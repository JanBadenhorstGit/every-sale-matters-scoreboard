"""Every Sale Matters v2 — lead funnel pipeline (PRIVATE: runs where the ActiveCampaign credential is available).

Pulls the contacts created in ActiveCampaign over the last N days, joins them to the
registration sheets by CRM ID (phone as a fallback), and writes DE-IDENTIFIED aggregates to
v2/data/leads.json: funnel per college × channel, speed to allocation, landing pages,
registrar lead conversion, unconverted pools, lead age at sale and sale-link quality.

No names, emails, phones or IDs leave this process. Raw API pages are cached per day under
sheets_private/ac/ (git-ignored) so a run only re-fetches recent days.

Run:  pplx credentials run <activecampaign handle> -- python3 v2/pipeline_leads.py [--days 45]
"""
import argparse, collections, json, re, statistics, subprocess, sys, time, urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import scoreboard_pipeline as v1  # noqa: E402

OUT = HERE / "data" / "leads.json"
RAW = HERE.parent / "sheets_private" / "ac"
BASE = "https://skillsacademy6941.api-us1.com/api/3/"
SAST = timezone(timedelta(hours=2))

# ActiveCampaign schema (ids verified 1 Nov 2026)
ENQUIRY_LISTS = {"2": "Bellview Inst.", "3": "Matric College", "4": "Skills Academy"}
SOURCE_FIELDS = {"12": "Matric College", "14": "Bellview Inst.", "18": "Skills Academy"}
REGISTRAR_FIELDS = {"10": "Matric College", "9": "Bellview Inst.", "11": "Skills Academy"}
STAGE_FIELDS = {"22": "Matric College", "24": "Bellview Inst.", "30": "Skills Academy"}
OLD_ENQUIRY_FIELDS = {"95", "120", "152"}
F_URL, F_SOURCE_PAGE, F_CHANNEL, F_FIRST_REF, F_COURSE = "83", "339", "341", "342", "2"
CHANNEL_TAGS = {"49": ("Matric College", "Site"), "50": ("Matric College", "Facebook"), "51": ("Matric College", "PPC"),
                "52": ("Bellview Inst.", "Site"), "53": ("Bellview Inst.", "Facebook"), "54": ("Bellview Inst.", "PPC"),
                "55": ("Skills Academy", "Site"), "56": ("Skills Academy", "Facebook"), "57": ("Skills Academy", "PPC"),
                "95": ("Skills Academy", "PPC Display")}
COLLEGE_WORDS = {"skills": "Skills Academy", "matric": "Matric College", "bellview": "Bellview Inst."}


def api(path, **params):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    for attempt in range(6):
        p = subprocess.run(["curl", "-sS", "-g", "--fail", "--max-time", "120", url], capture_output=True, text=True)
        if p.returncode == 0:
            time.sleep(0.3)  # stay under the 5 requests/second account limit
            return json.loads(p.stdout)
        time.sleep(5 * (attempt + 1))  # 429 / transient errors: back off
    raise RuntimeError(f"ActiveCampaign request failed: {path} ({p.stderr.strip()[:200]})")


def fetch_day(day: date):
    """All contacts created on `day` (UTC-ish window from the API), with their field values, tags and lists."""
    contacts, fv, tags, lists = [], [], [], []
    offset = 0
    while True:
        d = api("contacts", limit=100, offset=offset, include="fieldValues,contactTags,contactLists",
                **{"filters[created_after]": f"{day.isoformat()}T00:00:00",
                   "filters[created_before]": f"{(day + timedelta(days=1)).isoformat()}T00:00:00"})
        contacts += d.get("contacts", []); fv += d.get("fieldValues", []); tags += d.get("contactTags", []); lists += d.get("contactLists", [])
        total = int(d.get("meta", {}).get("total", 0))
        offset += 100
        if offset >= total or not d.get("contacts"):
            break
    return {"contacts": contacts, "fieldValues": fv, "contactTags": tags, "contactLists": lists}


def fetch_ids(ids):
    out = {"contacts": [], "fieldValues": [], "contactTags": [], "contactLists": []}
    ids = sorted(set(ids))
    for i in range(0, len(ids), 50):
        d = api("contacts", limit=50, ids=",".join(ids[i:i + 50]), include="fieldValues,contactTags,contactLists")
        for k in out:
            out[k] += d.get(k, [])
    return out


