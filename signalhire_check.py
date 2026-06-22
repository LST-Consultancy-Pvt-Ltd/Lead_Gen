#!/usr/bin/env python3
"""
signalhire_check.py  -  quick auth / connectivity check for the SignalHire API.

This is the LIGHT check: it submits one candidate search and reports whether the
API key is valid and the service is reachable. It does NOT poll for results
(see signalhire_test_search.py for the full flow).

Reads SIGNALHIRE_API_KEY from the environment, falling back to ./backend/.env.

Usage:
    python signalhire_check.py
"""
import os
import json
import urllib.request
import urllib.error

BASE = "https://www.signalhire.com/api/v1"


def load_api_key():
    """Env var first, then parse backend/.env (so it 'just works' in this repo)."""
    key = os.environ.get("SIGNALHIRE_API_KEY")
    if key:
        return key.strip()
    here = os.path.dirname(os.path.abspath(__file__))
    for env_path in (
        os.path.join(here, "backend", ".env"),
        os.path.join(here, ".env"),
    ):
        if os.path.exists(env_path):
            with open(env_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("SIGNALHIRE_API_KEY"):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
    return None


def send(req):
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode() or "{}"
            return r.status, json.loads(body)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")
    except Exception as e:
        return None, str(e)


def main():
    key = load_api_key()
    if not key:
        print("[FAIL] SIGNALHIRE_API_KEY not found (checked env + backend/.env)")
        return
    print(f"[KEY] Using API key: {key[:4]}...{key[-4:]} ({len(key)} chars)")

    # A real public profile makes the search request valid.
    # SignalHire REQUIRES a callbackUrl to deliver profiles (it PUSHES results to a
    # webhook rather than letting you poll). A placeholder lets us confirm the key
    # and flow are accepted (we won't receive the pushed result here).
    payload = {
        "items": ["https://www.linkedin.com/in/williamhgates"],
        "callbackUrl": "https://example.com/signalhire-callback",
    }
    req = urllib.request.Request(
        f"{BASE}/candidate/search",
        data=json.dumps(payload).encode(),
        method="POST",
        headers={"apikey": key, "Content-Type": "application/json"},
    )
    status, body = send(req)
    print(f"\nPOST /candidate/search  ->  HTTP {status}")
    print("Response:", json.dumps(body, indent=2) if isinstance(body, dict) else body)

    callback_err = isinstance(body, str) and "allback" in body
    if status in (200, 201) or (isinstance(body, dict) and body.get("requestId")):
        print("\n[OK] WORKING - key is valid, request accepted (got a requestId).")
    elif status in (401, 403):
        print("\n[FAIL] AUTH FAILED - the API key is invalid or expired.")
    elif status == 402:
        print("\n[WARN] KEY VALID but NO CREDITS remaining (HTTP 402).")
    elif status == 429:
        print("\n[WARN] KEY VALID but RATE-LIMITED (HTTP 429) - try again later.")
    elif status == 406 and callback_err:
        print("\n[OK] KEY VALID + reachable, but SignalHire REQUIRES a real callbackUrl"
              "\n     webhook to return profiles (it cannot be polled). The app's"
              "\n     integration sends callback_url=null, which is why it never enriches.")
    else:
        print("\n[WARN] Unexpected response - see body above.")


if __name__ == "__main__":
    main()
