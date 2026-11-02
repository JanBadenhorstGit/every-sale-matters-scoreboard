#!/usr/bin/env python3
"""Every Sale Matters v2 — sales data pipeline.

Builds v2/data/sales.json from the same public Google Sheets the v1 scoreboard
uses (Registration Spreadsheets per month, the weekly incentive sheet, and the
comparison sheet for the roster and August baselines), but keeps a per-day,
per-registrar record with sale-quality fields and merges it into a persistent
history so months survive even after their sheet is no longer shared.

No student names, ID numbers, phone numbers or CRM IDs are written anywhere.
"""
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import scoreboard_pipeline as v1  # noqa: E402  (reuses sheet IDs, download, counting helpers)

DATA = HERE / "data"
OUT = DATA / "sales.json"

# Registration Spreadsheet column positions (0-based) — see the sheet header row.
COL_REGISTRAR, COL_CRM, COL_STUDENT = 0, 2, 4
COL_PAID, COL_DO, COL_STATUS = 10, 11, 12
COL_FP_DATE, COL_FP_AMT, COL_PARGO = 13, 14, 17
COL_COURSE = 7

ONCE_OFF_MIN = 3000.0  # a "1st Payment" above this is a once-off (full fee / large deposit), not a monthly instalment

INSTALMENT_BANDS = [("lt400", 0, 400), ("b400_699", 400, 700), ("b700_1499", 700, 1500), ("ge1500", 1500, 10**9)]
LEADTIME_BANDS = [("le7", -10**6, 8), ("d8_14", 8, 15), ("d15_30", 15, 31), ("gt30", 31, 10**6)]

AMOUNT_RE = re.compile(r"[-+]?\d[\d\s,]*(?:[.,]\d{1,2})?")


