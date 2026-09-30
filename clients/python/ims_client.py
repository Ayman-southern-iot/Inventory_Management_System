"""
ims_client.py — client for the Southern IoT IMS integration API (v2, API keys + one-call take).

Contract: docs/reference/15-integration-api.md and packages/shared/src/contracts/
on branch feat/api-keys-take (Phase 11, ADR-0002). If the admin page "How to use this key"
disagrees with this file, the page is right.

Configuration (environment, never hard-coded):
    IMS_BASE_URL   the HTTPS hostname, e.g. https://ims.siot.solutions  (never :5173 / plain HTTP)
    IMS_API_KEY    ims_…  issued under Admin -> API keys (preferred)
  or, for a person running scripts by hand:
    IMS_EMAIL / IMS_PASSWORD   (session login; service accounts cannot sign in)

Scopes a lab-panel key needs: inventory:read, stock:take  (+ stock:receive for intake,
catalog:write / locations:write only for the import script).

CLI (read-only):
    python ims_client.py search "esp32"
    python ims_client.py where <productId>
"""
from __future__ import annotations

import os
import sys
import threading
import time
import uuid
from typing import Any, Iterator, Optional
from urllib.parse import urlparse

import requests

API_PREFIX = "/api/v1"

# Codes that mean "this credential will not work again": stop, do not retry (15.8).
DEAD_KEY_CODES = {"API_KEY_INVALID", "API_KEY_DISABLED", "API_KEYS_DISABLED_IN_DEMO"}


class ImsError(Exception):
    """Every error body is {code, message, details?}. Branch on `code`, never on `message`."""

    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(f"{status} {code}: {message}")
        self.status, self.code, self.message, self.details = status, code, message, details


class ImsCredentialDead(ImsError):
    """Key unknown/revoked/expired, key or service account disabled, or prod in demo mode.
    A human must act (issue a new key, re-enable the account, turn demo mode off)."""


