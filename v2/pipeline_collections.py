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


def parse_cancellations(wb, max_cycles=4):
    cycles = {}
    for title in wb.sheetnames:
        span = parse_cycle_title(title)
        if not span:
            continue
        start, end = span
        rows = []
        for r in wb[title].iter_rows(min_row=3, values_only=True):
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
                "college": COLLEGE_ALIASES.get(str(g(29) or "").strip().lower(), str(g(29) or "").strip() or None),
                "course": str(g(28) or "").strip() or None,
                "category": str(g(15) or "").strip() or None,
                "status": status or None,
                "processed": processed,
                "sent_to_collections": yes(g(7)),
                "attempts": attempts,
                "offer_made": bool(str(g(18) or "").strip()) and not str(g(18) or "").strip().lower().startswith("no offer"),
                "offer_accepted": yes(g(19)),
                "our_fault": fault.startswith("yes"),
                "acc_status": str(g(23) or "").strip() or None,
                "advisor": agent_name(g(24)),
                "agent": agent_name(g(25)),
                "sales_agent": agent_name(g(26)),
            })
        cycles[start.isoformat()] = {"label": title.strip(), "start": start.isoformat(),
                                     "end": end.isoformat(), "rows": rows}
    keep = sorted(cycles)[-max_cycles:]
    return {k: cycles[k] for k in keep}


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
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), default=str))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
