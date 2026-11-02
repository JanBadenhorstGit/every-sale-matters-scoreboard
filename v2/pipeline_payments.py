"""Casus Radar — payments per sale, from the weekly FileMaker report.

Joins each sale on the Registration Spreadsheets (CRM number, registrar, course, day) to the
Monday FileMaker report "All registrations 2024 to date, with CRM Number and payment totals"
(CRM_Number, Learner_Status, Date_Registered, Total Learner Payment) and writes aggregates
only to v2/data/payments.json. The report holds emails and phone numbers, so it is read from a
private path and never committed. Run from a trusted machine/task, not the public Action.

Usage: python v2/pipeline_payments.py /path/to/allregs.xlsx
"""
import json
import re
import sys
import datetime as dt
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
import scoreboard_pipeline as v1  # noqa: E402
import pipeline_sales as ps  # noqa: E402

OUT = HERE / "data" / "payments.json"
PAYING_STATUSES = {"current", "fully paid", "course complete", "on hold", "study break"}


def load_filemaker(path):
    """{crm_number: [ {status, reg: date, paid: float, course} ... ]} (a contact can have several registrations)."""
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.worksheets[0]
    rows = ws.iter_rows(values_only=True)
    hdr = [str(h or "").strip() for h in next(rows)]
    ci = {h: i for i, h in enumerate(hdr)}
    c_crm, c_status, c_reg, c_paid = ci["CRM_Number"], ci["Learner_Status"], ci["Date_Registered"], ci["Total Learner Payment"]
    c_course = next((i for h, i in ci.items() if "Course_Name" in h), None)
    fm = {}
    n = 0
    for r in rows:
        if not r or len(r) <= c_paid:
            r = tuple(r or ()) + (None,) * (len(hdr) - len(r or ()))
        crm = str(r[c_crm] or "").strip()
        if not crm or not crm.isdigit():
            continue
        reg = r[c_reg]
        if isinstance(reg, dt.datetime):
            reg = reg.date()
        elif isinstance(reg, str) and reg[:4].isdigit():
            try:
                reg = dt.date.fromisoformat(reg[:10])
            except ValueError:
                reg = None
        else:
            reg = None
        try:
            paid = float(r[c_paid] or 0)
        except (TypeError, ValueError):
            paid = 0.0
        fm.setdefault(crm, []).append({"status": str(r[c_status] or "").strip(), "reg": reg, "paid": paid,
                                       "course": str(r[c_course] or "") if c_course is not None else ""})
        n += 1
    wb.close()
    return fm, n


def sales_from_sheets():
    """One record per qualifying sale: (day, registrar_key, college, course, crm)."""
    sales = []
    for key, sid in v1.SHEETS.items():
        if key in ("incentive", "comparison"):
            continue
        path = v1.CACHE / f"{key}_{sid}.xlsx"
        if not path.exists():
            continue
        wb = openpyxl.load_workbook(path, read_only=True)
        for ws in wb.worksheets:
            d = v1.parse_day_tab(ws.title)
            if not d:
                continue
            college = None
            for r in ws.iter_rows(min_row=2, values_only=True):
                registrar = str(v1.g(r, ps.COL_REGISTRAR)).strip()
                if registrar.startswith("="):
                    continue
                sec = ps.section_college(v1.g(r, 1)) if not registrar else None
                if sec:
                    college = sec
                if not registrar or v1.norm(registrar) in ps.NOT_PEOPLE:
                    continue
                raw = v1.g(r, ps.COL_CRM)
                crm = str(int(raw)) if isinstance(raw, float) and raw == int(raw) else str(raw).strip()
                student = str(v1.g(r, ps.COL_STUDENT)).strip()
                if not (crm or student):
                    continue
                if str(v1.g(r, ps.COL_STATUS)).strip().lower() == "cancelled":
                    continue
                crm_digits = re.sub(r"\D", "", crm)
                course = re.sub(r"\s+", " ", str(v1.g(r, ps.COL_COURSE)).strip())[:60]
                sales.append({"day": d, "reg": v1.norm(registrar), "college": college, "course": course, "crm": crm_digits})
        wb.close()
    # the same day can appear in two month sheets (previous/current); keep one copy per (day, reg, crm)
    seen, out = set(), []
    for s in sales:
        k = (s["day"], s["reg"], s["crm"] or id(s))
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def match(fm_rows, day):
    """Pick the FileMaker registration closest to the sale day (same contact may have re-enrolled)."""
    if not fm_rows:
        return None
    dated = [x for x in fm_rows if x["reg"]]
    if not dated:
        return fm_rows[0]
    return min(dated, key=lambda x: abs((x["reg"] - day).days))