class ImsClient:
    def __init__(self, base_url: str, *, api_key: str | None = None,
                 email: str | None = None, password: str | None = None,
                 timeout: float = 15.0, max_retries: int = 3,
                 allow_insecure_localhost: bool = False):
        # Opt-in, off by default, and loopback only: lets a smoke test or a developer reach a
        # local API over plain HTTP without weakening the rule for any other host (15.1).
        is_loopback = urlparse(base_url).hostname in ("127.0.0.1", "localhost", "::1")
        if not base_url.lower().startswith("https://") and not (allow_insecure_localhost
                                                                and is_loopback):
            raise ValueError("Use the HTTPS hostname: a key is a bearer credential (15.1)")
        if not api_key and not (email and password):
            raise ValueError("Give api_key, or email + password")
        self.base = base_url.rstrip("/") + API_PREFIX
        self._key = api_key
        self._email, self._password = email, password
        self._timeout, self._retries = timeout, max_retries
        self._http = requests.Session()
        self._jwt: dict[str, Any] = {}
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "ImsClient":
        base = os.environ.get("IMS_BASE_URL")
        if not base:
            raise SystemExit("Set IMS_BASE_URL (the HTTPS hostname)")
        key = os.environ.get("IMS_API_KEY")
        if key:
            return cls(base, api_key=key)
        email, pw = os.environ.get("IMS_EMAIL"), os.environ.get("IMS_PASSWORD")
        if not (email and pw):
            raise SystemExit("Set IMS_API_KEY, or IMS_EMAIL and IMS_PASSWORD")
        return cls(base, email=email, password=pw)

    # ------------------------------------------------------------------ auth

    def _auth_header(self) -> str:
        if self._key:
            return f"Bearer {self._key}"          # header only; never ?api_key= (15.3)
        with self._lock:                          # session tokens rotate: serialise refresh
            if self._jwt and time.time() < self._jwt["exp"] - 60:
                return f"Bearer {self._jwt['access']}"
            if self._jwt.get("refresh"):
                r = self._http.post(f"{self.base}/auth/refresh", timeout=self._timeout,
                                    json={"refreshToken": self._jwt["refresh"]})
                if r.ok:
                    self._store(r.json())
                    return f"Bearer {self._jwt['access']}"
            r = self._http.post(f"{self.base}/auth/login", timeout=self._timeout,
                                json={"email": self._email, "password": self._password})
            self._raise_for(r)
            self._store(r.json())
            return f"Bearer {self._jwt['access']}"

    def _store(self, b: dict) -> None:
        self._jwt = {"access": b["accessToken"], "refresh": b["refreshToken"],
                     "exp": time.time() + b["expiresIn"]}

    # ------------------------------------------------------------- transport

    @staticmethod
    def _raise_for(r: requests.Response) -> None:
        if r.ok:
            return
        try:
            b = r.json()
        except ValueError:
            raise ImsError(r.status_code, "NON_JSON", r.text[:300]) from None
        cls = ImsCredentialDead if b.get("code") in DEAD_KEY_CODES else ImsError
        raise cls(r.status_code, b.get("code", "UNKNOWN"), b.get("message", ""), b.get("details"))

    def _call(self, method: str, path: str, *, json: Any = None, params: dict | None = None,
              idempotency_key: str | None = None) -> Any:
        headers = {}
        if idempotency_key:
            # Same key on every retry of ONE logical write: a retry can never act twice (15.6).
            headers["Idempotency-Key"] = idempotency_key
        for attempt in range(self._retries + 1):
            headers["Authorization"] = self._auth_header()
            try:
                r = self._http.request(method, f"{self.base}{path}", json=json, params=params,
                                       headers=headers, timeout=self._timeout)
            except (requests.ConnectionError, requests.Timeout):
                # Safe to retry only reads and idempotency-keyed writes.
                if attempt < self._retries and (method == "GET" or idempotency_key):
                    time.sleep(2 ** attempt)
                    continue
                raise
            # `attempt < self._retries` too: with max_retries=0 the refresh branch used to fall
            # out of the loop and return None instead of raising.
            if r.status_code == 401 and not self._key and attempt == 0 and self._retries > 0:
                self._jwt["exp"] = 0              # session expired early: refresh once
                continue
            safe_to_repeat = method == "GET" or bool(idempotency_key)
            retryable = r.status_code == 429 or (
                r.status_code == 409 and idempotency_key and self._code(r) == "CONFLICT") or (
                r.status_code >= 500 and safe_to_repeat)           # 5xx like a dropped link (15.10)
            if retryable and attempt < self._retries:
                time.sleep(self._retry_after(r) or 2 ** attempt)
                continue
            self._raise_for(r)
            return r.json() if r.content else None

    @staticmethod
    def _retry_after(r: requests.Response) -> float | None:
        """Seconds to wait, from whichever retry header the server sent (15.7).
        The key rate limiter names one per limit — `Retry-After-apiKey`, `Retry-After-apiKeyAddress`
        — and never sends a plain `Retry-After`; the login limiter sends the plain one. Wait for the
        largest present. None when there is none (a 409 in flight, a 5xx)."""
        waits = []
        for name, value in r.headers.items():
            if name.lower() == "retry-after" or name.lower().startswith("retry-after-"):
                try:
                    waits.append(float(value))
                except ValueError:
                    pass                          # an HTTP-date form is not used by this API
        return max(waits) if waits else None

    @staticmethod
    def _code(r: requests.Response) -> str:
        try:
            return r.json().get("code", "")
        except ValueError:
            return ""

    # ---------------------------------------------------------------- read
    # Scope: inventory:read

    def search(self, term: str, *, in_stock_only: bool = False, category_id: str | None = None,
               limit: int = 20, page: int = 1) -> dict:
        """ILIKE on product name and code. Returns {items, page, limit, total}."""
        params = {"search": term, "inStockOnly": str(in_stock_only).lower(),
                  "limit": limit, "page": page}
        if category_id:
            params["categoryId"] = category_id
        return self._call("GET", "/products", params=params)

    def iter_products(self, page_size: int = 100) -> Iterator[dict]:
        page = 1
        while True:
            res = self._call("GET", "/products", params={"page": page, "limit": page_size})
            yield from res["items"]
            if page * page_size >= res["total"]:
                return
            page += 1

    def product(self, product_id: str) -> dict:
        """Detail with placements. `activeBorrows` is always empty for a key (K2)."""
        return self._call("GET", f"/products/{product_id}")

    def where(self, product_id: str) -> list[dict]:
        """[{zoneName, compartmentCode, quantity, availableQty, ...}] — drawer + cell."""
        return self.product(product_id)["placements"]

    def category_tree(self) -> list[dict]:
        return self._call("GET", "/categories")

    def find_category(self, name: str) -> Optional[dict]:
        want = name.strip().lower()

        def walk(nodes):
            for n in nodes:
                if n["name"].strip().lower() == want:
                    return n
                hit = walk(n.get("children", []))
                if hit:
                    return hit
        return walk(self.category_tree())

    def rooms(self) -> list[dict]:
        """Room -> Zone -> Compartment tree. Room = cabinet, zone = drawer, compartment = cell."""
        return self._call("GET", "/locations/rooms")

    def zones(self) -> list[dict]:
        """Flat zone list, each with its compartments."""
        return self._call("GET", "/locations")

    def compartment_id(self, zone: str, code: str, room: str | None = None) -> str:
        """Resolve a drawer-cell address such as ('A3', '1B'), optionally within a room.

        Zone names are unique per room, not globally (migration 0033), so two cabinets can both
        have a drawer 'A3'. Taking from the first match would record the wrong cell, so an
        ambiguous address raises instead of guessing; pass `room` to settle it."""
        hits = [c["id"]
                for z in self.zones()
                if z["name"].lower() == zone.lower()
                and (room is None or z["roomName"].lower() == room.lower())
                for c in z["compartments"]
                if c["code"].lower() == code.lower()]
        if not hits:
            raise KeyError(f"No compartment {zone}-{code}" + (f" in {room}" if room else ""))
        if len(hits) > 1:
            raise LookupError(f"{zone}-{code} exists in more than one room; pass room=")
        return hits[0]

    # ----------------------------------------------------- catalogue writes
    # Scope: catalog:write. A "group" is a top-level category (parentId None).

    def create_group(self, name: str, trackable: bool = True) -> dict:
        return self._call("POST", "/categories",
                          json={"name": name, "parentId": None, "isTrackable": trackable})

    def create_category(self, name: str, group_id: str, trackable: bool = True) -> dict:
        return self._call("POST", "/categories",
                          json={"name": name, "parentId": group_id, "isTrackable": trackable})

    def create_item(self, name: str, *, category_id: str | None = None, unit: str = "pcs",
                    returnable: bool = True, description: str | None = None,
                    product_code: str | None = None) -> dict:
        """productCode is server-generated when omitted; category is optional."""
        body: dict[str, Any] = {"name": name, "categoryId": category_id, "unit": unit,
                                "defaultReturnable": returnable, "description": description}
        if product_code:
            body["productCode"] = product_code
        return self._call("POST", "/products", json=body)

    # ------------------------------------------------------ location writes
    # Scope: locations:write. Rooms are created by a person in the web UI.

    def create_zone(self, name: str, room_id: str) -> dict:
        return self._call("POST", "/locations/zones", json={"name": name, "roomId": room_id})

    def create_compartment(self, zone_id: str, code: str) -> dict:
        return self._call("POST", "/locations/compartments", json={"zoneId": zone_id, "code": code})

    # --------------------------------------------------------------- stock

    def receive(self, product_id: str, compartment_id: str, qty: int, *,
                note: str | None = None, idempotency_key: str | None = None) -> list[dict]:
        """Scope stock:receive. Always sends an Idempotency-Key (a double receive is silent).
        Returns every placement of the product."""
        body: dict[str, Any] = {"productId": product_id, "compartmentId": compartment_id,
                                "quantity": qty}
        if note:
            body["note"] = note
        return self._call("POST", "/stock/receive", json=body,
                          idempotency_key=idempotency_key or str(uuid.uuid4()))

    def take(self, product_id: str, compartment_id: str, qty: int, *,
             purpose: str | None = None, channel: str = "api",
             returnable: bool | None = None, return_date: str | None = None,
             project_id: str | None = None, idempotency_key: str | None = None) -> dict:
        """
        Scope stock:take; needs ALLOW_DIRECT_TAKE=true. One call = borrow ISSUED + ledger ISSUE.
        - Recorded against the caller (the key's service account). Put a person's name in purpose.
        - qty <= DIRECT_TAKE_MAX_QTY (default 10), else 400 VALIDATION_FAILED.
        - returnable None -> product default. Returnable needs return_date 'YYYY-MM-DD'.
        - channel: api | voice | panel | web (recorded, decides nothing).
        - 404 NOT_FOUND means the cell is empty (its row goes at zero), not a fault (15.5).
        Returns {borrowId, borrowNo, status, quantity, isReturnable, expectedReturnDate,
                 placement} — placement is None when the take emptied the shelf.
        Pass your own idempotency_key if you may retry at a higher level (e.g. after a crash).
        """
        body: dict[str, Any] = {"productId": product_id, "compartmentId": compartment_id,
                                "quantity": qty, "projectId": project_id,
                                "purpose": purpose, "channel": channel}
        if returnable is not None:
            body["isReturnable"] = returnable
            body["expectedReturnDate"] = return_date if returnable else None
        return self._call("POST", "/stock/take", json=body,
                          idempotency_key=idempotency_key or str(uuid.uuid4()))


# ------------------------------------------------------------ CLI (read-only)

def _main(argv: list[str]) -> int:
    if len(argv) < 3 or argv[1] not in ("search", "where"):
        print(__doc__)
        return 2
    c = ImsClient.from_env()
    try:
        if argv[1] == "search":
            res = c.search(argv[2])
            for p in res["items"]:
                print(f"{p['productCode']:<22} {p['name']:<40} "
                      f"avail {p['totalAvailable']:>5} {p['unit']}  id={p['id']}")
            print(f"{res['total']} match(es)")
        else:
            for pl in c.where(argv[2]):
                print(f"{pl['zoneName']}-{pl['compartmentCode']:<10} "
                      f"qty {pl['quantity']:>5}  available {pl['availableQty']:>5}")
    except ImsCredentialDead as e:
        print(f"Credential no longer works ({e.code}): {e.message}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv))
