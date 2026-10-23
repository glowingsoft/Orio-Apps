"""
ORIO — Iter-22 Room polish (Playwright) tests.
Verifies:
  1. Simple host chair (no crown/throne ring/throne plate).
  2. RoomPeopleStrip removed from DOM.
  3. Chat area rendered below mic grid, no overlap, normal flow (not absolute),
     no dark chat panel gradient.
  4. Mic grid stability under chat + focus/blur + menu open/close.
  5. In 20-seat mode on 320x568 and 390x844, seats 18/19/20 fully visible.
  6. Regression testIDs (room-name, header-*, menu-*, chat-input, etc.) still render.

Run via the Emergent browser automation harness (not standalone pytest).
Room ids pre-created via /api/rooms as demo@voiceup.app:
  8-seat  : 6abb26d372223e17754d4435
  15-seat : 6abb26d372223e17754d4436
  20-seat : 6abb26d372223e17754d4437
Login: demo@voiceup.app / demo1234 via btn-email -> login-email-input ->
       login-password-input -> login-submit-button.
"""
