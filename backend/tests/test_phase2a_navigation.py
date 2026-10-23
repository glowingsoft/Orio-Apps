"""
ORIO — Navigation regression (Phase 2A).

Guards against the AuthGate allow-list bug that caused /earnings and /agency
to fall back to /(tabs)/home. Any new top-level route added to the app MUST be
added to the allow-list in /app/frontend/app/_layout.tsx; this test enforces
that for the Phase-2A routes.

The test parses the raw layout file so it does not need a running web preview
(which is flaky in CI) and runs instantly.
"""
from __future__ import annotations
import os
import re

LAYOUT = "/app/frontend/app/_layout.tsx"
ME = "/app/frontend/app/(tabs)/me.tsx"
EARNINGS = "/app/frontend/app/earnings.tsx"
AGENCY_INDEX = "/app/frontend/app/agency/index.tsx"
AGENCY_MANAGE = "/app/frontend/app/agency/manage/[id].tsx"


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def test_route_files_exist():
    """The three Phase-2A screens must physically exist as route files."""
    assert os.path.isfile(EARNINGS), f"missing route: {EARNINGS}"
    assert os.path.isfile(AGENCY_INDEX), f"missing route: {AGENCY_INDEX}"
    assert os.path.isfile(AGENCY_MANAGE), f"missing route: {AGENCY_MANAGE}"


def test_auth_gate_allowlist_contains_earnings_and_agency():
    """AuthGate must not redirect new top-level Phase-2A/2B routes to home."""
    src = _read(LAYOUT)
    # The allow-list sits in a single-line Array.includes(). Slice around it.
    match = re.search(r"!\[([^\]]+)\]\.includes\(segments\[0\]", src)
    assert match, "allow-list in AuthGate not found — _layout.tsx was refactored"
    allowed = {s.strip().strip("'\"") for s in match.group(1).split(",")}
    for required in ("earnings", "agency", "withdraw", "withdrawals", "payout-methods", "admin"):
        assert required in allowed, (
            f"'{required}' missing from AuthGate allow-list: {sorted(allowed)}"
        )


def test_me_menu_routes_point_to_the_right_hrefs():
    """The Me-tab menu rows for Earnings and Agency Center MUST navigate to
    `/earnings` and `/agency` respectively — not to any sibling route."""
    src = _read(ME)
    # Find the Earnings menu descriptor
    for key, label, expect_href in [
        ("earnings", "Earnings", "/earnings"),
        ("agency", "Agency Center", "/agency"),
    ]:
        # The descriptor sits on a single line that pairs id with href.
        rx = re.compile(
            r"id:\s*\"" + re.escape(key) + r"\".*?href:\s*\"(?P<href>[^\"]+)\"",
            re.DOTALL,
        )
        m = rx.search(src)
        assert m, f"menu entry id='{key}' not found in me.tsx"
        href = m.group("href")
        assert href == expect_href, (
            f"menu id='{key}' href is '{href}', expected '{expect_href}'"
        )
        # label still present
        assert label in src, f"menu label '{label}' missing from me.tsx"


def test_me_menu_rows_have_testids():
    """me-earnings and me-agency testIDs must exist so UI tests can tap them."""
    src = _read(ME)
    # Rows interpolate testID={`me-${m.id}`} — accept either shape.
    assert ("testID={`me-${m.id}`}" in src) or ('testID="me-earnings"' in src), (
        "me.tsx menu Pressable missing testID wiring"
    )
    # Confirm the referenced ids exist
    assert 'id: "earnings"' in src
    assert 'id: "agency"' in src


def test_earnings_screen_renders_the_right_root_testid():
    """earnings.tsx must mount with the 'earnings-screen' testID so the UI
    verification agent can detect the correct screen after a tap."""
    src = _read(EARNINGS)
    assert 'testID="earnings-screen"' in src


def test_agency_center_renders_the_right_root_testid():
    src = _read(AGENCY_INDEX)
    assert 'testID="agency-center"' in src


def test_agency_manage_renders_the_right_root_testid():
    src = _read(AGENCY_MANAGE)
    assert 'testID="agency-manage"' in src


def test_no_hardcoded_fallback_to_rooms_in_me_menu():
    """Earnings/Agency rows must NOT fall back to /home or /rooms."""
    src = _read(ME)
    # Make sure no obvious error-fallback redirects to /home around these ids
    for key in ("earnings", "agency"):
        block_rx = re.compile(
            r"id:\s*\"" + re.escape(key) + r"\"[^\n]*",
        )
        m = block_rx.search(src)
        assert m, f"menu row '{key}' missing"
        line = m.group(0)
        assert "/home" not in line and "/rooms" not in line, (
            f"menu row '{key}' routes to a fallback: {line}"
        )
