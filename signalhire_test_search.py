#!/usr/bin/env python3
"""
signalhire_test_search.py  -  full end-to-end SignalHire search test.

Runs the complete async flow the app relies on:
    1. POST /candidate/search      -> returns a requestId (search is queued)
    2. GET  /candidate/{requestId} -> poll until status is 'success' / 'failed'
       (falls back to /request/{requestId}, which is what the app currently calls)

[WARN]  A successful search that REVEALS contacts consumes 1 SignalHire credit.

Reads SIGNALHIRE_API_KEY from the environment, falling back to ./backend/.env.

Usage:
    python signalhire_test_search.py --linkedin https://www.linkedin.com/in/williamhgates
    python signalhire_test_search.py --email someone@company.com
    python signalhire_test_search.py --name "Bill Gates"
    (no flag) -> defaults to a public LinkedIn profile
"""
import os
import sys
import json
import time
import argparse
import urllib.request
import urllib.error

BASE = "https://www.signalhire.com/api/v1"


def load_api_key():
    key = os.environ.get("SIGNALHIRE_API_KEY")
    if key:
        return key.strip()
    here = os.path.dirname(os.path.abspath(__file__))
    for env_path in (os.path.join(here, "backend", ".env"), os.path.join(here, ".env")):
        if os.path.exists(env_path):
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("SIGNALHIRE_API_KEY"):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def send(method, url, key, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"apikey": key}
    if data:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode() or "{}"
            try:
                return r.status, json.loads(raw)
            except json.JSONDecodeError:
                return r.status, raw
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except Exception as e:
        return None, str(e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--linkedin")
    ap.add_argument("--email")
    ap.add_argument("--name")
    ap.add_argument("--attempts", type=int, default=8, help="poll attempts (5s apart)")
    args = ap.parse_args()

    key = load_api_key()
    if not key:
        print("[FAIL] SIGNALHIRE_API_KEY not found (checked env + backend/.env)")
        sys.exit(1)
    print(f"[KEY] Key: {key[:4]}...{key[-4:]} ({len(key)} chars)")

    # SignalHire accepts an identifier string per item: LinkedIn URL, email, phone, or name.
    item = args.linkedin or args.email or args.name or "https://www.linkedin.com/in/williamhgates"
    print(f"[SEARCH] Searching for: {item}\n")

    # ---- Step 1: submit the search ----
    status, body = send("POST", f"{BASE}/candidate/search", key,
                         {"items": [item], "callbackUrl": "https://example.com/signalhire-callback"})
    print(f"STEP 1  POST /candidate/search  ->  HTTP {status}")
    print("        ", json.dumps(body) if isinstance(body, dict) else body)
    if not isinstance(body, dict):
        print("\n[FAIL] Search submit failed - see response above.")
        sys.exit(1)
    request_id = body.get("requestId")
    if not request_id:
        print("\n[FAIL] No requestId returned - cannot poll.")
        sys.exit(1)
    print(f"        requestId = {request_id}\n")

    # ---- Step 2: poll for the result ----
    for attempt in range(1, args.attempts + 1):
        time.sleep(5)
        # Prefer documented /candidate/{id}; fall back to /request/{id} (app's path).
        status, body = send("GET", f"{BASE}/candidate/{request_id}", key)
        if status == 404:
            status, body = send("GET", f"{BASE}/request/{request_id}", key)
        print(f"STEP 2  poll #{attempt}  ->  HTTP {status}")
        if isinstance(body, dict):
            items = body.get("items") or []
            it = items[0] if items else None
            st = (it or {}).get("status")
            print(f"        status = {st}")
            if it and it.get("contacts"):
                print("\n[OK] WORKING - contacts found:")
                print(json.dumps(it["contacts"], indent=2))
                return
            if st in ("notFound", "failed"):
                print("\n[OK] API WORKING (auth + flow OK) - but no contact for this query.")
                return
        else:
            print("        ", body)
    print("\n[WARN]  Polling finished without a final result (still processing or rate-limited).")


if __name__ == "__main__":
    main()
