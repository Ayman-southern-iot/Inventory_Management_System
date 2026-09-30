"""
smoke_client.py — exercise ims_client.py against a LOCAL IMS API (ADR-0002 follow-up, Part C).

Local stack only: refuses any base URL that is not loopback. Creates its own dedicated SMOKE
category, product, room, zone and cell, a service account and a key; revokes the key and switches
the account off at the end. Never prints the key.

Environment:
    IMS_BASE_URL               http://127.0.0.1:<port>   (the API must run with ALLOW_DIRECT_TAKE=true)
    IMS_SMOKE_ADMIN_EMAIL      an admin who can sign in
    IMS_SMOKE_ADMIN_PASSWORD
    IMS_SMOKE_API_LOG          optional: the API's log file, checked afterwards for the full key

Exit status 0 when every check passes, 1 otherwise.
"""
from __future__ import annotations

import os
import sys
import time
import uuid
from urllib.parse import urlparse

from ims_client import ImsClient, ImsCredentialDead, ImsError

LOOPBACK = ("127.0.0.1", "localhost", "::1")
results: list[tuple[str, str, bool, str]] = []


def check(tag: str, what: str, ok: bool, evidence: str) -> None:
    results.append((tag, what, ok, evidence))
    print(f"{'PASS' if ok else 'FAIL'} {tag:<3} {what} — {evidence}")


def main() -> int:
    base = os.environ.get("IMS_BASE_URL", "")
    if urlparse(base).hostname not in LOOPBACK:
        print("Refusing: smoke_client.py runs against a local API only (loopback IMS_BASE_URL).")
        return 2
    admin = ImsClient(base, email=os.environ["IMS_SMOKE_ADMIN_EMAIL"],
                      password=os.environ["IMS_SMOKE_ADMIN_PASSWORD"],
                      allow_insecure_localhost=True)
    tag = time.strftime("%H%M%S")

    # --- dedicated fixture, built through the admin's session ---------------------------------
    group = admin.create_group(f"SMOKE client group {tag}")
    product = admin.create_item(f"SMOKE client product {tag}", category_id=group["id"],
                                returnable=False)
    room = admin._call("POST", "/locations/rooms", json={"name": f"SMOKE client room {tag}"})
    zone = admin.create_zone(f"SMOKE client zone {tag}", room["id"])
    cell = admin.create_compartment(zone["id"], "C1")
    admin.receive(product["id"], cell["id"], 6)
    account = admin._call("POST", "/admin/api-keys/service-accounts",
                          json={"name": f"SMOKE client panel {tag}"})
    issued = admin._call("POST", "/admin/api-keys", json={
        "name": f"SMOKE client key {tag}", "expiresInDays": 1, "serviceAccountId": account["id"],
        "scopes": ["inventory:read", "stock:take", "stock:receive"]})
    key_id, token = issued["key"]["id"], issued["token"]
    print(f"fixture ready: product {product['productCode']}, cell {zone['name']}-{cell['code']}, "
          f"key {token[:12]}…")

    key = ImsClient(base, api_key=token, allow_insecure_localhost=True)
    sent: list[int] = []
    key._http.hooks["response"].append(lambda r, *a, **k: sent.append(r.status_code))

    def ledger_rows() -> int:
        return admin._call("GET", "/stock/ledger",
                           params={"productId": product["id"], "limit": 1})["total"]

    try:
        # P1 — read-only search finds the smoke product
        found = key.search(f"SMOKE client product {tag}")
        ids = [p["id"] for p in found["items"]]
        check("P1", "read-only search with the key finds the smoke product",
              product["id"] in ids, f"total={found['total']}")

        # P2 — a take and its replay with the same Idempotency-Key leave one ledger row
        before = ledger_rows()
        idem = str(uuid.uuid4())
        first = key.take(product["id"], cell["id"], 1, returnable=False, channel="panel",
                         purpose="smoke_client", idempotency_key=idem)
        again = key.take(product["id"], cell["id"], 1, returnable=False, channel="panel",
                         purpose="smoke_client", idempotency_key=idem)
        after = ledger_rows()
        check("P2", "take, then the same take replayed with the same key → one ledger row",
              first == again and after - before == 1 and first["status"] == "ISSUED",
              f"ledger {before}→{after}, replay equal as parsed JSON: {first == again}")

        # P3 — a receive without the header is refused for a key (OQ-KT10). Straight through
        # `_call`, because the client's own `receive()` always sends one.
        before = ledger_rows()
        try:
            key._call("POST", "/stock/receive",
                      json={"productId": product["id"], "compartmentId": cell["id"], "quantity": 2})
            got = "accepted"
        except ImsError as e:
            got = f"{e.status} {e.code}"
        after = ledger_rows()
        check("P3", "receive without Idempotency-Key from a key → 400, nothing received",
              got == "400 VALIDATION_FAILED" and after == before, f"{got}, ledger {before}→{after}")

        # P4 — a disabled key: the client raises its credential-dead error after ONE request
        admin._call("PATCH", f"/admin/api-keys/{key_id}", json={"isActive": False})
        sent.clear()
        try:
            key.search("anything")
            got = "no error"
        except ImsCredentialDead as e:
            got = f"ImsCredentialDead {e.status} {e.code}"
        except ImsError as e:
            got = f"ImsError {e.status} {e.code}"
        check("P4", "disabled key → ImsCredentialDead, exactly one request made",
              got == "ImsCredentialDead 403 API_KEY_DISABLED" and len(sent) == 1,
              f"{got}, requests={len(sent)}")
    finally:
        admin._call("DELETE", f"/admin/api-keys/{key_id}")
        admin._call("PATCH", f"/admin/api-keys/service-accounts/{account['id']}",
                    json={"isActive": False})
        print("cleanup: key revoked, service account deactivated")

    log = os.environ.get("IMS_SMOKE_API_LOG")
    if log:
        with open(log, encoding="utf-8", errors="replace") as fh:
            hits = fh.read().count(token)
        check("P5", "the full key appears nowhere in the API log", hits == 0, f"matches={hits}")

    failed = [r for r in results if not r[2]]
    print(f"PASS={len(results) - len(failed)} FAIL={len(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
