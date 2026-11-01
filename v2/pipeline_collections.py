#!/usr/bin/env python3
"""Every Sale Matters v2 — collections data pipeline.

Reads two internal spreadsheets that must NOT be made public (they contain
student names and numbers) and writes only aggregates / de-identified rows to
v2/data/collections.json:

  * "Collections Daily Goal" (Matthew): daily bank receipts per college split
    into Sales / Collections / Unclaimed, plus the monthly cash goal vs actual.
  * "2026 Cancellation Track Sheet" (Nishaad): one row per cancellation request,
    with salvage attempts, outcome, category, the collections agent handling it
    and the registrar who made the sale.

The sheets are exported with the `gws` CLI (Google Workspace, signed in as the
scoreboard owner), so this script runs from a trusted machine or a scheduled
Perplexity task — never in the public GitHub Action. Pass --from-files to use
already-exported .xlsx files instead (collections_goal.xlsx, cancellations.xlsx
in the --src directory).
"""
import argparse
import json
import re
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
OUT = HERE / "data" / "collections.json"

SHEETS = {
    "collections_goal": "12kFS07aCpsQbD_SJUP7JlTgUKjkqXFgii2eGMxIbRdI",
    "tests": "1-m8103ELclQ4D-awSBqK57315XX6vpe_2K11OvwG4YQ",  # ESM Tests register (Jan)
    "cancellations": "1iKxDM1EEYgd6a1MOIlG5r09CWABgAB9XtrAiVV7GNsI",
}
YEAR = 2026
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August",
     "September", "October", "November", "December"], 1)}
COLLEGE_ALIASES = {"skills academy": "Skills Academy", "skills": "Skills Academy",
                   "bellview": "Bellview Inst.", "bellview institute": "Bellview Inst.",
                   "matric": "Matric College", "matric college": "Matric College"}


