#!/usr/bin/env python3
"""Pull or push the private ActiveCampaign cache (sheets_private/ac/) to a private Drive folder.

The cache holds contact-level data and is git-ignored. Automation runs start from a fresh clone,
so without this step pipeline_leads.py would have to re-read 45 days from the API (hours) and
times out. The Drive folder is owned by jan@skillsacademy.edu.za and must never be shared.

  python3 v2/cache_sync.py pull   # download ac_cache.tgz and unpack into sheets_private/ac/
  python3 v2/cache_sync.py push   # pack sheets_private/ac/ and replace ac_cache.tgz in Drive

Only the archive moves; nothing from it is printed or committed.
"""
import json, pathlib, subprocess, sys, tarfile

HERE = pathlib.Path(__file__).resolve().parent
PRIV = HERE.parent / "sheets_private"
RAW = PRIV / "ac"
FOLDER_ID = "1jVJynlHoRld-VJ0hXiKkUbt7c7jWI6Sa"   # "Casus Radar private cache (do not share)"
NAME = "ac_cache.tgz"


def gws(*args, **kw):
    r = subprocess.run(["gws", "drive", "files", *args], capture_output=True, text=True, **kw)
    if r.returncode != 0:
        raise SystemExit(f"gws failed: {' '.join(args[:2])}: {r.stderr.strip()[:300]}")
    return r.stdout


def find_archive():
    q = f"name = '{NAME}' and '{FOLDER_ID}' in parents and trashed = false"
    out = gws("list", "--params", json.dumps({"q": q, "fields": "files(id,name,size,modifiedTime)"}))
    files = json.loads(out).get("files", [])
    return files[0] if files else None


def pull():
    f = find_archive()
    if not f:
        print("no cache archive in Drive; pipeline will fetch from the API", file=sys.stderr)
        return 1
    PRIV.mkdir(parents=True, exist_ok=True)
    tgz = PRIV / NAME                      # gws refuses output paths outside the working directory
    gws("get", "--params", json.dumps({"fileId": f["id"], "alt": "media"}), "-o", str(tgz.relative_to(pathlib.Path.cwd())))
    with tarfile.open(tgz) as t:
        t.extractall(PRIV)
    tgz.unlink()
    n = len(list(RAW.glob("*.json")))
    print(f"pulled cache: {n} day files ({int(f['size'])//1_000_000} MB archive, modified {f['modifiedTime']})", file=sys.stderr)
    return 0


def push():
    if not RAW.exists():
        raise SystemExit("nothing to push: sheets_private/ac missing")
    tgz = PRIV / NAME
    with tarfile.open(tgz, "w:gz", compresslevel=6) as t:
        t.add(RAW, arcname="ac")
    try:
        f = find_archive()
        meta = {"fields": "id,size,modifiedTime"}
        if f:
            out = gws("update", "--params", json.dumps({"fileId": f["id"], **meta}),
                      "--upload", str(tgz), "--upload-content-type", "application/gzip")
        else:
            out = gws("create", "--params", json.dumps(meta), "--upload", str(tgz),
                      "--upload-content-type", "application/gzip",
                      "--json", json.dumps({"name": NAME, "parents": [FOLDER_ID]}))
    finally:
        tgz.unlink(missing_ok=True)
    d = json.loads(out)
    print(f"pushed cache: {int(d['size'])//1_000_000} MB, {d['modifiedTime']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "pull":
        sys.exit(pull())
    elif cmd == "push":
        sys.exit(push())
    else:
        raise SystemExit(__doc__)