def strip(raw):
    """Reduce a raw API page to the fields we need, dropping names/emails. Phones are kept only in memory for matching."""
    fv = collections.defaultdict(dict); fvu = collections.defaultdict(dict)
    for x in raw["fieldValues"]:
        fv[x["contact"]][x["field"]] = x.get("value"); fvu[x["contact"]][x["field"]] = x.get("udate")
    tags = collections.defaultdict(list)
    for x in raw["contactTags"]:
        tags[x["contact"]].append((x["tag"], x.get("cdate")))
    lists = collections.defaultdict(list)
    for x in raw["contactLists"]:
        lists[x["contact"]].append((x["list"], x.get("sourceid"), x.get("sdate")))
    out = {}
    for c in raw["contacts"]:
        cid = c["id"]
        out[cid] = {"cdate": c["cdate"], "udate": c.get("udate"), "phone": digits(c.get("phone")), "fields": fv.get(cid, {}),
                    "fudate": fvu.get(cid, {}), "tags": tags.get(cid, []), "lists": lists.get(cid, [])}
    return out


def digits(v):
    s = re.sub(r"\D", "", str(v or ""))
    return s[-9:] if len(s) >= 9 else None


def ts(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s).astimezone(SAST)
    except ValueError:
        return None


def classify(c):
    """college, channel, registrar first name, allocation time, stage, stage time, landing path, old-enquiry flag."""
    college = None; channel = None; src_val = None
    for f, col in SOURCE_FIELDS.items():
        v = c["fields"].get(f)
        if v:
            college, src_val = col, str(v)
            break
    if not college:
        for lid, _, _ in c["lists"]:
            if lid in ENQUIRY_LISTS:
                college = ENQUIRY_LISTS[lid]; break
    for tid, _ in c["tags"]:
        if tid in CHANNEL_TAGS:
            tcol, tch = CHANNEL_TAGS[tid]
            college = college or tcol; channel = channel or tch
    if src_val:
        s = src_val.lower()
        channel = ("Facebook" if "facebook" in s else "PPC Display" if "display" in s else "PPC" if "ppc" in s or "google" in s
                   else "Site" if "site" in s or "web" in s else "WhatsApp" if "whatsapp" in s else "Other")
    chan_field = c["fields"].get(F_CHANNEL)
    if not channel and chan_field:
        channel = str(chan_field).strip().title()[:20]
    registrar = None; alloc_at = None
    for f in REGISTRAR_FIELDS:
        v = c["fields"].get(f)
        if v and str(v).strip():
            registrar = str(v).strip().split()[0].lower(); alloc_at = ts(c["fudate"].get(f)); break
    stage = None; stage_at = None
    for f in STAGE_FIELDS:
        v = c["fields"].get(f)
        if v and str(v).strip():
            stage = str(v).strip(); stage_at = ts(c["fudate"].get(f)); break
    url = c["fields"].get(F_URL) or c["fields"].get(F_SOURCE_PAGE)
    path = None
    if url:
        u = str(url).strip()
        u = re.sub(r"^https?://(www\.)?", "", u)
        path = u.split("?")[0].rstrip("/")[:80] or None
    old = any(c["fields"].get(f) for f in OLD_ENQUIRY_FIELDS)
    first_ref = c["fields"].get(F_FIRST_REF)
    is_lead = college is not None and (bool(src_val) or any(l in ENQUIRY_LISTS for l, _, _ in c["lists"]) or any(t in CHANNEL_TAGS for t, _ in c["tags"]))
    return {"college": college, "channel": channel or "Unknown", "registrar": registrar, "alloc_at": alloc_at, "stage": stage,
            "stage_at": stage_at, "path": path, "old": old, "first_ref": (str(first_ref).strip()[:40] if first_ref else None), "is_lead": is_lead}


def load_sales():
    """{crm_id: {d, reg, college, do, inst, dept, phone}} from every cached registration sheet."""
    from v2.pipeline_sales import course_family  # noqa: WPS433
    sales = {}
    for key, sid in v1.SHEETS.items():
        if key in ("incentive", "comparison"):
            continue
        path = v1.CACHE / f"{key}_{sid}.xlsx"
        if not path.exists():
            try:
                v1.CACHE.mkdir(parents=True, exist_ok=True)
                v1.download(sid, path)
            except Exception as e:  # public export failed; skip that month
                print(f"could not download {key}: {e}", file=sys.stderr)
                continue
        wb = openpyxl.load_workbook(path, read_only=True)
        for ws in wb.worksheets:
            d = v1.parse_day_tab(ws.title)
            if not d:
                continue
            college = None
            for r in ws.iter_rows(min_row=2, values_only=True):
                registrar = str(v1.g(r, 0)).strip()
                if registrar.startswith("="):
                    label = str(v1.g(r, 1)).lower()
                    for w, col in COLLEGE_WORDS.items():
                        if w in label:
                            college = col
                    continue
                crm = str(v1.g(r, 2)).strip().replace(".0", "")
                if not registrar or not crm.isdigit():
                    continue
                if str(v1.g(r, 12)).strip().lower() == "cancelled":
                    continue
                inst = None
                m = re.search(r"[\d.,]+", str(v1.g(r, 14)))
                if m:
                    try:
                        inst = float(m.group(0).replace(",", ""))
                    except ValueError:
                        inst = None
                if inst and inst > 20000:
                    inst = None
                dept = course_family(str(v1.g(r, 7)))[0]
                sales[crm] = {"d": d.isoformat(), "reg": v1.norm(registrar).split()[0] if registrar else None, "college": college,
                              "do": str(v1.g(r, 11)).strip().upper() == "X", "inst": inst, "dept": dept, "phone": digits(v1.g(r, 5))}
        wb.close()
    return sales