def parse_amount(v):
    """'R 2 095', 'R490', 'R 490,00', 6285.0 -> float; anything else -> None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s or not any(ch.isdigit() for ch in s):
        return None
    s = s.replace("R", "").replace("r", "").strip()
    m = AMOUNT_RE.search(s)
    if not m:
        return None
    t = m.group(0).replace(" ", "")
    # '490,00' -> decimal comma; '2,095' -> thousands comma
    if re.search(r",\d{2}$", t):
        t = t.replace(".", "").replace(",", ".")
    else:
        t = t.replace(",", "")
    try:
        return float(t)
    except ValueError:
        return None


def parse_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d/%m/%y", "%d %b %Y", "%d %B %Y"):
            try:
                return datetime.strptime(v.strip()[:10], fmt).date()
            except ValueError:
                continue
    return None


def band(value, bands):
    if value is None:
        return "unknown"
    for key, lo, hi in bands:
        if lo <= value < hi:
            return key
    return "unknown"


def empty_rec():
    r = {"reg": 0, "do": 0, "paid_n": 0, "paid_amt": 0.0, "digital": 0, "pup": 0,
         "inst": {k: 0 for k, _, _ in INSTALMENT_BANDS} | {"unknown": 0},
         "lead": {k: 0 for k, _, _ in LEADTIME_BANDS} | {"unknown": 0},
         "inst_sum": 0.0, "inst_n": 0,
         # once-off first payments (> ONCE_OFF_MIN): count, amount agreed, and the part not yet in the Paid column
         "once_n": 0, "once_amt": 0.0, "once_due": 0.0}
    return r


def section_college(label):
    """Section header in column B ('Skills First Response team', 'Matric College Total', 'Bellview Insitute')."""
    t = str(label or "").lower()
    if "skills" in t:
        return "Skills Academy"
    if "matric" in t:
        return "Matric College"
    if "bellview" in t:
        return "Bellview Inst."
    return None


NOT_PEOPLE = {"cancelled", "staff bursary", "total", "registrar"}


def parse_day_tab(ws, tab_date):
    """Per-registrar sale records for one daily tab (same qualifying rule as v1).

    Also returns {registrar_key: college} learned from the college section the
    row sits in, and a course mix for the day.
    """
    recs = {}
    college_of = {}
    courses = {}
    current_college = None
    for r in ws.iter_rows(min_row=2, values_only=True):
        registrar = str(v1.g(r, COL_REGISTRAR)).strip()
        if registrar.startswith("="):
            current_college = section_college(v1.g(r, 1)) or current_college
            continue
        if not registrar or v1.norm(registrar) in NOT_PEOPLE:
            continue
        crm = str(v1.g(r, COL_CRM)).strip()
        student = str(v1.g(r, COL_STUDENT)).strip()
        if not (crm or student):
            continue
        status = str(v1.g(r, COL_STATUS)).strip().lower()
        if status == "cancelled":
            continue
        key = v1.norm(registrar)
        if current_college:
            college_of[key] = current_college
        rec = recs.setdefault(key, empty_rec())
        rec["reg"] += 1
        if str(v1.g(r, COL_DO)).strip().upper() == "X":
            rec["do"] += 1
        paid = parse_amount(v1.g(r, COL_PAID))
        if paid and paid > 0:
            rec["paid_n"] += 1
            rec["paid_amt"] += paid
        pargo = str(v1.g(r, COL_PARGO)).strip().lower()
        if pargo == "digital":
            rec["digital"] += 1
        elif pargo:
            rec["pup"] += 1
        inst = parse_amount(v1.g(r, COL_FP_AMT))
        if inst and inst > 20000:
            inst = None  # a 6-figure 'monthly instalment' is a capture error (e.g. ID number in the amount column)
        once = None
        if inst and inst > ONCE_OFF_MIN:
            # ICB / Nated / some Matric sales are paid as one amount (R3,000-R14,800). Treat as a once-off:
            # value it at the amount paid, show it under upfront cash, keep it out of the instalment average.
            once, inst = inst, None
            rec["once_n"] += 1
            rec["once_amt"] += once
            if not (paid and paid > 0):
                rec["once_due"] += once  # not yet reflected in the Paid column (first-payment date still ahead)
        rec["inst"][band(inst, INSTALMENT_BANDS)] += 1
        if inst:
            rec["inst_sum"] += inst
            rec["inst_n"] += 1
        fp = parse_date(v1.g(r, COL_FP_DATE))
        lead = (fp - tab_date).days if fp else None
        rec["lead"][band(lead, LEADTIME_BANDS)] += 1
        course = re.sub(r"\s+", " ", str(v1.g(r, COL_COURSE)).strip())[:60]
        if course:
            c = courses.setdefault(course, {"n": 0, "do": 0, "paid_n": 0, "paid_amt": 0.0,
                                            "inst_sum": 0.0, "inst_n": 0, "once_n": 0, "once_amt": 0.0, "once_due": 0.0,
                                            "college": current_college})
            c["n"] += 1
            c["do"] += 1 if str(v1.g(r, COL_DO)).strip().upper() == "X" else 0
            if paid and paid > 0:
                c["paid_n"] += 1
                c["paid_amt"] += paid
            if inst:
                c["inst_sum"] += inst
                c["inst_n"] += 1
            if once:
                c["once_n"] += 1
                c["once_amt"] += once
                if not (paid and paid > 0):
                    c["once_due"] += once
    return recs, college_of, courses


def course_family(name):
    """Collapse messy course strings into (department, family, variant).

    Departments match the Cancellation Track Sheet's course field: Matric, Provider, QCTO, ICB, Nated.
    """
    n = re.sub(r"\s+", " ", name).strip()
    low = n.lower()
    variant = None
    for v, pat in (("4th Team", r"4th team"), ("1st Team", r"1st team"), ("S&R", r"s\s*&\s*r")):
        if re.search(pat, low):
            variant = v
            break
    m = re.search(r"\b(asc|nsc)\b.*?(20\d\d)", low)
    if m:
        return "Matric", f"{m.group(1).upper()} Matric {m.group(2)}", variant
    if "matric" in low:
        return "Matric", "Matric (other)", variant
    if "icb" in low:
        return "ICB", re.sub(r"\s*\(.*?\)\s*", " ", n).strip(" -"), variant
    if "occupational certificate" in low or "qcto" in low:
        fam = re.sub(r"^(qcto\s+)?(national |higher |advanced )?occupational certificate:\s*", "", n, flags=re.I)
        toks = fam.strip()[:30].split()
        while toks and (len(toks[-1]) <= 3 or toks[-1].lower() in ("practi", "practit", "pract")):
            toks.pop()  # source strings are truncated; drop partial / joining words
        return "QCTO", " ".join(toks), variant
    if "national certificate" in low or re.search(r"\bn[4-6]\b", low) or "nated" in low:
        return "Nated", re.sub(r"\s*\(.*?\)\s*", " ", n).strip(" -")[:40], variant
    fam = re.sub(r"\s*\(.*?\)?\s*$", "", n)          # drop trailing "(Digital)" incl. truncated "("
    fam = re.sub(r"\s*\(.*?\)\s*", " ", fam)            # drop other parentheticals
    fam = re.sub(r"\s*[-–]\s*\(?\d+ ?(modules?|mo).*$", "", fam, flags=re.I)
    fam = re.sub(r"\s+(comprehensive )?(certificate|course|certifi\w*)\b.*$", "", fam, flags=re.I)
    fam = re.sub(r"\s+-\s+.*$", "", fam) if "short" not in low else fam
    return "Provider", fam.strip(" -:,")[:40], variant


def rollup_courses(courses):
    """Monthly totals per course family from the per-day course detail."""
    out = {}
    for day, mix in courses.items():
        month = day[:7]
        for name, v in mix.items():
            if not isinstance(v, dict):
                v = {"n": v, "do": 0, "paid_n": 0, "paid_amt": 0.0, "inst_sum": 0.0, "inst_n": 0,
                     "once_n": 0, "once_amt": 0.0, "once_due": 0.0, "college": None}
            dept, fam, variant = course_family(name)
            f = out.setdefault(month, {}).setdefault(fam, {"dept": dept, "n": 0, "do": 0, "paid_n": 0, "paid_amt": 0.0,
                                                            "inst_sum": 0.0, "inst_n": 0, "once_n": 0, "once_amt": 0.0, "once_due": 0.0,
                                                            "colleges": {}, "variants": {}})
            for k in ("n", "do", "paid_n", "paid_amt", "inst_sum", "inst_n", "once_n", "once_amt", "once_due"):
                f[k] += v.get(k, 0) or 0
            if v.get("college"):
                f["colleges"][v["college"]] = f["colleges"].get(v["college"], 0) + v["n"]
            if variant:
                f["variants"][variant] = f["variants"].get(variant, 0) + v["n"]
    return out


def load_reg_book(path):
    wb = openpyxl.load_workbook(path, read_only=True)
    days, colleges, courses = {}, {}, {}
    for ws in wb.worksheets:
        d = v1.parse_day_tab(ws.title)
        if not d:
            continue
        recs, college_of, mix = parse_day_tab(ws, d)
        days[d.isoformat()] = recs
        courses[d.isoformat()] = mix
        colleges.update(college_of)  # later tabs win
    wb.close()
    return days, colleges, courses


def main():
    DATA.mkdir(exist_ok=True)
    # 1. v1 pipeline: downloads/caches every sheet and computes roster, incentives, baselines.
    base = v1.main()
    files = {key: v1.CACHE / f"{key}_{sid}.xlsx" for key, sid in v1.SHEETS.items()}

    # 2. Rich per-day records from every Registration Spreadsheet that is available.
    fresh_days, fresh_courses, sheet_college = {}, {}, {}
    source_status = {}
    for key, path in files.items():
        if key in ("incentive", "comparison"):
            continue
        if not path.exists():
            source_status[key] = {"ok": False, "sheet": v1.SHEETS[key]}
            continue
        days, colleges, courses = load_reg_book(path)
        fresh_days.update(days)
        fresh_courses.update(courses)
        sheet_college.update(colleges)
        source_status[key] = {"ok": True, "sheet": v1.SHEETS[key], "days": len(days),
                              "latest": max(days) if days else None}

    # 3. Merge into persistent history (fresh data wins; old days survive).
    old, old_courses, old_colleges = {}, {}, {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text())
            old = prev.get("days", {})
            old_courses = prev.get("courses", {})
            old_colleges = {p["key"]: p["college"] for p in prev.get("roster", [])}
        except Exception as e:  # noqa: BLE001
            print(f"could not read previous sales.json: {e}", file=sys.stderr)
    days = {**old, **fresh_days}
    # month sheets carry every working day's tab from day one; drop the empty future tabs
    days = {d: v for d, v in days.items() if d <= base["latest_day"]}
    courses = {**old_courses, **fresh_courses}

    # 4. Roster: v1 people carry college + August baseline + this week's incentive.
    roster = []
    for p in base["people"]:
        roster.append({"name": p["name"], "key": v1.norm(p["name"]), "college": p["college"],
                       "aug_per_day": p["aug_per_day"], "incentive": p["incentive"]})
    known = {p["key"] for p in roster}
    # Registrars that sell but are not on the comparison-sheet roster (new starters,
    # spelling drift). They are added with the college of the sheet section they
    # appear in and no August baseline, so their sales still count.
    unrostered = sorted({k for d in days.values() for k in d} - known)
    for k in unrostered:
        college = sheet_college.get(k) or old_colleges.get(k) or "Unknown"
        roster.append({"name": k.title(), "key": k, "college": college, "aug_per_day": None,
                       "incentive": None, "unrostered": True})

    sast = timezone(timedelta(hours=2))
    payload = {
        "generated_at": datetime.now(sast).isoformat(timespec="seconds"),
        "latest_day": base["latest_day"],
        "month": base["month"],
        "config_stale": base["config_stale"],
        "aug_recorded_days": base["aug_recorded_days"],
        "incentive_week_days": base["periods"]["week"]["days"],
        "roster": roster,
        "unrostered": unrostered,
        "days": dict(sorted(days.items())),
        "courses": dict(sorted(courses.items())),
        "course_months": rollup_courses(courses),
        "sources": source_status,
        "schema": {
            "inst_bands": {"lt400": "under R400", "b400_699": "R400–699", "b700_1499": "R700–1,499",
                           "ge1500": "R1,500+", "unknown": "not captured"},
            "lead_bands": {"le7": "within 7 days", "d8_14": "8–14 days", "d15_30": "15–30 days",
                           "gt30": "over 30 days", "unknown": "no date"},
        },
    }
    OUT.write_text(json.dumps(payload, separators=(",", ":"), default=str))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes, {len(days)} days, {len(roster)} on roster, "
          f"{len(unrostered)} unrostered)", file=sys.stderr)
    return payload


if __name__ == "__main__":
    main()
