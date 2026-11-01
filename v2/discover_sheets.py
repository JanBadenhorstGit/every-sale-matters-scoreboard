"""Find each month's Registration and incentive spreadsheets in Google Drive by name,
make sure they are readable by anyone with the link (the public Action downloads them),
and write month_sheets.json for scoreboard_pipeline.py.

Run privately with the gws CLI (Jan's account). Never run in the public Action.
Naming convention (Abisoye): "<Month> 2026 Registration Spreadsheet" and "<Month> 2026 Spreadsheet".
"""
import json, subprocess, sys, re, pathlib, datetime

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "month_sheets.json"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def gws(args, params):
    r = subprocess.run(["gws", "drive", *args, "--params", json.dumps(params), "--format", "json"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip()[:400])
    return json.loads(r.stdout or "{}")


def find(name_exact):
    q = f'name = "{name_exact}" and mimeType = "application/vnd.google-apps.spreadsheet" and trashed = false'
    res = gws(["files", "list"], {"q": q, "fields": "files(id,name,owners(emailAddress),createdTime)",
                                  "supportsAllDrives": True, "includeItemsFromAllDrives": True, "corpora": "allDrives"})
    files = res.get("files", [])
    files.sort(key=lambda f: f.get("createdTime", ""))
    return files[-1] if files else None


def ensure_link_reader(file_id):
    perms = gws(["permissions", "list"], {"fileId": file_id, "supportsAllDrives": True,
                                          "fields": "permissions(id,type,role)"}).get("permissions", [])
    anyone = [p for p in perms if p.get("type") == "anyone"]
    if anyone and anyone[0].get("role") in ("reader", "commenter", "writer"):
        if anyone[0]["role"] != "reader":
            subprocess.run(["gws", "drive", "permissions", "update", "--params",
                            json.dumps({"fileId": file_id, "permissionId": anyone[0]["id"], "supportsAllDrives": True}),
                            "--json", json.dumps({"role": "reader"}), "--format", "json"], capture_output=True, text=True)
            return "downgraded to reader"
        return "already reader"
    r = subprocess.run(["gws", "drive", "permissions", "create", "--params",
                        json.dumps({"fileId": file_id, "supportsAllDrives": True}),
                        "--json", json.dumps({"type": "anyone", "role": "reader"}), "--format", "json"],
                       capture_output=True, text=True)
    return "shared viewer-by-link" if r.returncode == 0 else f"share failed: {r.stderr.strip()[:200]}"


def main():
    existing = json.loads(OUT.read_text()) if OUT.exists() else {"months": {}}
    months = existing.get("months", {})
    today = datetime.date.today()
    # look at this month and next (sheets are created on the last working day of the previous month)
    targets = []
    for delta in (0, 1):
        y, m = today.year, today.month + delta
        if m > 12: y, m = y + 1, m - 12
        targets.append((f"{y:04d}-{m:02d}", MONTHS[m - 1], y))
    notes = []
    for key, mname, y in targets:
        entry = months.get(key, {})
        for kind, pattern in (("reg", f"{mname} {y} Registration Spreadsheet"), ("incentive", f"{mname} {y} Spreadsheet")):
            if entry.get(kind):
                continue
            f = find(pattern)
            if not f:
                notes.append(f"{key}: no sheet named '{pattern}' yet")
                continue
            entry[kind] = f["id"]
            share = ensure_link_reader(f["id"])
            notes.append(f"{key}: found '{f['name']}' ({f['id']}, owner {f['owners'][0]['emailAddress']}) - {share}")
        if entry:
            months[key] = entry
    OUT.write_text(json.dumps({"updated": datetime.datetime.now().isoformat(timespec="seconds"), "months": months}, indent=1) + "\n")
    print("\n".join(notes) or "no new sheets")
    print(f"wrote {OUT} with months {sorted(months)}")
    cur = f"{today.year:04d}-{today.month:02d}"
    if cur not in months or not months[cur].get("reg") or not months[cur].get("incentive"):
        print(f"MISSING: {cur} is incomplete: {months.get(cur)}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