def pctl(xs, q):
    if not xs:
        return None
    xs = sorted(xs); k = (len(xs) - 1) * q; f = int(k); c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=45)
    ap.add_argument("--refetch", type=int, default=10, help="re-fetch this many most recent days (field values change)")
    a = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    today = datetime.now(SAST).date()
    days = [today - timedelta(days=i) for i in range(1, a.days + 1)]
    contacts = {}
    for i, d in enumerate(sorted(days)):
        f = RAW / f"{d.isoformat()}.json"
        if f.exists() and (today - d).days > a.refetch:
            raw = json.loads(f.read_text())
        else:
            raw = strip(fetch_day(d))
            f.write_text(json.dumps(raw, separators=(",", ":")))
            print(f"fetched {d}: {len(raw)} contacts", file=sys.stderr)
        contacts.update(raw)
    sales = load_sales()
    print(f"sales rows with CRM id: {len(sales)}", file=sys.stderr)
    # sale contacts created before the window: fetch by id so lead age at sale and source are known
    missing = [cid for cid in sales if cid not in contacts and sales[cid]["d"] >= (today - timedelta(days=a.days)).isoformat()]
    if missing:
        extra = strip(fetch_ids(missing))
        contacts.update(extra)
        print(f"fetched {len(extra)} older sale contacts by id", file=sys.stderr)
    # phone index for fallback matching (memory only)
    by_phone = collections.defaultdict(list)
    for cid, c in contacts.items():
        if c["phone"]:
            by_phone[c["phone"]].append(cid)

    window_from = (today - timedelta(days=a.days)).isoformat()
    month = today.strftime("%Y-%m")
    leads = {}
    for cid, c in contacts.items():
        k = classify(c)
        if not k["is_lead"]:
            continue
        cd = ts(c["cdate"])
        if not cd or cd.date().isoformat() < window_from:
            continue
        k["cdate"] = cd; k["id"] = cid; k["sale"] = None
        leads[cid] = k
    # link sales to leads
    link = collections.Counter(); age_hist = collections.defaultdict(collections.Counter)
    sale_rows = {cid: s for cid, s in sales.items() if s["d"] >= window_from}
    for cid, s in sale_rows.items():
        mkey = s["d"][:7]
        lead = leads.get(cid)
        how = "same_contact" if lead else None
        if not lead:
            c = contacts.get(cid)
            if c:
                k = classify(c)
                if k["is_lead"]:
                    cd = ts(c["cdate"]); k.update({"cdate": cd, "id": cid, "sale": None}); lead = k; how = "same_contact_older"
        if not lead and s["phone"]:
            for other in by_phone.get(s["phone"], []):
                if other in leads and other != cid:
                    lead = leads[other]; how = "phone_match"; break
        if lead:
            lead["sale"] = s
            age = (date.fromisoformat(s["d"]) - lead["cdate"].date()).days
            bucket = "same day" if age <= 0 else "1–7 days" if age <= 7 else "8–30 days" if age <= 30 else "31–90 days" if age <= 90 else "over 90 days"
            age_hist[mkey][bucket] += 1
        else:
            how = "no_lead_found"; age_hist[mkey]["no lead found"] += 1
        link[(mkey, how)] += 1

    # ---- aggregates ----
    daily = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: {"leads": 0, "allocated": 0, "registered": 0, "do": 0})))
    monthly = collections.defaultdict(lambda: collections.defaultdict(lambda: collections.defaultdict(lambda: {"leads": 0, "allocated": 0, "staged": 0, "registered": 0, "do": 0, "inst_sum": 0.0, "inst_n": 0})))
    speed = collections.defaultdict(list); speed_reg = collections.defaultdict(list); never = collections.Counter(); lead_n = collections.Counter()
    pages = collections.defaultdict(lambda: {"leads": 0, "registered": 0})
    regs = collections.defaultdict(lambda: {"leads": 0, "registered": 0, "do": 0})
    pools = collections.defaultdict(lambda: collections.defaultdict(lambda: {"d7_30": 0, "d30_plus": 0, "d0_7": 0}))
    stages = collections.defaultdict(collections.Counter)
    old_re = collections.Counter(); attribution = collections.defaultdict(collections.Counter)
    for L in leads.values():
        dk = L["cdate"].date().isoformat(); mk = dk[:7]; col = L["college"]; ch = L["channel"]
        d = daily[dk][col][ch]; m = monthly[mk][col][ch]
        d["leads"] += 1; m["leads"] += 1
        if L["registrar"]:
            d["allocated"] += 1; m["allocated"] += 1
        if L["stage"] and L["stage"].lower() != "allocated":
            m["staged"] += 1
        if L["sale"]:
            d["registered"] += 1; m["registered"] += 1
            if L["sale"]["do"]:
                d["do"] += 1; m["do"] += 1
            if L["sale"]["inst"]:
                m["inst_sum"] += L["sale"]["inst"]; m["inst_n"] += 1
        # speed to allocation (minutes), leads created on working hours or not; only leads older than 1 day are judged for 'never'
        if (today - L["cdate"].date()).days >= 3:
            lead_n[col] += 1
        if L["alloc_at"] and L["alloc_at"] >= L["cdate"]:
            mins = (L["alloc_at"] - L["cdate"]).total_seconds() / 60
            speed[col].append(mins)
            if L["registrar"]:
                speed_reg[L["registrar"]].append(mins)
        elif not L["registrar"] and (today - L["cdate"].date()).days >= 3:
            never[col] += 1
        if L["path"]:
            p = pages[(col, L["path"])]; p["leads"] += 1; p["registered"] += 1 if L["sale"] else 0
        if L["registrar"]:
            r = regs[L["registrar"]]; r["leads"] += 1
            if L["sale"]:
                r["registered"] += 1; r["do"] += 1 if L["sale"]["do"] else 0
        if not L["sale"]:
            age = (today - L["cdate"].date()).days
            pl = pools[col][ch]; pl["d0_7" if age <= 7 else "d7_30" if age <= 30 else "d30_plus"] += 1
        if (today - L["cdate"].date()).days >= 3:
            stages[col][L["stage"] or "not set"] += 1
        if L["old"]:
            old_re[mk] += 1
        if L["first_ref"]:
            attribution[L["first_ref"]][ch] += 1

    def speed_block(xs, n_total, nev):
        return {"n": len(xs), "median_min": round(statistics.median(xs)) if xs else None, "p75_min": round(pctl(xs, 0.75)) if xs else None,
                "within_1h_pct": round(100 * sum(1 for x in xs if x <= 60) / len(xs)) if xs else None,
                "within_24h_pct": round(100 * sum(1 for x in xs if x <= 1440) / len(xs)) if xs else None,
                "never_allocated_pct": round(100 * nev / n_total) if n_total else None}

    payload = {
        "generated_at": datetime.now(SAST).isoformat(timespec="seconds"),
        "window": {"from": window_from, "to": (today - timedelta(days=1)).isoformat(), "days": a.days},
        "month": month,
        "daily": daily, "monthly": monthly,
        "speed": {"by_college": {c: speed_block(xs, lead_n[c], never[c]) for c, xs in speed.items()},
                  "by_registrar": {r: speed_block(xs, len(xs), 0) for r, xs in speed_reg.items() if len(xs) >= 10}},
        "pages": sorted([{"college": c, "path": p, **v} for (c, p), v in pages.items()], key=lambda x: -x["leads"])[:60],
        "registrars": {r: {**v, "conv_pct": round(100 * v["registered"] / v["leads"], 1) if v["leads"] else None,
                           "leads_per_sale": round(v["leads"] / v["registered"], 1) if v["registered"] else None} for r, v in regs.items() if v["leads"] >= 10},
        "pools": pools, "stages": stages, "old_enquiries": old_re,
        "lead_age_at_sale": age_hist,
        "sale_link": {f"{m}": {how: n for (mm, how), n in link.items() if mm == m} for m in {mm for mm, _ in link}},
        "attribution": {k: dict(v) for k, v in sorted(attribution.items(), key=lambda kv: -sum(kv[1].values()))[:15]},
        "notes": {"allocation_time": "udate of the college Registrar field = when the registrar was (last) assigned",
                  "registered": "lead's CRM ID (or phone) appears in a registration sheet in the window; cancelled rows excluded",
                  "staged": "Sale Stage field set to anything other than 'Allocated'"},
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":"), default=str))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes): {len(leads)} leads, {len(sale_rows)} sales in window", file=sys.stderr)


if __name__ == "__main__":
    main()