def export(sheet_id, dest):
    cmd = ["gws", "drive", "files", "export", "--params",
           json.dumps({"fileId": sheet_id,
                       "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),
           "--output", str(dest)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=300)
    return dest


def num(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[R\s,]", "", str(v))
    try:
        return float(s)
    except ValueError:
        return None


def month_key(name):
    m = MONTHS.get(name.strip().lower().rstrip("."))
    return f"{YEAR}-{m:02d}" if m else None


def parse_bank(wb):
    """{'2026-09': {'Skills Academy': [{dom, label, sales, collections, unclaimed}, ...]}}"""
    bank = {}
    for title in wb.sheetnames:
        m = re.match(r"^\s*(Skills Academy|Bellview|Matric)\s+Bank\s+([A-Za-z]+)\s*$", title)
        if not m:
            continue
        mk = month_key(m.group(2))
        if not mk:
            continue
        college = COLLEGE_ALIASES[m.group(1).lower()]
        rows = []
        for r in wb[title].iter_rows(values_only=True):
            label = str(r[0] or "").strip()
            dom = num(r[1]) if len(r) > 1 else None
            if not label or dom is None:
                continue
            rows.append({"dom": int(dom), "label": label.title(),
                         "sales": num(r[2]) if len(r) > 2 else None,
                         "collections": num(r[3]) if len(r) > 3 else None,
                         "unclaimed": num(r[4]) if len(r) > 4 else None})
        if rows:
            bank.setdefault(mk, {})[college] = rows
    return bank


def parse_goals(wb):
    """{'2026-09': [{dom, goal_day, goal_cum, actual_day, actual_cum}]} — cycle runs 8th..7th."""
    goals = {}
    for title in wb.sheetnames:
        m = re.match(r"^\s*([A-Za-z]+)\s+Month(?:ly)?\s+Goal\.?\s*$", title, re.I)
        if not m:
            continue
        mk = month_key(m.group(1))
        if not mk:
            continue
        rows = []
        for r in wb[title].iter_rows(min_row=2, values_only=True):
            dom = num(r[0]) if r else None
            if dom is None:
                continue
            rows.append({"dom": int(dom), "goal_day": num(r[1]), "goal_cum": num(r[2]),
                         "actual_day": num(r[5]) if len(r) > 5 else None,
                         "actual_cum": num(r[6]) if len(r) > 6 else None})
        if rows:
            goals[mk] = rows
    return goals


def parse_cycle_title(title):
    m = re.match(r"^\s*(\d{1,2})\s*([A-Za-z]+)\s*-\s*(\d{1,2})\s*([A-Za-z]+)\s*$", title.strip())
    if not m:
        return None
    m1, m2 = MONTHS.get(m.group(2).lower()), MONTHS.get(m.group(4).lower())
    if not (m1 and m2):
        return None
    start = date(YEAR, m1, int(m.group(1)))
    end_year = YEAR + 1 if m2 < m1 else YEAR
    end = date(end_year, m2, int(m.group(3)))
    return start, end


def to_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%Y"):
            try:
                return datetime.strptime(v.strip()[:10], fmt).date()
            except ValueError:
                pass
    return None


def yes(v):
    return str(v or "").strip().lower() in ("yes", "true", "y")


def agent_name(v):
    s = str(v or "").strip()
    if not s or s.lower() in ("none", "n/a", "no advisor"):
        return None
    return s.split("@")[0].strip().title()


COURSE_TYPES = {"matric", "provider", "qcto", "icb", "nated"}
ACC_STATUSES = {"current", "on hold", "pending", "study break", "cancelled", "canceled", "paid up"}


def detect_layout(raw_rows):
    """Find the Course column by content and anchor the trailing columns on it.

    The sheet's trailing columns drift between tabs (October 2026 rows sit one column left of
    their headers from 'Account status' onward), so the header row cannot be trusted. Course
    is the one column whose values are almost all Matric/Provider/QCTO/ICB/Nated; College is
    the column after it; Agent (sales), Collection agent and Student advisor are the three
    columns before it; Account status is the column before those only if it looks like one.
    """
    width = max((len(r) for r in raw_rows), default=0)
    best, best_i = 0, None
    for i in range(20, width):
        vals = [str(r[i]).strip().lower() for r in raw_rows if i < len(r) and r[i] is not None]
        if len(vals) < 5:
            continue
        hit = sum(v in COURSE_TYPES for v in vals) / len(vals)
        if hit > best:
            best, best_i = hit, i
    if best_i is None or best < 0.8:
        return None
    c = best_i
    acc_vals = [str(r[c - 5]).strip().lower() for r in raw_rows if c - 5 < len(r) and r[c - 5] is not None]
    acc_ok = acc_vals and sum(v in ACC_STATUSES for v in acc_vals) / len(acc_vals) > 0.6
    return {"course": c, "college": c + 1, "sales_agent": c - 2, "agent": c - 3, "advisor": c - 4,
            "acc_status": c - 5 if acc_ok else None, "shifted": not acc_ok}


def offer_type(v):
    """Bucket the free-text 'Salvage Offer Made' into a handful of offer types."""
    t = str(v or "").strip().lower()
    if not t or t.startswith("no offer"):
        return None
    if "transfer" in t or "tranfer" in t or "change" in t and "course" in t:
        return "Course transfer"
    if "study break" in t or "hold" in t:
        return "Study break / hold"
    if "payment plan" in t or "instal" in t or "lower" in t or "split" in t or "arrang" in t:
        return "Payment plan"
    if "payment method" in t or "debit" in t:
        return "Change payment method"
    if "advise" in t or "advice" in t or "import" in t or "motivat" in t:
        return "Motivation / advice"
    return "Other offer"


def parse_cancellations(wb, max_cycles=4):
    cycles = {}
    for title in wb.sheetnames:
        span = parse_cycle_title(title)
        if not span:
            continue
        start, end = span
        rows = []
        raw = [r for r in wb[title].iter_rows(min_row=3, values_only=True) if r and r[0]]
        lay = detect_layout(raw)
        if not lay:
            print(f"cancellations: could not detect course column in '{title}', skipped", file=sys.stderr)
            continue
        if lay["shifted"]:
            print(f"cancellations: '{title}' rows are offset from headers (no Account status column)", file=sys.stderr)
        for r in raw:
            logged = to_date(r[0] if r else None)
            if not logged:
                continue
            # Typo years (3026, 2027) or dates far outside the cycle: trust the cycle year.
            if logged.year != YEAR or not (start - timedelta(days=120) <= logged <= end + timedelta(days=31)):
                try:
                    logged = logged.replace(year=start.year if logged.month >= start.month else end.year)
                except ValueError:
                    continue
            if not (str(r[1] or "").strip() or str(r[2] or "").strip()):
                continue  # no student reference: template/blank row
            g = lambda i: r[i] if i < len(r) else None  # noqa: E731
            attempts = []
            for i in (9, 11, 13):
                meth = str(g(i) or "").strip()
                if meth and meth.lower() not in ("n/a", "none"):
                    attempts.append(meth)
            status = str(g(17) or "").strip()
            processed = bool(status or str(g(15) or "").strip())
            fault = str(g(22) or "").strip().lower()
            rows.append({
                "logged": logged.isoformat(),
                "logger": agent_name(g(3)),
                "college": COLLEGE_ALIASES.get(str(g(lay["college"]) or "").strip().lower(), str(g(lay["college"]) or "").strip() or None),
                "course": str(g(lay["course"]) or "").strip() or None,
                "category": str(g(15) or "").strip() or None,
                "status": status or None,
                "processed": processed,
                "sent_to_collections": yes(g(7)),
                "attempts": attempts,
                "offer_made": bool(str(g(18) or "").strip()) and not str(g(18) or "").strip().lower().startswith("no offer"),
                "offer_accepted": yes(g(19)),
                "our_fault": fault.startswith("yes"),
                "offer": offer_type(g(18)),
                "acc_status": (str(g(lay["acc_status"]) or "").strip() or None) if lay["acc_status"] is not None else None,
                "advisor": agent_name(g(lay["advisor"])),
                "agent": agent_name(g(lay["agent"])),
                "sales_agent": agent_name(g(lay["sales_agent"])),
            })
        cycles[start.isoformat()] = {"label": title.strip(), "start": start.isoformat(),
                                     "end": end.isoformat(), "rows": rows,
                                     "layout_shifted": lay["shifted"]}
    keep = sorted(cycles)[-max_cycles:]
    return {k: cycles[k] for k in keep}


def parse_tests(wb):
    """Tests register: one row per A/B or price test with exposed/converted counts per variant."""
    if "Tests" not in wb.sheetnames:
        return []
    out = []
    for r in wb["Tests"].iter_rows(min_row=2, values_only=True):
        if not r or not r[0] or str(r[0]).strip().lower().startswith("example"):
            continue
        g = lambda i: r[i] if i < len(r) else None  # noqa: E731
        d = lambda v: (to_date(v).isoformat() if to_date(v) else None)  # noqa: E731
        out.append({
            "test": str(g(0)).strip(), "type": str(g(1) or "").strip() or None, "owner": str(g(2) or "").strip() or None,
            "start": d(g(3)), "end": d(g(4)), "metric": str(g(5) or "").strip() or None,
            "a": {"name": str(g(6) or "A").strip(), "n": int(num(g(7)) or 0), "conv": int(num(g(8)) or 0)},
            "b": {"name": str(g(9) or "B").strip(), "n": int(num(g(10)) or 0), "conv": int(num(g(11)) or 0)},
            "status": str(g(12) or "").strip() or None, "notes": str(g(13) or "").strip() or None,
        })
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(HERE.parent / "sheets_private"))
    ap.add_argument("--from-files", action="store_true")
    a = ap.parse_args()
    src = Path(a.src)
    src.mkdir(exist_ok=True)
    files = {}
    for key, sid in SHEETS.items():
        dest = src / f"{key}.xlsx"
        if not a.from_files:
            try:
                export(sid, dest)
                print(f"exported {key}: {dest.stat().st_size} bytes", file=sys.stderr)
            except Exception as e:  # noqa: BLE001
                print(f"export failed for {key}: {e}", file=sys.stderr)
        if dest.exists():
            files[key] = dest

    sast = timezone(timedelta(hours=2))
    payload = {"generated_at": datetime.now(sast).isoformat(timespec="seconds"), "sources": {}}
    if "collections_goal" in files:
        wb = openpyxl.load_workbook(files["collections_goal"], read_only=True, data_only=True)
        payload["bank"] = parse_bank(wb)
        payload["goals"] = parse_goals(wb)
        wb.close()
        payload["sources"]["bank"] = {"sheet": SHEETS["collections_goal"],
                                      "latest_month": max(payload["bank"]) if payload["bank"] else None,
                                      "latest_goal_month": max(payload["goals"]) if payload["goals"] else None}
    if "cancellations" in files:
        wb = openpyxl.load_workbook(files["cancellations"], read_only=True, data_only=True)
        payload["cancellations"] = parse_cancellations(wb)
        wb.close()
        all_logged = [r["logged"] for c in payload["cancellations"].values() for r in c["rows"]]
        payload["sources"]["cancellations"] = {"sheet": SHEETS["cancellations"],
                                               "latest_logged": max(all_logged) if all_logged else None,
                                               "rows": len(all_logged)}
    if "tests" in files:
        wb = openpyxl.load_workbook(files["tests"], read_only=True, data_only=True)
        payload["tests"] = parse_tests(wb)
        wb.close()
        payload["sources"]["tests"] = {"sheet": SHEETS["tests"], "rows": len(payload["tests"])}
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), default=str))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
