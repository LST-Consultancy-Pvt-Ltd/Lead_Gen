#!/usr/bin/env python3
"""
signalhire_probe_search.py - discover SignalHire's Search API contract.

Sends minimal/empty requests to likely Search endpoints to learn:
  - which path exists, sync vs async, required fields (from validation errors).
Empty/invalid bodies should trigger validation errors (no credit spend) that
reveal the expected parameters - same technique that found "Callback url is required".

Reads SIGNALHIRE_API_KEY from env or backend/.env.
"""
import os, json, urllib.request, urllib.error

BASE = "https://www.signalhire.com/api/v1"

def load_api_key():
    k = os.environ.get("SIGNALHIRE_API_KEY")
    if k: return k.strip()
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.path.join(here, "backend", ".env"), os.path.join(here, ".env")):
        if os.path.exists(p):
            for line in open(p, encoding="utf-8"):
                line = line.strip()
                if line.startswith("SIGNALHIRE_API_KEY"):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None

def call(method, path, key, payload=None):
    url = BASE + path
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"apikey": key}
    if data: headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode(errors="replace")
            return r.status, body[:800]
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:800]
    except Exception as e:
        return None, str(e)

def main():
    key = load_api_key()
    if not key:
        print("[FAIL] no api key"); return
    print(f"[KEY] {key[:4]}...{key[-4:]}\n")

    # Likely Search-API shapes (empty/minimal -> expect validation errors, no spend).
    probes = [
        ("POST", "/candidate/searchByQuery", {}),
        ("POST", "/candidate/searchByQuery", {"currentCompany": "TrakMotive"}),
        ("POST", "/candidate/scrapeSearch", {}),
        ("POST", "/candidate/searchByQuery", {"items": ["TrakMotive"]}),
        ("GET",  "/credits", None),
        ("GET",  "/candidate/credits", None),
    ]
    for method, path, payload in probes:
        status, body = call(method, path, key, payload)
        print(f"{method} {path}  body={json.dumps(payload) if payload is not None else '-'}")
        print(f"   -> HTTP {status}: {body}\n")

if __name__ == "__main__":
    main()