def bucket():
    return {"sold": 0, "matched": 0, "paid_any": 0, "paid_amt": 0.0, "paying_status": 0, "pending": 0, "cancelled": 0,
            "fully_paid": 0, "expired": 0}


def add(b, m):
    b["sold"] += 1
    if m is None:
        return
    b["matched"] += 1
    st = m["status"].lower()
    if m["paid"] > 0:
        b["paid_any"] += 1
        b["paid_amt"] += m["paid"]
    if st in PAYING_STATUSES:
        b["paying_status"] += 1
    if st == "pending":
        b["pending"] += 1
    elif st == "cancelled":
        b["cancelled"] += 1
    elif st == "fully paid":
        b["fully_paid"] += 1
    elif st == "expired":
        b["expired"] += 1


def main(fm_path):
    fm, fm_rows = load_filemaker(fm_path)
    sales = sales_from_sheets()
    roster_college = {}
    try:
        for p in json.loads((HERE / "data" / "sales.json").read_text()).get("roster", []):
            roster_college[p["key"]] = p["college"]
    except Exception:  # noqa: BLE001
        pass
    report_to = max((x["reg"] for rows in fm.values() for x in rows if x["reg"]), default=None)

    by_month, by_reg, by_fam, by_dept, by_week = {}, {}, {}, {}, {}
    for s in sales:
        m = match(fm.get(s["crm"]), s["day"]) if s["crm"] else None
        month = s["day"].isoformat()[:7]
        college = roster_college.get(s["reg"]) or s["college"] or "Unknown"
        add(by_month.setdefault(month, {}).setdefault(college, bucket()), m)
        add(by_month[month].setdefault("_all", bucket()), m)
        add(by_reg.setdefault(month, {}).setdefault(s["reg"], bucket()), m)
        dept, fam, _ = ps.course_family(s["course"]) if s["course"] else ("Unknown", "Unknown", None)
        add(by_fam.setdefault(month, {}).setdefault(fam, bucket() | {"dept": dept}), m)
        add(by_dept.setdefault(month, {}).setdefault(dept, bucket()), m)
        wk = (s["day"] - dt.timedelta(days=s["day"].weekday())).isoformat()
        add(by_week.setdefault(wk, bucket()), m)

    def finish(b):
        b["paid_amt"] = round(b["paid_amt"])
        b["paid_pct"] = round(100 * b["paid_any"] / b["matched"], 1) if b["matched"] else None
        b["match_pct"] = round(100 * b["matched"] / b["sold"], 1) if b["sold"] else None
        return b

    for d in (by_month, by_reg, by_fam, by_dept):
        for mm in d.values():
            for b in mm.values():
                finish(b)
    for b in by_week.values():
        finish(b)

    out = {
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "report_registered_to": report_to.isoformat() if report_to else None,
        "filemaker_rows": fm_rows,
        "sales_in_sheets": len(sales),
        "months": by_month,
        "registrars": by_reg,
        "families": by_fam,
        "departments": by_dept,
        "weeks": by_week,
        "definitions": {
            "sold": "qualifying sales on the Registration Spreadsheets (registrar named, CRM/student ID present, not cancelled)",
            "matched": "sales whose CRM number appears in the FileMaker report",
            "paid_any": "matched sales with Total Learner Payment > 0",
            "paying_status": "Learner_Status in Current / Fully Paid / Course Complete / On Hold / Study Break",
            "pending": "Learner_Status = Pending (no payment yet)",
            "note": "Payments are cumulative to the report date, so young cohorts look worse than they will end up; compare like-for-like ages.",
        },
    }
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"wrote {OUT} ({len(sales)} sales, {fm_rows} FileMaker rows, report to {report_to})")
    for month in sorted(by_month):
        b = by_month[month]["_all"]
        print(f"  {month}: sold {b['sold']}, matched {b['match_pct']}%, paid anything {b['paid_pct']}%, pending {b['pending']}, cancelled {b['cancelled']}, cash R{b['paid_amt']:,}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/allregs.xlsx")
