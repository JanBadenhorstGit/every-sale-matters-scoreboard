#!/usr/bin/env python3
"""Refresh v2/data/ads.json: Meta (Facebook) spend via the `meta` CLI, Google Ads from a patch file.

  python3 v2/pipeline_ads.py [--gads /tmp/gads.json] [--days 14]

Google Ads has no CLI here, so the automation run pulls the daily report with the Google Ads
connector tool and saves it as {college: {YYYY-MM-DD: {cost, clicks, conv}}} (rands, not micros);
this script merges it. Meta is read directly for the three ad accounts: daily spend for the last
--days days and monthly totals for the current and previous month.

Aggregates only; no person-level data is involved.
"""
import argparse, datetime as dt, json, pathlib, subprocess, sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "data" / "ads.json"
META = {"Skills Academy": "2879824205642596", "Bellview Inst.": "562792675051629", "Matric College": "698352734678325"}


def meta(acct, since, until, increment=None):
    cmd = ["meta", "-o", "json", "ads", "--ad-account-id", f"act_{acct}", "insights", "get",
           "--since", since, "--until", until, "--fields", "spend,impressions,clicks"]
    if increment:
        cmd += ["--time-increment", increment]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        print(f"meta failed for {acct}: {r.stderr.strip()[:200]}", file=sys.stderr)
        return []
    try:
        return json.loads(r.stdout).get("data", [])
    except json.JSONDecodeError:
        print(f"meta returned non-JSON for {acct}", file=sys.stderr)
        return []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gads", help="Google Ads daily patch json {college: {date: {cost, clicks, conv}}}")
    ap.add_argument("--days", type=int, default=14)
    a = ap.parse_args()

    A = json.load(open(OUT))
    today = dt.date.today()
    daily, monthly = A.setdefault("daily", {}), A.setdefault("monthly", {})

    # 1. Google Ads daily (from the connector tool) -> daily PPC, and monthly PPC sums for touched months
    touched = set()
    if a.gads:
        P = json.load(open(a.gads))
        for col, days in P.items():
            for d, v in days.items():
                if d >= today.isoformat():
                    continue                      # today is partial; tomorrow's run writes it
                daily.setdefault(col, {}).setdefault(d, {})["PPC"] = {
                    "cost": round(v.get("cost", 0)), "clicks": round(v.get("clicks", 0)), "conv": round(v.get("conv", 0))}
                touched.add((col, d[:7]))
        for col, m in touched:
            rows = [v["PPC"] for d, v in daily[col].items() if d.startswith(m) and "PPC" in v]
            mp = monthly.setdefault(m, {}).setdefault(col, {}).setdefault("PPC", {})
            for k in ("cost", "clicks", "conv"):
                mp[k] = sum(r.get(k, 0) for r in rows)
        print(f"google ads: {sum(len(d) for d in P.values())} college-days merged, months {sorted({m for _, m in touched})}", file=sys.stderr)

    # 2. Meta daily spend (last --days) and monthly totals (this month and last)
    since = (today - dt.timedelta(days=a.days)).isoformat()
    first_prev = (today.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
    for col, acct in META.items():
        for row in meta(acct, since, (today - dt.timedelta(days=1)).isoformat(), "daily"):
            daily.setdefault(col, {}).setdefault(row["date_start"], {})["Facebook"] = {"cost": round(float(row.get("spend", 0)))}
        for row in meta(acct, first_prev.isoformat(), today.isoformat(), "monthly"):
            m = row["date_start"][:7]
            monthly.setdefault(m, {}).setdefault(col, {})["Facebook"] = {
                "cost": round(float(row.get("spend", 0))), "impressions": int(row.get("impressions", 0)), "clicks": int(row.get("clicks", 0))}
        print(f"meta {col}: ok", file=sys.stderr)

    A.setdefault("accounts", {}).setdefault("Facebook", {})
    A["accounts"]["Facebook"] = {"Skills Academy": "2879824205642596 (Skills_Academy_Backup)", "Bellview Inst.": "562792675051629", "Matric College": "698352734678325"}
    A["generated_at"] = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    json.dump(A, open(OUT, "w"), indent=0)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)", file=sys.stderr)


if __name__ == "__main__":
    main()
