# ORIO - Product Requirements Document

## Overview
**ORIO** — *Voice Chat, Party & New friends*. Premium social voice-chat mobile app with the futuristic O + crown identity. Arabic + English (RTL/LTR ready). All previous "Folu Live" branding has been replaced.

---

## ✅ Iter-52 — Delete Room + Supporter Ranking + Trophy + Avatar half-overlap

**Exact files changed:**
- `/app/backend/server.py` — added `DELETE /api/rooms/{room_id}` (owner-only soft-delete) + `GET /api/rooms/{room_id}/ranking` (contribution|charm × daily|weekly|monthly|all, top 50 from gift_transactions)
- `/app/frontend/src/api.ts` — `apiDeleteRoom` + `apiRoomRanking` helpers
- `/app/frontend/app/room-ranking.tsx` — **NEW** screen with podium Top 3 + rank 4-50 + 2 metric tabs + 4 period chips
- `/app/frontend/app/_layout.tsx` — AuthGate whitelists `room-ranking`
- `/app/frontend/app/room/[id].tsx` — trophy icon beside room name → `/room-ranking?id=`
- `/app/frontend/app/(tabs)/home.tsx` — trophy mini-pill on every room card
- `/app/frontend/app/room/[id]/info.tsx` — half-in/half-out owner avatar (negative margin + ring) + delete-room button at top of settings card
- `/app/backend/tests/test_iter52_delete_room_and_ranking.py` — NEW, 7 tests

**Backend endpoints:**
- Reused: `gift_transactions` ledger for ranking aggregation (NO second source of truth), `profile_visitors` collection (already existed from earlier iteration)
- NEW: `DELETE /rooms/{id}` (owner-only, 403 for others); `GET /rooms/{id}/ranking` (metric+period params)
- Both enforce auth + validation server-side; no frontend-only gating

**Database changes:** None — all additions use existing collections. The room-delete flow sets `is_live:false + is_deleted:true` which cleanly frees the owner's `one_live_room_per_owner` partial unique slot (verified).

**Resolution per section:**
1. **Avatar half-in/half-out** ✅ — `ownerAvatarWrap` with `marginTop:-36` + surface-colored ring.
2. **VIP V inside circle** — already fixed in Iter-51 via `overflow:"hidden"` on the circle container.
3. **Delete Room** ✅ — real `DELETE /api/rooms/{id}` + confirmation dialog ("هل أنت متأكد من حذف الغرفة؟" + Cancel/Confirm).
4. **Trophy icon beside room name** ✅ — in room header.
5. **Trophy icon on discovery cards** ✅ — mini-pill on every room card.
6. **"ترتيب الداعمين" screen** ✅ — new dedicated page.
7. **المساهمة ranking** ✅ — real senders from `gift_transactions`.
8. **الجاذبية ranking** ✅ — real recipients from `gift_transactions`.
9. **Time filters** ✅ — daily/weekly/monthly/all, server-authoritative UTC boundaries.
10. **Real data** ✅ — no hardcoded users; 30s background refetch while screen visible.
11. **Top-3 podium** ✅ — gold/silver/bronze podium with scale emphasis on #1.
12. **All rankings clickable** ✅ — row + podium both route to `/user/{id}`.
13. **Room cards clickable** ✅ — card body opens room, trophy opens ranking (stopPropagation).
14. **Profile visit tracking** — already implemented (`/api/users/{id}/visit` + dedupe window).
15. **Who viewed my profile** — already implemented (`/api/users/me/visitors`).
16. **Visitor privacy** — enforced (owner-only endpoint).

**Tests:** **42/42 pass** (Iter-47 + 48 + 49 + 50 + 51 + 52). New Iter-52 suite covers:
- Delete requires auth · Non-owner forbidden · Owner succeeds · Delete frees slot
- Ranking shape empty · Rejects invalid metric · Reflects real transactions


---

## ✅ Iter-51 — Room UI polish + Report page + Change-Seat + mention focus

**A. Backend changes:**
- `POST /api/users/{user_id}/report` extended to accept `media_data_url` (base64, ≤~2MB) + `media_kind` ("image" | "video") and strict `reason` whitelist (8 categories + "other"); 250-char details cap enforced server-side.

**B. Frontend changes:**
- `/app/frontend/src/components/SpeakerRing.tsx` — now returns **null** when `level <= 0.03`. The permanent decorative ring that was visible at opacity 0.55 on EVERY seat is gone.
- `/app/frontend/app/room/[id].tsx` — `seatName` style stripped of the black transparent backplate (now clean text with a subtle shadow for legibility). `chatInputRef` added so the `@` button can refocus the input. Owner tapping a seated OTHER user now opens the normal profile card (not the old mic-action sheet).
- `/app/frontend/src/room/RoomUserCard.tsx` —
  - No more hairline dividers (header + action bar) → the stray "white line" is gone
  - Card uses `maxHeight: 85%` instead of a fixed 72% → no content clipping
  - Full-width + square corners confirmed
  - **New: Change Seat arrow** next to `@` (owner only, target on numbered mic)
  - **New: Seat Picker modal** showing all available mic seats with Taken/Locked hints
  - VIP V emblem wrapped in an `overflow:"hidden"` circle so animation never escapes
  - Settings menu localized AR labels (`إبلاغ / تعيين كمشرف للغرفة / سحب من الميك / طرد / حظر`)
  - Report row routes to the new dedicated `/report?user_id=...` page
  - `@` mention still inserts `@nickname ` into room chat; parent now refocuses the chat input
- `/app/frontend/app/report.tsx` — **NEW dedicated إبلاغ screen** with 8 reason tiles, 250-char counter, image + video picker (expo-image-picker, base64), live char counter, duplicate-submit guard. Submits to the real `/users/{id}/report` endpoint.
- `/app/frontend/app/_layout.tsx` — `report` route whitelisted in AuthGate.

**C. Database/data changes:** None (the `user_reports` doc now carries optional `media_kind` + `media_data_url` in-place; no new collection).

**D. Backend endpoints reused:**
- `POST /rooms/{id}/mic-change-seat` (owner/mod only — 403 enforced)
- `POST /users/{id}/report` (extended)
- All others from Iter-50 unchanged

**E. Tests:** **35/35 pass** across Iter-47 + 48 + 49 + 50 + 51. New Iter-51 suite covers: 8 reason categories, bogus→"other" fallback, 250-char truncation, small image attachment accepted, oversized attachment rejected (413/422), owner can change-seat (seats update), non-owner gets 403, occupied destination gets 409.

**F. Items that could NOT be fully implemented this cycle (still open):**
- Full Create-Room UI form with image / welcome / notice / seat picker (backend ready)
- Multi-account switcher (up to 5 sessions)
- Separate User Notice feature (room notice already persists)
- Richer in-chat row with avatar + badges inline


---

## ✅ Iter-50 — Room Profile Card Full-Width + Role-Aware Settings + @ Mention + Toast Bottom

**A. Backend changes:** None required — all admin endpoints already existed:
- `POST /api/rooms/{id}/moderators/add` (owner-only, 403 enforced)
- `POST /api/rooms/{id}/moderate` with `action: kick_seat / lock_seat / mute_seat` (owner/mod-only)
- `POST /api/rooms/{id}/bans/add` (owner/mod-only — this is "Kick from room")
- `POST /api/users/{id}/report` (any authenticated user, persisted to `user_reports`)
- `POST /api/users/{id}/block` (any authenticated user, persisted to `user_blocks`)
- `POST /api/rooms/{id}/seats/leave` (self-only)

**B. Frontend changes:**
- **RoomUserCard rewritten (surgical, same component)**:
  - **Full-width + square corners** — card now stretches edge-to-edge; no `borderRadius`.
  - **Header bar with `@` (opposite corner) + three-dot Settings menu**.
  - **@ button** inserts `@nickname ` into the room chat input via the new `onMention(user)` prop → shows **yellow** in chat via existing `renderMessageText` (Iter-48).
  - **Settings menu is role-aware**:
    - Normal user viewing someone else → only **Report**
    - Room owner viewing someone else → **Assign Moderator / Remove from Mic / Kick / Block / Report**
    - All actions wired to the existing real backend endpoints
  - **Leave Seat visibility fixed**: only shown when `isOnSeat && isMe` (self-only, per spec)
  - "Remove from Mic" only appears when the target is actually on a numbered seat (seat index > 0)
- **Toast anchored to bottom** of screen (was top). Translates from +24 → 0, so it no longer covers the ORIO logo / profile card.
- **Owner-seat touch feedback** was already a lightweight toast (no banner / no avatar) — kept, now bottom-positioned.

**C. Database/data changes:** None.

**D. Permission enforcement:**
- Owner-only actions (Assign Mod / Remove from Mic / Kick / Block) are **server-side enforced** — attackers calling the API without the role get `403`.
- Verified with 7 tests in `tests/test_iter50_room_profile_admin_actions.py`.

**E. Tests:** **27/27 pass** across Iter-47 + Iter-48 + Iter-49 + Iter-50 suites. New Iter-50 suite covers:
- Non-owner cannot assign moderator (403)
- Non-owner cannot moderate seat (403)
- Non-owner cannot ban (403)
- Owner can ban (200)
- Report persists (`reported:true` + id)
- Block endpoint reachable
- Owner can moderate seat


---

## ✅ Iter-49 — Discovery pills restored + mic glow cleanup + "جديد" badge wired

**A. Backend changes (surgical, server.py):**
- Room-join WebSocket now ships `is_new` on `user_pub` so chat clients can render the "جديد"/"NEW" chip server-authoritatively.
- `/api/users/search` projection extended with `created_at` so `is_new` is computed accurately (was silently falling back to `now_utc()`).

**B. Frontend changes:**
- **Party Rooms (home.tsx)** — restored the full 7-pill discovery row:
  `Recommended · PK · Music · Chat · Games · CP · Watched` (RTL labels: توصية / PK / موسيقى / دردشة / ألعاب / CP / تمت المشاهدة). Each pill maps to a real backend endpoint (`/rooms?sort=…` or `/rooms?category=…` or `/rooms/watched`).
- **Mic/seat glow removed** — the duplicate purple `shadowColor` + `borderWidth` that was applied to seats when speaking is gone. The `SpeakerRing` watery white waveform is now the **sole** speaking indicator; it is already driven by real Agora audio levels and renders zero when `!speaking || muted || empty-seat`.
- **Messages screen** — premium title + Add Friend icon (`person-add` in a soft brand-tint pill) in the opposite corner; tap → `/search` (real ORIO user search).
- **"جديد" badge** — new `NewUserBadge` component (green chip, no local timer) wired into:
  - Room chat rows (reads `is_new` from the WS payload)
  - Search results (reads `is_new` from `/users/search`)
  - More surfaces to follow in next cycle (user profile card, room cards, mic seats)
- **Yellow `@mentions`** confirmed working via `renderMessageText` from Iter-48.

**C. Database/data changes:**
- No new indexes. The Iter-48 `one_live_room_per_owner` partial unique index is still active (verified).

**D. Party Rooms category restoration:** ✅ All 7 pills present, each wired to a real backend query. Icons: `sparkles / flash / musical-notes / chatbubbles / game-controller / heart / time` — all sharp ionicons, no emoji.

**E. Mic waveform / glow status:**
- Permanent seat glow / purple shadow when speaking: **REMOVED**.
- `SpeakerRing` white waveform: ONLY active when `(speaking && !muted)`, driven by real Agora levels (local via `isLocalSpeaking`, remote via `remoteAudioLevels` normalized 0..1).
- Empty seats / silent users / muted users: ZERO ring/glow.

**F. Permissions / moderation status:**
- Backend permission checks for room ownership / moderator role / leave-seat already enforced in server.py (unchanged).
- Frontend profile-card UI with role-aware action set is **still pending** (next cycle).

**G. Multi-account status:**
- Not yet implemented — still pending (next cycle).

**H. Tests:**
- 20/20 pass across the Iter-47 + Iter-48 + Iter-49 suites.
- New file: `tests/test_iter49_discovery_and_new_badge.py` (4 tests covering popular + PK + watched endpoints + is_new wiring).
- Full regression suite: pre-existing legacy failures outside this scope are unchanged.

**I. Still pending (next cycle, same backlog as before, now reduced):**
- §5 Full Create-Room UI with image + welcome + room-notice + user-notice form fields (backend ready).
- §7 Multi-account switcher (up to 5 saved sessions).
- §8–11 Full-width room profile card with role-gated actions (normal → Gift/Follow; owner → Report/Kick/Ban/Mod; owner-only Leave Seat).
- §10 Report system with 500-char text + optional image/video attachments.
- §12 Richer room-chat identity row (avatar + badges inline).
- §14 Separate User Notice feature (room notice already persists).

**J. Configuration still required:**
- Twilio Verify credentials (`TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_VERIFY_SERVICE_SID`) — Phone login remains dim until supplied.
- Facebook (`FACEBOOK_APP_ID / FACEBOOK_APP_SECRET`) — Facebook login remains dim until supplied.


---

## ✅ Iter-48 — Master Surgical Fix (Partial — Policy & Core UX layer)

**Backend (surgical, server.py append-only):**
- **One room per user** — pre-check 409 + partial unique index `one_live_room_per_owner` (concurrent-safe); migrated 142 duplicate live rooms to `is_live=false`
- **Allowed room categories** strictly `{cp, games, chat, music}`; `_normalize_room_category()` applied in `public_room` + create endpoint (legacy "dj"/"social"/"team" etc. silently normalized)
- **Seat count** enforced to `{8, 15, 20}` and actually determines persisted seat array length
- **`welcome_msg` + `notice`** persisted in `CreateRoomIn` so Create-Room flow can send real values
- **`is_new`** auto-badge in `public_user`: `True` for 5 days from real `created_at` (tz-safe)
- All existing auth / wallet / rooms / VIP / gifts endpoints untouched

**Frontend (surgical):**
- **Toast dedup**: identical message → one toast only (fixes "3 identical banners on single tap")
- **Localized AR/EN unavailable messages**: `phoneNotConfigured` + `fbNotConfigured` now user-friendly, no raw backend errors
- **Global scrollbar hide** via `+html.tsx` CSS → removes gray vertical lines on web
- **Fixed purple avatar border removed** on `/(tabs)/me.tsx` profile header
- **Tap profile avatar → full-screen `ImageViewer`** directly (new `ImageViewerProvider` mounted globally)
- **Yellow `@mentions`** in room chat via `renderMessageText` (`#FFD60A`, not purple)
- **"Enter my room"** header icon → opens user's real owned room (or `/create-room` if none); long-press always goes to create
- **Discovery tabs** locked to `Recommended / CP / Games / Chat / Music / Following`
- **Room category badges** use the canonical 4 labels

**Tests:** `tests/test_iter48_room_policy_and_badges.py` — **7/7 pass**. Combined with Phase 6 — **15/15**. Full regression: 490 pass / 38 fail. The ~15 legacy failures in `test_iteration_17/18/19/22/27` create 2+ rooms per owner (now blocked by the user-requested one-room-per-user policy) — these need refactoring to use one owner per room. The remaining ~23 failures are pre-existing unrelated issues (room-shape migration, growth-points field rename, mic-invite WS tests).

**Still outstanding from master prompt (next cycles):**
- §7 Party header icon spacing polish
- §9 Full Create-Room UI with image / welcome / notice form fields (backend ready)
- §13 Mic waveform correctness (verify `SpeakerRing` is only around active-speaker avatars)
- §16–18 Messages add-friend icon, Profile `أنا/Profile` + account switch
- §19–25 Full-width room profile card, mod actions, report with media attachments, @ icon
- §26 (frontend) Render "جديد" badge on user tiles everywhere (field is now shipped)
- §27 User-notice as separate feature


**Backend (surgical, server.py append-only):**
- `GET /api/auth/providers` — reports `{google, email, phone, facebook}` enabled flags
- `POST /api/auth/phone/send-otp` + `/verify-otp` (Twilio Verify REST, real SMS, strict E.164, 5-per-10m send limit, 10-per-10m verify limit, TTL cleanup)
- `POST /api/auth/facebook/exchange` (debug_token → app-ownership check → `/me` fetch → unify by `facebook_id`/`email`)
- `GET /api/auth/facebook/public-config` — returns `{app_id}` only; secret stays server-side
- New sparse-unique indexes: `users.phone`, `users.facebook_id`
- When credentials are empty → endpoints return 503 "not configured" (NEVER a fake success)

**Frontend:**
- New `app/(auth)/phone.tsx` — country-code picker (73 countries), E.164 normalization, 6-digit code, 30s resend cooldown, re-enter number
- `login.tsx` — exactly 4 real methods: Google, Email, Phone, Facebook (official blue + logo); Phone/Facebook dim when `providers.*=false`
- `auth-context.tsx` — `signInWithPhoneSendOtp`, `signInWithPhoneVerify`, `signInWithFacebook`; auto-detects FB redirect `#access_token` on cold start (web + native deep link)

**Tests:** `tests/test_iter47_phase6_phone_facebook_auth.py` — **8/8 pass**. Full regression: 523 pass / 21 pre-existing failures (all unrelated areas: room layout, VIP conversions, mic-invite WS tests from older iterations).

**To enable in production:** fill the following in `/app/backend/.env`:
```
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_VERIFY_SERVICE_SID=VA...
FACEBOOK_APP_ID=...
FACEBOOK_APP_SECRET=...
```
Then restart backend. The login screen auto-detects via `/auth/providers` and un-dims the buttons.


## Phase 5 (this iteration) — Rebrand to ORIO

### Branding
- Official logo asset (the neon O with orbital ring) is displayed centered on splash + login
- Cinematic reference background image is used behind the login for the calm-purple gaming atmosphere
- Splash: dark gradient + ORIO logo + tagline "Voice Chat, Party & New friends"
- App name in `app.json`: **ORIO**
- Backend log/title/welcome text: **ORIO**

### Login screen (matches supplied reference)
- Full-screen cinematic background image
- Top-right pill button `Language / اللغة` with globe icon + chevron → opens modal with English / العربية selection (state saved locally; ready for i18n expansion from admin)
- Centered ORIO logo (official image) + subtitle "Voice Chat, Party & New friends"
- Three large rounded provider buttons: Google (white), Apple (glass), Phone (glass)
- OR separator
- Three round social icons: Facebook, Email, X
- Email button routes to email/password flow (existing real auth)
- Terms + Privacy legal footer (Arabic version supported)
- Google/Apple/Phone/Facebook show a "credentials required" dialog — configuration point is ready; no fake auth

### Preserved (unchanged from earlier phases)
- Email/password real JWT auth (register, login, refresh, me, logout)
- 5-tab navigation: Games / Rooms / Posts / Messages / Me
- Diamonds (premium 3D SVG gem) as the sole currency
- 11 recharge packages (mobile) + 11 web-bonus packages
- 10 diamond mini-games with server-side RNG + atomic deduction
- VIP 1-7 with purchase (Folu Coins → renamed everywhere to Diamonds)
- Follow/unfollow, DMs, Rooms with 8 seats + gifts
- Posts feed + likes + delete + **threaded comments (bottom-sheet UI with real-time refresh)**

## Phase 6 (this iteration) — Room Experience Upgrade (Phase 1 of 3)

### Multi-layout Voice Rooms
- New `PATCH /api/rooms/{id}/layout` endpoint (owner/moderator only) — accepts 8, 15, or 20 seats
- Responsive seat grid with dynamic sizing: 8 → HOST + rows of 4+3, 15 → HOST + 5+5+4, 20 → HOST + 5+5+5+4
- Seat contents preserved when shrinking; new empty seats added when growing

### Persistent Room Chat
- Chat feed is always visible above the bottom bar (no toggle) with 200-message rolling buffer
- Real-time via WebSocket; new `system` events broadcast on: seat_taken, seat_left, muted, unmuted, layout_changed, room_closed, chat_cleared
- Chat history (last 30 messages) is replayed to each newly connected socket, so late joiners see context
- Owner/mod can wipe chat via `POST /api/rooms/{id}/chat/clear`

### Minimize / Restore (Global Room Session)
- New `RoomSessionProvider` at root manages Agora + WS globally — session survives navigation
- ⋮ → Minimize navigates back and reveals a `FloatingMiniRoom` pill (avatar + room name + voice dot + ✕) above the tab bar
- Tapping the pill re-opens the room; Agora voice never drops
- WS auto-retries when the auth token restores after a deep-link/refresh

### Close Room
- New `POST /api/rooms/{id}/close` (owner/moderator only) marks `is_live=false`, clears chat, and broadcasts `room_closed`
- Non-owner attempts return 403; connected clients auto-navigate back home on receipt of the event

### Room ⋮ Menu (all 8 items)
- Close room (owner/mod, danger)
- Share (native OS share-sheet)
- Minimize
- Mute / Unmute self (seat only)
- Clear chat (owner/mod)
- Layout picker (8/15/20)
- Entrance effects toggle (`PATCH /rooms/{id}/settings`)
- Noise reduction toggle
- Network speed — measured live via `/api/rtc/config` ping

### Cross-platform confirm helper
- `src/utils/confirm.ts` — `Alert.alert` on native, `window.confirm` on web (fixes RN-Web where `Alert.alert` doesn't render)

## Phase 7 (this iteration) — User Profile System Rebuild

### Numeric ID (immutable, 9 digits)
- New `numeric_id` field on `users` collection — always 9 digits, no letters/symbols
- Startup backfill for existing users; unique sparse index; generated at registration
- Immutable — `UpdateProfileIn` does not accept it; PATCH attempts are silently ignored
- New `GET /api/users/by-numeric-id/{nid}` for CP/Friend search (400 on non-numeric or wrong length, 404 on unknown)

### Profile header
- Cinematic cover (blurred fallback → user's own cover), large gold-ring avatar, marquee username for long names (`MarqueeText`)
- Numeric ID pill with one-tap copy (`expo-clipboard`) → ✓ confirmation
- Info chip row (scrollable): country flag, age, gender, VIP, charm, wealth, family, account-age-in-days
- Account age is computed client-side from server-authoritative `created_at`
- Bio (own edits, viewer read-only) with elegant empty state
- Voice Bio placeholder card — clearly marked "Coming Soon" / "Soon" pill (non-functional as required)
- Real Friends / Following / Followers stat row — tappable, live counts from backend
- 3-tab switcher: `الملف الشخصي` / `مرتبة الشرف` / `العلاقات` with gold underline

### Tab content
- **Profile**: User Room card (opens the room), Family card (opens family), horizontal Posts row
- **Honor**: LV chips + 3 gallery frames (Gift, Medal, Fashion) with locked-item fallback
- **Relationships**: Relationship requests bar, CP card with search action + add slot, Friends grid with per-slot Invite buttons, CP Ranking + Friends Ranking navigation pills

### Edit Profile screen (owner only)
- Pencil (top-left of profile header) opens `/edit-profile`
- Fields: avatar (image picker + gallery permission), nickname, bio, age (13–120 numeric-only input), gender (Male/Female pills), country (bottom-sheet picker with flag + code)
- "Premium ID — Coming Soon" placeholder row (disabled — does NOT alter numeric_id)
- Server-side validation with 422 on invalid age/gender

### View-only mode
- `/user/{id}` renders the same layout but replaces the pencil with a share button; disables owner-only actions

## Phase 8 (this iteration) — P0 Bug Fixes + Polish

### Login crash fixed
- `t.comingSoon(p)` (called as a function) crashed the login screen on tap of Apple/Phone/Facebook/TikTok/X
- Fixed to a simple `Alert.alert(p, "${p} — Coming Soon")` string message
- All 5 "Coming Soon" social buttons now tap cleanly, no `t.comingSoon is not a function` error

### 8-digit numeric ID standard
- Previous 9-digit IDs migrated to fresh unique 8-digit at startup (via `_backfill_numeric_ids`)
- New registrations issue 8-digit numeric IDs (`10000000..99999999`)
- Fallback to 9-digit only if the 8-digit space is saturated

### Age validation tightened to 13–99
- `UpdateProfileIn.age` now `Field(ge=13, le=99)`
- 100+ returns 422

### Account age Day-1 rule
- ProfileView now clamps account-age to `Math.max(1, floor(diff/day) + 1)` — registration day counts as Day 1 (not Day 0)

### VIP identity uses the ORIO V (no star)
- Profile info-row chip now shows literal "V" + "VIP N" in the exact tier color from `OrioVipEmblem.VIP_TIERS`
- Adjacent "Nobility — Soon" chip added as placeholder

### Profile avatar no longer clipped
- `coverWrap: overflow:visible` + inner `coverInner: overflow:hidden` clip layer for the blurred cover art
- Avatar now overflows below the cover container, fully visible

### Room chat dedup + stable keys
- `pushChat` in `RoomSession` now dedupes by message ID (prevents replay-on-reconnect duplicates)
- Chat IDs are deterministic: `chat-{at}-{userId}-{text[:30]}`
- system events use `sys-{kind}-{userId}` — no more `Date.now()` in keys
- Backend truncates chat timestamps to ms precision (matches Mongo storage) so live broadcast IDs equal history-replay IDs
- Resolves the "Encountered two children with the same key" React warning

### Universal avatar tap
- New shared `UserAvatar` component: tap any avatar → `/user/{userId}`
- Applied in Posts feed, Post comments, and Room seats (tapping a seat occupied by another user now opens their profile instead of the gift sheet)
- Post-author name row also navigates to `/user/{authorId}`

## Phase 9 (this iteration) — Global UI Polish

### Me tab: numeric_id + V VIP + tappable chips
- Me tab now displays `ID: 78995809` (8-digit numeric_id) — previously showed the old hex `short_id`
- VIP badge is the ORIO V (color-tinted, from `OrioVipEmblem.VIP_TIERS`) — no more star icon; only rendered when vip_level > 0
- Header row → tap → `/(tabs)/profile`
- Level chip → `/vip`; Wealth + Charm chips → `/rankings`

### Profile info chip fixes
- Left-edge chip clipping fixed (padding lg vs md)
- Charm / Wealth / V VIP chips are now `Pressable` and navigate to `/rankings` or `/vip`
- Nobility remains "— Soon" placeholder

### Login logo shrunk
- Container 168 → 140 px, image 148 → 140 px, wordmark 56 → 48 pt
- All content fits within the viewport with room to breathe

### Global ORIO refresh indicator
- New `OrioRefreshControl` shared component — gold tint on iOS, gold+purple sequence on Android
- Wired into: `/(tabs)/home`, `/(tabs)/games`, `/(tabs)/posts`, `/(tabs)/profile` (owner + viewer variants)

## Phase 10 (this iteration) — Room Discovery + Room User Card + Mini Room

### Country-based room discovery
- Replaced the multi-country chip banner (Arab/Turkey/USA) with a **single country-selector button** — dark bottom-sheet with circular flags, search field, and all backend `/countries`
- Rooms API now accepts `?country_code=XX` and only returns rooms with `listeners_count > 0`
- New rooms are created with `country_code`/`country_flag` copied from the owner's account for automatic filtering
- Public room DTO exposes `country_code` + `country_flag`

### "LIVE" removed from UI, real room type badge
- The visible "LIVE" text/dot is gone from room cards and room header (spec: keep real-time state, remove the word)
- Room cards now show a real type badge (CHAT / DJ / PK / TEAM / GAME / STUDY / VOICE / MEET) derived from `room.category`
- Room detail header shows the room's actual type in a gold pill

### RoomUserCard — tap an avatar without moving the user
- New `RoomUserCard` modal shown when tapping any avatar in the room; opening/closing does NOT mutate seat state or Agora
- Shows real backend data: nickname, 8-digit numeric_id, country flag, gender + age pill, account-age days, Wealth/Charm/VIP stat cards (all tappable), Family, Gift Gallery
- Bottom action = context-aware:
  - Own seat → `Leave Seat`
  - Other user → `Send Gifts` (opens gift sheet pre-targeted to their id)
  - Own card off-seat → `Open Profile`
- Wealth/Charm → `/rankings`, VIP → `/vip`, avatar or Gift Gallery → full profile at `/user/{id}`

### Draggable mini-room
- Rebuilt as a compact 200×56 pill (roughly half the previous size)
- Fully draggable via `PanResponder` with soft-spring snap-back on release
- Clamped inside safe-area on all sides + above tab bar; stays inside the viewport
- Agora + WebSocket stay alive; tap to restore

## Phase 11 (this iteration) — Room Polish + Host Chair + Received Gifts

### Compact room-discovery cards
- Replaced the giant portrait cards (aspectRatio 0.85) with a compact 2-column grid: 1.2 aspect-ratio cover strip on top + 2-line info footer (name + listeners + owner nickname)
- ~6 cards fit per phone viewport instead of 2
- Type badge (real category) + country flag remain as small top overlays
- "LIVE" text remains absent throughout

### Host + Numbered Mic Seats (new data model)
- `num_seats` semantics changed to **numbered mic seats only** (host is *not* counted)
- Total seat slots in DB = `num_seats + 1` (index 0 is the dedicated host chair)
- Allowed layouts: 1 host + 8 mic (=9 slots), 1 host + 15 (=16), 1 host + 20 (=21)
- `create_room` and `PATCH /rooms/{id}/layout` both provision `num_seats + 1` slots
- Startup migration (`_migrate_rooms_host_plus_numbered`) pads legacy rooms; idempotent
- LayoutPicker labels: "Cozy — 1 host + 8 mic seats" / "Party — 1 host + 15 mic seats" / "Concert — 1 host + 20 mic seats"

### Dedicated Host Chair (visual)
- Rendered as a separate block above the numbered grid, upper-left corner (auto-flips to upper-right in RTL)
- Distinct gold "★ HOST" badge above the seat
- Uses the real owner's avatar/nickname/VIP/speaking/mute state; never gets consumed by a numbered mic seat
- Numbered mic seats display seat.index (1..N), same size across the entire grid regardless of 8/15/20 layout

### Chat + action bar compaction
- Chat feed maxHeight 200→140, positioned above compacted action bar, no longer covers mic seats
- Action buttons 48→40 px, chat input 44→40 px, icon sizes 22→18
- Keyboard-avoiding view intact — keyboard does not push the mic grid

### RoomUserCard bottom sheet + real Gift Gallery
- Converted from centered floating card to a slide-up bottom sheet (~62% of screen height)
- 8-digit ID chip is tap-to-copy: `testID=card-copy-id` with green "Copied!" flash + haptic on native
- Gift Gallery preview now consumes `GET /users/{id}/gifts-received` — first 4 gifts with real images + `×N` quantity badges
- Tap the gallery → dedicated `/user/{id}/gifts` page

### Received Gifts page — `/user/[id]/gifts`
- New route, real backend data via `GET /users/{id}/gifts-received`
- 3-column grid of aggregated gifts (image + `×N` badge + name + total diamonds)
- Summary header: recipient avatar, 8-digit ID, total gifts count, total value
- Empty state when the user has never been gifted
- Pull-to-refresh with `OrioRefreshControl`

### Copy-to-clipboard 8-digit ID everywhere
- New shared util `/src/utils/copyId.ts` (expo-clipboard + optional expo-haptics)
- Wired into `me.tsx` (`me-copy-id`), `RoomUserCard` (`card-copy-id`), and reuses the already-copyable ID chip in `ProfileView`

### FloatingMiniRoom halved
- Width 200→140 px, height 56→44 px (avatar 36→30, close 24→20)
- Drag/clamp/tap-to-restore preserved. Agora voice + WS remain live while minimized.

### Verification (iter 16)
- Backend 9/9 tests pass — see `/app/backend/tests/test_iteration_16.py` and `/app/test_reports/pytest/pytest_results_iter16.xml`
- Frontend 13/13 checkpoints pass — see `/app/test_reports/iteration_16.json`

## Phase 12 (this iteration) — Mic system + Permissions + PK Challenge + Room Lock

### Backend
- **Host chair permission**: `POST /rooms/{id}/seats/take` on seat 0 by a non-owner/non-mod returns `403 "هذا المقعد لصاحب الغرفة فقط"` (check runs before occupied/locked so the message is deterministic).
- **Real-time participants**: `GET /rooms/{id}/participants` returns `{room_id, count, participants}` from WS `_hub.presence`. `user_joined`/`user_left` events already include `present[]`.
- **Room lock**: `POST /rooms/{id}/lock` (owner/mod) with 5-digit numeric pin → bcrypt-hashed `pin_hash`. `POST /rooms/{id}/unlock` clears it. `POST /rooms/{id}/join` accepts an optional `{"pin": "12345"}` and rejects with 403 when locked (owner/mod/already-seated bypass). `public_room` exposes `is_locked`; `pin_hash` never leaks.
- **Mic invite (owner/mod)**: `POST /rooms/{id}/mic-invite` places a currently-in-room (WS-present) user onto an empty seat. Rejects targets not in presence (400), non-owner/mod callers (403), and non-owner target on host seat (403 with the Arabic message).
- **Mic change-seat (owner/mod)**: `POST /rooms/{id}/mic-change-seat` moves a seated user from→to, preserving mute state; refuses locked/occupied destinations.
- **PK Challenge (server-authoritative 1v1)**: `POST /rooms/{id}/pk/start` (two seated users, one active per room), `GET /rooms/{id}/pk`, `POST /rooms/{id}/pk/end`. Scoring is automatic: `POST /gifts/send` with a `room_id` credits the gift's `total_cost` to score_a or score_b when the recipient is on a PK seat, and broadcasts `pk_score` over the WS.

### Frontend
- **Header polish**: room name in upper corner (RTL-aware), new `room-participants-btn` with live count from WS presence, `room-menu-btn` uses `ellipsis-horizontal` (`•••`) and hides while the menu sheet is open.
- **Mic Mode wording**: "Layout" → **"Mic Mode / وضعيات الميكات"** everywhere (menu item, picker title).
- **Owner/mod mic-action sheet**: tap any non-self numbered/locked seat as owner → **Change Seat / Invite / Lock**; on a locked mic → **Open Mic** only.
- **Normal users**: direct-tap seat-take behaviour preserved. Host-seat error surfaces via the backend Arabic message.
- **Room menu**: Exit / Share / Minimize / Mute Room / Clear Chat (mod) / Lock Room or Unlock Room (mod) / Mic Mode (mod) / Mute self. **"Close Room" wording removed** — Exit is available to all users.
- **Room Mute**: toggles `session.roomMuted` → `useAgora` calls `muteAllRemoteAudioStreams(true)` (native) / `adjustPlaybackSignalVolume(0)` (web). Publisher stream unchanged; Agora stays connected.
- **Minimize icon** = `contract-outline` (arrows meeting inward).
- **Bottom action bar**: `exit-room-btn` **removed**. New `room-more-btn` (four-dot `apps`) opens `BottomMoreSheet` with `more-music` (placeholder alert — no music backend yet) and `more-pk` (real `PkPanel` with live score bar, polling every 3s).
- **RoomUserCard**: modal backdrop now fully transparent — the room stays lit when the profile bottom sheet opens. Horizontal cover-strip removed. Action bar: **Send Gifts** for others; **Leave Seat** only when target is self AND on a mic.
- **Seat mute badge**: rendered OUTSIDE the seat Pressable (which had `overflow:hidden`), so the mute icon sits outside the circular avatar boundary at the reference position.
- **Room Lock UI**: 5-digit numeric input with monospace tracking, `lock-room-pin-input` + `lock-room-submit`; validates 5-digit before enabling submit.

### Verification (iter 17)
- Backend **23/23 pytest pass** — `/app/backend/tests/test_iteration_17.py` and `/app/test_reports/pytest/pytest_results_iter17.xml`.
- Frontend runtime + code checks pass — `/app/test_reports/iteration_17.json`.
- P1 fix applied by testing agent: reordered the host-chair permission check in `take_seat()` so the Arabic 403 message wins over the 409 "seat is occupied" and 403 "seat is locked" branches.

## Phase 13 (this iteration) — Room Header simplification + Room Info + Follow / Membership / Moderators / Bans + two-part Discovery

### Backend
- **Room persistence rule**: rooms are never auto-deleted. Discovery uses `is_live: True` + `is_deleted != True` + `listeners > 0`; the underlying record survives 0 participants.
- **Follow (idempotent)**: `POST /rooms/{id}/follow`, `DELETE /rooms/{id}/follow`, `GET /rooms/{id}/follow-status`. `follow_count` is atomically synced on the room doc after every mutation.
- **Membership (async approval)**: `POST /rooms/{id}/membership/request` requires the caller to be following, blocks duplicates; `GET /rooms/{id}/membership/pending` for owner/mod; `POST /rooms/{id}/membership/review` (owner only) marks approved/rejected and inserts the `room_members` row.
- **Moderators (owner only)**: `POST /rooms/{id}/moderators/add` — target must be an approved member; `POST /rooms/{id}/moderators/remove`; `GET /rooms/{id}/moderators`.
- **Bans (owner/mod)**: `POST /rooms/{id}/bans/add`, `POST /rooms/{id}/bans/remove`, `GET /rooms/{id}/bans`. Ban enforcement on join → `403 "You are banned from this room"`.
- **Recommended sort**: `GET /rooms?sort=recommended` runs an aggregation ranking rooms by `listeners*3 + follow_count*2 + recent_gifts_last_hour*5`.
- **Public schema**: `public_room` now exposes `is_deleted`, `follow_count`, `member_count`, `background_url` (falls back to `cover_url`). `pin_hash` still never leaks.
- Unique indexes on `room_follows`, `room_members`, `room_bans`; pending index on `room_membership_requests`.

### Frontend
- **Simplified room header**: room name + custom ORIO blue follow heart with real count. Removed: minimize icon, ID text, Voice Off pill, category badge, three-dot menu, participants badge. Tapping the name opens the new Room Info screen.
- **Custom ORIO iconography** (pure SVG in `src/components/OrioIcons.tsx`):
  - `OrioHeart` — blue V-notched follow heart with active-state gradient + glow
  - `OrioMembership` — orange winged plus diamond
  - `OrioCreateRoom` — gold house silhouette with plus-notch door
  - `OrioMoveMic` — twin circles with transfer arrows (ready for owner Move-Mic action)
- **Room Info screen** (`/room/[id]/info`): real background, real owner card with tap-to-copy 8-digit ID, real follow + membership buttons (progressive Join → Pending → Member), horizontal Members / Moderators / Banned Users sections, owner-only Pending Requests approve/reject rows, real `Share.share` via `Linking.createURL`.
- **BottomMoreSheet re-homing**: the removed three-dot menu functions moved into the bottom four-dot tools — Music (placeholder), PK Challenge (real), Minimize, Room Info, Mute Room.
- **Discover Rooms**: two-part 50/50 segmented control — `filter-countries` (with existing country picker) and `filter-recommended` (drives `sort=recommended`). Create-room icon replaced with `OrioCreateRoom`.
- **Create Room CTA**: "Go Live 🎙️" → "Create Room".

### Verification (iter 18)
- Backend **21/21 pytest pass** — `/app/backend/tests/test_iteration_18.py` and `/app/test_reports/pytest/pytest_results_iter18.xml`.
- Frontend runtime checks **all pass** (`filter-countries`/`filter-recommended` at 175 px each, `<svg viewBox="0 0 24 24">` inside `create-room-btn`, no removed header testIDs present, follow heart 0→1→0 atomic, membership button progressive-disclosure works, `/room/{id}/info` renders all sections, `room-more-sheet` contains all 5 actions, no "Go Live" text) — `/app/test_reports/iteration_18.json`.
- No code changes were required by the testing agent this pass.

## Phase 14 (this iteration) — Fixed mic size + name plate + real-time People strip + expanded Discovery categories

### Backend
- **`GET /rooms?sort=popular`** — orders by `follow_count DESC` then `listeners_count DESC`; keeps the `listeners > 0` gating.
- **`GET /rooms?sort=pk`** — returns only rooms currently running an active PK match (`pk_matches.status=active`).
- **`GET /rooms/following`** — real followed rooms for the caller (survives 0 listeners since these are user-owned relationships).
- **`GET /rooms/watched`** — recently visited rooms in newest-first order.
- **`room_visits` collection** — upserted on `POST /rooms/{id}/join`; unique index on `(user_id, room_id)` + secondary `(user_id, visited_at DESC)`. A repeat visit updates `visited_at` (no duplicates).

### Frontend
- **Fixed mic seat size across every Mic Mode.** `computeSeatMetrics` now returns a constant `SEAT_SIZE = 62` regardless of 8/15/20; only the row structure varies (4/4, 5/5/5, 5/5/5/5). No dynamic shrink when other users join or leave.
- **Username plate.** Every occupied seat renders its nickname inside a compact translucent black plate (`backgroundColor: rgba(0,0,0,0.55)`, `borderRadius: 8`, `paddingH: 6 / V: 2`). Marquee behavior unchanged for long names.
- **`RoomPeopleStrip`** (new): horizontal ScrollView below the header driven by `session.participants`. De-duplicated by `user.id` (reconnects don't double-count). Tapping a strip avatar opens `RoomUserCard` without touching seat state. Trailing pill shows the real WS-connected count (`room-people-count`).
- **Expanded Discover Rooms.** Replaced the iter-18 Countries/Recommended segmented control with a horizontally-scrollable tab row of 9 categories (`tab-recommended`, `tab-popular`, `tab-pk`, `tab-games`, `tab-chat`, `tab-music`, `tab-following`, `tab-family`, `tab-watched`). Selected tab uses purple ORIO active pill. Country selector is always visible below the tabs — both filters combine.
- **Localized per-category empty states** (Arabic + English) — Following → "You aren't following any rooms yet." / "أنت لا تتابع أي غرف بعد."
- **API bindings**: `apiListRoomsPopular`, `apiListRoomsPk`, `apiRoomsFollowing`, `apiRoomsWatched`.

### Verification (iter 19)
- Backend **26/26 pytest pass** — `/app/backend/tests/test_iteration_19.py` + full iter-18 regression (21/21) — `/app/test_reports/pytest/pytest_results_iter19.xml`.
- Frontend runtime checks **all pass** — `/app/test_reports/iteration_19.json`:
  - Every numbered seat has an identical 62×62 px bounding box (F1).
  - Seat username `<Text>` renders `background-color: rgba(0, 0, 0, 0.55)` (F2).
  - `room-people-strip` renders `strip-person-*` avatars and `room-people-count` matches (F3).
  - Tapping a strip avatar opens `room-user-card`; seat DOM byte-identical before/after (F4).
  - All 9 tab testIDs render; wrapping ScrollView has `overflow-x: auto`, `scrollWidth 869 > clientWidth 390` (F5).
  - Following tab shows the localized empty state; Recommended tab does not contain the "following" text (F6/F8).
  - Country selector visible on every tab (F7).
  - Full iter-16..18 regression checks still green (F9).
- No code changes required by the testing agent this pass.

- Rankings (5 categories × 4 periods, country filter)
- Friendship + CP (with pair keys, points, levels)
- Families + private chat (10,000 Diamond create cost, membership-gated messages)
- Profile Visitors (5-min dedup, lifetime views counter)
- Referral code + share
- My Rooms, Settings, Invite, Me hub

## Phase 7 (this iteration) — Visible Branding & Systems

### ✅ Login screen (matches user spec exactly)
- Official ORIO O logo at top, **slightly smaller** than before (148×148 inside 168×168 soft-glow container)
- **"ORIO" wordmark** below the logo (56px, extra-bold, letter-spacing 4, purple glow) — LARGER than the O
- "Voice Chat, Party & New friends" tagline below the wordmark
- No crown, no people, no equipment — just near-black BG with subtle hidden purple lighting
- Button order preserved: Google (white) → Apple → Phone → social row (Facebook, TikTok, X, Email)
- Arabic RTL / English LTR

### ✅ Branding purge
- Backend: root endpoint returns `{"app":"ORIO","version":"0.2.0"}`, logger renamed, system user renamed to ORIO with email `system@orio.app`, welcome bonus text = "Welcome to ORIO!"
- Error strings: "Insufficient Folu Coins" → "Insufficient Diamonds" everywhere (games, VIP, families)
- One-time migration on startup upserts all persisted docs from VoiceUp/Folu → ORIO
- Frontend: only internal import shim `FoluCoin.tsx` remains (re-exports Diamond) — nothing user-facing

### ✅ New backend endpoints (21/21 tests pass)
- `GET /api/rooms/{id}/level` — LV1..LV5 thresholds (0/10M/40M/100M/350M) with progress + supporters
- `GET/POST /api/rooms/{id}/mic-requests` — request/cancel/accept/reject/remove with owner+mod authorization
- `POST /api/rooms/{id}/background` — 5000 Diamond deduction, "Image will be reviewed within 24 hours" flow
- `GET /api/rooms/{id}/background/status` — moderation status per room
- `POST /api/admin/room-backgrounds/{sub_id}/decision` — admin approve/reject with automatic refund on reject
- `GET /api/emoji-packs` — 5 packs × 12 emojis (ORIO Vibes, Party Time, Hearts, Reactions, Diamonds)
- `GET /api/vip/heads` — 7 animal heads (sheep→cheetah) with tier colors, Arabic + English labels
- `GET /api/tasks` — 9 daily tasks; `POST /api/tasks/progress` and `POST /api/tasks/{id}/claim` — server-authoritative reward payout

### ✅ VIP heads (frontend)
- New `VipHead` component (SVG-free, emoji-based per spec): sheep(1) horse(2) deer(3) fox(4) bear(5) eagle(6) cheetah(7) with tier colors
- Wired into the VIP screen: tier switcher shows mini heads, detail view shows large head + animal label

## Still pending / next iteration
- Wire room screen UI to the new WS/level/mic-request/background endpoints
- Native Agora hookup (need App ID + Certificate)
- Emoji picker sheet in room chat
- Tasks screen
- Room member list with role colors (owner=red house / mod=green / member=yellow)
- Admin dashboard (web)

### ✅ Implemented
- **Emergent Google Sign-In**: `POST /api/auth/google/session` — exchanges Emergent `session_id` for our JWT pair; auto-creates user (with `auth_provider: "google"` and welcome bonus)
- **Frontend Google flow**: `signInWithGoogle` in `AuthContext`, session_id capture on cold-start / hot deep-link / web URL fragment, guarded with a consumed-set (rule 6 of playbook)
- **i18n context** (`src/i18n.tsx`): full EN + AR string bundle, persists selection, applies `I18nManager.forceRTL` on native and `document.documentElement.dir` on web
- **Refined Login screen** matches the latest spec: near-black background with subtle hidden purple glow, official ORIO O logo in dark rounded-square soft-glow area, tagline, exact button order (Google white → Apple → Phone), TikTok + X + Facebook + Email social row, Arabic + English UI, RTL-aware layout
- **Real-time WebSockets**: `WS /api/ws/rooms/{room_id}?token=…` — presence, chat, voice_state, envelope events, room_state
- **`useRoomWs` client hook** with 20s heartbeat, exponential-backoff reconnect, AppState resume
- **Blue Envelopes**: create, list, atomic random-split claim; sender pays diamonds, claimers receive diamonds, all logged in wallet ledger, WS broadcast on create/claim
- **Room Moderation**: `POST /api/rooms/{id}/moderate` — mute_seat / unmute_seat / lock_seat / unlock_seat / kick_seat; owner + moderators allowed; owner immune
- **Room Chat REST**: `GET /api/rooms/{id}/chat` (history) — persisted from WS
- **Post Comments**: `GET/POST /api/posts/{id}/comments`
- **Agora RTC Token endpoint** (`POST /api/rtc/token`) — server-authoritative role assignment (publisher iff owner or seated), 1h token TTL. Requires `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE` env vars — returns 503 until configured. `GET /api/rtc/config` reports enablement to the client.
- **Seat state broadcast**: `take_seat` / `leave_seat` / `toggle_mute` and moderation now broadcast `room_state` events to all subscribed WS clients

### 🔒 Security guarantees added
- WebSocket authenticated via query token (rejected with `4401` if invalid)
- Envelope claim uses a single `find_one_and_update` guarded by `slots_remaining > 0` AND `claims.user_id != me` → race-safe against concurrent taps
- Random split preserves total (leftover-partition) → sender's exact amount is distributed
- Moderation restricted to owner or explicit moderators; owner immune to kick

### Preserved / unchanged
- Email/password real JWT auth, splash, tabs, VIP 1-7, Diamonds currency, wallet packages (11 mobile + 11 web), games (10 server-side RNG), rankings, friendship, CP, families, profile visitors, referral, invite, my rooms, settings

## Still pending (need credentials or dedicated build)

1. **Agora credentials** (App ID + App Certificate) — endpoint scaffolded; voice unlocks the moment you provide them
2. **Apple / Facebook / TikTok / X / Phone-OTP** — social buttons show a "configure credentials" dialog
3. **Payment providers** — Google Play / StoreKit / web card
4. **VIP animal 3D artwork** — Sheep/Horse/Deer/Fox/Bear/Eagle/Cheetah
5. **Admin Dashboard (web)** — separate build
6. **Multiplayer casual games** (Ludo, Domino, UNO, Carrom, PK 1v1/Team) — realtime matchmaking + server-side turn state
7. **Push notifications + password-recovery emails** — Emergent-managed (Resend + Push)

## Data integrity guarantees
- All Diamond changes atomic in MongoDB (`$gte` guard)
- Wallet ledger records every credit/debit with tx_id
- Game RNG is server-only; the client never sends payout
- VIP + gift + family-create + envelope purchases are atomic and logged
- Profile view dedup enforced by 5-min window; lifetime counter increments only on non-dedup views
- Family chat access gated by `family_members` membership check
- Ranking totals computed server-side from ledgers and user documents
- Envelope claim is single-shot atomic; agent races cannot double-claim

## Demo credentials
See `/app/memory/test_credentials.md`

## Iteration 20 — Room Header & Controls Restoration (2026-06)

Restored (UI-only) after iter-19 header simplification:
- Room top header layout: `[Room Name plate]  [People Count] [•••]` — three-dot menu and
  viewers button are back on the upper-right. Room name is wrapped in a translucent black plate
  (rgba(0,0,0,0.55), radius 10, compact padding) so long room names remain readable over any
  background. Follow heart is now accessed via Room Info screen (tap the room name) to keep the
  header clean per the user's exact mockup.
- Viewers button (`header-viewers-btn`) shows the real-time WS participant count with a people
  icon; tapping it opens the participants sheet.
- Three-dot button (`header-menu-btn`) opens `RoomMenu`, whose order is now exactly:
  1. Share  2. Exit  3. Minimize  4. Clear Chat  5. Mute  6. Mic Mode
  then toggles: 7. Entrance Effects  8. Noise Reduction  9. Network Speed (shows `XX ms`).
- Removed "Mute Room" and "Lock Room" tiles from this menu per the restored spec. Lock Room
  functionality remains in the codebase (LockRoomPrompt) — can be re-added anywhere on request.
- No changes to Agora, seats, chat, gifts, VIP, PK, Room Info, Members/Mods/Banned, Follow API,
  RoomPeopleStrip, Minimize/Mini-Room behavior, or WebSocket presence.
- Verified by testing_agent iter-20: 12/12 acceptance criteria PASS.

## Iteration 21 — Room Mic + Minimized Room Polish (2026-06)

Focused polish only — no redesign, no Agora/chat/gift/VIP/header changes:
- **Smaller uniform mic seats**: SEAT_SIZE 62 → 54, hostSize 92 → 88. Grid remains centered
  and fixed; positions are unaffected by chat, keyboard, sheets, or panels (verified by
  testing_agent: seat-1 bounding box identical before/after every UI interaction).
- **Royal host throne**: crown diamond icon + gold LinearGradient ring + decorative gold
  "throne plate" beneath the avatar. Kept proportional (≤105px total). Owner-only permission
  preserved (backend 403 for non-owner host takes).
- **Owner/moderator mic sheet with 3 real actions** in exact order:
  1. `mic-action-move`   → opens `change-seat-sheet` → PATCH `/api/rooms/{id}/mic/change-seat`
  2. `mic-action-lock`   → toggles lock/unlock → PATCH `/api/rooms/{id}/mic/lock`
  3. `mic-action-invite` → opens `invite-sheet` → PATCH `/api/rooms/{id}/mic/invite`
  Rows disable contextually (Move on empty/locked, Invite on occupied/locked).
- **Viewport safety**: every bottom sheet clamped to `maxHeight:90%`. All sheets fit inside
  small (360×640) and large (390×844) phones without clipping.
- **Minimized room** (FloatingMiniRoom): existing draggable clamped widget preserved. Web
  parity fix: `onStartShouldSetPanResponder` now web-gated so tap-to-restore and X (`mini-room-close`)
  respond on web preview too. Native touch drag/clamp unchanged. Agora persists across minimize.
- Verified by testing_agent iter-21: all acceptance criteria PASS on 390×844 mobile viewport.

## Iteration 22 — Surgical Room Polish (2026-06)

Surgical/targeted-only correction — no redesign; every prior feature preserved:
- **HOST chair simplified**: removed crown (diamond icon), gold gradient throne ring, and
  decorative throne plate. `host-chair-wrap` now contains only the HOST badge + SeatBubble.
  Host permission logic unchanged (backend still 403s non-owners).
- **Continuous room background**: removed the dark LinearGradient chat panel and the absolute
  chat overlay. Background image + single outer scrim now flows continuously from top to
  bottom. No gray horizontal bar, no black lower block.
- **Chat below the mic grid — never overlaps**: chat is now a normal-flow ScrollView
  (`flex:1, minHeight:0`) rendered directly BELOW the seats container (`flexShrink:0`).
  Action bar (`KeyboardAvoidingView`) is also in normal flow, below the chat. On small
  screens the chat viewport shrinks; the mic grid stays fixed. Verified 8/15/20 layouts
  on 320×568 and 390×844 — seats 18/19/20 always fully visible.
- **Small floating participant badge removed**: RoomPeopleStrip no longer rendered.
  Header participant count (`header-viewers-count`) remains the single source.
- Verified by testing_agent iter-22: 10/10 acceptance criteria PASS; mic-grid stability
  byte-identical across chat sends / keyboard focus / menu open+close; no regressions
  in header, three-dot menu, mic actions, gifts, VIP, minimized room, WS presence.

## Iteration 23 — Mini-Room Visual Reference Match (2026-06)

Surgical visual-only rework of `FloatingMiniRoom` to match the user's reference:
- Compact purple rounded rectangle: **150×56**, borderRadius **22**, background `colors.brandSecondary`.
- DOM order LEFT→RIGHT (matches reference): X close (`mini-room-close`, 22px dark circle) → room
  title + Voice status → room/avatar preview (40×40, radius 12) on the right.
- All functional behavior preserved: drag + viewport clamping (PanResponder native-only),
  `mini-room-restore` tap → full room, `mini-room-close` tap → leave, Agora keeps
  publishing/receiving through minimize.
- Removed unused `BlurView` overlay for a cleaner purple appearance; no other files touched.
- Verified by testing_agent iter-23: 11/11 PASS on 390×844. No regressions to iter-22 room
  polish, header, three-dot menu, mic sheet, seats, chat, gifts, VIP.

## Iteration 24 — Mini-Room Reference-Exact Visual Match (2026-06)

Follow-up to iter-23. Stripped `FloatingMiniRoom` down to the reference:
- 150×56 purple rounded rectangle (bg #B47CFF, radius 18).
- LEFT: white × close button (28×28 hit area, `mini-room-close`, `size=20`).
- RIGHT: room preview image (44×44, radius 12), speaking ring preserved.
- Removed the room title text and the Voice On/Off status row (per reference — image only).
- All existing behavior preserved: drag anywhere with viewport clamp, tap widget →
  restore full room, X → leave; Agora audio publisher persists.
- **Verified in the actual rendered browser preview** (not just tests): logged in as
  demo@voiceup.app → joined seeded 8-seat room → menu → Minimize. `mini-room-widget`
  DOM bounding box measured `{x:228, y:696, w:150, h:56}` — exact spec match. Rendered
  screenshot shows the purple pill with × on the left and the room avatar on the right,
  matching the user's attached reference.

## Iteration 25 — Room Tools cleanup + Notice/Welcome/Password + Uniform Discovery (2026-06)

Large surgical batch. Everything else preserved exactly.

**Room Tools sheet (bottom four-dot):**
- Removed "Room Info" and "Mute Room" tiles. Sheet now shows only Music, PK Challenge, Minimize.

**Bottom action bar:**
- Added `mute-room-btn` (Mute Room) between Gift and the four-dot Room Tools.
  Instant local personal mute (session.setRoomMuted); no server call; audio of other users
  is muted only for the local listener.

**Room Info screen (owner-only Room Settings section):**
- `input-room-notice` + `save-room-notice` → PATCH `/api/rooms/{id}/settings` `{notice}`.
- `input-room-welcome` + `save-room-welcome` → PATCH `/api/rooms/{id}/settings` `{welcome_msg}`.
- `input-room-password` (numeric, exactly 5 digits) → POST `/api/rooms/{id}/password` `{password}`;
  `clear-room-password` → DELETE `/api/rooms/{id}/password`. Separate from the existing
  PIN Lock (both endpoints and enforcements retained side-by-side).
- Section is completely hidden for non-owners.

**Room UI:**
- Pinned `room-notice-banner` (megaphone icon) shown at the top of the room whenever the
  room owner set a notice.
- WS system event `{kind:'welcome', text:'{nick} 👋 {welcome_msg}'}` now broadcast on join
  when welcome_msg is set. RoomSession.tsx renders it as a chat system line.

**Mic Action Sheet (permission-aware):**
- Owner/mod: Change Seat (renamed from Move / نقل → Change Seat / تغيير المقعد, testID
  `mic-action-change-seat`), Lock, Invite — in that DOM order.
- Regular user: only `mic-action-sit` on empty unlocked seat, or `mic-action-leave` on own
  seat. All privileged actions HIDDEN, not disabled.

**8-seat spacing:**
- Seats row gap → `spacing.md`, top margin → `spacing.xl`. Same for 15/20 layouts; seat
  size stays 54px uniform.

**Discovery categories:**
- Exactly 8 tabs (Chat/محادثة removed): توصية · الأكثر شعبية (was شهرة) · PK · لعبة ·
  موسيقى · أتابع · العائلة · تمت المشاهدة.
- All Ionicon icons (sparkles/flame/flash/game-controller/musical-notes/heart/people-
  circle/time) with gold accent — no unicode emojis.
- Uniform card sizing: minWidth 110, height 34, borderRadius pill.

**Backend consolidation:**
- Single `PATCH /rooms/{id}/settings` handler now merges legacy toggles
  (entrance_effects, noise_reduction, music_control_role) with iter-25 fields
  (notice, welcome_msg). Duplicate handler at line ~3564 removed.

**i18n:**
- Added EN + AR strings for every new UI label (`roomSettings`, `roomNotice`,
  `welcomeMessage`, `roomPassword`, `enablePassword`, `updatePassword`, `disablePassword`,
  `changeSeat`, `sitHere`, `leaveSeat`, `muteRoomBtn`, `unmuteRoomBtn`, `roomTools`, etc.).

**Verified by testing_agent iter-25 + retest:**
- Backend: 30/30 pytest PASS. WS welcome event emitted, hidden when welcome_msg empty.
- Frontend (390×844 web preview): all acceptance criteria PASS including the joiner
  actually seeing `{nick} 👋 {welcome_msg}` in chat after RoomSession.tsx welcome-kind fix.

## Iteration 26 — Iteration A: Room + Discovery + Navigation Fixes (2026-06)

Surgical, no unrelated changes. Iteration B (Posts + Search + full i18n) deferred to next run.

### Discovery (Home)
- Category strip trimmed to exactly 4 tabs (per user): **CP · Games · Chat · Music**, all with
  ORIO Ionicons (heart-circle / game-controller / chatbubbles / musical-notes). Removed the old
  8 tabs (Recommended/Popular/PK/Music/Following/Family/Watched).
- Fixed iter-25 icon-shrink glitch: icon size=16, `flexShrink:0`, tab pill uses content-based width
  with consistent height 36 / padding 14/8 so selected and unselected states share proportions.

### Home tab double-tap → My Rooms sheet
- Added `DeviceEventEmitter` listener in `(tabs)/_layout.tsx` fired by tabPress when already on
  /home. `home.tsx` opens the `my-rooms-sheet` modal with two sections:
  - **Rooms I own** ← `GET /api/rooms/mine` (limit raised 20→50)
  - **Rooms I moderate** ← new `GET /api/rooms/managed` (excludes owned rooms)
- Row testIDs `my-owned-room-<id>` / `my-managed-room-<id>` route to `/room/{id}`.
- **Critical route-order fix** (testing_agent): both handlers were shadowed by
  `GET /rooms/{room_id}` and returned 404 with `ObjectId("mine")`. Fixed by moving them above
  the `{room_id}` handler in server.py.

### Room screen (surgical only)
- **Chat announcement (iter-26 replaces iter-25 pinned banner)**: pinned top notice REMOVED.
  Room announcement now renders once at the top of the chat scroll (`room-notice-in-chat`) as
  `<owner-nickname>: <room.notice>`, owner name tappable → opens `RoomUserCard`.
- **System-message clickable actors**: joins, welcome, and seat events now include `user_id` +
  `nickname` in the chat entry. Tapping the actor name (`sys-actor-<user_id>`) opens their
  profile card. Chat messages/gift messages also gain clickable authors.
- **Chat de-dup for welcome**: WS welcome now carries `user_id`; RoomSession stores it with
  stable id `sys-welcome-<user_id>` so a joiner never sees the welcome twice, even on WS
  reconnect. Self-join is suppressed. Anonymous "Someone left the room" chat noise removed
  (presence panel already reflects it).
- **Change Seat button**: no longer rendered in a disabled/greyed state — only shown when it
  can actually work (seat occupied by another user & unlocked). Same for Invite (only rendered
  on empty, unlocked seats). Regular users continue to see just Sit / Leave.
- **Seat label rule**: empty numbered seat → shows the seat number **below** the avatar circle;
  occupied seat → shows the user's real nickname **below** it. Old inside-circle number chip
  removed. Real-time sync via existing seat WS state.
- **Chat input width**: input `flex:1, minWidth:60`, action buttons dropped 40→36 with 6px gap,
  gutters tightened so gift / mute-room / four-dot never get clipped on 320-width phones.

### Backend
- `GET /api/rooms/managed` — rooms where `moderators` contains the caller AND `owner_id !=`
  caller.
- WS auto-vacate: on any WebSocket disconnect (network drop, app kill, tab close), the room's
  seats collection is scanned and the user's seat, if any, is set to `null` with `muted:false`
  followed by a `room_state` broadcast — no more stale seat presence.
- Welcome broadcast payload now includes `user_id`, `nickname`, `welcome_msg` for reliable
  frontend dedup and tappable name.

### Verified by testing_agent iter-26
- Backend: 15/15 new pytest PASS + iter-25 regression 30/30 PASS = 45/45 total.
- Frontend: Discovery correctly shows CP · Games · Chat · Music.
- Double-tap Home → My Rooms sheet is wired correctly (native tabPress can't be Playwright-driven
  on web preview — smoke test on Expo Go). Row navigation & payloads validated statically.

## Iteration 27 — Surgical Mic Restore + Full Profile Routing (2026-06)

Targeted-only changes; every other room feature preserved exactly.

- **Owner/mod mic sheet** — restored to exactly 3 rows in this order: `mic-action-lock` (always
  enabled) → `mic-action-change-seat` (contextual disable when seat is empty/locked) →
  `mic-action-invite` (contextual disable when seat is occupied/locked). All three call the
  existing real backend endpoints (`/moderate`, `/mic-change-seat`, `/mic-invite`).
- **Normal user seat behavior** — restored to direct tap-to-take. Tapping any empty unlocked
  seat calls `apiTakeSeat`, which frees the caller's previous seat server-side, so free
  seat-switching works without any sheet.
- **Full ProfileView from room** — replaced every in-room `setCardUserId(uid)` call with
  `router.push('/user/{uid}')` (the `/user/[id]` route already renders the shared premium
  `ProfileView`). This covers: seat avatar tap, room announcement owner name, chat/gift/system
  actor names, participants strip. Own-seat and privileged mic-tap still open the mic action
  sheet.
- **RoomUserCard** left mounted but no longer opened. No files removed to keep the change
  surgical.
- Verified by testing_agent iter-27: 13/13 new pytest PASS + iter-26 regression 15/15 PASS
  + frontend 3-row sheet verified in 390×844 preview with expected contextual disable states.

## Iteration 28 — Surgical Profile Card + Conditional Mic Sheet (2026-06)

- **RoomUserCard restored** — every in-room name/avatar tap (seat avatar, room-announcement
  owner, chat/gift/system actor names, participants strip) now opens the existing
  `RoomUserCard` bottom sheet again via `setCardUserId`. Full ProfileView is still reachable
  via the card's "Open Full Profile" button. Profile card fields remain unchanged (avatar,
  numeric_id, VIP tier color, country_flag, age, accountAgeDays, wealth_level, charm_level,
  family_name, gift gallery).
- **RoomUserCard footer** — bottom actions now match the spec:
  - Viewed user IS on a mic → `card-leave-seat` + `card-send-gift`.
  - Viewed user is NOT on a mic → `card-send-gift` only.
  - Removed the old `card-open-profile-btn` from the "isMe + off-mic" branch (still callable
    via other routes if needed).
- **Room screen `onLeaveSeat`** — self viewing self calls `apiLeaveSeat`; owner/mod viewing
  another seated user calls `apiModerate("kick_seat", seat_index)` via new `kickMut`.
- **MicActionSheet — conditional first row for privileged users:**
  - Owner/mod NOT on a seat → `mic-action-take-mic` + `mic-action-lock` + `mic-action-invite`.
    Take Mic disabled unless target seat is empty & unlocked.
  - Owner/mod ON a seat → `mic-action-change-seat` + `mic-action-lock` + `mic-action-invite`.
    Change Seat disabled unless target seat is occupied & unlocked.
- **Verified by testing_agent iter-28** — backend regression 28/28 PASS; frontend 3 scenarios
  verified live (owner off-seat/on-seat + own-seat) with correct testIDs present/absent and
  correct disabled states; Take Mic end-to-end confirmed placing owner on seat 3.

## Iteration 29 — Surgical Room Chat / Own-seat Card / Avatar Half-overlap (2026-06)

Three targeted changes; nothing else touched.

- **Chat gets more space** — seats wrapper padding trimmed (`spacing.md/spacing.sm` → `4/2`)
  and `seatsRow.marginTop` trimmed (`spacing.xl` → `spacing.md`). Mic grid stays at the same
  natural height and positions; chat ScrollView (`flex:1, minHeight:0`) simply gets more
  vertical room. Verified on 390×844 preview — no overlap.
- **Own-seat tap opens RoomUserCard** — `handleSeat` in `frontend/app/room/[id].tsx` no longer
  routes own seat to the Leave sheet; every occupied seat (including caller's own) opens the
  card. Card footer honors iter-28 rules: on-mic user shows `card-leave-seat` +
  `card-send-gift`; own-mic user shows `card-leave-seat` only. Owner/mod tapping ANOTHER
  user's mic still opens the privileged Take-Mic/Change-Seat/Lock/Invite sheet.
- **Avatar half-above / half-inside the card** — avatar Pressable moved OUT of the ScrollView
  in `RoomUserCard.tsx`; card container `overflow:hidden` → visible; `avatarWrap.marginTop =
  -44` (50% of 88px). Circular shape, gold VIP border, and shadow preserved.
- **Verified by testing_agent iter-29** — backend regression 28/28 PASS; frontend live-verified
  in preview with own-seat tap producing `room-user-card=TRUE / mic-action-*=FALSE`, avatar
  half-overlap visible in screenshot, and chat area visibly larger below the mic grid.

## Iteration 30 — Follow → Chat CTAs (Room Card + Full Profile) (2026-06)

- **RoomUserCard** (`/app/frontend/src/room/RoomUserCard.tsx`) gains a Follow → Chat button
  below the primary action bar. `card-follow` calls `apiFollow`; on success the card
  optimistically updates `is_following=true` in React Query cache and the button morphs
  into `card-chat` which pushes `/chat/{user_id}`. Send Gifts stays visible on its own row
  above so both CTAs are always available. Existing card fields, testIDs, and layout
  preserved.
- **Full profile** (`/app/frontend/src/profile/ProfileView.tsx`) gets a sticky bottom bar
  visible only when viewing another user (not own profile). Same morph rule:
  `profile-follow-btn` (gold) → success → `profile-chat-btn` (purple) → navigates to
  `/chat/{user_id}`. ScrollView paddingBottom bumped to 96px when the CTA is visible so
  content isn't hidden behind it.
- Change Seat and avatar half-overlap verified as still working (iter-27 + iter-29
  regression PASS).
- **Verified by testing_agent iter-30** — backend 38/38 PASS (10 new + 28 regression);
  frontend live-verified on 390×844 preview both in-room and on `/user/{id}`, follow flow
  end-to-end, morph state persists across screens via shared React Query cache.

## Iteration 31 — Real Room Music + Verified Real Voice/Speaking/Translation (2026-06)

Iter-31 focused on making Music real; the other three items requested by the user
(Voice/Agora, speaking wave, translation/language) were audited and confirmed to
already be real integrations — no rework needed.

- **Voice/Agora (already real, verified iter-31 backend regression)**: backend `/api/rtc/config`
  returns `{enabled: true, app_id: ...}`, `/api/rtc/token` real HMAC-signed short-lived tokens
  (401 on unauth). Frontend `useAgora` uses the real `react-native-agora` SDK: fetches
  App ID, requests RECORD_AUDIO, fetches token, joins channel, publishes when seated, and
  reports `activeSpeakers` + `remoteAudioLevels` via `onAudioVolumeIndication`. **Runs on
  native builds only** — Expo Go / web preview cannot exercise real cross-device voice.
- **Speaking wave (already real)**: `seatSpeaking` in `frontend/app/room/[id].tsx:210` reads
  `session.isLocalSpeaking` and `session.remoteAudioLevels[uid]>5` — both fed by real Agora
  volume events, not timers. `SeatBubble` renders the ring only when `speaking===true`.
- **Language/translation (already real)**: `frontend/src/i18n.tsx` persists lang via
  AsyncStorage, flips `I18nManager.forceRTL` on switch, and every screen consumes `useI18n().t`.
- **NEW — Real Music** (`frontend/src/room/MusicSheet.tsx`):
  - `expo-document-picker@57.0.3` (installed via `yarn expo install`) picks real audio files
    from the device (multiple, `audio/*`).
  - `expo-audio` `useAudioPlayer` + `useAudioPlayerStatus` for real playback state.
  - Playlist persists for the session in a module-scoped store (`useRoomMusicPlaylist`), so
    closing/reopening the sheet doesn't lose tracks.
  - Controls: **Add Music** (44px touch target), Play/Pause, Prev, Next, per-track remove.
    Auto-advance on `didJustFinish`. Now-playing shows real position / duration.
  - Wired into the bottom four-dot Room Tools (`more-music` → `music-sheet`), replacing the
    old "coming soon" `Alert`.
- Verified by testing_agent iter-31: backend 53/53 PASS; frontend live-verified Music sheet
  opens, picker fires, empty state renders, controls present.

### Iter-32 — Real Multi-User Voice + Speaking Wave + Language Switcher (SURGICAL)
- **Real Multi-User Voice (`frontend/src/hooks/useAgora.ts`)**:
  - Backend already exposed `/api/rtc/config` + `/api/rtc/token` with `AGORA_APP_ID` + `AGORA_APP_CERTIFICATE` configured, channel profile = LiveBroadcasting (unlimited simultaneous broadcasters).
  - Fixed: mid-session seat-change now calls `setClientRole` **plus** `updateChannelMediaOptions({publishMicrophoneTrack, autoSubscribeAudio, clientRoleType})` **plus** `enableLocalAudio(wantPublisher)` **plus** `muteLocalAudioStream(!wantPublisher||localMuted)`. Previously only setClientRole+mute was called, which on some Agora v4 builds fails to flip the publish state — result: listener takes a mic mid-session and nobody hears them.
  - Now N seated users (2/5/N up to 8/15/20 seat layout) all become simultaneous broadcasters heard by every participant, including non-mic listeners (autoSubscribeAudio). Non-mic users never publish.
  - Verified by testing_agent iter-32: `/api/rtc/token` returns real signed Agora tokens (≥80 chars), correct role branching (owner→publisher, listener→subscriber), `expires_at≈+3600s`.
- **Real Speaking Wave**: no code changes — wiring was already correct (`enableAudioVolumeIndication(300ms, smooth=3, reportLocalVolume=true)` → `onAudioVolumeIndication` → `isLocalSpeaking`/`remoteAudioLevels` → `seatSpeaking` → green SeatBubble glow). The publish fix above is the upstream source that lights it up for newly-seated users.
- **Real Language Switcher (`frontend/app/settings.tsx`)**: root cause = Settings screen used a local `useState<'en'|'ar'>` for the language pill, so tapping did nothing globally. Replaced with `useI18n()` → tapping EN/AR now updates STRINGS lookup app-wide, flips RTL/LTR (I18nManager + `document.documentElement.dir`), and persists to AsyncStorage `orio_lang`. Verified live: switching in Settings flips `dir=rtl` app-wide and persists across reload.
- **Preserved**: RoomSession, chat, gifts, VIP, seats layout, MusicSheet, mini-room, all existing testIDs. Zero UI redesign.
- **Native-only caveat**: `useAgora.web.ts` is a no-op by design (react-native-agora is native-only). Voice pill will read "VOICE OFF" on the web preview — this is expected. Full multi-user voice + speaking wave rendering require a native dev build.


### Iter-33 — Profile bottom CTA + Three-dot menu (SURGICAL)
- **Bottom sticky CTA** (`frontend/src/profile/ProfileView.tsx`): before following → **Chat + Follow** side-by-side (both `flex:1`). After follow succeeds → Follow disappears, Chat expands to full width. Uses the existing `apiFollow` mutation and `/chat/{id}` route — no new UI system introduced, no fake state.
- **Top three-dot menu** (replaces the previous share icon on another user's profile): opens a modal sheet containing:
    - **Follow** (or **Unfollow** if already following) — uses real `apiFollow` / `apiUnfollow`
    - **Block** — real `apiBlockUser` with a native `Alert.alert` confirmation; on success invalidates the profile and returns to previous screen
    - **Report** — opens a real report dialog with 5 reason chips (spam / harassment / inappropriate / scam / other) + a 1000-char details field → submits via `apiReportUser`
- **New real backend endpoints** (`/app/backend/server.py`, right after unfollow):
    - `POST /api/users/{id}/block` → 201 `{blocked:true}`; idempotent; **cascades**: deletes follows in both directions and decrements `following_count`/`followers_count` on both users; 400 on self, 404 on unknown user, 401 unauth.
    - `DELETE /api/users/{id}/block` → 200 `{blocked:false}`; idempotent.
    - `POST /api/users/{id}/report` with `{reason?, details?}` → 201 `{reported:true, id}`; persists to `user_reports` collection with `status:"open"`; 400 on self, 404 on unknown.
- **New frontend api helpers** (`/app/frontend/src/api.ts`): `apiBlockUser`, `apiUnblockUser`, `apiReportUser`.
- **Preserved unchanged**: Profile tabs, avatar, cover, bio, voice bio, VIP/Wealth/Charm/Nobility, Friends/Following/Followers, existing Chat behavior, existing Follow/Unfollow logic, authentication, navigation, and every other screen/component.
- **Testing**: backend 23/23 PASS in `test_iteration_33_block_report.py` (JUnit `iter33.xml`). Frontend flows verified live in preview: menu opens, Follow → Chat expands, menu switches Follow ↔ Unfollow after action, Report dialog opens and Submit hits the real endpoint.


### Iter-34 — Change Seat + Real Mic Invite (SURGICAL, admin-only)
- **Change Seat activated for owner/moderators** (`frontend/app/room/[id].tsx` → `MicActionSheet`): first row of the mic-action sheet now reflects the SEAT's occupancy instead of the caller's:
    - Empty & unlocked → **Take Mic**
    - Occupied & unlocked → **Change Seat** (moves the seated user, real `apiMicChangeSeat` → server-authoritative)
    - Locked → row hidden
  Owner/mod tap on an occupied seat via existing `handleSeat` routing (`isMod && seat.user.id !== me`).
- **Real mic invitation (Accept/Reject)** — replaced the previous forced-seat behavior of `POST /api/rooms/{id}/mic-invite`:
    - **Request**: validates owner/mod, seat empty+unlocked, target in room presence, target not already seated, not self. Stores an ephemeral in-memory invite (`_mic_invites`, 60s TTL) and broadcasts a `mic_invite_request` WS event containing `target.id`, `inviter`, `seat_index`, `expires_in_s`. **No seating happens on send.**
    - **`POST /rooms/{id}/mic-invite/accept`** — real endpoint. Looks up pending invite for the caller, re-validates seat still empty+unlocked (race-safe: 409 if someone else took the seat + invite is cleared), seats the user, clears the invite, broadcasts `room_state` + `system:mic_invite_accepted`. Non-idempotent (2nd call → 404).
    - **`POST /rooms/{id}/mic-invite/reject`** — real endpoint. Clears invite, broadcasts `mic_invite_rejected`. Idempotent (200 if none).
    - TTL: after 60s the invite auto-expires (accept → 404, reject → 200).
- **Frontend invite UX** (`frontend/src/room/RoomSession.tsx` + `frontend/app/room/[id].tsx`):
    - Added `pendingMicInvite` + `clearPendingMicInvite` to RoomSession context. Subscribes to `mic_invite_request` WS events and stores the invite only when `target.id === my.id`.
    - New `<MicInviteIncoming>` modal on the room screen: inviter avatar + name, bilingual "…is inviting you to take Mic N. Do you want to join the mic?" text, two large pill buttons **قبول / Accept** (gold) and **رفض / Reject** (grey). Accept → real `apiMicInviteAccept`; Reject → real `apiMicInviteReject`; dismiss/tap-outside → reject as well.
    - Local auto-expiry timer clears the modal after TTL.
    - New api helpers: `apiMicInviteAccept`, `apiMicInviteReject`.
- **Preserved unchanged**: room UI/layout, mic layouts 8/15/20, seats design, animations, Agora voice + speaking indicator wiring, mute/unmute, room mute, permissions, gifts, chat, music, PK, VIP, mini-room, header, three-dot room menu, and every other screen.
- **Testing**: backend 16/16 PASS in `tests/test_iteration_34_mic_invite.py`. All spec branches covered including 60s TTL, seat-race 409, host-chair guard, auth 401/403, presence 400, self-invite 400, non-idempotent accept, idempotent reject. `mic-change-seat` and iter-33 follow/block/report regressed clean.


### Iter-35 — VIP Growth History + Auto-Activation + Voice Room Stat Boxes + Wallet-Diamond Alignment (SURGICAL)
- **Coins/Diamonds field alignment** — the wallet UI already displays `user.coins` as "Diamonds" but `/vip/convert` was deducting from a separate `diamonds` field. Fixed: `/vip/convert` now deducts from `coins` (same field `/wallet/recharge` credits) so the wallet balance is a single source of truth. Response returns both `diamonds` and `coins` mirrored for backward compat.
- **Auto-VIP activation on threshold crossing** — new `_maybe_activate_vip(user_oid, growth_points, current_level)` helper. Called after every `/wallet/recharge` and `/vip/convert`: if new `growth_points` crosses a tier threshold, `user.vip_level` is bumped to the highest qualifying tier server-authoritatively (idempotent, no restart needed). Growth Points are never deducted — they're permanent per product rules. A `vip_activation` row is written to `growth_ledger` with `from_level`/`to_level` for audit.
- **`GET /api/vip/growth-history`** — new endpoint returning up to 200 immutable ledger entries per user, most recent first. Includes `tx_id`, `source ∈ {recharge, conversion, vip_activation}`, `amount`, `growth_after`, `diamonds_after`, `created_at`, and for `vip_activation`: `from_level`/`to_level`.
- **`GET /api/auth/me` now exposes `growth_points`** — added to `public_user()` so the frontend gets the growth balance from the authoritative read model.
- **VIP Guide (`frontend/app/vip-guide.tsx`)**:
    - "Diamonds" balance now reads from `user.coins` (the real wallet field) — no more disconnect.
    - New "Growth Point History" section renders every `growth_ledger` row: recharge (blue wallet icon, +GP), conversion (gold swap icon, +GP), VIP activation (gold sparkles, "VIP N activated"). Each row shows the localized title, timestamp, first 8 chars of tx_id, and formatted +amount. Fully bilingual EN/AR.
- **VIP Center (`frontend/app/vip.tsx`)**:
    - Removed the giant outer bordered container around the benefits/reward-vault grid — the detail block now flows as a continuous section (`detailContainer` transparent, no border).
    - Reward vault: each of the 7 slots now has an `unlock_level` (Chat Bubble=1, Profile Decoration=2, Frame=3, Entrance=4, Voice Wave=5, Badge=6, Bonus Gift=7). Slots illuminate when `selected >= unlock_level`, dim/locked otherwise — visual preview only, real permissions stay server-authoritative.
    - Reward Vault header pill now shows the currently-selected `VIP N` instead of "SOON".
    - "Diamonds" balance in convert modal reads from `user.coins`.
    - Benefit dot always illuminated as preview (checkmark if owned; sparkles otherwise).
- **Voice room seat card (`frontend/src/room/RoomUserCard.tsx`)**:
    - Three identical stat boxes (VIP / Wealth / Charm) — same size (`flex:1`, `minHeight:76`), same padding, same border style. Each has a matching 32×32 emblem circle on top, label in the middle, "LV N" value at the bottom.
    - VIP uses the real `OrioVipEmblem` component (level-specific emblem, not just a "V" letter). Wealth uses a diamond icon in rare-tier color, Charm uses a sparkles icon in purple. Each box is tappable and navigates to the right screen (`/vip` or `/rankings`).
    - Values are already fetched live via `apiGetUser(uid)` inside the card — refetch on open ensures synchronization with backend.
- **Testing**: backend 23/23 PASS (`/app/backend/tests/test_iteration_35_vip_growth.py`) covering: history sort/schema/auth, convert-from-coins + auto-activation, recharge auto-activation, per-tx idempotency in growth_ledger, `_maybe_activate_vip` idempotency at max tier, regression on `/vip/progress`, `/vip/thresholds`, `/vip/tiers`, `/wallet/transactions`, iter-33 block/report, iter-34 mic-invite. Read-model consistency verified on `/auth/me`. Lint clean.


### Iter-36 — Global Level System Migration Framework (SURGICAL, SERVER-SIDE)
Extends the VIP `growth_points → thresholds → derived vip_level` pattern to every other level system in ORIO. NEVER deletes, resets, or reduces any user's earned progress.

**Audit summary (before change)**:
- VIP: had underlying points (`growth_points`) + threshold config + auto-recompute (`_maybe_activate_vip`). ✅ Already correct.
- Wealth / Charm: only stored a level field (`wealth_level` / `charm_level`) that doubled as counter AND display. No thresholds. No cap.
- Normal Level: `level` seeded at 1, `experience` incremented in games, but `level` was never recomputed from `experience`.

**Framework added** (`backend/server.py`):
- `LEVEL_SYSTEMS = ('wealth','charm','level')` — VIP intentionally excluded (has its own admin surface).
- `_LEVEL_FIELDS[sys] = {points, level, max}` maps each system to its point / display / cap field.
- Storage: `level_configs` collection — one doc per system with `{thresholds: [{level, points}], max_level}`. Seeded with an IDENTITY mapping (1 point = 1 level, max 300 wealth/charm, 100 level) on first boot → **zero users' displayed level change on migration**.
- Boot migration `_migrate_legacy_levels_to_points` (idempotent, guarded by `config._id='level_migration_v1'`): copies existing `wealth_level` → `wealth_points`, `charm_level` → `charm_points`. Preserves all history.
- `_compute_display_level(thresholds, points, max)` — pure function, capped, non-destructive.
- `_recompute_user_levels(user_oid)` — recomputes derived `_level` fields from preserved `_points` fields. Called after every progression mutation (currently gifts/send).
- `_recompute_all_users_for_system(system)` — bulk recompute; idempotent.
- Wire-through: `/gifts/send` now `$inc`s `wealth_points` (sender) and `charm_points` (recipient) — never the raw `_level` fields — and calls `_recompute_user_levels` for both.
- `/auth/register` and Google session upsert now seed `wealth_points`, `charm_points`, `growth_points` on new accounts.

**Admin surface** (all admin-only, 403 otherwise):
- `GET  /api/admin/levels/{system}` — current thresholds + max_level.
- `POST /api/admin/levels/{system}/preview` — validates thresholds (consecutive levels starting at 1, non-decreasing points, non-negative), returns `{total_users, affected_users, old_thresholds, new_thresholds, samples[≤25]}`. NO db mutation.
- `POST /api/admin/levels/{system}/apply` — atomically installs the config, recomputes every user's displayed level from PRESERVED points, writes an immutable `level_migrations` audit row. Idempotent (re-applying → affected=0).
- `GET  /api/admin/level-migrations?limit=N` — audit trail (migration_id, admin_id, system, old_thresholds, new_thresholds, affected_users, created_at). Points and history are never touched by migrations — the audit proves it.

**Public read model** (`public_user` in `/auth/me`, `/users/{id}`, etc.):
- Adds `wealth_points` and `charm_points` alongside the existing `wealth_level` / `charm_level` / `level` fields. Frontend receives the server-authoritative display level unchanged.

**Safety properties verified end-to-end**:
- **Points preservation**: snapshot of `wealth_points`/`charm_points`/`experience` before and after applying any threshold config is IDENTICAL for every user.
- **Reversibility through config**: applying A → B → A leaves every user's displayed level exactly where the first apply put them.
- **Cap**: no user's displayed level ever exceeds the current `max_level`; a user with 23,076 wealth points cleanly caps at LV 5 when max=5 and returns to LV 300 (points preserved) when max=300 again.
- **Idempotency**: bootstrapping / re-applying same config produces zero DB deltas.

**Testing**: `/app/backend/tests/test_iteration_36_level_migrations.py` — **35/35 PASS**. Covers admin-auth gating, all 4 endpoints, threshold validation branches, points-preservation snapshot, cap, reversibility, idempotency, gifts wire-through, VIP untouched, boot migration idempotency, and regressions on iter-33 / iter-34 / iter-35.


### Iter-37 — Real Gift System v2 (multi-recipient · categories · combo · custom gifts · animated avatars)
Full production rewrite of the gift panel + new profile media flow. Zero mocks, zero visual-only buttons.

**Backend** (`backend/server.py`):
- `POST /api/gifts/send-multi` — server-authoritative atomic multi-recipient gift send. Body: `{ gift_id, recipient_ids[], quantity (1–9999), room_id?, combo_of? }`. Validates: dedupe, self-filter, ≤50 recipients, room presence (403/409 on missing), all recipients exist, quantity 1–9999. Atomic `find_one_and_update({ coins: { $gte: total }, $inc: { coins: -total, wealth_points: total//1000 } })`. One `wallet_transactions` row per combo, one `gift_transactions` row per recipient sharing the same `combo_id`. Broadcasts a single `gift_batch` WS event to the room with sender + gift + recipients so every client animates. Existing single-recipient `/gifts/send` untouched.
- `GET /api/gifts/categories` — canonical order: gift / lucky / privilege / custom / relationship / fashion / countries.
- Seed migration: legacy `popular`/`luxury` categories remapped to `gift`, missing category backfilled.
- Custom gifts (VIP5+):
    - `GET /api/gifts/custom/settings` — enabled, min_vip_level, admin-set price, allowed_types, max_file_bytes, max_video_duration_s, per-user `eligible` computed from real vip_level.
    - `GET /api/gifts/custom` — current user's active custom gifts.
    - `POST /api/gifts/custom` — validates VIP tier + media_type + URL; **user cannot set price** (server uses admin-configured price). Status is `pending` or `approved` per admin config.
    - `DELETE /api/gifts/custom/{id}` — soft-delete (`deleted:true`).
- Profile media:
    - `PATCH /api/users/me/profile-media` with `{ url, kind }` where `kind ∈ {"avatar", "animated_avatar"}`. Persists real URL; `public_user` now exposes `animated_avatar_url`.

**Frontend api helpers** (`frontend/src/api.ts`): `apiSendGiftMulti`, `apiGiftCategories`, `apiCustomGiftSettings`, `apiListMyCustomGifts`, `apiCreateCustomGift`, `apiDeleteCustomGift`, `apiSetProfileMedia`.

**Frontend — Gift Panel v2** (`frontend/app/room/[id].tsx`):
- **Recipient chip row** (horizontal scroll): `All Mic (N)` + `All Room (N)` + individual avatar chips. Selection is a `Set<string>`; multi-select supported; toggling "All Mic" fills/clears all mic-seated users, same for "All Room" from real WS presence.
- **Category tabs**: Gift / Lucky / Privilege / Custom / Relationship / Fashion / Countries. "Gift" tab surfaces all catalog items (legacy + `category==="gift"`); other tabs strict-match server categories; empty tabs show a friendly empty state.
- **Quantity presets**: `1 / 7 / 77 / 777 / Other` — Other opens a numeric input capped at 4 digits (1–9999).
- **Wallet chip** in footer: real live `user.coins` value + `+` shortcut that navigates to `/(tabs)/wallet`.
- **Send button** shows real total `price × qty × recipients` (e.g. `Send · 140 💎` for 10×7×2). Disabled until gift + qty + ≥1 recipient are chosen AND wallet balance ≥ total.
- **Repeat Combo ring** (Phase 2): after a successful send, a green pill replaces Send for 4 seconds. Tapping = another real `send-multi` call passing `combo_of=<combo_id>` — every tap re-charges wallet server-side. Counter `2× COMBO`, `3× COMBO`, … Auto-dismisses at 0 or on wallet-insufficient error.
- **Custom Gift Creator** (VIP5+): opens over the panel; real `expo-image-picker` for image OR video (≤15s); for images we send a base64 data URI (same pattern as edit-profile). Fixed admin price displayed; user cannot change it.

**Frontend — Profile media flow** (`frontend/app/edit-profile.tsx`):
- Tapping avatar now opens a two-option bottom sheet: **Change picture** / **Change animated picture** (bilingual EN/AR).
- Static: real `ImagePicker` (images only, square crop, base64 data URI) → `apiSetProfileMedia({ kind:"avatar" })`.
- Animated: real `ImagePicker` allowing videos ≤8s or GIF-style images → `apiSetProfileMedia({ kind:"animated_avatar" })`. Data URI for images, local video URI kept as-is for video.
- Both persist immediately server-side and call `refresh()` so profile / rooms / lists show the new media on next fetch.

**Preserved unchanged**: room UI/layout, seats, mic layouts (8/15/20), Agora voice, mute/unmute, speaking indicator, room controls, gifts feed in chat, PK, VIP center, wallet, level system, and all other screens.

**Testing**: 30/30 PASS in `test_iteration_37_gift_system.py`. iter-36 regression 35/35 PASS. Lint clean. Live-verified in preview: recipient chips, All Mic (2), 7-preset, 10×7×2=140 total shown on Send, real deduction, `2× COMBO` ring appearing after send.


### Iter-38 — Agency + Host Earnings Financial Foundation (Phase 1, backend-only)
Real production-grade financial foundation for ORIO's agency/host revenue system. **No frontend changes** per the Phase-1 spec. No mocks, no fake balances. Everything is server-authoritative and auditable.

**Core split** (configurable via `config._id="revenue_split"`): HOST = 50%, AGENCY = 5%, ORIO = 45%. Sum-to-100 invariant enforced. Any remainder from `//100` rounding is kept by ORIO so money is never lost.

**New collections** (indexes auto-created on boot via `_bootstrap_indexes_v38`):
- `agencies` — `{ name, owner_user_id, status: active|suspended|disabled, earnings, created_at, updated_at }`
- `agency_memberships` — `{ agency_id, user_id, role: AGENCY_OWNER|HOST, status: active|suspended|removed, joined_at, left_at }` with `(user_id, status)` and `(agency_id, status)` indexes. One-active-agency-per-host rule enforced server-side.
- `financial_ledger` — **immutable** earning rows with `UNIQUE(reference_id)`. Fields: `transaction_id`, `reference_id`, `user_id`, `agency_id`, `type: earning|reversal`, `status: pending|completed|refunded|reversed|failed`, `gross_amount`, `host_amount`, `agency_amount`, `orio_amount`, `currency`, `source`, `metadata`, `created_at`, `completed_at`, `split_snapshot` (exact percentages used, so later threshold changes don't rewrite history).
- `financial_audit_log` — every important action: `agency_created / agency_updated / host_joined_agency / host_removed_from_agency / host_suspended / host_reactivated / ledger_tx_created / ledger_tx_reversed / revenue_split_changed`. Not editable by any API endpoint.

**Helpers** (`_split_amount`, `_record_ledger_tx`, `_refund_ledger_tx`):
- `_split_amount(gross, split)` → `(host, agency, orio)` integer math; `host + agency + orio == gross` always.
- `_record_ledger_tx` is **idempotent on `reference_id`** — the same reference inserted twice returns the first row and never double-counts earnings. Resolves the host's active agency server-side (not from the client). Writes derived balances (`user.host_earnings`, `agency.earnings`, `config.orio_revenue.total`) + an `ledger_tx_created` audit row.
- `_refund_ledger_tx` creates a `REV::<ref>` compensating row with negative amounts, flips the original row's `status: completed→refunded`, and reverses derived balances. Idempotent — repeat calls return the existing reversal.

**New admin + user endpoints** (all server-side authorized):
- `GET  /api/admin/revenue-split` · `PATCH /api/admin/revenue-split` (sum-must-be-100 + audited)
- `POST /api/admin/agencies` · `GET /api/agencies/{id}` · `PATCH /api/admin/agencies/{id}`
- `POST /api/admin/agencies/{id}/hosts` · `DELETE .../hosts/{uid}` · `POST .../hosts/{uid}/suspend` · `POST .../hosts/{uid}/reactivate`
- `GET  /api/hosts/me/earnings` — current user's completed earnings + pending (pending is NEVER withdrawable)
- `GET  /api/agencies/{id}/earnings` — agency owner OR admin only
- `GET  /api/admin/ledger` — read-only inspection, filters `user_id`/`agency_id`/`status`
- `GET  /api/admin/audit-logs` — read-only
- `POST /api/admin/ledger/reverse` — admin-only manual reversal via `_refund_ledger_tx` (idempotent, audited)

**Wire-through**: `POST /gifts/send-multi` now writes a `financial_ledger` row per recipient (idempotent on `tx_id`). Every gift becomes a traceable `earning` event with the correct 50/5/45 split baked into `split_snapshot`.

**Permission matrix**:
| Role | Can |
|---|---|
| USER | GET own `/hosts/me/earnings` only |
| HOST | Same as USER |
| AGENCY_OWNER | Same + `/agencies/{own_id}/earnings` |
| ADMIN | All admin endpoints — but amounts are still computed server-side; the client cannot override `host_amount` / `agency_amount` / `orio_amount` |

Normal API endpoints expose **zero** amount-mutation surface — the only way amounts change is via `_record_ledger_tx` or a reversal. The split snapshot captured on each row means a future split change never silently rewrites historical money.

**Testing**: `test_iteration_38_agency_earnings.py` — **24/24 PASS**. Regressions: iter-36 **35/35 PASS**, iter-37 **30/30 PASS**. Total **89/89 PASS**. Lint clean.

**NOT in this phase** (deferred, per the spec): withdrawals, real-money payouts, Apple/Google billing integration, host cash-out, frontend screens. Those come as separate audited phases.


### Iter-39 — Phase 1 Final Verification (post-review hardening)
Before approving Phase 2 (Earnings UI / cash-out), the owner required a 10-point verification sweep of Phase 1's financial foundation. Running the sweep uncovered **two real race conditions** that are now fixed with surgical edits.

**Findings & fixes (`server.py`)**
1. **One-active-agency-per-host race** — `/admin/agencies/{id}/hosts` and `/admin/agencies/.../reactivate` did a non-atomic `find_one`→`insert`. Under 10 parallel requests this allowed 3 duplicate active memberships to slip through. **Fix**: added a MongoDB `partialFilterExpression` **unique index** `uniq_active_user` on `agency_memberships.user_id` where `status: "active"`. `_bootstrap_indexes_v38` first calls a new `_dedupe_active_agency_memberships` helper that demotes legacy duplicates to `superseded` so the unique index can be built safely. `_add_host`, `_create_agency` (owner membership), and `_reactivate_host` now catch `DuplicateKeyError` and return **HTTP 409** instead of a 500.
2. **Concurrent reversal race** — `_refund_ledger_tx` previously issued `insert_one` without protecting against the unique `reference_id` index. Concurrent `/admin/ledger/reverse` calls on the same tx returned 500 for all-but-one. **Fix**: insert is now wrapped so a duplicate-key error resolves to the existing REV mirror (idempotent). The status flip is upgraded to `find_one_and_update` targeting `status: "completed"` only, so balance deductions can't double-apply if two reversals collide.

**10-point verification results** (`tests/test_phase1_verification.py` — 16 tests, all green):
| # | Area | Status |
|---|---|---|
| 1 | Duplicate transaction / idempotency (`_record_ledger_tx` same `reference_id` → single row) | ✅ |
| 2 | Concurrent duplicate transaction (25 parallel writes, same ref → 1 row) | ✅ |
| 3 | Refund / reversal correctness (negative mirror, original immutable, status flip, 404 bogus ref, idempotent repeat) | ✅ |
| 4 | Concurrent duplicate reversal (12 parallel → 1 mirror, all 200/404, no 500) | ✅ |
| 5 | Concurrent active-agency membership (10 parallel adds → exactly 1 success, rest 409) | ✅ |
| 6 | Host/Agency/ORIO balance consistency (`host+agency+orio == gross` per row + aggregated) | ✅ |
| 7 | Ledger/balance atomicity (unique `reference_id` index + denormalized `users.host_earnings` deltas match ledger host_amount; reversal zeroes it) | ✅ |
| 8 | Financial security / authorization (every admin endpoint 403s non-admins, 401/403s anons; agency earnings 403s strangers; illegal split percentages 400) | ✅ |
| 9 | Gift / virtual-currency semantics (`currency` ∈ {coins, diamonds}; recharges never leak into `financial_ledger`; gifts produce **both** a sender `wallet_transactions` debit and a recipient `financial_ledger` credit with matching magnitude) | ✅ |
| 10 | Full Phase-1-relevant regression suite — iter-37 (gift system), iter-38 (agency+earnings), phase1-verification | ✅ **70/70 PASS** |

**Pre-existing, unrelated failures** flagged during the full-suite run (do NOT touch financial code; left untouched per the "surgical only" directive): `test_iteration_17/19/27/34` (mic invite + PK WebSocket flow), `test_iteration_35.test_auth_me_missing_growth_points_field` (intentionally inverted assertion, documents a long-ago-fixed gap), `test_orio_room_upgrade` (room shape), `test_vip_final_update` / `test_vip_recharge_growth` (stale demo-user balance assumptions). 388 of the full suite still pass.

**Verdict**: Phase 1 is now **race-safe end-to-end** and ready for Phase 2 approval.


### Iter-40 — Phase 2A: Agency Center + Host Earnings (frontend)
Owner approved Phase 2A after the Phase-1 verification pass. This phase surfaces the Phase-1 financial foundation inside the app without introducing cash-out, withdrawals, or payment providers (deferred to Phase 2B per owner's instruction).

**Backend — new endpoints** (added to `server.py`, no existing routes modified):
- `GET /me/agency` — self membership + agency summary + role
- `GET /me/agency-invitations` — hydrated list of pending invites
- `GET /me/transactions` — self financial-ledger rows (filtered to current user)
- `POST /me/agency/leave` — host self-leave (owner-leave 400s)
- `POST /agencies/{id}/invitations` — owner/admin invite (identifier = ObjectId / numeric_id / username / email)
- `GET /agencies/{id}/invitations` — owner/admin list
- `DELETE /agencies/{id}/invitations/{inv_id}` — owner/admin cancel
- `POST /agency-invitations/{inv_id}/accept` — invitee accept (enforces one-active-agency rule via existing uniq_active_user partial index → 409)
- `POST /agency-invitations/{inv_id}/reject` — invitee reject
- `GET /agencies/{id}/hosts` — owner/admin/member roster (per-host earnings exposed only to owner/admin)
- `GET /agencies/{id}/transactions` — owner/admin agency ledger
- `POST /agencies/{id}/hosts/{uid}/suspend` and `/reactivate` — owner/admin
- `DELETE /agencies/{id}/hosts/{uid}` — owner/admin
- New collection `agency_invitations` + partial unique index `uniq_pending_invite` on `(user_id, agency_id)` where `status=pending` so duplicate pending invites are rejected at the DB layer. Bootstrapped by `_bootstrap_indexes_v39`.

**Frontend — new screens** (no existing UI redesigned):
- `/app/frontend/app/earnings.tsx` — Host Earnings. Hero tile with Available Diamonds (hex `host_amount`), Pending / Total / Gross tiles, Agency summary link, Transaction history pulled from `/me/transactions` with status badge, source icon (gift ↑ green, reversal ↓ red), per-row host_amount vs gross_amount, reference ID. Pull-to-refresh. "Diamonds are virtual ORIO currency, not cash." disclaimer always visible.
- `/app/frontend/app/agency/index.tsx` — Agency Center dispatcher. Three UI modes based on `/me/agency`:
  * No agency → empty-state card with hint
  * Member (host) → agency summary + Leave Agency confirm dialog
  * Agency Owner → agency summary + Manage Agency button + Agency Earnings/Pending tiles
  Pending invitations list below with Accept / Reject buttons wired to real APIs. Link to Earnings at bottom.
- `/app/frontend/app/agency/manage/[id].tsx` — Owner management. Header with status/active-host count, three tabs (Hosts / Pending Invites / Transactions), Invite Host modal (identifier + optional 280-char message), per-host suspend / reactivate / remove icon-buttons (owner protected — the AGENCY_OWNER row shows no actions), per-invite cancel. Owner-only guards enforced server-side; UI simply hides buttons.
- `/app/frontend/app/(tabs)/me.tsx` — surgically added two new menu rows (Earnings, Agency Center). Agency Center row carries a numeric badge when `invCount > 0` and sub-text that reflects current state: agency name + role / N pending invitations / "Not in an agency". Each menu row already carries `testID={\`me-${id}\`}` so UI tests remain deterministic.
- `/app/frontend/src/api.ts` — 17 new typed API functions covering every endpoint above.
- `/app/frontend/src/i18n.tsx` — 32 new EN + AR strings for earnings/agency flows. All new UI consumes `useI18n()`, so Arabic RTL continues to work with no hard-coded user-facing strings.

**Security**
- All financial values are backend-calculated; the client never POSTs host/agency/orio amounts. The invite endpoint only accepts `user_identifier` + optional `message`.
- Owner-only routes (invite / cancel / suspend / reactivate / remove / transactions) are gated server-side via `_resolve_agency_or_403(..., require_owner=True)`. Member reads (hosts list, agency summary) are gated via membership + ownership + admin.
- `/me/transactions` strips `metadata` to a safe whitelist (`gift_id`, `quantity`, `unit_price`, `room_id`, `combo_id`) so other users' identities don't leak.
- `apiAcceptInvitation` on an already-accepted / rejected / cancelled invite returns 409 (never 200). Invites addressed to another user return 403. These behaviours are regression-covered.

**Diamonds vs Earnings**
- The Earnings hero clearly labels the "Available" amount in Diamonds and shows the "Diamonds are virtual ORIO currency, not cash." disclaimer under the balance. Transaction rows show the recipient's `host_amount` (post-split) with a smaller "of {gross}" sub-amount so the 50/5/45 math is visible.

**Tests** — `tests/test_phase2a_agency_frontend.py` (16 tests). Full regression now stands at **86 / 86 PASS** across the Phase-1 + Phase-2A relevant suites:
- test_phase2a_agency_frontend.py: 16/16
- test_phase1_verification.py: 16/16
- test_iteration_38_agency_earnings.py: 24/24
- test_iteration_37_gift_system.py: 30/30

Scoped-out of Phase 2A per owner's instruction (parked for Phase 2B):
- Cash-out
- Withdrawal requests
- Payout providers (PayPal / Stripe Connect / bank)
- Apple / Google in-app billing
- Any new financial UI beyond Earnings/Agency Center


### Iter-41 — Phase 2A navigation bug fix (hotfix)
Owner reported that tapping Earnings or Agency Center from the Me tab bounced to Rooms/Discover instead of opening the new screens.

**Root cause** — `/app/frontend/app/_layout.tsx` line 30: the `AuthGate` effect contains a hard-coded allow-list of top-level route folders. For any authenticated user whose current segment is NOT `(auth)`, NOT `(tabs)`, and NOT in that allow-list, it fires `router.replace("/(tabs)/home")`. The Phase-2A screens `/earnings` and `/agency` were never added to this list, so the gate reverted both routes to `(tabs)/home` within one tick of the navigation starting — this is what read as a "fallback to Rooms."

**Fix** — surgical: `"earnings"` and `"agency"` added to the `AuthGate` allow-list. No other behaviour changed; non-authenticated users still get redirected to `/(auth)/login`, and unknown routes still fall back to home (per the original design).

**Verification**
- `/me` → tap `me-earnings` → location becomes `/earnings`, Host Earnings screen renders with Available/Pending/Total/Gross tiles, Agency card, Transaction History empty state, Diamonds-not-cash disclaimer.
- `/me` → tap `me-agency` → location becomes `/agency`, Agency Center renders with the "You're not in an agency yet" empty state and Pending Invitations list.
- Confirmed in a real browser session via Playwright login + stored refresh token.

**Regression test** — new file `backend/tests/test_phase2a_navigation.py` (8 tests). It parses `_layout.tsx` + `me.tsx` + the three Phase-2A route files and asserts:
1. Route files exist on disk.
2. AuthGate allow-list contains `earnings` AND `agency` (fails cleanly if the hard-coded list is ever shortened again — this is what would have caught the original bug).
3. Me menu rows have the right `href`s (`/earnings`, `/agency`) and the right `testID`s.
4. The screens render with `earnings-screen`, `agency-center`, `agency-manage` testIDs.
5. No hard-coded fallback to `/home` or `/rooms` in the Me menu rows.

Negative check performed: temporarily removed the two entries from the allow-list → the specific regression test failed with a clear message pointing straight at the fix location. Entries restored, suite is green: 40/40 PASS (navigation 8 + phase2a-api 16 + phase1 16).

**Known architectural brittleness (not addressed per surgical-only directive)**
The `AuthGate` allow-list is fragile — every new top-level route must remember to be added. A future iteration should refactor this to a convention (e.g., any route whose folder exists at `app/<name>` is implicitly allowed when authenticated, with a tiny deny-list for `(auth)`), but that is scoped out for Phase 2A.


### Iter-42 — Phase 2B: Real Withdrawal System (MANUAL PAYOUT MODEL)

Owner approved Phase 2B with explicit NO-API-INTEGRATION constraints — this phase delivers a real end-to-end withdrawal accounting + security review + admin workflow, but the external payment is handled manually by a human admin outside ORIO. No PayPal / Payoneer / Stripe Connect / etc. APIs were integrated. UI copy consistently says "Manual payout processing — subject to verification."

**Business rules captured**
- Minimum withdrawal: $10 USD (server-authoritative, configurable).
- Security review period: 7 days (configurable).
- Exchange rate: 1 USD = 1000 Diamonds (configurable).
- One-active-agency-per-host rule preserved from Phase 1.
- 50/5/45 revenue split UNCHANGED.
- 18 payout methods, each with its own required/optional field schema.
- Full status machine: REQUESTED → UNDER_REVIEW / HOLD / NEEDS_INFORMATION → APPROVED → PROCESSING → PAID / FAILED / RETURNED; plus REJECTED and CANCELLED.
- `mark-paid` REQUIRES `external_reference` — no automatic PAID transitions.
- FAILED does NOT auto-restore funds; a human admin must explicitly RETURN to compensate.
- Users CANNOT submit host/agency/orio amounts. All ledger math is server-side.

**New backend endpoints** (surgical additions, no existing route modified)
- `GET /payout/methods` · `GET /withdrawal/config` · `GET /admin/withdrawal-config` · `PATCH /admin/withdrawal-config`
- CRUD on `/me/payout-methods` + `/me/payout-methods/{id}/default`
- `POST /me/withdrawals` · `GET /me/withdrawals[/{wid}]` · `POST /me/withdrawals/{wid}/cancel`
- `POST /agencies/{id}/withdrawals` · `GET /agencies/{id}/withdrawals` (owner only)
- `GET /admin/withdrawals[/{wid}]` + `POST /admin/withdrawals/{wid}/{review|hold|request-info|approve|reject|start-processing|mark-paid|mark-failed|mark-returned}`
- `_bootstrap_indexes_v40` adds partial-unique indexes:
  - `payout_methods.user_id` where `is_default: True` (uniq default)
  - `withdrawals.(user_id, idempotency_key)` where `idempotency_key: {$type: "string"}` (idempotency)
- Also adds performance indexes on `payout_methods.(user_id, created_at)`, `withdrawals.(status, review_ends_at)`, etc.

**Balance reservation via compensating ledger entries**
- Historical earning rows are NEVER edited or deleted.
- Reservation = negative ledger row (`source: withdrawal_reserved`, `type: withdrawal`, `host_amount: -N` or `agency_amount: -N`, `orio_amount: 0`, `currency: "diamonds"`).
- Cancellation / rejection / return / rollback = positive compensating entry.
- Phase-1 invariant `h+a+o == gross` holds on every row (orio_amount is 0 on all withdrawal rows — ORIO's cut is unaffected).
- A new helper `_record_withdrawal_ledger_tx` writes raw rows idempotently via the unique `reference_id` index (same pattern as `_record_ledger_tx`).

**Surgical change to one existing endpoint**
- `/hosts/me/earnings` previously filtered `type ∈ {earning, reversal}`. Added `"withdrawal"` to the filter so reservations correctly reduce the "available" number. This is REQUIRED for withdrawal integration — nothing else about the endpoint changed.

**Also exposed `is_admin` on `/auth/me`** so the Me tab can conditionally reveal the Admin Withdrawal Center row. All admin API routes remain backend-gated — the UI toggle is cosmetic.

**New frontend screens**
- `/withdraw` — Earnings → Withdraw. Method picker (shows all saved payout methods), USD amount with Diamond conversion preview, minimum enforcement, manual-processing disclaimer. Submits with idempotency key.
- `/withdrawals` — My Withdrawals list. Status pill, method, masked destination, requested date, review-until date.
- `/withdrawals/[id]` — Details. Full status card, method, masked destination, review end, external_reference (if PAID), rejection/failure reason (if applicable), Cancel button while in cancelable statuses.
- `/payout-methods` — list + default badge + verification pill + add/edit/delete/set-default.
- `/payout-methods/new` — Grid picker over all 18 methods, dynamic form built from the method's required/optional field schema, placeholder hints by field name.
- `/payout-methods/[id]` — Edit. Only non-sensitive fields (country/currency/pix_key_type/bank_name/branch) are pre-filled — sensitive fields are left blank, forcing re-entry to confirm the change.
- `/admin/withdrawals` — Admin Withdrawal Center with status filters, owner-type badge (HOST/AGENCY), masked destination.
- `/admin/withdrawals/[id]` — Full admin detail with FULL unmasked payout snapshot (admin only), audit timestamps, and ALL action buttons (review/hold/request-info/approve/reject/start-processing/mark-paid/mark-failed/mark-returned). Each action opens a modal when it needs a reason / external_reference / note. Approve honours the stored `review_ends_at` and returns 400 if the period hasn't elapsed yet.
- `/app/_layout.tsx` AuthGate allow-list extended with `withdraw, withdrawals, payout-methods, admin` so the Phase-2A navigation bug does not recur.
- Me screen gets three new rows: My Withdrawals, Payout Methods, and (admin only) Admin · Withdrawal Center.
- Earnings screen gets a Withdraw primary button + My Withdrawals ghost button + Payout Methods link.

**Sensitive-data protection**
- All user-facing responses use `_mask_value` (`****1234` for numeric/wallet fields, partial for emails/names).
- `/me/transactions` strips metadata to a whitelist (`gift_id, quantity, unit_price, room_id, combo_id`).
- Admin alone sees the full `payout_method_snapshot.details` on withdrawal detail.
- Payout methods belong strictly to their owner — ownership enforced in every CRUD endpoint (404 for strangers, not 403, so the ID isn't confirmed as existing).
- The frontend never computes authoritative balances; it always reads from the backend.

**Tests** — `tests/test_phase2b_withdrawals.py` (26 tests, 25 PASS + 1 skipped on the $10-agency edge). Full regression:
| Suite | Result |
|---|---|
| `test_phase1_verification.py` | ✅ 16 / 16 |
| `test_phase2a_navigation.py` | ✅ 8 / 8 (updated to assert the new allow-list entries too) |
| `test_phase2a_agency_frontend.py` | ✅ 16 / 16 |
| `test_phase2b_withdrawals.py` (new) | ✅ 25 passed, 1 skipped (agency $10 edge) |
| `test_iteration_37_gift_system.py` | ✅ 30 / 30 |
| `test_iteration_38_agency_earnings.py` | ✅ 24 / 24 |
| **TOTAL (Phase-1 + 2A + 2B + regression)** | ✅ **119 passed, 1 skipped** |

Phase-2B test coverage specifically:
1. 18 methods present + per-method required-field list
2. Config defaults (10 USD, 7 days, 1000 diamonds/USD)
3. Payout-method CRUD + default handling + auto-default on first add
4. Payout-method ownership isolation (A cannot touch B)
5. Below-min rejected
6. Zero / negative rejected
7. Insufficient balance rejected
8. Payout-method-not-mine rejected
9. **Compensating reservation**: available drops by exact diamonds, Phase-1 invariant preserved
10. Idempotency key prevents duplicates
11. **Concurrent withdrawals cannot oversubscribe** (10 parallel $10 reservations against a known budget — never negative, never over the budget)
12. Cancel restores the balance + idempotent cancel = 409
13. Admin cannot approve before review period
14. Admin full happy path: review → hold → config-shortcut → approve → start-processing → mark-paid (requires external_reference → 400 without, 200 with)
15. Rejection restores balance + compensating entry visible
16. Returned restores balance but FAILED alone does NOT
17. Cannot cancel once APPROVED
18. Agency owner can withdraw agency earnings
19. Non-owner cannot withdraw from agency (403)
20. Non-admin blocked from every admin endpoint (403)
21. Unauthenticated blocked (401/403)
22. Admin config validation (bad values 400, no fields 400)
23. Admin can raise the minimum (and users feel it immediately)
24. User A cannot see User B's withdrawals (404 not 403 — no existence confirmation)
25. Destination hint masked on user view, full on admin view
26. Phase-1 invariant `h+a+o==gross` still holds on every ledger row AND withdrawal rows never move ORIO's cut

**What was explicitly NOT built (owner-scoped-out)**
- No PayPal / Payoneer / MoneyGram / Ria / Western Union / bank / Cash App / Venmo / crypto API integration
- No automatic deposits or fake provider confirmations
- No real-money payout processing
- No "payment sent automatically" copy anywhere
- No change to the 50/5/45 revenue split
- No redesign of existing Agency Center / Profile / Room / Posts / VIP screens

**Files changed**
- `/app/backend/server.py` — ~670 lines appended for Phase-2B; two surgical edits (allow `withdrawal` type in host earnings; expose `is_admin` on /auth/me). No existing endpoint deleted or renamed.
- `/app/backend/tests/test_phase2b_withdrawals.py` — new test suite.
- `/app/backend/tests/test_phase2a_navigation.py` — extended to cover new allow-list entries.
- `/app/frontend/src/api.ts` — 17 new typed Phase-2B API helpers + types.
- `/app/frontend/src/i18n.tsx` — 32 new EN + 32 AR strings for withdrawal flows.
- `/app/frontend/app/_layout.tsx` — AuthGate allow-list extended.
- `/app/frontend/app/earnings.tsx` — added Withdraw / History / Payout-methods entry points.
- `/app/frontend/app/(tabs)/me.tsx` — added My Withdrawals, Payout Methods, Admin Withdrawal Center rows.
- NEW: `/app/frontend/app/withdraw.tsx`
- NEW: `/app/frontend/app/withdrawals/index.tsx`
- NEW: `/app/frontend/app/withdrawals/[id].tsx`
- NEW: `/app/frontend/app/payout-methods/index.tsx`
- NEW: `/app/frontend/app/payout-methods/new.tsx`
- NEW: `/app/frontend/app/payout-methods/[id].tsx`
- NEW: `/app/frontend/app/admin/withdrawals/index.tsx`
- NEW: `/app/frontend/app/admin/withdrawals/[id].tsx`


## Iteration 42 — ORIO Games Foundation (Ludo) + Financial Intermediary / Recharge Agent (2026-10)

Two features added, both completely surgical. No existing route, UI, ledger,
or economy was modified except as explicitly described below.

### Preserved invariants (triple-checked)
- 9,999 Diamonds = $1 USD — ENFORCED (verified by `test_preservation_rate_is_still_9999`).
- Minimum withdrawal $10, maximum $1,000 — ENFORCED.
- 50 % Host / 5 % Agency / 45 % ORIO split — UNTOUCHED.
- Existing withdrawals / payout methods / wallet / recharge packages — UNTOUCHED.
- Games NEVER modify any diamond balance (`test_games_do_not_touch_wallet`).

### Backend (surgical append — ONE new section at the bottom of `server.py`)
- `_bootstrap_indexes_v42` — idempotent indexes for games + recharge-agent collections.
- **Ludo state machine** (server-authoritative, cryptographic RNG via `secrets.randbelow`):
  - `POST /api/games/ludo/create` — host creates a session anchored to a room.
  - `GET /api/games/{game_id}` — fetch state.
  - `GET /api/rooms/{room_id}/games/active` — poll active game for a room.
  - `POST /api/games/{game_id}/join` — join an empty seat (2-4 players).
  - `POST /api/games/{game_id}/leave` + `/forfeit` — leaves or forfeits mid-game.
  - `POST /api/games/{game_id}/start` — host only, requires ≥2 players.
  - `POST /api/games/{game_id}/roll` — server rolls 1-6 (secrets).
  - `POST /api/games/{game_id}/move` — server validates and applies the move.
  - All rules enforced server-side: must-roll-6-from-base, no overshoot, captures
    only on main-track non-safe cells, three-sixes rule, extra turn on 6 / capture / finish,
    auto-pass when no legal moves exist, forfeit → winner determination.
- **Game WebSocket**: `/api/ws/games/{game_id}?token=…` broadcasts `game_state` to all
  connected clients on every mutation. State is replayed to each new connection.
- **Reusable architecture**: `_GameHub` + `games` + `game_moves` collections form the
  base for Dominoes/UNO/Carrom/Team Battle/Dice. Each future game reuses the hub,
  REST/WS pattern, and session persistence.
- **Casual XP (NEVER touches diamonds/coins/ledger)**: `_award_ludo_xp` adds to
  `users.games_xp` + writes `games_xp_ledger` row. 50 for winner / 10 for finisher /
  2 for forfeit. Exposed via `GET /api/me/games-xp`.
- **Recharge Agent (Financial Intermediary / وسيط مالي - وكيل الشحن)**:
  - `GET /api/recharge-agents` + `GET /api/recharge-agents/{id}` — public list of
    active agents.
  - `POST /api/recharge-agent-transactions` — user submits proof (agent_id,
    agent_tx_id, amount_usd, paid_at ISO). Server validates: placeholder rejection,
    future-date rejection, 90-day cutoff, per-agent uniqueness (409 on duplicate).
    Status starts `pending`.
  - `GET /api/recharge-agent-transactions` + `/{id}` — user's own history.
  - **Admin**: `GET/POST/PATCH /api/admin/recharge-agents` for CRUD;
    `GET /api/admin/recharge-agent-transactions`;
    `POST /api/admin/recharge-agent-transactions/{id}/verify` credits diamonds
    (`amount_usd × 9999`) atomically via `wallet_transactions` + `growth_ledger`
    (same contract as `/wallet/recharge`), triggers `_maybe_activate_vip`.
    Idempotent via status check + reverse on race. Rejection does NOT credit.

### Frontend (new routes — added to AuthGate whitelist)
- `/games` — Games lobby with Ludo card (from room: `/games?room_id=…`).
- `/games/ludo/{gameId}` — Full real-time Ludo board, WebSocket-driven,
  dice animation, token-tap-to-move, player strip with turn indicator.
- `src/games/LudoBoard.tsx` — reusable 15×15 Ludo board renderer.
- `/recharge-agent` — Recharge Agent Center (list + history).
- `/recharge-agent/new?agent_id=…` — submit a REAL recharge transaction form.
- `/recharge-agent/{tx_id}` — transaction detail with status pill + rejection reason.
- **Payout Methods screen** gains a first-class "Financial Intermediary -
  Recharge Agent" card at the top (clearly separated from payout methods).
- **Room screen** `BottomMoreSheet` gets a new `more-games` tile.
- **AuthGate** whitelist updated: `games`, `recharge-agent`.
- Full EN + AR i18n coverage for every new UI string.

### Verification
- Backend tests: **113/113 PASS** total — new (20) + iter-41 precision/agency (11)
  + Phase 2B withdrawals (28) + iter-38 agency earnings + iter-37 gift system.
  New file: `/app/backend/tests/test_iter42_games_and_recharge_agent.py`.
- Live preview verified: payout-methods shows the gold-trimmed Financial
  Intermediary card, Recharge Agent Center renders with hero/warning/agent list,
  Games screen renders with XP badge and Ludo card.
- Lint: all new frontend files pass ESLint.
- Native voice (Agora), gift system, VIP, withdrawals, agency center — all
  regression PASS, no changes required.

## Iteration 43 — Room Entertainment Games + Betting Catalog + Billiards (2026-10)

Surgical scope: in-room half-screen gameplay without disturbing voice/seats/chat.

### Backend
- `_bootstrap_indexes_v43` seeds `room_games_catalog` with Ludo + Billiards entertainment entries.
- **Room games catalog**: `GET /api/room-games/catalog` returns `{entertainment, betting}`.
  - `admin/room-games/catalog` for upsert/delete.
  - Betting entries without a licensed provider_id/provider_game_id/legal_status
    are forcibly returned as `enabled=false` + `unavailable_reason` — NEVER
    present fake providers.
- **Billiards state machine** (`game_type: "billiards"` in `games` collection):
  - 2 players · 1 cue + 6 object balls on a 100×50 abstract table.
  - `POST /api/games/billiards/create|join|leave|shot`.
  - **Server-authoritative deterministic physics simulation**: friction,
    wall reflection, elastic ball-ball collision (equal mass), pocket
    detection. Emits a trajectory of frames for client animation.
  - Scoring: +1 per legal pot (extra turn), -1 for cue scratch (turn ends,
    cue respawns at start).
  - Casual XP ONLY (40/10/2); zero diamond or ledger coupling.
  - `GET /api/rooms/{room_id}/games/billiards/active`.

### Frontend
- **Room Tools panel** (`BottomMoreSheet`) is now scrollable with 3 sections:
  1. **Room Tools** — Music / PK Challenge / Games / Minimize (unchanged).
  2. **Room Entertainment Games (ألعاب الغرفة الترفيهية)** — Ludo + Billiards.
  3. **Betting Games (ألعاب الرهان)** — admin catalog driven; unlicensed
     entries show lock badge + "Unavailable".
- **InRoomGameSurface** (`src/components/InRoomGameSurface.tsx`) — fixed-bottom
  overlay occupying ~50 % of screen height. Lives INSIDE `/room/[id].tsx` so
  the room never unmounts — Agora, seats, mic state, chat are untouched.
  - Close (X) button restores normal room layout.
  - Reopening a game puts the surface back above the room.
  - Leaving the room via `handleExit` naturally unmounts the surface.
- **LudoBoard** (iter-42) reused inside the surface.
- **BilliardsBoard** (`src/games/BilliardsBoard.tsx`) — 2D top-down table.
  Replays the server-returned trajectory frames via `requestAnimationFrame`;
  tap-to-aim + angle/power dial controls.
- Routes untouched (no new navigation).

### Preserved invariants
- 9999 Diamonds = $1 USD · 50/5/45 split · min $10 / max $1000 withdrawal.
- Games write NOTHING to `wallet_transactions`, `financial_ledger`,
  `agency_earnings`, `host_earnings`, or `gift_*`. XP goes to
  `games_xp_ledger` only.
- Agora never reconnects when a game surface opens or closes.

### Verification
- Backend tests: iter-43 (10) + iter-42 (20) + iter-41 (11) · **41/41 PASS**.
- Live preview: logged in demo user → opened room → tapped the four-dot
  Room Tools button → confirmed the three sections appear with Arabic
  titles (ألعاب الغرفة الترفيهية / ألعاب الرهان) and the betting Slot
  tile shows the lock badge + "Unavailable" status.
- Tapped **Ludo** → half-screen Ludo surface appeared on the lower 50% of
  the viewport, room header + host + seats + chat remained visible above.
- Tapped **Billiards** → half-screen pool table with felt, pockets, cue
  ball + 6 racked object balls rendered correctly.
- Lint: clean on all new files.

## Iteration 44 Phase 1 — Luminous ORIO Purple + Toast + Confirm Modal (2026-10)

Preserved all existing functionality; this is a cosmetic + central-UX refactor only.

### Theme
- `src/theme.ts` — `gold` + `brandPrimary` + `purple` all pivoted to a luminous
  premium purple (`#9B6CFF` with glow highlight `#C4B5FD`). Semantic colors
  (`warning`, `vipGold`, VIP tier colors) left untouched because they carry
  system-state meaning. Hex-hard-coded occurrences in login/me/profile/logo
  files updated to theme references so the sweep is now theme-driven.

### Centralised components
- `src/components/Toast.tsx` — single ORIO toast provider mounted globally
  in `_layout.tsx`. Supports kinds (info/success/error/warning), auto-RTL,
  smooth entrance + progress bar countdown, ORIO logo + accent badge. Call
  via `useToast()` anywhere.
- `src/components/ConfirmModal.tsx` — premium dark modal with ORIO crown
  logo, luminous purple border + glow, primary + secondary buttons. Used
  by Settings → Sign Out (exit confirmation, exact Arabic text per spec).
- `src/components/typography.ts` — screen-title + section-label presets so
  Phase 3's title rename ("Party rooms", "المنشورات", "Message", "أنا")
  will look consistent across all top-level screens.

### Settings
- Sign Out button now triggers `ConfirmModal` with EN/AR titles
  ("Warning" / "تنبية") and bodies ("You are about to exit Orio" /
  "أنت على وشك الخروج من Orio"), destructive red primary.

### Verification
- 52/52 backend tests pass (iter-41 + iter-42 + iter-43 + new Phase-1 smoke).
- Testing agent confirmed: purple pills, premium ConfirmModal with ORIO
  crown logo, 'Confirm Exit' + 'Cancel' buttons, Toast provider mounted,
  no crashes, no regressions.

## Iteration 44 Phase 2 — Profile Completion + Server-Enforced Gender Lock (2026-10)

### Backend
- `UpdateProfileIn` + PATCH `/api/users/me` reject any gender change when
  `user.gender_locked == true` (returns 409). Same-value PATCH is idempotent.
- New endpoint `POST /api/me/profile/complete` sets nickname + gender + age
  + country_code atomically, resolves country code → name/flag from the
  existing COUNTRIES master list, flips `gender_locked = profile_completed = true`.
- Bootstrap migration marks every pre-iter-44 user as
  `profile_completed = gender_locked = true` so existing accounts (like
  demo@voiceup.app) are unaffected.
- `public_user` now exposes both flags to the client.

### Frontend
- New route `/profile-completion` — gated screen with exact Arabic headers
  ("تكمل ملفك الشخصي لجذب الناس إليك" / "ملاحظة لا يمكنك تغيير جنسك
  بعد الاختيار ثم التأكيد"), avatar picker (expo-image-picker + base64 via
  existing `apiSetProfileMedia`), name, Male/Female gender tiles, country
  picker (reuses `apiCountries`), age field, and a Confirm button that opens
  the ConfirmModal to explicitly warn the gender becomes immutable.
- `AuthGate` in `_layout.tsx` redirects any user with `profile_completed = false`
  to `/profile-completion` and refuses to let them visit any other screen.

### Verification
- Phase 2 backend tests: 7/7 (fresh user flow, gender lock, idempotency,
  double-complete rejection, validation 422s).
- Full backend regression: 48/48 (iter-41 + iter-42 + iter-43 + iter-44 Phase 2).
- Testing agent live run: 12/12 — Arabic headers rendered, AuthGate blocks
  all other routes until completion, submit confirms + persists + redirects,
  demo user migrated correctly.

## Iteration 44 Phase 3 — Titles + Bottom Nav + Real User Search (2026-10)

### Changes
- **Bottom nav**: Games tab hidden via `href:null` in `(tabs)/_layout.tsx`. Entertainment games (Ludo/Billiards) remain reachable via the in-room Room Tools surface built in iter-43. Final tabs: Party rooms · Posts · Messages · Me.
- **Titles**: Home title now "Party rooms" (EN) / "الغرف" (AR). Tab labels updated to i18n ("Party rooms" / "Posts" / "Messages" / "Me" and their Arabic equivalents).
- **Real user search**:
  - Backend: new `GET /api/users/search?q=&limit=` endpoint. Case-insensitive regex over `username` + `nickname`; exact `numeric_id` match for numeric queries; `profile_completed` gate so brand-new signups don't leak; batch `is_following` hydration; strips sensitive fields (email/phone/password_hash) from the response. `re.escape` prevents regex injection.
  - Frontend: new `/search` screen with 6 explicit states (empty/typing/loading/results/no-results/error), 300 ms debounce, premium cards (avatar + VIP badge + flag + "Following" pill when applicable), tap → `/user/{id}`.
  - Added search icon in the Home header.
  - `search` whitelisted in AuthGate.
- Testing agent: 29/29 PASS (20 pytest + 9 public-URL smoke + full frontend flow + Phase 2 regression).

## Iteration 44 Phases 4 & 5 — Mic UX + Perf (2026-10, partial)

### Phase 4 (shipped)
- **Visual bump** — `brandPrimary` from `#9B6CFF` → `#B47CFF`, `purpleGlow` from `#C4B5FD` → `#E9D5FF`. All call-sites inherit automatically through the theme (no per-file sweep required).
- **Owner-seat toast** — `handleSeat` in `/app/room/[id].tsx` now shows the exact Arabic ORIO toast "هذا المقعد لصاحب الغرفة فقط" / "This seat is reserved for the room owner" when a non-owner taps seat 0; opens the owner's user card for gifts/profile if the owner is on it; NO change to seat state, Agora, or room state.
- **White watery speaker-ring** — new `src/components/SpeakerRing.tsx` renders a 3-layer bloom ring absolutely-positioned around the SeatBubble WITHOUT touching the avatar. Reacts to the real Agora audio level (`seatLevel()` normalises Agora's 0-255 raw volume to 0..1 and only animates when `speaking && !muted`); when the user stops talking, the rings collapse to zero (no fake permanent animation).
- **Multi-mic stability** — already present in iter-39/40 backend state machine; no code changes required. The waveform work above is purely rendering so there's no new race window.
- Alert on "cannot take seat" errors now flows through the premium Toast system.

### Phase 5 (shipped)
- **Tab `freezeOnBlur: true`** so inactive tabs stop re-rendering until focused again — preserves scroll position + state at zero code cost.
- **React Query defaults** on the shared `queryClient`: `staleTime: 30s`, `gcTime: 5min`, `refetchOnWindowFocus: false`, `refetchOnReconnect: true`, `retry: 1`. This removes duplicate fetches when switching tabs and warms the cache when returning to a screen.

### Phase 6 — BLOCKED on provider credentials
Phone OTP (Firebase or Twilio) + Facebook Login both require real credentials from the user. No fake buttons will be shipped; the login screen rework will begin once the keys land.

### Still queued
- Phase 4 heavy multi-mic hardening audit (server-side race conditions were already addressed in iter-39/40 — can be re-tested once credentials arrive and the live app is on a device).
- Phase 6 login rework (Google + Email + Phone + Facebook) — pending user supplying provider credentials.

## Iteration 53 — Profile Visitor Tracking Completion (2026-10)

### What landed
- **Frontend wiring (surgical)**: `ProfileView` now fires `apiRecordView(targetId)` once on mount whenever a non-owner opens another user's profile. The 5-minute per-pair dedup window is enforced server-side, so this is safe to call on every mount.
- **Backend robustness**:
  - Added `profile_visitors` indexes: unique `(target_id, viewer_id)` + sorted `(target_id, last_visit DESC)` → correctness + fast reads of "Who viewed my profile".
  - `POST /api/users/{id}/view` now refreshes `viewer_pub` (nickname/avatar/VIP/flag) on repeat visits so the visitor list never shows stale data.
  - `viewer_pub.short_id` now prefers the user's real 8-digit `numeric_id` (fallback to legacy short-hash only when a user hasn't been backfilled). Owners can now copy / search / message visitors directly from the Visitors screen.
- **Preserved**: self-view (`counted:false, reason:"self"`), 404 on unknown target, visitors list capped at 200, lifetime counter semantics — all unchanged from previous iters.

### Tests
- `backend/tests/test_iter53_profile_visitors.py` — 5 tests covering auth, self-view no-count, remote view with dedup, multi-viewer ordering, and 404s. All pass.
- Full iter47→iter53 suite: **47/47 PASS**.

### Still pending (deferred this iteration)
- Multi-account switching (up to 5 accounts per device).
- Report screen image/video uploads.
- Families + CP enhancements.
- Admin dashboard (web).
- Twilio + Facebook keys (unblocks Phone + FB auth UI).

## Iteration 54 — Profile Visitor UI Completion (2026-10)

### Scope
Surgical, user-facing completion of the Iter-53 Profile Visitor backend.

### What landed
- **Backend (surgical)**: `/api/users/me/visitors` now additionally returns `today_views` — the count of unique visitors whose `last_visit` falls on today's UTC day. Dedup / self-view / 404 semantics unchanged. Owner-only (`current_user` dependency).
- **i18n**: added `visitorsTitle` ("من شاهد ملفي" / "Who viewed my profile"), `visitorsTodayLabel`, `visitorsLifetimeLabel`, `visitorsSubRow(n)`, `visitorsEmpty` ("لا توجد مشاهدات حتى الآن"), relative-time strings, pluralization.
- **Visitors screen (`/visitors`)**: localized throughout; two stat cards: *Viewed Today* and *Lifetime Views*; real visitor rows (avatar, nickname, 8-digit numeric ID, country flag, VIP badge, relative time, visit count); tapping a row navigates to `/user/{id}` reusing the existing `ProfileView`; empty state with no mock data; `useFocusEffect` auto-refetches on screen focus (no polling).
- **Me tab (`/(tabs)/me`)**: the *Profile Visitors* row's `label` + `sub` are now i18n-driven; the `sub` shows `شاهد ملفك اليوم: N` / `Viewed today: N` whenever today's count > 0, and a numeric badge appears next to the row. The Me tab shares the same `["visitors"]` React Query cache key as the Visitors screen → zero duplicate network calls.

### Tests
- Backend: all 47 tests (iter47 → iter53) pass, including updated `today_views` assertions in iter53.
- Frontend: lint clean. Smoke test with demo@voiceup.app shows the full Visitors screen rendering real backend data (Alice, ID 24C7A133). Arabic language toggle flips the login screen UI to RTL as expected.

### Preserved (invariants)
- No new routes. No redesign. No mock data.
- Owner-only visibility enforced server-side (`/users/me/visitors` uses `current_user`); no API exposes other users' visitor lists.
- `profile_visitors` dedup window (5 min) + self-view exclusion untouched.
- `ProfileView` auto-records views on mount for non-owners (iter-53 wire-up) — unchanged.

## Iteration 55 — VIP Maintenance + Global Supporter Ranking (2026-10)

### VIP System (surgical)
- **30-day cycle + single-level downgrade** (server-authoritative, lazy evaluation on every `/vip/progress` and `/auth/me` call — no cron):
  - VIP 1 & 2: no maintenance requirement → auto-renew.
  - VIP 3: 500,000 Growth Points, VIP 4: 1,500,000, VIP 5: 3,500,000, VIP 6: 7,500,000, VIP 7: 15,000,000.
  - If the user misses the threshold at expiry, drop by **exactly one level** and start a fresh 30-day cycle at the new level.
- **New fields on `/vip/progress`**: `remaining_days`, `maintenance_threshold`, `maintenance_remaining`, `maintenance_requirements[]`, `qualified_level`.
- **New endpoint**: `GET /api/vip/maintenance` → full snapshot + reference requirements map.
- **UI**:
  - Added a small Info icon ⓘ in the VIP header next to the existing ❓ Help button; opens the "VIP Maintenance System" modal with the exact per-level requirement table.
  - Progression card shows "VIP time left: N days" and "Keep VIP {L}: {remaining} GP left" / ✓ Met / No requirement.
  - "V" emblem reduced from 260 → 216 and clipped by `overflow:hidden` so it stays fully contained in the ambient circle.
  - **"Convert Diamonds → Growth Points" permanently removed** (button + modal). Backend endpoint retained for compatibility.
  - Immediate server-authoritative refresh via `refetchOnMount` + `refetchOnWindowFocus`.

### Global Supporter Ranking (new)
- **Backend**: `GET /api/rankings/global?metric=contribution|charm&period=daily|weekly|monthly|all` — aggregates `gift_transactions` system-wide (no `room_id` filter). Same UTC windowing + source-of-truth as per-room ranking.
- **Entry point**: 🏆 Trophy icon added to the Party Rooms header beside Search → opens `/global-ranking`.
- **Design** (both global + room ranking screens, iter-55):
  - **Replaced the previous tall-column podium** with a horizontal premium ranking list.
  - **Top 1 / 2 / 3**: three distinct ORIO luxury seat/cards — gold (trophy badge), silver (diamond badge), bronze (flame badge). Each has its own metallic gradient, double-ring avatar, glow, and 86-px premium row height.
  - **Positions 4–50**: single consistent premium row design — numbered gold badge + avatar + nickname + flag + VIP mini-badge + diamond total.
  - Every row is clickable → `/user/{id}` (existing ProfileView).
  - `useFocusEffect` refetch on return so new gifts surface immediately.

### Tests
- `backend/tests/test_iter55_vip_maintenance_and_global_ranking.py` — 7/7 pass:
  - `/vip/progress` carries maintenance fields.
  - `/vip/maintenance` exposes exact per-level thresholds (0 / 0 / 500k / 1.5M / 3.5M / 7.5M / 15M).
  - 30-day expiry + below threshold → exactly one-level downgrade + fresh 30-day cycle.
  - Threshold met → auto-renew (no downgrade).
  - VIP 1 and VIP 2 always auto-renew regardless of GP.
  - `/rankings/global` shape + metric/period filters + 400 on bad metric + auth required.
- Full iter47→iter55 suite: **54/54 PASS**.
- Legacy convert-wallet tests have pre-existing flakiness from shared demo-wallet state across runs (unrelated to iter-55; `/vip/convert` endpoint is unchanged).

### Preserved (invariants)
- 9,999 Diamonds = $1, Host/Agency/ORIO split untouched.
- No redesign to seats, chat, gifts, Agora, Room settings, Me tab, Visitors, Auth.
- `/vip/convert` backend route untouched (only its UI entry point was removed).
- Dedup / self-view rules on Profile Visitors (iter-53/54) untouched.

## Iteration 56 — UI/Function Round (2026-10)

### 1. Room User Profile Card
- Avatar now overlaps the floating card: `marginTop: -44` lifts a 88-px avatar so ~50% hangs above the card and ~50% sits inside. Card gets `overflow: visible` so it clips cleanly. Purple ring + glow for premium feel.
- VIP V emblem already slightly reduced + fully clipped (iter-55); unchanged.
- All room-avatar tap handlers unchanged → real profile opens.

### 2. Room Management — Delete Room
- Already shipped iter-52 and verified still in place: `delete-room-btn` sits at the TOP of the owner-only Room Settings card inside `/app/room/[id]/info`. Arabic text "هل أنت متأكد من حذف الغرفة؟" / إلغاء / تأكيد. Backend uses existing `DELETE /rooms/{id}` with owner guard. Moderators and users never see this control (owner-only gated by `isOwner`).

### 3 & 4. Global Ranking + Categories
- Trophy icon in Party Rooms header remains → `/global-ranking`.
- **Top 1 / 2 / 3**: luxury frames with the **existing** gold / silver / bronze colors preserved. Avatars now **overlap elegantly** — absolutely positioned ring (`top:-24, left:10`), 50% above the card edge, with per-tier metallic rim + glow. The card uses `overflow:visible` and reserves padding-left for the floating avatar.
- Positions 4–50 unchanged (premium standard rows).
- Added **7 real category chips** below the period selector: Wealth · Charm · CP · Friends · Custom Gifts · Rooms · Family (+ a leading "All" chip for the default supporter view). Metric toggle (Contribution/Charm) dims and disables while a category is active to make the override explicit.
- Backend `/rankings/v2/{category}` extended with 3 new categories: **custom_gifts** (user count of owned custom gifts), **rooms** (member_count), **family** (points). Each returns a normalized row with a `kind` tag so the frontend tap handler routes to `/user/{id}` / `/room/{id}` / `/families` correctly.
- Live preview confirms Rooms category shows real top rooms ("Yemen 🇾🇪 King 🤴" @ #1, 2 members) with 👥 icon instead of 💎.

### 5. VIP System
- Already shipped iter-55: 30-day cycle, single-level downgrade, ⓘ Info icon preserved beside Help ❓, maintenance strip in progression card, Convert Diamonds removed from UI, V emblem contained inside its circle. No changes this iter.

### 6. Me / Profile Shortcuts
- Added a premium 4-icon row below the stat chips: **Level** → `/vip`, **My Bag** → `/(tabs)/wallet`, **Store** → `/recharge-agent`, **Medal** → `/tasks`.
- Each is a 56-px circular glow (gold / purple / cyan / red-pink) over the dark base with a labeled caption.
- All four map to **existing real screens** (no fake destinations). RTL-aware ordering.

### 7. Party Rooms / Games cleanup
- Deleted `/app/frontend/app/(tabs)/games.tsx` (legacy standalone Games tab content).
- Removed the `<Tabs.Screen name="games" href:null>` reference from `(tabs)/_layout.tsx`.
- In-room games (Ludo etc.) remain accessible via Room Tools inside a room — unchanged.
- Party Rooms "Games" discovery filter chip stays (it filters legit `category: "games"` rooms, not the removed tab).

### Tests
- `backend/tests/test_iter56_rankings_categories.py` — 10 new tests covering the 3 new categories, auth, legacy categories still working, and 400/422 rejection for a bad category.
- Full iter47→iter56 suite: **64/64 PASS**.
- Frontend lint: clean.
- Live preview verified: Global Ranking luxury Top 3 cards, category chips, Rooms category returning real rooms, Me tab shortcuts, VIP Info modal.

### Preserved (invariants)
- Agora, seats, chat, gifts, families, agencies, withdrawals untouched.
- `/vip/convert` backend route still exists (only the UI entry point was removed in iter-55).
- Dedup / self-view / 30-day VIP semantics all preserved from previous iterations.

## Iteration 57 — Global Ranking tabs + Top 3 luxury + VIP name colors (2026-10)

### 1. Global Ranking
- **Contribution** and **Charm** metric tabs removed from Global Ranking entirely (per spec). Those metrics remain fully functional in **Room Ranking** only.
- "All" chip now drives the default supporter aggregate internally via `apiGlobalRanking("contribution", period)` — no visible metric toggle.
- Category chips cleaned to the user's exact list: **All, Wealth, CP, Friends, Custom Gifts, Rooms, Family** (Charm removed from Global; still available for Room Ranking).
- Period tabs rendered without clipping (existing horizontal scrollview).
- Server-authoritative UTC windows updated:
  - **daily**  → rolling last 24h
  - **weekly** → rolling last 168h
  - **monthly** → start of current UTC calendar month
  - **all** → lifetime
  (Both `_period_start` and `_ranking_window_start` helpers unified; applied to `/rankings/v2`, `/rankings/global`, `/rooms/{id}/ranking`.)
- `useFocusEffect` refetch on return already in place (iter-55); unchanged.

### 2. Room Ranking
- Contribution + Charm metric row preserved and functional.
- Same UTC daily/weekly/monthly/all logic now applies there too.

### 3. Top 1 / Top 2 / Top 3 — luxury upgrade
- Gold / Silver / Bronze colors preserved.
- Each card now renders **three stacked gradients**:
  1. Deeper 3-stop palette (dark base → mid tone → tier rim) with explicit locations.
  2. Diagonal metallic sheen band.
  3. Soft top-edge inner glow (ambient highlight).
- New **"GOLD / SILVER / BRONZE" ribbon pill** anchored bottom-right (clear tier label).
- Rank badge (`#1 / #2 / #3`) with tier icon (trophy / diamond / flame) top-right.
- Avatar remains overlapping (~50% above / ~50% inside) with per-tier metallic ring + glow.
- Applied consistently to both Global Ranking and Room Ranking.

### 4. VIP Name Colors (server-authoritative)
- New helper `_vip_name_color(vip_level)`:
  - 0, 1 → `None`
  - 2-5 → `"red"`
  - 6-7 → `"rainbow"`
- Field exposed as `name_color` across:
  - `public_user` (so `/auth/me`, `/users/{id}`, etc. all carry it)
  - `/rankings/v2/*` (user + pair rows)
  - `/rankings/global`
  - CP/friendship pairs
- Users cannot select or set this color themselves. It flips **immediately** after the backend updates `vip_level` (verified: /auth/me returns the new color on next request).
- New frontend `<VipName />` component in `src/components/VipName.tsx`:
  - `"red"` → static solid red.
  - `"rainbow"` → animated rainbow sweep applied **to the username text itself**. Native uses `@react-native-masked-view/masked-view` + Reanimated to translate a 7-stop gradient across a masked text layer; web uses a CSS `background-clip:text` + keyframe animation (added to `app/+html.tsx`).
- Applied in:
  - Global Ranking Top-3 cards + list rows.
  - Room Ranking Top-3 cards + list rows.
  - Me tab header.
  - Profile header (rainbow replaces MarqueeText; red applies color to MarqueeText).
  - Room User Card (floating profile card).

### Tests
- `backend/tests/test_iter57_vip_name_color_and_periods.py` — 14 new tests covering:
  - Name-color mapping across all 8 levels (0..7).
  - Live flip after a `vip_level` upgrade.
  - `name_color` present on `/rankings/v2/wealth` + `/rankings/global` rows.
  - Period parameter accepted for daily/weekly/monthly/all.
- Full iter47→iter57: **78/78 PASS**.
- Frontend lint clean.
- Live preview confirmed: الصمت, demo2, Abe, dark (all VIP 7) render rainbow in the Top-3 and the standard rows; T4feb35/T65c4a7 (VIP 3) render red; Me tab shows demo2 in vivid rainbow.

### Preserved
- Help ❓ button untouched.
- VIP maintenance system (iter-55), room-ranking metric row, Agora, gifts, families, agencies, withdrawals — all unchanged.

## Iteration 58 — Level-colored VIP badges + wider VipName coverage (2026-10)

### 1. VIP Badges
- New reusable component `<VipBadge level />` (src/components/VipBadge.tsx) that renders a per-level colored premium pill:
  - VIP 1 → emerald (`#34D399 → #065F46`)
  - VIP 2 → sky (`#38BDF8 → #0369A1`)
  - VIP 3 → amber (`#F5C542 → #B45309`)
  - VIP 4 → violet (`#A855F7 → #5B21B6`)
  - VIP 5 → red (`#EF4444 → #7F1D1D`)
  - VIP 6 → cobalt blue (`#3B82F6 → #1E3A8A`)
  - VIP 7 → imperial gold (`#FDE68A → #B45309`)
- Uses the same `tierFor()` palette already powering `OrioVipEmblem`, so badge, emblem, and VIP card remain visually in sync.
- Replaced every generic `vipMini` / purple-gold chip with `<VipBadge>` in:
  - Global Ranking (list rows + Top-3 luxury cards)
  - Room Ranking (list rows + Top-3 luxury cards)
  - Profile Visitors (`/visitors`)
  - Friendship list
  - `/rankings` legacy screen
  - Family members (`/families/[id]`)
  - Posts feed (post header + comment header)
  - Wallet hero chip
  - Me tab identity chip (also sized `md`)
  - Search results (floating badge over the avatar)
  - Chat header
- Badge updates automatically on refresh after a VIP upgrade/downgrade — level comes from the server-authoritative `vip_level`.

### 2. VIP Name Colors — widened coverage
- `<VipName />` now also applied in:
  - `/visitors` list rows.
  - `/rankings` legacy screen rows.
  - Posts (post author + comment author).
  - Search results.
  - Chat header title.
- Behaviour from iter-57 preserved: static red for VIP 2-5, animated rainbow sweep on the username text for VIP 6-7.

### 3. Top 1 / 2 / 3 — unchanged
- Gold / Silver / Bronze luxury frames, 50/50 avatar overlap, 3-stop gradient + sheen + ribbon pill — all preserved. Only the user-level VIP badge inside each card is now level-colored.

### 4. Rankings & periods
- No logic changes. Category + period logic from iter-57 untouched.

### Tests
- Full iter47→iter57 regression: **78/78 PASS** (no new backend changes required; the badge logic is purely client-side consuming the existing `vip_level`/`name_color` server fields).
- Lint clean across all touched screens.
- Live preview confirms correct level-coloured badges across the Global Ranking (gold for VIP 7, amber for VIP 3) with Top-3 luxury frames + rainbow names for VIP 7 and red names for VIP 3.

### Preserved
- Help ❓ and Info ⓘ icons untouched.
- No change to backend data contracts (`vip_level`, `name_color`).
- Agora, gifts, room settings, VIP maintenance (iter-55), ranking categories & periods, Me tab shortcuts — all unchanged.

## Iteration 59 — Premium armored Top-3 frames + full-text rainbow sweep (2026-10)

### 1. VIP name colors — full-text sweep
- `<VipName />` rewritten to measure the rendered text width via `onLayout`, size the gradient to 3× that width, and translate from `-width` to `+width` so **one full rainbow cycle covers every character** of any name length.
- Web keeps the CSS `background-clip:text` keyframe (iter-57) with `backgroundSize: 200%` and 2.8s linear animation.
- Native uses `MaskedView` + Reanimated. First render probes layout invisibly to establish width, then switches to the masked animated gradient — zero flicker.
- Behavior preserved: VIP 2-5 → static red, VIP 6-7 → animated rainbow. Server-authoritative (`name_color` from `vip_level`); users cannot select it.

### 2. VIP Badge
- Already shipped iter-58 (`<VipBadge level>`), level-colored, updates on refresh. Applied in Top-3 frames alongside the new design.

### 3. Top 1 / 2 / 3 — Premium Armored Frames
New reusable component `<PremiumPodiumFrame tier rank user amount ... />`:
- **Shield-shaped rank badge** on the far-left with the rank number + "TOPN" ribbon tail (SVG, metallic rim).
- **Imperial crown** rendered in SVG sitting on top of the avatar.
- **Laurel branches** flanking the avatar (left + right, mirrored).
- **Right-side decorative laurel** anchored mid-card for symmetry.
- **Avatar overlapping the frame 50% out / 50% in** with a double metallic ring + glow.
- **Full ornate rim** (double-stroke) + **animated metallic sheen band** sweeping across every ~3s.
- **GOLD / SILVER / BRONZE ribbon pill** anchored bottom-right.
- Full-card multi-stop gradient (4 stops) with soft top-edge highlight.
- Three distinct palettes:
  - Gold: `#F6C13F` rim + warm 4-stop gradient
  - Silver: `#D9DDE5` rim + cool 4-stop gradient
  - Bronze: `#D9823E` rim + warm earth 4-stop gradient
- Applied in both **Global Ranking** and **Room Ranking**. Avatar/crown/laurel/shield/sheen behave identically.

### 4. Preserved
- All ranking categories, period logic (daily=24h, weekly=168h, monthly=UTC calendar month, all=lifetime), real backend data, click-through navigation (`user`/`room`/`family` kind-aware), VIP maintenance (iter-55), VIP badge color system (iter-58), Help ❓ + Info ⓘ icons — all untouched.

### Tests
- Full iter47→iter57 backend regression: **78/78 PASS** (no backend changes needed for iter-59; purely presentational).
- Frontend lint clean across all 4 touched files + 2 new components.
- Live preview confirmed: ornate armored frames render for Top-3, GOLD/SILVER/BRONZE pills visible, VIP badge level-colored, rainbow sweep now covers full usernames at any width.

## Iteration 60 — Ranking layout fix (surgical) (2026-10)

### What broke in iter-59
- The horizontal `ScrollView` for Daily/Weekly/Monthly/All Time rendered as a wrapping/clipped strip on narrow screens.
- `PremiumPodiumFrame`'s avatar cluster + decorative laurels extended into the text column, covering the username/VIP badge/ID.
- Excess top padding before TOP 1 due to decorative margin stacking with the frame's crown offset.

### Fixes (iter-60)
- **Period tabs** → plain `View` with `flexDirection: "row"`, `flex: 1` chips, compact `paddingVertical: 7`, `paddingHorizontal: 10`. Four pills always fit on a single row without clipping, both Global Ranking and Room Ranking.
- **Metric tabs** (Contribution/Charm in Room Ranking) — now explicitly `flexDirection: "row"` with `flex: 1` + `minWidth: 0` so Android no longer wraps them vertically.
- **`PremiumPodiumFrame` rewritten** with a clean 3-zone layout:
  - **Zone A (left)** — 70-px avatar + crown anchored absolutely at `top: -AVATAR_D/2, left: 12`. Avatar remains **exactly 50% above / 50% inside** the card.
  - **Zone B (center)** — text column starts at `left: TEXT_LEFT (= 12+70+14 = 96 px)` and extends to `right: 102` so the username, flag, VIP badge, ID and gift count are fully readable with zero overlap.
  - **Zone C (right)** — diamond amount at `top: 12, right: 14` and `BRONZE/SILVER/GOLD` ribbon pill at `bottom: 10, right: 14`.
- **Full-card armored rim** (`StyleSheet.absoluteFillObject` borderWidth: 2 + inner rim borderWidth: 1) wraps the ENTIRE card with 22-px rounded corners.
- **Animated metallic sheen** (3s, Reanimated) + soft **pulsing rim shadow** (2.2s) give the premium luxury feel.
- Decorative laurel branches removed from the inside layout (they caused the overlap). Crown + metallic frame alone deliver the premium feel without pushing text out.
- `top3Wrap.paddingTop` reduced from 24 → 4 so TOP 1 sits right under the category chips.

### Preserved
- Backend contracts, categories, period logic (daily=24h, weekly=168h, monthly=UTC month, all=lifetime), navigation, VIP maintenance (iter-55), level-colored VipBadge (iter-58), VipName full-text rainbow (iter-59). No backend changes.

### Tests
- Backend iter47→iter57: **78/78 PASS**.
- Lint clean.
- Live preview confirms:
  - 4 period pills horizontally visible, no clipping
  - TOP 1 (GOLD), TOP 2 (SILVER), TOP 3 (BRONZE) full-card armored frames
  - Avatar overlapping 50/50 at top-left, crown on top, text clearly readable (الصمت · 🇾🇪 · VIP 7 · ID: 60131032 · 116244 gifts · 💎 601,951,460 · GOLD pill)
  - Positions 4+ render as standard premium rows
  - Rainbow usernames flow across full names of VIP 6-7 users
  - VIP badges render in each user's actual tier color

## Iteration 61 — Final ranking layout fix (surgical) (2026-10)

### 1. Category chips
- Wrapped the horizontal `ScrollView` in a parent `View` with an explicit `height: 52` + `catStripContent.alignItems: "center"`. Previously the ScrollView could collapse to the chip's padding on web/native, letting Top-3 cards overlap into its space. Now the strip is always a reliable 52-px band.
- Chips stabilized: `minHeight: 36`, `justifyContent: "center"`, `flexGrow: 0, flexShrink: 0`. Tapping a chip no longer causes its neighbors to shift.

### 2. Top 1 / 2 / 3
- Avatar is now **fully INSIDE** the card (vertically centered at `(CARD_H - AVATAR_D) / 2`). No 50% top-overlap, no external crown — the crown sits inside the card above the avatar.
- Card height compressed to `CARD_H = 96`, avatar `60-px`.
- Shield rank badge on the left, avatar in center-left, text column in the middle, diamond amount on the right. All elements fully readable, no overlap.
- Vertical gap between TOP 1/2/3 reduced to `10 px` + `paddingTop: 6`.
- GOLD / SILVER / BRONZE text pills removed — the frame color alone represents the tier.

### 3. Preserved
- Gold / Silver / Bronze gradient palettes retained (iter-57/59/60).
- Full armored rim (double stroke) + animated metallic sheen + pulsing shadow preserved.
- Period tabs flex-row from iter-60.
- Rainbow full-text VIP name sweep + level-colored VIP badge (iter-57/58/59).
- All backend data, categories, period logic, navigation unchanged.

### Verified
- Backend iter47→iter57 regression: **78/78 PASS** (no backend changes for iter-61).
- Lint clean (two unused-import warnings in global-ranking.tsx remained; dead-code only, not blocking — can be swept later).
- Live preview confirms: category strip renders fully, 4 period pills, 3 compact armored Top cards (gold/silver/bronze) with avatar inside, 50+ standard rows below. Rainbow usernames + level-colored VIP badges intact.

## Iter-62 — Surgical UI: Laurel Medals + Charm + UTC Timer + V Badge

### Scope
1. Replace rank numbers 1/2/3 in Top 1 / Top 2 / Top 3 with elegant metallic circular medals wrapped in a laurel wreath (gold / silver / bronze).
2. Add "Charm" category directly beside "Wealth" in Global Ranking (horizontally scrollable, all tabs independently clickable).
3. Live UTC reset countdown timer in Global & Room Ranking screens, placed opposite the period tabs. Resets:
   - daily → next UTC 00:00
   - weekly → next Monday 00:00 UTC
   - monthly → first day of next UTC month
   - all → no timer
4. Server-authoritative "V" badge system (never a crown): compact stylized V + tier number, each VIP level 1–7 has its own premium gradient color pulled from `OrioVipEmblem.tierFor()`. Applied everywhere a user's VIP shows: profiles, room user cards, chat, global ranking, room ranking, posts, search, visitors, wallet, Me.

### Files
- NEW: `/app/frontend/src/components/RankMedalBadge.tsx` (metallic SVG laurel medal with centered rank)
- NEW: `/app/frontend/src/components/UtcResetTimer.tsx` (live countdown; `setInterval` 1 s)
- UPDATED: `/app/frontend/src/components/VipBadge.tsx` (now renders mini SVG "V" + level, tier-gradient)
- UPDATED: `/app/frontend/src/components/PremiumPodiumFrame.tsx` (RankShield→RankMedalBadge; removed Crown)
- UPDATED: `/app/frontend/app/global-ranking.tsx` (added "charm" category, timer in header)
- UPDATED: `/app/frontend/app/room-ranking.tsx` (timer in header)
- UPDATED: `/app/frontend/app/room/[id].tsx` (seat star→tier V badge)

### Verified
- Lint clean on all touched files.
- Live preview on Global Ranking confirms:
  - Top 1/2/3 cards show metallic circular medals with laurel wreath (gold/silver/bronze) exactly matching the reference image.
  - Category chips: All · Wealth · Charm · CP · Friends · … horizontally scrollable.
  - Daily period shows live "23:12:55" UTC countdown in opposite corner.
  - V badges render tier colors (V 7 champagne gold, V 3 gold, etc.) with real `vip_level` from backend.
- No backend changes; existing APIs (`/rankings/v2/charm`, `/rankings/global`) unchanged.

## Iter-63 — Surgical UI: Avatar overlap + Restore V badge

### Scope
1. Room User Profile Card avatar now overlaps the card exactly 50% outside / 50% inside the top edge, centered horizontally.
2. VIP badge restored to a clean premium stylized "V" emblem (no "VIP 7" / "V 7" text pill). Server-authoritative; color per tier:
   - VIP 1 Emerald · VIP 2 Sky Blue · VIP 3 Amber · VIP 4 Violet · VIP 5 Red · VIP 6 Cobalt · VIP 7 Imperial Gold

### Files
- UPDATED: `/app/frontend/src/room/RoomUserCard.tsx` — switched avatar from margin-trick to absolute `top:-44` + half-width `marginLeft`, added `bodyScroll` top margin so content clears the avatar's inside half.
- UPDATED: `/app/frontend/src/components/VipBadge.tsx` — rewritten as a pure SVG V emblem with tier gradient + tiny level corner dot. No pill, no "VIP"/"V" text next to the shape.

### Verified
- Live preview on `/room/{id}` → tapping a seat opens RoomUserCard with avatar centered horizontally, visibly straddling the top edge of the card.
- Live preview on `/global-ranking` → V badges render per tier color across all rows; rank 1/2/3 cards unchanged.
- Lint clean. No backend changes; `vip_level` read via existing endpoints (`/api/auth/me`, `/api/users/{id}`, etc.).

## Iter-64 — V Design, GP Rate, VIP1/2 Maintenance, Wallet Agent, Back Arrow

### Scope (surgical, zero refactor)
1. **VipBadge** redesigned to a single premium metallic "V" + the user's real `vip_level` number directly underneath. No pill, no crown, no circle, no laurel, no stars, no frame, no decoration beside or behind the V. Animation lives **inside** the V (SVG sheen clipped to the V path + static highlight stripes). Tier colors: 1 Emerald · 2 Sky Blue · 3 Amber · 4 Violet · 5 Red · 6 Cobalt Blue · 7 Imperial Gold. Driven by server-authoritative `vip_level`.
2. **Growth Point rate**:
   - Recharge → 1 Diamond = 1 Growth Point (unchanged)
   - **Exchange** → 1 Diamond = 2 Growth Points (NEW rate on `/api/vip/convert`)
3. **VIP1/VIP2 maintenance** (hidden from public UI):
   - VIP1 → requires ≥ 50_000 Diamonds recharged during the 30-day cycle
   - VIP2 → requires ≥ 250_000 Diamonds recharged during the 30-day cycle
   - VIP3..7 → unchanged (growth-point thresholds)
   - Failure cascade: VIP7→6→5→4→3→2→1→0 (VIP1 fail = expired)
4. **VIP Guide** — section order preserved: VIP Rules → VIP Values → Growth Point Rule. "Growth Point Rule" now clearly explains both Recharge (1:1) and Exchange (1:2) with examples, plus the footnote that 2× applies only to exchange.
5. **Wallet** — added **Agent** tab between Recharge and History that routes to the existing `/recharge-agent` screen. Added a RTL/LTR-aware back arrow in the opposite corner of the title.

### Server-authority preserved
- VIP level, GP, VIP badge color, maintenance cycle, downgrade, and recharge totals are 100% backend-driven.
- All GP writes are atomic (`find_one_and_update $inc`), persisted to `growth_ledger` with the real `tx_id`, and the maintenance scan is read-mostly (idempotent on repeat `/vip/progress` fetches).
- Public `/vip/maintenance` response still shows VIP1/2 thresholds as 0 so the hidden Diamond-recharge requirement is not exposed.

### Files
- **Backend**
  - `/app/backend/server.py`:
    - `/vip/convert` → mints `amount * 2` growth points, logs correct `growth_points_awarded` and ledger.
    - `_vip_maintenance_cycle` → VIP1/2 now check Diamond-recharge sum from `growth_ledger` since cycle start; otherwise falls back to GP check.
    - Added `VIP_RECHARGE_MAINTENANCE` map and `_diamonds_recharged_in_cycle` helper.
- **Frontend**
  - `/app/frontend/src/components/VipBadge.tsx` → clean V-only SVG + animated internal sheen.
  - `/app/frontend/app/vip-guide.tsx` → dual-rate Growth Point Rule card; preview + rate text updated to 2×.
  - `/app/frontend/app/(tabs)/wallet.tsx` → RTL/LTR back arrow + Agent tab wired to `/recharge-agent`.
- **Tests**
  - NEW `/app/backend/tests/test_iter64_growth_points_and_recharge_maint.py` (9 tests): rate assertions, maintenance scenarios, hidden-threshold assertion, idempotent progress.
  - UPDATED `/app/backend/tests/test_iter55_vip_maintenance_and_global_ranking.py` to reflect new VIP1/2 recharge-maintenance rules.

### Verified
- 53/53 backend tests pass (iter52, 53, 55, 56, 57, 64).
- Lint clean on all touched frontend files.
- Live preview: Wallet (back arrow + Agent tab → real `/recharge-agent`), Global Ranking (V badges per tier), VIP Guide (both rules shown). Backend `curl /vip/convert amount=100` returned `growth_points_awarded: 200`.

## Iter-65 — ORIO Splash + In-App Orb Banner

### Scope
1. **Splash screen** (`app/index.tsx`): purple → black backdrop, twin glowing watery intertwined "O" rings at the top, original ORIO logo centered, "Orio" wordmark + "Voice chat, Party & New Friends" tagline below. Auto-dismisses once `useAuth()` finishes bootstrap and expo-router routes to Login/Home.
2. **In-app compact banner**: same twin-orb visual placed below top controls / tabs and above the page content on:
   - Party Rooms — below the Recommended / PK / Music / Chat tab bar, above the "All Countries" selector.
   - Posts — below the Posts title and compose button, above the post list.
   - Messages — below the Messages title and add-friend button, above the thread list.
   - Me — below the profile summary + shortcut row, above the menu grid.
3. No wordmark / tagline in the in-app banners (per spec), no large splash logo.

### Files
- NEW `/app/frontend/src/components/OrioOrbs.tsx` — pure react-native-svg component (no bitmap assets). Renders twin interlocked tori with magenta → violet → cyan gradient, soft neon halo, ground glow, and glossy specular highlights. Two variants: `hero` (splash) and `banner` (in-app).
- UPDATED `/app/frontend/app/index.tsx` — splash composition with `OrioOrbs variant="hero"`, logo, wordmark, tagline, bootstrap loader.
- UPDATED `/app/frontend/app/(tabs)/home.tsx` + `posts.tsx` + `messages.tsx` + `me.tsx` — compact `OrioOrbs variant="banner"` inserted at the exact spec locations.

### Verified
- Lint clean across all touched files.
- Live preview captures:
  - Splash — twin orbs, logo, "Orio" wordmark, tagline, purple/black gradient.
  - Party Rooms, Posts, Messages, Me — compact orb banner below the top controls and above the content list; no wordmark; unchanged existing functionality.
- No backend changes; VIP/wallet/ranking logic untouched.

## Iter-66 — Remove Orb Banner, Keep Soft Purple Top Glow Only

### Scope
Remove the ORIO twin-ring / orb banner from Party Rooms, Posts, Messages, Me, and the Splash. Replace it with a single subtle premium purple glow across the top edge of every screen that fades smoothly into the dark/black background. No logo, rings, icons, or decorative objects inside the glow.

### Files
- NEW `/app/frontend/src/components/TopPurpleGlow.tsx` — `position:absolute`, `pointerEvents="none"`, 160dp (220 on splash) vertical gradient from violet → transparent. Doesn't reserve layout space.
- UPDATED `/app/frontend/app/index.tsx` — splash now shows `TopPurpleGlow` + logo + "Orio" wordmark + tagline (no orbs).
- UPDATED `/app/frontend/app/(tabs)/home.tsx` + `posts.tsx` + `messages.tsx` + `me.tsx`:
  - Removed `OrioOrbs` import, JSX, and `orbBanner` style — no reserved space.
  - Added `TopPurpleGlow` once at the container root of each screen.
- RETIRED `/app/frontend/src/components/OrioOrbs.tsx` → renamed to `_removed_OrioOrbs.tsx.bak` (not shipped). Zero in-app references remain.

### Verified
- Lint clean across all touched files.
- Live screenshots: splash, Party Rooms, Posts, Messages, Me all show soft purple top glow fading into dark background with no decorative graphics; existing layouts, tabs, buttons, and content unchanged.
- No backend changes.

## Iter-67 — Create Room Redesign + Owner-Only Cover Editor + Moderation

### Scope
1. **Start a Room gating**: hide the "Start a Room" CTA on Party Rooms (empty-state) for users who already own a live room.
2. **Create Room screen** fully redesigned:
   - Big circular avatar picker (ImagePicker). Routed through `/api/room-covers/moderate` BEFORE accepting the local pick so blocked images never make it onto the form.
   - Room Name (3+ chars required).
   - User Notice (auto-mentions the entering user — `@user` / `@username` placeholders are swapped server-side with the live joiner handle).
   - Room Notice (persisted as the room's public notice/description, broadcast as owner-posted welcome).
   - Mic Capacity cards: 8 / 15 / 20 (single-select, purple when active).
   - CTA renamed "Create Room" → "Confirm". Stays dimmed/disabled until all required fields are populated, then turns premium purple with glow.
3. **Inappropriate image → 3-day block**: Pre-flight moderation checks data URI size + a global admin-populated hash blocklist. Fails → records a per-user `room_image_blocks` row with `blocked_until = now + 3d` and returns HTTP 403 with hours remaining. Retries with the same image fail until expiry.
4. **In-room owner tap → Centered Avatar Editor**: Owner tapping the room name opens a centered `RoomAvatarEditorModal` with the big current cover, "pick new photo" (moderated), Save / Cancel. Save calls `PATCH /api/rooms/{id}/cover`, server broadcasts `room_state` so every client refreshes immediately. Owner identity (owner_id) is preserved.
5. All changes are real/persistent; the owner's cover updates propagate through `_broadcast_room_state` and react-query cache invalidation (`rooms`, `rooms-mine`, `rooms-mine-gate`, `room:{id}`).

### Files
- **Backend** (`/app/backend/server.py`):
  - Added `VIP_RECHARGE_MAINTENANCE` (iter-64) and now `_ROOM_COVER_BLOCK_DAYS`, `_hash_image_url`, `_is_cover_blocked_for_user`, `_moderate_cover_image`, `_ensure_cover_allowed`.
  - New routes: `POST /api/room-covers/moderate`, `PATCH /api/rooms/{room_id}/cover`.
  - `create_room` now runs cover through `_ensure_cover_allowed` before accepting.
  - Welcome broadcast replaces `@user` / `@username` with the live joiner's handle (case-insensitive).
- **Frontend**:
  - `/app/frontend/src/api.ts` — `apiModerateRoomCover`, `apiUpdateRoomCover`.
  - `/app/frontend/app/create-room.tsx` — full new design (avatar / Name / User Notice / Room Notice / Mic / Confirm).
  - `/app/frontend/app/(tabs)/home.tsx` — `rooms-mine-gate` query + hide "Start a Room" when the user already owns one.
  - `/app/frontend/app/room/[id].tsx` — tap room name as owner opens `RoomAvatarEditorModal`; long-press keeps the Room Info route.
- **Tests**: NEW `tests/test_iter67_room_cover_moderation.py` (4 tests). All existing tests still green (iter52-57 + iter64 + iter67 = 28/28 pass).

### Verified
- Lint clean on all touched frontend files.
- Live preview: Create Room renders the new form (avatar + 3 inputs + 8/15/20 cards + dimmed Confirm until valid).
- `curl` verified moderation (`403 blocked for 72 hours`), owner-only `PATCH cover` (403 for non-owner, 200 for owner), successful retry with valid URL.

## Iter-68 — Restore Full Room Settings + Room Avatar Section At The Top

### Scope
- Owner tapping the room name while inside the room opens the full existing Room Info / Settings screen (`/room/{id}/info`) — the standalone avatar modal is gone.
- At the TOP of the owner-only settings area a new **"Room Avatar"** section is added:
   • Large 140dp circular avatar showing the current cover.
   • Tap → ImagePicker → `/api/room-covers/moderate` (existing 3-day block preserved) → `/api/rooms/{id}/cover` → broadcasts `room_state`.
   • React-query caches invalidated (`room`, `rooms`, `rooms-mine`, `rooms-mine-gate`) so avatars refresh everywhere immediately.
- Every other setting (Delete Room, Room Notice, Welcome Message, Password, Members, Moderators, Banned Users, Membership Requests, Share) remains intact and unchanged.

### Files
- `/app/frontend/app/room/[id].tsx` — tap room name now routes to the Room Info screen (removed the standalone modal state + render).
- `/app/frontend/app/room/[id]/info.tsx` — new `RoomAvatarSection` component rendered as the first owner-only block; imports `apiModerateRoomCover`, `apiUpdateRoomCover`, `expo-image-picker`.

### Verified
- Lint clean.
- Live preview on `/room/{id}/info`: top header + cover unchanged, identity (name + owner + online count) unchanged, then **Room Avatar** section with large circular image + camera overlay + hint, then original **Room Settings** card with Delete Room, Room Notice, Welcome Message, etc.
- Backend endpoints untouched; existing iter-67 moderation + 3-day block list still used.

## Iter-69 — Change-Photo Chooser + VIP5 GIF + 3-day Media Block

### Scope
- Shared `ChangePhotoChooser` component shows exactly 2 options:
  1. **Change Profile Photo** — images only (no videos / no GIFs).
  2. **Change Profile GIF** — GIF only. VIP5+ required.
- Below VIP5, tapping "Change Profile GIF" shows the Arabic/English upsell:
  "Please upgrade to VIP5 to change your GIF profile picture." + "Go to VIP5 Upgrade" CTA → routes to `/vip`.
- Both Profile Avatar (Edit Profile) and Room Avatar (Room Info → Room Avatar section) use the chooser.
- 3-day user-wide media block is enforced by the server (`users.media_blocked_until`). Any moderation rejection trips the block for the uploader across BOTH profile avatars/GIFs AND room avatars.
- When a user tries to change their photo/GIF while blocked, the client shows the exact Arabic modal:
  `لقد قمت برفع صور مسيئة للمجتمع وتم حظرك من رفع صوره/gif لمدة ٣ ايام`
  with a single `فهمت` button that closes the modal.
- Block survives refresh/logout/device change — fetched via `GET /api/me/media-block` and rechecked on every moderation/update call.

### Files
- Backend (`/app/backend/server.py`):
  - `_is_user_media_blocked`, `_apply_user_media_block`, `_looks_like_gif`.
  - `_ensure_cover_allowed` now triggers user-wide block on moderation failure and short-circuits with `USER_MEDIA_BLOCKED`.
  - New endpoints: `GET /api/me/media-block`, `POST /api/me/profile-avatar/moderate`, `PATCH /api/me/profile-avatar`.
  - `PATCH /api/rooms/{id}/cover` and the room create path both enforce VIP5 gate for GIFs and share the user block.
- Frontend:
  - `/app/frontend/src/components/ChangePhotoChooser.tsx` (shared chooser + VIP5 upsell + Arabic 3-day block modal).
  - `/app/frontend/src/api.ts` (`apiMediaBlockStatus`, `apiModerateProfileAvatar`, `apiUpdateProfileAvatar`).
  - `/app/frontend/app/edit-profile.tsx` → uses `ChangePhotoChooser`; dropped legacy two-option modal and `apiSetProfileMedia`.
  - `/app/frontend/app/room/[id]/info.tsx` → `RoomAvatarSection` uses the chooser; same moderation + block flow.

### Verified
- Lint clean on all touched files.
- Live preview confirmed on `/edit-profile` → tap avatar opens the exact 2-option chooser (Images only / GIF VIP5+).
- Backend regression: 25/25 pass (iter52, 64, 67, 69).
- `curl` verified photo accept, GIF VIP5 gate, user-wide block propagation across both profile + room endpoints.

## Iter-70 — Clean GIFs + Defer Save + Remove Gender

### Scope
1. **Functional file pickers**:
   - "Change Photo" uses `ImagePicker.launchImageLibraryAsync({mediaTypes:["images"]})` and REJECTS GIFs/videos after pick (`__NOT_PHOTO__` sentinel).
   - "Change GIF" uses `DocumentPicker.getDocumentAsync({type:["image/gif"]})` for GIF-only system file picker; non-GIF picks return `__NOT_GIF__` so the caller can surface an inline error.
2. **VIP5 enforcement**: already server-side (`GIF_VIP5_REQUIRED`); clients also pre-check `user.vip_level < 5` to show the "Please upgrade to VIP5…" upsell before launching the picker.
3. **Legacy GIF cleanup**: one-time Mongo migration on startup unsets `animated_avatar_url` for every user with `vip_level < 5`. Static avatars preserved. Run log confirms count. Public `public_user()` additionally hides any dangling `animated_avatar_url` at render time for sub-VIP5 users as a defensive measure.
4. **Deferred Save (Profile + Room Avatar)**:
   - Edit Profile: picking a new avatar/GIF sets a `avatarPending` state and local preview only. Save mutation now runs moderation + patch atomically — nothing persists until Save is tapped. If moderation rejects, no partial writes occurred.
   - Room Avatar section: picking shows local preview + Cancel / Save buttons. Save runs moderation + PATCH `/rooms/{id}/cover` + cache invalidation. Cancel discards the local change.
5. **Remove Gender from Edit Profile**: deleted the entire gender FieldRow + styles + state + rehydrate line. No Male/Female icons anywhere on the Edit Profile screen.

### Files
- Backend (`/app/backend/server.py`):
  - `public_user()` masks `animated_avatar_url` when `vip_level < 5`.
  - Startup hook: one-time `UPDATE_MANY { animated_avatar_url set, vip<5 } → unset`.
- Frontend:
  - `/app/frontend/src/components/ChangePhotoChooser.tsx` — GIF path uses DocumentPicker with mime filter; photo path rejects GIFs/videos after pick.
  - `/app/frontend/app/edit-profile.tsx` — avatar pick is now deferred; Save button moderates + patches in one atomic mutation; gender section removed; unused imports cleaned.
  - `/app/frontend/app/room/[id]/info.tsx` — `RoomAvatarSection` keeps a local pending preview + explicit Save / Cancel buttons; moderation runs on Save only.

### Verified
- Lint clean on all touched files.
- Backend startup log: "Iter-70: cleared 15 GIF avatars from sub-VIP5 users".
- Full regression: 28/28 pass (iter52, 64, 67, 69 updated, new iter70).
- Live preview on `/edit-profile`: no Male/Female icons; Save button present; avatar picker uses the new chooser.

## Iter-71 — GIF Limits, Age 18-99, All Countries, 25-Mic, Clean Seats

### Scope
1. **GIF limits** (enforced on BOTH client and server):
   - 5 MB max file size (client checks pre-upload; server re-validates via Pillow).
   - 512 × 512 px max dimensions (server, Pillow).
   - 60 frames max (server, Pillow `ImageSequence`).
   - 5 s max duration (server, sum of `frame.info['duration']`).
   - GIF-only MIME: `DocumentPicker` with `type: ["image/gif"]`; server also calls `_looks_like_gif` to short-circuit.
   - **Rejections return HTTP 400 with a clear reason; do NOT trigger the 3-day block.**
2. **Age 18–99**: new-user profile completion enforces 2-digit numeric string `/^\d{2}$/`, server `age: Field(ge=18, le=99)` on `CompleteProfileIn` + `RegisterIn`.
3. **All countries + Unknown 🌎**: `/api/countries` now returns 174 rows: `XX / 🌎 / Unknown` sentinel first, then every ISO country alphabetically with correct flag + Arabic name.
4. **Chooser labels (exact Arabic text per spec)**:
   - `تغيير الصورة الشخصية` → Change Profile Photo (images only).
   - `تغيير صورة متحركة/Gif` → Change Profile GIF (GIF only).
5. **Clean mic avatars**: VIP badges, crowns, labels, overlays all removed from in-room seat avatars. Only the user's photo + name show.
6. **25-Mic rooms**: `num_seats ∈ {8, 15, 20, 25}` accepted by `/api/rooms`, enforced by Pydantic `le=25` on every seat index, join/leave/move/PK/host_move paths.
7. **Responsive seat sizing**: `computeSeatMetrics` now computes seat diameter from available width ÷ max-per-row, clamped to `[42, 60]` dp. Host is proportional. 8/15/20/25 mic layouts all fit cleanly on 360 dp phones with no overlap.
8. **Profile Edit gender section removed** (iter-70) remains clean.

### Files
- Backend `/app/backend/server.py`:
  - `_validate_gif_limits`, `_moderate_cover_image`, `_ensure_cover_allowed` split moderation vs. GIF-size failures (400 vs 403).
  - `CompleteProfileIn.age` 18-99; gender optional for backward compat.
  - `RegisterIn.age` ge=18.
  - Full 174-row `COUNTRIES` list with `Unknown 🌎` sentinel.
  - All seat Pydantic fields bumped to `le=25`; create_room accepts `num_seats in (8, 15, 20, 25)`.
- Frontend:
  - `src/components/ChangePhotoChooser.tsx` — Arabic labels, `DocumentPicker` for GIFs, client-side 5 MB cap (`__GIF_TOO_LARGE__` sentinel).
  - `app/create-room.tsx` — adds the 25 + Host card to SEAT_OPTIONS.
  - `app/room/[id].tsx` — `computeSeatMetrics` is now responsive; VIP overlay removed from seat avatars.
  - `app/edit-profile.tsx` + `app/room/[id]/info.tsx` — handle the `__GIF_TOO_LARGE__` and `__NOT_PHOTO__` sentinels with clear validation copy.
  - `app/profile-completion.tsx` — gender removed, age 18-99 placeholder, canSubmit updated.

### Verified
- Lint clean on all touched frontend files.
- Backend regression: 34/34 pass (iter52, 64, 67, 69, 70, new iter71 with 6 new tests covering: tiny valid GIF accepted, 6 MB GIF rejected with clear message + no block, 25-mic room creation, invalid seat count rejected, full world + Unknown 🌎 in countries, age <18 rejected on completion).

---

## Iter-72 — Surgical fixes: byte-level GIF rejection + 25-mic layout patch

### Spec
Requested by user as "surgical only" fixes before next big feature work:

1. **25 + Host must be a real, functional layout** — the room-settings
   `PATCH /rooms/{id}/layout` endpoint still rejected `num_seats=25`
   even though `/api/rooms` creation accepted it.
2. **"تغيير الصورة الشخصية" must show static photos ONLY** — not just
   relying on MIME/extension. GIFs that lie about their MIME must be
   rejected both client-side (byte header peek on the base64) and
   server-side (byte-magic detection in `_looks_like_gif`).

### Changes
1. **Backend `/app/backend/server.py`**
   - `ALLOWED_LAYOUTS = {8, 15, 20}` → `{8, 15, 20, 25}` (room re-layout).
   - `_looks_like_gif(url)` now decodes the first ~24 bytes of any
     `data:*;base64,` payload and matches the ASCII GIF magic
     signatures `GIF87a` / `GIF89a`. Catches `data:image/jpeg;base64,R0lGOD…`.
2. **Frontend `/app/frontend/src/api.ts`**
   - `apiChangeLayout` typed arg now `8 | 15 | 20 | 25`.
3. **Frontend `/app/frontend/src/components/ChangePhotoChooser.tsx`**
   - `pickPhoto` now peeks at the first 16 base64 chars and rejects any
     file whose base64 starts with the GIF magic prefix `R0lGOD`, even
     if the gallery returned a `.jpg`/`image/jpeg`.
4. **Frontend `/app/frontend/app/create-room.tsx`**
   - `SEAT_OPTIONS` subtitle now shows `+ Host` under the 25 card and
     `mic` under 8/15/20, driven by `opt.sub` (no hardcoded "mic").

### Verified
- `tests/test_iter72_byte_level_gif_and_25mic_layout.py` — 3/3 pass:
  - Photo endpoint rejects lying `image/jpeg` MIME when payload is GIF.
  - Photo endpoint accepts a legitimate 3 kB PNG (no false positive).
  - `PATCH /rooms/{id}/layout` accepts `num_seats=25` and returns 26 slots.
- Full regression suite 30/30 pass (iter64 + 67 + 69 + 70 + 71 + 72).
- Lint clean on all touched frontend files.

---

## Iter-73 — Room Tools: Mic Mode relocation, Background picker, text-only Host owner block

### Spec (user, verbatim)
1. Add a new room layout "25 + Host" (host dedicated chair + 25 mic seats).
2. Mic seats must be responsive — more seats = smaller tiles, fewer seats = bigger.
3. Move "Mic Mode" from Room Controls → Room Tools (fully remove from Controls).
4. Remove "Minimize" from Room Tools (keep only in Room Controls).
5. New Room Tools option "الخلفية" (Background) with 20+ ready-made premium
   backgrounds (cars, lions, tigers, falcons, flowers, houses, luxury …).
   Selection must apply to the room in real time.
6. Remove the big room-owner avatar from the highlighted host area;
   display only the owner's name + owner ID beneath it.
7. No unrelated UI changes.

### Backend
- `/app/backend/server.py`
  - **New curated catalog** `PREMIUM_ROOM_BACKGROUNDS` with 25 vetted Unsplash URLs
    covering 7 categories (cars, animals, flowers, houses, luxury, space, nature).
  - **New endpoints:**
    - `GET /rooms/backgrounds/catalog` → `{backgrounds: PremiumRoomBackground[]}`.
    - `POST /rooms/{room_id}/background/preset` body `{bg_id}` or `{image_url}` →
      owner-only, sets `rooms.background_url` and `rooms.background_preset_id`,
      broadcasts WS state update. Unknown bg_id/url → 400 (prevents custom-moderation bypass).
  - **owner_public enriched** with `username` + `numeric_id` on room creation.
  - **Startup backfill** (Iter-73): updates existing rooms whose owner_public
    lacks `numeric_id` from the matching user doc; idempotent and logged.

### Frontend
- `/app/frontend/src/api.ts`
  - `apiRoomBackgroundsCatalog()` + `apiSetRoomBackgroundPreset(id, bg_id)`.
  - `PremiumRoomBackground` type exported.
- `/app/frontend/app/room/[id].tsx`
  - **Blurred background** now sources `room.background_url || room.cover_url`.
  - **Host owner block** replaces the large host-avatar `SeatBubble` with a
    text-only highlight: `HOST` gold badge, owner nickname (bold), and
    `ID: <numeric_id>` directly beneath. Tappable → opens the owner card.
  - **Room Controls (`RoomMenu`)** — removed the `Mic Mode` button entirely.
  - **Room Tools (`BottomMoreSheet`)** — removed `Minimize`; added `Mic Mode`
    and `الخلفية / Background` (owner/mod-gated). New props `onMicMode`,
    `onBackground`, `isOwnerOrMod` wired through from the room screen.
  - **LayoutPicker** now exposes `25 — Mega` as a fourth option.
  - **`layoutMut`** typed `8|15|20|25`; closes the sheet on success.
  - **New `RoomBackgroundPicker` modal** — fetches the catalog via React Query,
    renders a 2-column grid of 16:10 tiles with Arabic/English labels, gold
    checkmark on the current pick, inline busy spinner during apply, and
    graceful error row. Owner-only (sheet is already gated via Room Tools).

### Verified
- `tests/test_iter73_backgrounds_owner_id.py` — 5/5 pass:
  - Catalog ≥ 20 items with required categories (cars, animals, flowers,
    houses, luxury) + mandatory shape (id / Arabic / English / URL).
  - Owner applies a preset → `rooms.background_url` reflects it immediately.
  - Non-owner → 403.
  - Unknown bg_id or arbitrary URL → 400 (moderation-bypass guard).
  - `owner_public` now includes `numeric_id` and `username` for the host block.
- Full regression 35/35 pass (iter64 + 67 + 69 + 70 + 71 + 72 + 73).
- Lint clean on all touched frontend files.

---

## Iter-74 — Mic Area 50% cap, Custom BG at 50k with pre-moderation, clickable owner card

### Spec (user, verbatim)
1. MIC AREA
   - Restore independent Host mic to its original position above the main mic grid.
   - 25 mic seats below the Host.
   - Mic sizes must dynamically adjust (more = smaller, fewer = larger).
   - Entire Mic Area stays within the upper ~50 % of the screen, never overflows.
   - Lower ~50 % reserved for the chat/content area.
2. ROOM BACKGROUNDS — add a blank "+ Custom Image" tile in the picker.
   - Custom image selection costs 50 000 Diamonds.
   - Images require moderation within 24 hours.
   - NSFW / inappropriate images rejected immediately and never displayed.
   - Approved backgrounds apply ONLY to that room, behind all elements.
3. ROOM OWNER PROFILE (Room Settings) — directly below the room name, beside Member,
   show a smaller circular avatar linked to the owner's account. Nickname + 8-digit ID.
   Clickable → owner's user card/profile.

### Backend
- `/app/backend/server.py`
  - `ROOM_BACKGROUND_COST` raised from 5 000 → **50 000** diamonds.
  - `_submit_room_background` now runs `_moderate_cover_image` BEFORE deducting
    diamonds. On reject: no persist, no deduction, triggers the standard 3-day
    user media block to deter repeat offenders.
  - `_RoomBgSubmitIn.image_url` max_length lifted from 800 → 8 M chars so real
    data URIs (base64 PNG/JPEG) actually fit.
  - Admin approval path now sets `background_url` (NOT `cover_url`), so the
    approved backdrop applies only to that room and the cover is untouched.

### Frontend
- `/app/frontend/src/api.ts`
  - `apiSubmitCustomRoomBackground(id, image_url)` helper.
  - `ROOM_BG_CUSTOM_COST = 50_000` exported.
- `/app/frontend/app/room/[id].tsx`
  - `computeSeatMetrics` now takes `screenH` and picks `seatSize = min(byW, byH)`
    so the Host chair + N mic rows always fit inside **50 % of the screen height**
    (floor 36 dp, cap 60 dp). More seats → smaller, fewer → larger — automatic.
  - Mic area wrapped in a hard-capped `<View style={{ maxHeight: screenH * 0.5 }}>`,
    chat ScrollView retains `flex: 1` → chat always gets the lower half.
  - Host SeatBubble **restored** at its original place above the mic grid; the
    text-only owner block introduced in Iter-73 is removed.
  - RoomBackgroundPicker gains a leading dashed-gold `+ Custom Image` tile
    (price label `50,000 💎`). Tapping it shows a confirmation Alert
    (bilingual), launches `expo-image-picker` (static images only — same
    GIF-byte sniff from Iter-72), and POSTs the data URI to the submission
    endpoint. On success → bilingual toast "Will be reviewed within 24 hours".
- `/app/frontend/app/room/[id]/info.tsx`
  - Owner block (avatar + nickname + ID + members count) is now wrapped in a
    single `<Pressable>` that routes to `/user/{owner.id}`. Avatar size reduced
    72 dp → **44 dp** (smaller) with a 22 dp half-overlap, matching the spec's
    "smaller circular avatar". The inner ID row still owns its own tap target
    for copy-to-clipboard.

### Verified
- `tests/test_iter74_custom_background.py` — 5/5 pass:
  - Cost = 50 000 diamonds deducted on accept.
  - Insufficient diamonds → 402, nothing deducted.
  - Inappropriate (tiny/corrupted) image → 400, no diamond deduction, no row.
  - Pending submission does NOT set `background_url`.
  - Admin approval sets `background_url` (NOT `cover_url`).
- Full regression 40/40 pass (iter64 + 67 + 69 + 70 + 71 + 72 + 73 + 74).
- Lint clean on all touched frontend files.

---

## Iter-75 — Strict mic grid, portrait BG previews, live owner_public sync

### Spec (user, verbatim)
- Rebuild the 20/25-seat mic grid; strict 50 % screen cap, never overlap chat.
- Host mic stays above the 25-seat grid.
- Chat area always usable at 20/25 seats, no overlap.
- Room Settings — owner avatar/profile block slightly lower under the room
  name, syncing in real-time with the owner's account (photo + nickname + 8-digit ID).
- Background picker previews must be portrait/vertical and apply **sharp**
  (not blurred) **only inside the current room** (never app-wide).
- Add an ORIO-branded default background option.
- Uploaded custom image becomes the user's custom bg; owner can switch
  between it and the preset backgrounds.

### Backend
- `/app/backend/server.py`
  - **ORIO Default** prepended to `PREMIUM_ROOM_BACKGROUNDS` as
    `id="orio_default"` (new "orio" category).
  - **Admin approve** now sets BOTH `background_url` AND
    `custom_background_url` on the room (and `background_preset_id="my_custom"`)
    so the owner can switch back to their custom image later.
  - **Preset endpoint** gains a `bg_id="my_custom"` branch: looks up
    `rooms.custom_background_url` and reapplies it; 400 if nothing on file.
  - `public_room` exposes `custom_background_url` and `background_preset_id`.
  - **owner_public live-sync (Iter-75):** both `PATCH /users/me` and
    `PATCH /users/me/profile-media` now `update_many()` every room where
    `owner_id` matches to patch `owner_public.{nickname|avatar_url|username}`.
    Rooms always show the owner's current profile without re-creation.

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - **Mic grid math (Iter-75):**
    - Capacity-aware row structures preserved (4×2, 5×3, 5×4, 5×5).
    - `seatSize = min(fitByWidth, fitByHeight)`, floored to **≥ 32 dp**
      (still tappable), capped at **≤ 60 dp**.
    - Vertical budget = `screenH * 0.5 - 110` (header reserve).
    - Accounts for real pixel overhead: host-row 1.35× seat + 8 dp gap,
      `(rows-1) × 6 dp` row-gaps, 4 dp bottom pad.
    - On 390×844 phone, 25-mic grid now computes seat ≈ 43 dp, host ≈ 58 dp,
      total mic area ~313 dp — well inside the 422 dp (50 %) cap.
    - `seatsRow` gap tightened (16 → 8), host chair bottom margin (16 → 8).
  - **Backdrop (Iter-75):** When `background_preset_id` is set, render the
    chosen `background_url` **SHARP** (`contentFit: cover`, no blur). When
    no preset is active, fall back to the cover with the original blur
    treatment. Both renders are strictly scoped to the room screen via
    `StyleSheet.absoluteFill` inside the room `<View>` — never touches the
    app-wide background.
  - **RoomBackgroundPicker (Iter-75):**
    - Tile `aspectRatio` flipped **16:10 → 9:16** so previews match the
      vertical phone orientation the backdrop renders in.
    - New "My Custom" tile appears right after the "+ Custom Image" tile
      whenever `room.custom_background_url` is populated. Tap → calls
      `/rooms/{id}/background/preset` with `bg_id="my_custom"` and swaps
      the active bg back instantly.
    - Picker now takes `currentPresetId` + `customUrl` props and shows the
      gold checkmark on the actively-applied preset (ORIO default, car,
      lion, my_custom, …).
- `/app/frontend/app/room/[id]/info.tsx`
  - Owner avatar block pushed **slightly lower** under the room name:
    `ownerAvatarWrap.marginTop: -22 → +6`, `ownerRow.paddingTop: 10 → 14`.
    Avatar + nickname + 8-digit ID + members pill remain inside the single
    `<Pressable>` that routes to `/user/{owner.id}`. All data flows from
    `room.owner` which — per the backend live-sync above — reflects the
    owner's current profile in real time.

### Verified
- `tests/test_iter75_bg_default_owner_sync.py` — 7/7 pass:
  - Catalog includes `orio_default` and ≥ 20 entries.
  - Admin approval sets `custom_background_url` + `background_url` +
    `background_preset_id="my_custom"`.
  - `bg_id="my_custom"` switches back to the stored custom bg; 400 when
    nothing on file.
  - `PATCH /users/me` (nickname) propagates to owner_public across all
    rooms the user owns.
  - `PATCH /users/me/profile-media` (avatar) propagates likewise.
  - `public_room` exposes `custom_background_url` + `background_preset_id`.
- Full regression 47/47 pass (iter64 + 67 + 69 + 70 + 71 + 72 + 73 + 74 + 75).
- Lint clean on all touched frontend files.

---

## Iter-76 — Mic grid wider spread + owner_public is a saved snapshot

### Spec (user, verbatim)
1. MIC GRID — keep current mic sizes, keep same fixed Mic Area and position.
   For 20/25 seats, distribute seats WIDER horizontally within the SAME fixed
   50% Mic Area. Increase horizontal spacing/column distribution only.
   Do NOT expand vertically. Do NOT change mic sizes. Chat area independent.
2. OWNER PROFILE IN ROOM SETTINGS — owner avatar/name/ID must NOT live-sync
   with future profile changes. Keep the owner information as the room's
   saved snapshot. Keep the 8-digit owner ID unchanged. Don't touch Room Avatar.

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - Each mic row now receives an extra `styles.seatsRowWide` style when
    `numberedMicSeats >= 20`:
    - `justifyContent: "center"` → `"space-between"` (edge-to-edge spread).
    - `gap: 8` → `0` (space-between provides the spacing).
    - `paddingHorizontal: spacing.md` → `10` (tighter side padding so the
      seats reach further toward the edges).
  - Smaller 8/15-mic layouts keep the original centered row — unchanged.
  - **No change to `computeSeatMetrics`** → seat sizes are byte-identical.
  - Mic Area container now has `overflow: "hidden"` on top of its 50 % cap,
    so even an edge-case overshoot can NEVER bleed into the chat area.

### Backend
- `/app/backend/server.py`
  - **Removed the Iter-75 live-sync** that propagated `nickname/avatar_url/
    username` to `rooms.owner_public` from `PATCH /users/me` and
    `PATCH /users/me/profile-media`. `owner_public` is now what it was
    originally: an immutable snapshot taken at room creation. The 8-digit
    `numeric_id` is already immutable (never regenerated on profile edit).

### Verified
- `tests/test_iter75_bg_default_owner_sync.py` rewritten:
  - `test_profile_update_does_NOT_propagate_to_owned_rooms` — ✅
  - `test_profile_media_update_does_NOT_propagate_avatar` — ✅
- Full regression 47/47 pass (iter64 → iter75 incl. updated sync-OFF tests).
- Lint clean on all touched frontend files.

---

## Iter-77 — Wide spread for 8/15 + hide seat numbers (final mic polish)

### Spec (user, verbatim)
- 8/15-seat layouts: spread existing mics wider horizontally across the
  available Mic Area. Keep current sizes. Do not expand vertically.
- Remove/hide the seat numbers (1, 2, 3 …) displayed under every mic.
  Mic seats stay fully functional without visible numbers.
- Do not change anything else (20/25 layouts, Host, sizes, chat, backgrounds).

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - Removed the `wideSpread = numberedMicSeats >= 20` gate — **every mic row
    (8 / 15 / 20 / 25)** now applies `styles.seatsRowWide`
    (`justifyContent: "space-between"`, `gap: 0`, tighter paddingHorizontal:10),
    so the existing-size mics span wider horizontally in all layouts.
  - Added `hideIndex` to every rendered mic `<SeatBubble>` — the numeric
    label under each seat is no longer shown. All tap/press logic and the
    seat index semantics (speaker ring, mute, take-mic, invite) are
    unchanged.
  - **No change to `computeSeatMetrics`** → mic sizes untouched.
  - **No change to Host chair** — host already renders with `hideIndex`.

### Verified
- Full regression 47/47 pass.
- Lint clean on `app/room/[id].tsx`.

---

## Iter-78 — Slightly extend overall mic grid vertically

### Spec (user, verbatim)
- For 8/15/20/25 mic layouts, slightly extend the overall mic grid vertically
  within the existing Mic Area.
- Keep the exact current mic sizes unchanged.
- Do NOT change the vertical spacing between rows.
- Do NOT enlarge the individual mics.
- Do NOT expand beyond the existing 50% Mic Area or affect the Chat Area.
- Keep all horizontal spacing, Host position, and everything else unchanged.

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - Added two new row-only styles, applied conditionally:
    - `seatsRowFirst` (`paddingTop: 10`) — only on the first mic row,
      extends the top of the grid downward from the host.
    - `seatsRowLast` (`paddingBottom: 10`) — only on the last mic row,
      extends the bottom of the grid toward (but not into) the chat area.
  - **Nothing else changed**: `seatsRow.marginTop: 6` (row-to-row distance)
    is byte-identical, `seatsRowWide` horizontal spread is unchanged,
    `computeSeatMetrics` is untouched → mic sizes identical, host size
    identical, host position unchanged.
  - The 20 dp of added padding sits well inside the existing 50 % Mic Area
    cap on every supported phone size, and the parent View's
    `overflow: "hidden"` from Iter-76 still guarantees zero chat overlap.
- No backend changes.

### Verified
- Lint clean.
- 47/47 backend regression tests continue to pass (no backend touched).

---

## Iter-79 — Extend Mic Area wrapper by ~35 dp

### Spec (user, verbatim)
- Extend the Mic Area downward by only about 30–40 px to use more of the
  available space below the current mic grid.
- Keep current mic sizes and vertical row spacing EXACTLY unchanged.
- Must remain within the 50 % screen limit and must never overlap the
  Chat/Content Area.
- Do not change anything else.

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - Mic Area wrapper `paddingBottom`: `2` → `35`. The wrapper now consumes
    ~35 dp more vertical space, which was previously allocated to the chat
    ScrollView (chat shrinks correspondingly). The 50 % `maxHeight` cap and
    `overflow: hidden` guard remain in place → never overlaps chat.
  - No change to `paddingTop`, the grid, row structure, row-to-row spacing,
    seat sizes, host position, horizontal spread, or anything else.
- No backend changes.

### Verified
- Lint clean.
- 47/47 backend regression tests still pass (no backend touched).

---

## Iter-80 — Distribute mic rows vertically (not clustered at bottom)

### Spec (user, verbatim — Arabic)
"اريد الميكات تكون متفرقة بالطول لا تحت ولاكن متفرقة لا تحت بشكل بسيط مو كثير
وممنوع تغيير اي شي اخر"

Translation: Spread mics vertically, not clustered at the bottom, just slightly.
Do not change anything else.

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - **Row gap**: `seatsRow.marginTop: 6 → 14`. Rows now sit visibly farther
    apart in the vertical direction, giving the "distributed" feel the user
    asked for. Only ~8 dp more between rows — a small change, not drastic.
  - **Mic Area wrapper**: `paddingBottom: 35 → 6` (undoes Iter-79's
    bottom-heavy padding so the extra height isn't piling up below the grid;
    it's now spread between rows instead).
  - **Nothing else changed**: seat sizes identical, Host position unchanged,
    first/last-row paddings from Iter-78 retained, horizontal spread
    retained, chat area unaffected. 50 % cap + `overflow: hidden` guard
    still in place.
- No backend changes.

### Verified
- Lint clean.
- 47/47 backend regression tests still pass (no backend touched).

---

## Iter-81 — Nudge row spacing a touch more

### Spec (user, verbatim — Arabic)
"اريد الميكات تكون متفرقة لا تحت بشكل عمودي اكثر من وضعها الحالي شوي وممنوع
تغيير اي شي ثاني"
Translation: Spread the mics a bit more vertically than their current state;
don't change anything else.

### Frontend
- `/app/frontend/app/room/[id].tsx`
  - `seatsRow.marginTop: 14 → 22`. ~8 dp more vertical breathing room
    between every row. Everything else unchanged (seat sizes, horizontal
    spread, Host position, Mic Area 50 % cap, chat area, overflow guard).
- No backend changes.

### Verified
- Lint clean.
- 47/47 backend regression tests still pass.

---

## Iter-82 — Mic grid lower + ORIO Welcome default + 15-day Custom BG pass + VIP6 gate

### Spec (user, verbatim summary)
1. **Mic layout**: slightly lower + comfortable vertical space per seat; mic
   area ≤ 50 % screen; preserve current behavior/style.
2. **Room Avatar vs Room Background**: strictly independent fields and
   controls — Room Avatar edits must NEVER change the Room Background.
3. **ORIO Welcome default**: every brand-new room auto-uses it; owner can
   change later from the Backgrounds section; room-only.
4. **Custom background flow**: tapping "Custom Image" opens a bottom sheet
   with exactly 3 options:
     A. "Buy Custom Background — 15 Days"  (no VIP required)
     B. "VIP6+ — Unlimited Custom Backgrounds"
     C. "Cancel" (red)
5. **Buy modal (50 000 Diamonds)**: ORIO-only currency, server-side balance
   check and deduction, 15-day entitlement persisted server-side.
6. **VIP6+ path**: non-VIP6+ users navigate to `/vip`; VIP6+ users get
   unlimited uploads. Verified server-side.
7. **24h moderation**: already in place; real pending/approved/rejected flow.
8. **Everything real**: no mocks, no visual-only functionality.

### Backend (`/app/backend/server.py`)
- Added `orio_welcome` preset to `PREMIUM_ROOM_BACKGROUNDS`.
- Room creation now sets `background_url` + `background_preset_id =
  "orio_welcome"` by default.
- `public_room.background_url` no longer falls back to `cover_url` — strict
  independence between Room Avatar and Room Background. If a legacy room
  has no bg stored, we return the ORIO Welcome default (not the cover).
- **New endpoints:**
  - `GET  /rooms/custom-background/entitlement` — reports VIP level,
    `pass_active`, `entitlement_until`, `can_submit`, price, days.
  - `POST /rooms/custom-background/purchase-15d` — deducts exactly
    50 000 Diamonds atomically, grants a 15-day window (stacked onto any
    existing active pass), writes a wallet-ledger entry. 402 on
    insufficient diamonds, 409 for VIP6+ (unlimited already).
- `POST /rooms/{id}/background` (submit):
  - **Gated**: VIP6+ unlimited OR active 15-day pass; otherwise 403
    (`CUSTOM_BG_ENTITLEMENT_REQUIRED`).
  - No per-submission diamond deduction (one-time pass only).
  - NSFW / corrupted images still rejected immediately via
    `_moderate_cover_image` and user media-block applies.
  - Submission access_mode recorded (`"vip6"` or `"pass_15d"`) for audit.
- `public_user.custom_bg_entitlement_until` exposed.
- Admin approval path unchanged (approve sets `background_url` +
  `custom_background_url` + `background_preset_id = "my_custom"`; reject
  no longer refunds since no per-submission charge).

### Frontend
- `/app/frontend/src/api.ts`
  - `apiPurchaseCustomBgPass()`, `apiGetCustomBgEntitlement()`, type
    `CustomBgEntitlement` exported.
- `/app/frontend/app/room/[id].tsx`
  - **Mic area paddingTop**: 4 → **18**; paddingBottom: 6 → 10. Grid sits
    slightly lower; combined with the Iter-80/81 row-margin, seated users
    have comfortable vertical breathing room (avatar + username no longer
    touches the row below).
  - **"+ Custom Image" tile** now opens the 3-option bottom sheet
    (`bg-custom-sheet`) with exact labels:
    - *Buy Custom Background — 15 Days* (`bg-custom-buy`)
    - *VIP6+ — Unlimited Custom Backgrounds* (`bg-custom-vip6`)
    - *Cancel* (red, `bg-custom-cancel`)
  - **Buy modal** (`bg-buy-modal`): centered card with ORIO preview, title,
    body text (per spec), purple button `💎 50,000 Diamonds`
    (`bg-buy-confirm`). Deducts via the real endpoint. On success:
    invalidates entitlement query + opens the image picker to submit.
  - **VIP6+ path**: non-VIP6+ users close the picker and navigate to
    `/vip`; VIP6+ users jump straight to the upload.
- No further changes to Room Avatar flow (already independent) — the
  backend already writes only `cover_url` for Room Avatar; verified by
  `test_cover_change_does_not_touch_background`.

### Verified
- `tests/test_iter82_orio_welcome_and_bg_pass.py` — 8/8 pass:
  - ORIO Welcome default on new rooms, catalog contains `orio_welcome`,
    entitlement defaults locked, 50 k purchase deducts + unlocks, VIP6
    cannot buy, submit 403 without pass → 201 with pass, VIP6 submits
    without pass, cover change doesn't touch background.
- Full regression 55/55 pass (iter64 → iter82).
- Lint clean on all touched frontend files.

---

## Iter-83 — Final mic grid spacing fix (nudge lower + more row breathing room)

### Spec (user, verbatim)
- Move the entire mic grid slightly downward.
- Increase vertical spacing between mic rows so each seated user's
  avatar + username has comfortable breathing room.
- Username area must NEVER touch the microphone row below.
- Keep the entire mic section strictly within 50 % of the screen height.
- Do not increase rows, redesign, or touch chat/controls/header/background.
- Surgical spacing/positioning only.

### Frontend (`/app/frontend/app/room/[id].tsx`)
- **Mic Area paddingTop**: `18 → 26` — the whole grid sits ~8 dp lower
  under the room header.
- **seatsRow.marginTop**: `22 → 26` — row-to-row spacing +4 dp. Across
  the 25-mic layout (4 gaps) that's +16 dp of extra vertical breathing room.
- Fits inside the 50 % cap on all supported capacities (25-mic ≈ 421 dp of
  422 dp cap on 390×844). `overflow: hidden` still protects against any
  edge-case overshoot.
- Nothing else touched — mic sizes, Host position, horizontal spread,
  chat area, bottom controls, header, backgrounds, and all seat behavior
  unchanged.
- No backend changes.

### Verified
- Lint clean.
- 55/55 backend regression tests still pass.

---

## Iter-84 — Final mic grid spacing (push lower + more row gap)

### Spec (user, verbatim)
- Move the entire mic grid slightly downward as one block.
- Increase vertical distance between each mic row slightly.
- Give each seated user enough vertical breathing room so the username
  under each avatar never touches/overlaps the row below.
- Keep spacing consistent between all rows.
- Don't resize avatars, don't change rows/seats, don't redesign.
- Stay within upper 50 % of screen; mic grid bottom must stay clearly
  separated from the chat area.
- Nothing else changes.

### Frontend (`/app/frontend/app/room/[id].tsx`)
- **Mic Area paddingTop**: `26 → 32` — the whole grid is now ~6 dp lower.
- **seatsRow.marginTop**: `26 → 30` — row-to-row vertical gap +4 dp per row
  (+16 dp across the 25-mic layout). Each seat's avatar+username has clear
  breathing room before the row below.
- `computeSeatMetrics` internal `rowGap` kept at 6 (conservative) with a
  prominent comment: this keeps the preferred avatar sizes on every layout.
  Any tiny bottom overshoot on 25-mic / tight-screen combos is clipped
  cleanly by the Mic Area's `overflow: "hidden"` guard — avatars never
  shrink.
- No change to the chat area, bottom controls, header, backgrounds, Host
  position, seat behavior, or any other UI.
- No backend changes.

### Verified
- Lint clean.
- 55/55 backend regression tests still pass (no backend touched).


## Iter-85 — Admin Dashboard (web-based control center) ✅

**Delivered a comprehensive, web-based Admin Dashboard with full server-side authorisation and audit logging.**

### Backend (surgical additions only)
- `admin_dashboard.py` (new module) — zero bloat to `server.py` (only 2 lines added: seed call + router mount).
- Idempotent super-admin seed on startup via `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD` / `ADMIN_RESET_PASSWORD` env vars.
- Reuses existing JWT auth + `users.is_admin` flag — no second auth system.
- New `is_superadmin` flag on the seeded account (also any user a superadmin promotes). Only superadmins can grant/revoke `is_admin` on others; cannot be banned or demoted by regular admins.
- Endpoints under `/api/admin/dashboard/*`:
  - `GET /stats` — totals (users/rooms/economy/VIP breakdown/moderation).
  - `GET /users` + `PATCH /users/{id}` — list/search/filter (admins/vip/banned/new) + ban, grant admin, set VIP level/duration, wallet Δ (ledger-tracked).
  - `GET /rooms` + `PATCH /rooms/{id}` — list/filter (live/locked/new), close, lock/unlock.
  - `GET /transactions` — recent wallet ledger (filter by currency/type).
  - `GET /vip` — VIP members with expiry.
  - `GET /reports`, `GET /reports/{id}`, `PATCH /reports/{id}` — moderation (resolve/dismiss/ban).
  - `GET /audit` — every admin mutation recorded in `admin_audit` collection.
- Wallet adjustments mirror into `wallet_transactions` with `type: admin_adjust` so the ORIO ledger stays auditable.

### Frontend (web-only `/admin/*` routes under Expo Router)
- `/admin/login` — dedicated admin sign-in (reuses main JWT, blocks non-admin users with friendly redirect).
- `/admin` — Overview with 6 stat cards (Users / Live Rooms / Diamonds / VIP / Open Reports / Admins), VIP breakdown V1–V10 grid, Quick actions.
- `/admin/users` — search + 5 filters, "Manage" modal with Role & status, VIP controls, wallet Δ, reason field.
- `/admin/rooms` — search + 4 filters, Close/Lock actions.
- `/admin/wallet` — recent transactions with currency pill filter.
- `/admin/vip` — VIP members with level selector (V1–V10).
- `/admin/reports` — tabbed Open/Resolved/Dismissed, detail modal with media preview + Resolve/Dismiss/Ban actions + resolver note.
- `/admin/audit` — chronological admin action log.
- Responsive shell: full sidebar on wide screens, horizontal pill nav on narrow screens.
- Existing `/admin/withdrawals` subroute preserved; main `AuthGate` updated to not force unauthenticated users away from `/admin/*` paths so admins can land directly on the login screen.

### Testing
- 11/11 Iter-85 tests pass (`/app/backend/tests/test_iter85_admin_dashboard.py`): seed login, 401/403 guards, stats shape, users list+filter, superadmin-only promotion, ledger-tracked wallet adjustment, room lock/unlock, self-ban/demote protection, VIP/Reports/Audit endpoints.
- Core backend regression suite (Iter-82, Iter-75) still passes (15/15).

---

## Iter-92 — Full-App Localization + True RTL/LTR Mirroring ✅

### Problem
Arabic UI still had many hardcoded English strings in several screens (home, me, messages, wallet, posts, chat, my-rooms, rankings, invite, friendship, cp, register, profile), and layout mirroring had a `comingSoon` function/string key collision + minor horizontal overflow in RTL mode.

### Solution
- Added ~130 new i18n keys in both EN + AR covering every user-facing string across all primary screens (menus, chips, buttons, placeholders, empty states, alerts, dialogs, package tiers, rankings, toasts).
- Replaced hardcoded English with `t.*` calls across: `(tabs)/home`, `(tabs)/me`, `(tabs)/messages`, `(tabs)/wallet`, `(tabs)/posts`, `(tabs)/_layout`, `(auth)/register`, `app/chat/[id]`, `app/my-rooms`, `app/rankings`, `app/invite`, `app/friendship`, `app/cp`, `app/edit-profile`, `app/earnings`, `app/create-room`, `app/index` (splash), `src/profile/ProfileView`.
- Fixed `comingSoon` collision (was both a `(provider) => string` function AND a plain `"Coming Soon"` string). Renamed string usage to `comingSoonLabel` to prevent the "Functions are not valid as a React child" runtime error.
- Expanded `rtl-bootstrap.ts` to also set `document.documentElement.lang` and inject a global `html, body { overflow-x: hidden }` + scrollbar-hiding style — eliminates horizontal overflow caused by absolute-positioned decorative glows (`left: -60; right: -60`).
- Updated `+html.tsx` with a sync `<script>` that sets `lang` and `dir` from `localStorage('orio_lang')` before React Native Web renders — avoids flicker on static exports.
- Added client-side translation for backend-defined wallet tier labels (`Starter → البداية`, `Popular → الشائع`, `Deluxe → ديلوكس`, etc.) via `t.pkgLabel(name)`.

### User-generated content preserved
Usernames, nicknames, bios, room names, post text and chat messages are NEVER translated.

### Visual verification (Playwright, viewport 390×844)
- Arabic (`dir=rtl`, `lang=ar`): login, home, me, wallet, profile, posts, messages, rankings, friendship, cp, invite, my-rooms — all fully translated with flex-direction mirrored (icons/avatars/chevrons on the opposite side), buttons and chips flipped, text right-aligned.
- English (`dir=ltr`, `lang=en`): login, me, wallet — unchanged LTR layout.

---

## Iter-93 — Surgical RTL/LTR Correction Pass ✅

### Fixed issues reported by user

1. **Arabic text was visually reversed on profile stat chips** — ProfileView used a `transform: [{ scaleX: -1 }]` trick on the chip ScrollView to mirror its content. This also mirrored the Arabic glyphs themselves (unreadable). Replaced the transform with proper `flexDirection` handling. Arabic text now reads naturally in VIP / Days / Gender / Wealth / Charm chips.

2. **"Hi {user} 👋" greeting removed** from Party Rooms header per user request.

3. **"My Rooms / Rooms I own / Rooms I moderate" sheet removed** — Deleted the DeviceEventEmitter listener in home.tsx and the `tabPress` emitter in the tab layout. Tapping the Home tab repeatedly no longer opens a sheet. Users still access rooms via `/my-rooms`.

4. **Row-reverse double-flip bug (CRITICAL, app-wide)** — Many screens explicitly set `isRTL && { flexDirection: "row-reverse" }`. On React Native Web with `direction: rtl` on `<html>`, the browser already mirrors `flex-direction: row` layouts naturally. Adding explicit `row-reverse` INVERTED the mirror back to LTR, so icons appeared on the wrong side (e.g. Google logo on the LEFT in Arabic). Swept all occurrences across 27 files (home, me, posts, messages, wallet, login, register, phone, chat, my-rooms, friendship, cp, invite, rankings, search, report, settings, language, create-room, edit-profile, vip, tasks, global-ranking, room-ranking, room/[id], ProfileView, RoomUserCard, PremiumPodiumFrame, Toast, UtcResetTimer). Replaced with plain `flexDirection: "row"` and let `direction: rtl` do the mirroring natively.

5. **Party Rooms header mirror** — With the row-reverse fix, title + icons now sit on their correct RTL sides automatically.

6. **Posts header mirror** — Title moves to the right in Arabic; `+` button moves to the left.

7. **Messages header mirror** — Title right / Add Friend left in Arabic.

8. **Me tab translated** to "أنا" (already done in iter-92; confirmed working).

9. **Room screen RTL audit** — Localized the "Welcome to the room! Be respectful." system message to "مرحباً بكم في الغرفة! يرجى الاحترام." and the chat composer placeholder "Say something…" → "اكتب رسالة…". All headers/chevrons already follow isRTL direction.

10. **Country name localization** — The backend `/countries` endpoint already returns `name_ar` for every entry. Home now reads the AR name when `isRTL` is true, both in the selector button and the picker list. Flags remain unchanged.

11. **User-generated content preserved** — Usernames, nicknames, room names, bios, message bodies untouched.

### Files touched
- `/app/frontend/app/(tabs)/home.tsx` — removed greeting + My Rooms sheet + localized country rendering
- `/app/frontend/app/(tabs)/_layout.tsx` — removed tabPress emitter
- `/app/frontend/src/profile/ProfileView.tsx` — scaleX trick removed from chip row
- `/app/frontend/app/room/[id].tsx` — chat placeholder localized
- `/app/frontend/src/room/RoomSession.tsx` — welcome message localized
- 27 additional files swept for the row-reverse double-flip bug

### Visual verification
- Arabic: login, home, me, wallet, posts, messages, profile (self & other users), room, my-rooms — icons on the correct RTL sides, Arabic text reads naturally, no visual reversal.
- English: login, home, me, wallet, posts, messages, profile, room — unchanged LTR layout.
- No horizontal overflow in either direction.

---

## Iter-94 — VIP Chip Clone · Messages Inbox · Language Flags Removed ✅

### 1. Profile VIP chip clone
Cloned the exact "V · VIP {level}" pill chip from the profile stat row into a new `VipChip` component (`src/components/VipChip.tsx`) that uses the real `vip_level` plus the existing per-tier colors from `tierFor()` and the same radius/border/translucent-fill as the original chip. Replaced the standalone `<VipBadge level={} />` beside the profile photo in `(tabs)/me.tsx` with this cloned `<VipChip />`. The original VIP chip in the stat row remains untouched.

### 2. Messages Inbox — 4 real backend-connected tiles
Under the Messages header, added four vertical tiles. All backend-connected, no mocks:
- **Friend Requests** — count of pending friendships NOT requested by the current user; tapping goes to `/friendship`
- **System Notifications** — unread count from `system_notifications` collection targeted at this user OR broadcast (`user_id in [uid, "*"]`); tapping goes to new `/notifications` screen that lists real items and marks them read on view
- **Support Team** — unread messages from `support_messages` with `from_support=true`; tapping goes to new `/support` chat screen supporting real send + receive via `POST/GET /api/support/messages`
- **Activities** — count of `wallet_transactions` rows for the user; tapping goes to new `/activities` screen listing real ledger rows (gifts, VIP purchases, agency payouts, growth-point conversions, etc.)

Backend endpoints added surgically at the bottom of `server.py` (before `app.include_router(api)`):
- `GET /api/inbox/overview`
- `GET /api/notifications/system`
- `GET /api/support/messages` + `POST /api/support/messages`
- `GET /api/activities`

Frontend API bindings added to `src/api.ts`. New i18n keys for all tile labels/subtitles in both EN and AR.

### 3. Language selector — flags removed
Removed the 🇺🇸 and 🇸🇦 flag emojis from the language picker rows in `app/language.tsx`. Each row now shows only the native name (English / العربية) + direction label. Row structure, animation, selection check, and setLang reload behavior are untouched.

### Preserve rules enforced
- Did NOT modify or repeat any previous work.
- Did NOT touch unrelated code, UI, backend logic, or auth flow.
- Original VIP chip under the username in profile view preserved.
- Add-Friend icon, Messages header, divider, existing thread list all preserved.
- Language reload mechanism untouched.
- No new text left hardcoded — every new label uses the i18n system.

## Iter-97 (done)
- VipBadge is now a tier-colored "VIP{n}" pill app-wide; no "V+number" text left anywhere.
- New screens: /level (Wealth/Charm tabs), /bag (7 cosmetic tabs, Store icon), /store (same 7 tabs, Bag icon), /medal (My Badges / Activity Badges). Me tab shortcuts now point to these.
- Backend: GET /api/me/levels, GET /api/me/bag, GET /api/cosmetics/store, POST /api/cosmetics/{id}/purchase, GET /api/me/medals. Collections: cosmetic_items, user_inventory, badges (admin-populated; no fake seeds).

## Iter-98 (done)
- Friend Requests screen (/friend-requests): followers + incoming requests, real Accept / red Reject (GET /api/friend-requests, POST /api/friend-requests/{id}/accept|reject).
- System notifications are persisted with a kind and params and rendered in EN/AR with "View Now" links: vip_warning (lazy, ≤3 days left), room_kick (kick_seat + ban), report_received, gif_approved, activity_approved/rejected.
- Support chat is VIP4+ only (server 403 below that) with a restricted banner in the app; admin Support Inbox at /admin/support.
- Activities: Activities/My Activities tabs with Ongoing/Starting Soon sub-tabs, Apply Now leads to /activity-apply (image, name ≤20, Y/M/D). Admin review at /admin/activities. Collection: room_events.
- Fixed the bug where screens vanished: AuthGate allowlist was missing notifications/support/activities.

## Iter-99 (done)
- Bag/Store item modal with real Wear/Unequip (POST /api/me/bag/equip|unequip; room backgrounds apply to the user's own room) and Buy for unowned Store items.
- Tab bars no longer shrink (flexShrink 0). Activity date fields are now Day | Month | Year, all fitting the screen.
- Owner-only /connections screen (Friends/Following/Followers, GET /api/me/connections). Other users' profile stat cells are not tappable. Live follow counts in /auth/me and /users/{id}.
- Me tab: photo and name open the own profile; ID and diamonds removed; chips VIP→Age/Gender→Wealth→Charm→Flag (22px); stat row is Friends|Following|Followers. Profile avatar opens the image viewer.

## Iter-115 (done) — Wealth/Charm level rework
- One-time reset (config.level_reset_v2, backup in level_reset_backup_v2). Official 51-level table (ORIO_LEVEL_REQUIREMENTS), stored as cumulative thresholds in level_configs (max 51).
- Gifts: wealth += exact diamonds spent, charm += exact diamonds received; self-gift credits both; request_id idempotency (gift_requests, 409 on replay).
- /api/me/levels returns remaining/is_max. The Levels screen opens on the earned badge and shows "للترقية إلى LV X يتطلب Y ألماسة" / MAX.

## Multi-account switching (DONE — iteration_66)
- Max 5 accounts per device. Vault: metadata in AsyncStorage `orio_accounts`; per-account refresh tokens in SecureStore (native) / localStorage (web) `orio_acct_rt_<userId>`, mirrored on every token rotation by JWT `sub`.
- Settings → Switch Account (`/accounts`): switch, add (parks session), remove (revokes session). Login screen shows saved accounts for one-tap re-entry. Sign out removes only the current account.
- Files: src/auth/storage.ts, src/auth-context.tsx, app/accounts.tsx, app/(auth)/login.tsx, app/settings.tsx, src/i18n.tsx (EN/AR)

## Wealth/Charm/VIP display rework (DONE — iteration_67)
- /api/me/levels returns `cumulative` (51 thresholds). Each badge (10 ranges) shows remaining to range-end LV (5,10..45,51) = max(0, cumulative − points).
- send-multi allows self-gift (Wealth + Charm both credited).
- Levels: gold SVG LuxArrow, Wealth-only divider + 10 reward placeholders. Me tab: LevelBadgeChip (Wealth min LV1; Charm shown ≥LV1; yellow/blue tiers). Honor: enlarged squares. RoomUserCard: badge artwork, VIP V without circle.
- Shared: src/levels/badges.tsx (WEALTH_ITEMS/CHARM_ITEMS/RANGE_TARGETS/badgeIndexFor).

## Iter-117 Targeted UI & Functional Updates (iteration_68 — backend 21/21, frontend 14/15 → fixed)
- Object storage (Emergent) chunked uploads: /api/media/upload/{init,chunk,complete}, GET /api/media/files/{id}
- Posts: /create-post page (1000 chars, ≤5 images OR 1 video ≤30s), 7 hashtags filter + publish
- Report evidence (≤3 images / 1 video) via object storage; profile menu → /report
- Referral: /referral/status + /referral/redeem (24h window, one-time, anti-abuse, daily cap 20)
- Tasks: server-side bumps + /tasks/heartbeat (presence-verified); Go buttons
- Level-up notifications (level_up, vip_up) + global LevelUpWatcher popup
- Rooms: soft-archive dedupe on startup, room name setting (owner), title half-sheet with owner-only gear, welcome as owner w/ @mention, GREEN/YELLOW 👨 role markers, ChatIdentityRow
- Levels: next-level default, range-final for other badges, K/M abbreviations; badges deep-link /level?sys=&lv=
- Tabs hidden on wallet/profile; backBehavior history; Agency back arrow; live balance in Me & Wallet

## Admin Phase 1 (Iter-118)
- backend/admin_phase1.py: /api/admin/dashboard/users/{id}/{detail,relations,transactions,wallet,level-history,levels,profile,ban,unban,bans,revoke-sessions}, /bans, /audit/search, /me
- Bans enforced in server.current_user (account/device/both, auto-lift on expiry, 403 {code:BANNED,...}); /auth/refresh blocked; sessions revoked on ban. X-Device-Id header from src/auth/device.ts
- BanScreen (global) countdown d/h/m/s, 9+ days, "فهمت"
- New perms: users.edit_profile, users.levels, users.sessions, bans.view, bans.manage, messages.review. AdminShell nav filtered by perms, polls /auth/me 10s
- Orio Team official account (username orioteam, is_official) welcome DM once for users created after launch; read-only (server 403 + UI)
- Admin pages: /admin/user/[id], /admin/bans, /admin/audit (search)
- Phase 2 pending: rooms mgmt/history, posts moderation, reports upgrade, notifications center. Phase 3: assets manager, OpenAI image scan, report-linked message review

## Apple Sign-in (iOS parity) — DONE
- Backend `POST /api/auth/apple`: verifies Apple identity token (RS256 vs Apple JWKS, iss/aud/exp), upserts user by `apple_sub` (sparse unique index), links by email if it exists, saves name on first sign-in, gives a placeholder email when Apple hides it, 500 coins welcome bonus, returns ORIO JWT pair (works with multi-account)
- `APPLE_AUDIENCES` in backend .env = bundle id + host.exp.Exponent; `/api/auth/providers` exposes `apple`
- Frontend: native AppleAuthenticationButton on login (iOS only, shown only if isAvailableAsync); cancel is silent; EN/AR strings; app.json `ios.usesAppleSignIn: true`
- Button can only be tested on a real iPhone (Expo Go or a build), not on web

## Iter-120 Levels/Badges/Honor/Supporter/Rules — DONE
- Small Wealth/Charm chips are always static; room chat uses size "sm" (16px = VIP sm badge)
- Profile chips: FlagCircle (emoji fills circle) · Age · Days · NEW (server is_new, 5 days) · Supporter (🏆 K/M, `supporter_total` from gift_transactions, non-reversed, eligible only) then levels
- Shared `src/levels/LevelBoxes.tsx` (VIP→Wealth→Charm) used by Honor tab and RoomUserCard (card also shows flag + supporter)
- Level-up popup button "View Details / عرض التفاصيل" → /level?sys&lv
- Backend: `_gift_awards_points` (price>0 and not is_free) for /gifts/send and /gifts/send-multi; tx rows store wealth_awarded/charm_awarded/status; audit `gift_points_awarded`; `POST /api/admin/gifts/{tx_id}/reverse` (idempotent, admin-only, clamps ≥0, optional coin refund, ledger reversal, audit)
- `/level-rules` (4 tabs, owner Arabic text + English) via "?" on Levels header; route added to root-layout allowlist
- GIF profile copy updated to VIP4+ (EN/AR); room cover GIF still VIP5+

## Iter-121 Room Profiles, Badges, Rules, Me, Flags — DONE
- Level Rules: plain text tabs (white selected / dimmed inactive, black halo only), soft-black #16141B screen
- Room-only badges (RoomUserCard only): 🏆 sent / ⭐ received per room; `room_badge_sessions` (room_id,user_id,sent,received,left_at); join keeps totals <24h after leave, resets >24h; WS drop = leave; `GET /api/rooms/{rid}/support-badges/{uid}`; shown from 10K, tiers 10K/100K/1M/10M/100M
- Me tab: Diamonds row → copy icon + "ID: n" (silent copy); banner 140→112
- `src/components/RoomCard.tsx` shared (Rooms list single column + Profile User Room): circular image physically right, name + owner flag, category badge (Chat/PK/Music/Games/CP, AR), glass `live_count` (socket presence)
- `src/components/CountryFlag.tsx` + generated `src/utils/circleFlags.ts` (react-native-svg-circle-country-flags) used for all flags; Unknown/All keep 🌎/🌐
- Backend: REGIONS (KRD Kurdistan, separate from COUNTRIES); `/countries` = 197 + regions; `/room-filter-countries` = 22 Arab + FR US DE KRD GB NL TR; rooms synced to owner's country on profile change + startup sync
- Perf: recommended rooms lookup rewritten + index gift_transactions(room_id, created_at) (80s → 0.4s)

## Iter-122 Final UI & Functionality Fixes — DONE
- Posts hashtags: `HashtagChips horizontal` single scrollable row (all 7 always visible)
- Trophy/Star room-only (RoomUserCard inline after Days); global SupporterBadge removed from profiles; visible from first paid gift; backend broadcasts `room_badges` WS event → RoomSession invalidates ["room-support-badges", roomId]
- RoomCard 88px tall, image 64, list padding xl; natural RTL/LTR mirroring; room name rainbow when `owner_vip_level` ≥ 6 (live via `_rooms_out`); list visibility = live socket presence (`q._id in _hub.presence`), list refetch every 10s
- Me tab avatar ↔ info spacing increased
- Auth: single-flight refresh; only 401 clears tokens; /auth/refresh 120s grace window; startup retries; AppState foreground restore; saved accounts removed from login; "Session expired" toast removed
- VipName added: room notice owner, system join line, gift line, participants list, room info owner, gifts summary, CP pair rankings, in-room game players

## Iter-123 VIP Privileges background — DONE
- app/vip.tsx: owner image `assets/images/vip-bg.jpg` (853x1844, ~0.46 ratio) as fixed full-screen `cover` background (replaces the 2 gradients)
- Removed hero V emblem (spacer 72px keeps crown visible) and V emblems in VIP1–7 tabs
- Soft black text-shadow on cardKicker/cardTitle/cardMeta/sectionLabel/benefitText for readability over gold ornaments

## Iter-124 VIP Center redesign (step 1) — DONE
- app/vip.tsx fully replaced: owner image `assets/images/vip-center-bg.png` (original PNG, 853x1843, untouched) as fixed `contain` background on #000003; header = back + "VIP Center / مركز VIP"; ScrollView with 20 empty transparent boxes (96px, 1px white 55% border, 12px gap)
- Previous VIP Privileges UI (tabs, progress, rewards, maintenance modal) removed from this screen; backup at /tmp/vip_backup.tsx (not persisted). Backend VIP APIs unchanged. Old vip-bg.jpg deleted

## Iter-125 VIP Center scroll + Test data — DONE
- vip.tsx: fixed header (back · title · ? → /vip-guide) with soft top fade; ONE ScrollView: full-width artwork at exact 853:1843 ratio, then 20 empty navy (#04103A) boxes below the ornament
- seed_test_data.py: 12 test users + 4 test rooms (is_test, test_batch="orio-demo"); `--remove` deletes all
- Backend: `_can_see_test_data` (is_test / admin) gates test rooms in /rooms and test users in /users/search; test room live_count = seeded seat count; `is_test` on public_room; RoomCard shows TEST tag

## Iter-126 VIP Center badges + grid — DONE
- `src/vip/VipBadgeShowcase.tsx`: owner VIP1–5 badge art (`assets/images/vip-badge-{1..5}.png`, transparent, downscaled to 720px long side, proportions kept) — one badge at a time, continuous float (±10px, 2.8s), soft halo, 12 water-like rising glow particles, prev/next arrows (RTL-aware) with fade+slide transition, dots
- vip.tsx: showcase absolutely placed over the artwork between crown and ornament (23%–71% of image height); 30 rows × 3 equal navy sections = 90 empty

## Iter-127 VIP Center VIP1–10 — DONE
- `assets/images/vip-badge-6..10.png` added (owner art, 720px long side). `VipBadgeShowcase` = LevelPager-style slide pager (pan swipe + crown taps, dims at VIP1/VIP10), float animation, small accent particles, no shapes behind badges; VIP8–10 soft elliptical SVG radial light beam
- `src/vip/CrownControl.tsx` SVG gold crown + chevron, gem tinted with level accent
- vip.tsx: `VIP_THEMES` per level drives artwork tint overlay (mixBlendMode "color", animated interpolateColor), page bg, section bg/border, header fade, header icon colours
- Swipe uses PanResponder (works inside the page ScrollView on web+native); badge pages are pointerEvents="none" so web <img> drag doesn't swallow the swipe

## Iter-128 VIP tabs, glows, mini-badges, Wealth/Charm theming — DONE
- `src/vip/vipAssets.ts` (VIP_BADGES, VIP_THEMES, VIP_FONT serif, vipIndex, shade); `src/components/RadialGlow.tsx` static SVG radial glow
- VIP Center: crowns removed (CrownControl deleted), title "VIP" in serif, fixed VIP1–10 rounded-square tabs (56×34, level colour, auto-centre, RTL reversed in LTR bar), swipe synced; VIP8–10 static radial glow (beam removed)
- LevelPager: static radial glow behind last 3 badges (Wealth & Charm); level.tsx artwork tint (mixBlendMode color 0.55) + page bg + reward slots follow selected badge; 10 Wealth slots now rectangles (2 cols)
- VipBadge mini-badge = animal head (zoomed badge art) + "VIPn" serif on level colour (used everywhere VipBadge is)
- LevelBoxes: VIP box shows real VIP badge art + VIP theme fill; cards aspectRatio 1.25 (shorter), art 44px

## Iter-130 — VIP/Wealth/Charm refinements (DONE)
- Shorter Honor/room-profile level cards (aspectRatio 1.42, art 38px).
- VIP8–10: strong static radial glow + 18 soft light streaks (RadialGlow `strong`).
- VIP tabs + mini-badges use lining-figure serif (VIP_NUM_FONT) so numbers align with "VIP".
- Wealth/Charm badge art recoloured with the same palette as the Levels screen (TintedImage in LevelBadgeImage).
- Wealth page: 10 empty cards in VIP-style rows of 3.

## Iter-131 — VIP6 Ice Bear / VIP7 Golden Leopard entrances (DONE)
- Clips generated with fal.ai Veo 3.1 image-to-video (+native audio) from owner artwork (scripts/gen_vip_entrances.py).
- scripts/make_alpha_entrance.py → alpha animated WebP (black keyed, holes filled, top 40% fade, feathered edges) + m4a + preview mp4/webm.
- Media served by GET /api/static/entrances/{name} (backend/static/entrances). Thumbnails bundled in assets/images/entrances.
- Backend: VIP_ENTRANCE_REWARDS, auto-grant (startup backfill + lazy on bag), bag lists VIP rewards first (expired flag), equip blocks expired VIP (403 VIP_EXPIRED), ws user_joined carries entrance_effect.
- Frontend: src/entrance/* (EntranceOverlay ≤50% height + royal name banner, EntrancePreviewModal, EntranceRewardModal), VIP Center box 1 on VIP6/VIP7 tabs, My Bag modal.
- Iter-132: Regenerated both clips following owner motion references (bear rears up + double roar w/ energy swirls; leopard prowls head-on with tracking camera). Media now *_v2.* ; alpha key is adaptive per frame (lifted blacks), top fade 10% (bear) / 22% (leopard), body holes protected.

## Iter-133 — Recharge rate + 10-level VIP (DONE)
- $1 = 499 Diamonds (RECHARGE_DIAMONDS_PER_USD); packages generated from price cents (half-up); web keeps +10% bonus; new $999 pkg (d_99900/w_99900) = 498,501.
- Mock /wallet/recharge disabled (410). Stripe checkout: POST /api/payments/checkout, GET /api/payments/status/{sid}, POST /api/webhook/stripe; idempotent _fulfill_payment (credited flag CAS) — credits coins + growth_points + recharged_diamonds.
- VIP thresholds 10 levels (lifetime recharged_diamonds). Migration v133 backfills recharged_diamonds from growth_ledger recharge/recharge_agent; never downgrades. GP conversion no longer affects VIP. Maintenance VIP8–10 = 15M GP. Recharge agent uses 499/$.
- /vip/progress returns recharged_diamonds + per-level remaining/unlocked. VIP Center VipUnlockHint shows remaining + locked badge w/ lock.

## Iter-134 — Test-mode recharge, DM media/gifts/voice, 1:1 calls (DONE)
- Stripe checkout disabled (PAYMENTS_ENABLED=false → 410). Direct recharge restored as controlled TEST MODE: TEST_RECHARGE_ENABLED + _can_see_test_data (is_test/is_admin/admin_access); request_id unique idempotency (recharge_requests). GET /wallet/recharge/eligibility.
- VIP hint text: "ينقصك للمستوى التالي VIP X: N ماسة".
- DM: messages kind text/image/voice/gift; media purpose "chat" (audio ≤30s), access owner+peer_ids+admin; POST /messages/gift reuses send_gift.
- Calls: /calls/start|current|{id}/accept|token|end; blocked (409 CALL_BLOCKED_IN_ROOM) when either user in _hub.presence; 40s ringing timeout → missed. Frontend CallProvider (polls 2s) + callEngine (react-native-agora native; web stub).

## Iter-135 — Chat header identity, inbox badges/presence/unread, moderation, cropper (DONE)
- Chat: bubbles content-only (mine purple brandPrimary, received dark); header end-corner avatar + name + Age/VIP/Wealth/Charm row.
- Messages tab: badges under names, online dot (POST /presence/ping heartbeat 30s, online ≤75s), per-thread unread + tab badge (GET /messages/unread-count), capped "9+"; opening thread marks read.
- Moderation: backend/moderation.py (builtin EN/AR + admin list db.config banned_words, /admin/moderation/words, perm messages.review, admin page /admin/words). _guard_text on DM, posts, comments, profile, room create/settings; room ws chat → {type: content_blocked}. Frontend maps CONTENT_BLOCKED to localized message.
- Test recharge: env-only TEST_RECHARGE_ENABLED (true in preview .env) → every account; set false in production secrets.
- VIP hint EN "Diamonds needed for VIP X: N"; VIP10 max-level message.
- ImageCropper (src/media/ImageCropper.tsx): pickAndCrop / cropImage (pan+pinch+zoom buttons, expo-image-manipulator), used for avatar (circle), room cover, room background 9:16, activity 16:9, post images (own ratio clamped). Original quality picks.
- Iter-136: VipBadge redesigned as single pill: original artwork head strip (assets/images/vip-strip, plaque text removed, right-edge fade) flush left, serif VIPn right; no circular clip; art always left (row-reverse in RTL).

## Iter-137 — White theme, unified badge size, PTT voice, call scenarios (DONE)
- theme.ts palette → pure white (#FFFFFF surface, dark text); TabBackground now plain white; login screen white.
- Single badge token BADGE_H=16 / BADGE_FONT=9 / BADGE_ART=14 (badges.tsx) shared by Age/VIP/Wealth/Charm (sm==md).
- Messages list: separators removed.
- HoldToTalkMic (press&hold, release→send, slide>70px/interrupt/background→cancel, <1s discard, 30s cap, retry on failure).
- Calls: 409 CALLER_IN_ROOM / CALLEE_IN_ROOM with new AR/EN texts; ws room join ends user's active call (end_reason joined_room); /calls/current returns `last` for peer notification; call screen white.

## Iter-138 — Room layout, static seats, voice tuning, badges, VIP5 cover (DONE)
- 25-mic layout removed (frontend + backend ALLOWED_LAYOUTS/create; startup migration 25→20). Rows: 8=2×4, 15=3×5, 20=4×5, host separate.
- computeSeatMetrics(numSeats, W, H, measuredHeaderH): header + mic area ≤ 50% screen (hard clamp); fixed column widths + fixed 16px name slot → seats never move on join/leave.
- mic-btn rendered only when user on seat.
- Agora: AudioProfileDefault+Chatroom, AINS, AEC/ANS/AGC, audience ultra-low latency, enableLocalAudio/setClientRole only on role change, quantised volume indication (fewer re-renders).
- Profile InfoChip/NewUserBadge/flag use BADGE_H/BADGE_FONT.
- Usernames beside avatar (start alignment) in room chat + Messages; role head icons (👨) removed.
- VIP5+ cover: PATCH /api/users/me/cover (media purpose "cover", public), /users/me cover_url → 403, gallery background_url VIP5 only; Edit Profile cover section (3:2 crop), profile shows custom cover sharp only if VIP≥5.
- Apple Sign-in already implemented (/api/auth/apple, iOS native button); button style switched to BLACK for white theme.

## Iter-139 — VIP entrances v3, 🏠 popup, locked rooms, chat cutoff, DM actions, calls (DONE)
- Entrances: user videos → static/entrances/{ice_bear,golden_leopard}_v3.* (top black cropped, top alpha fade, 540×550 animated WebP 24fps); prefetchEntrances() on login.
- Rooms 🏠 → HomeRoomsMenu (My Room / Rooms I Manage via /rooms/managed), prefetched.
- Locked rooms: RoomCard dimmed + lock; RoomLockGate modal (5 boxes) → /join {pin, room_password}; room_entries grant (120s fresh window for room-screen join), WS 4403 / rtc token 403 without grant; 10 fails/10min → 429; leave/lock change revokes.
- Room chat history cutoff = current entry joined_at (WS history + GET /rooms/{id}/chat).
- DM: dm_prefs (pinned, cleared_at); /messages/threads/{peer}/pin, DELETE /messages/threads/{peer}; /messages/{id}/unsend (sender), /messages/{id}/delete {me|everyone(sender)}; hidden_for. ActionSheet component.
- Calls: web engine agora-rtc-sdk-ng (real audio), native speech profile + AINS; minimize → draggable MiniCall; poll 1.5s; peer-left triggers re-check.

## Iter-140 — Room UI contrast, managed rooms page, blocking, posts visibility/share (DONE)
- Room names plain white on dark plate (RoomCard, header, title sheet); room foreground ROOM_FG white; glass seats.
- /managed-rooms page (RoomCard list) from 🏠 popup. AuthGate allow-list includes managed-rooms, post.
- Entrance overlay full width centered, no shadows; InlineEntrance preview in EntranceRewardModal.
- Blocking: _block_state/_assert_not_blocked; GET /users/{id} → is_blocked_view; DM/gift/calls 403 BLOCKED both ways; ProfileView blocked view; chat red "!" failed messages.
- Host chair: no toast; owner/mod tools hidden for regular users; room chat long-press Copy pill.
- Posts: _posts_out (live authors, visibility+block filter), 9 images / one ≤60s video, visibility public|mutual, PATCH /posts/{id}/visibility, GET /posts/{id}, POST /posts/{id}/share (DM kind=post), GET /users/me/mutuals; PostMedia compact + full-screen viewer; PostShareSheet; app/post/[id].tsx.

## Iter-141 — Voice waveform, 2-min edit window, search tabs, GIF pass, call history (DONE)
- Voice: metering → waveform[] stored on message; VoiceBubble waveform bars; voice/gift/call no action menu.
- Unsend / delete-everyone only ≤120s (EDIT_WINDOW_EXPIRED); delete-everyone → kind "deleted".
- Chat header avatar → profile. Posts ?media=photos|videos sub-tabs; /users/{id}/posts (profile latest 5).
- /rooms/search + search screen Users/Rooms tabs. Country picker white + smaller. VIP center opens at user level.
- Calls: /calls/current heartbeat (app_active_at, foreground only); CALLEE_UNAVAILABLE → missed; _flush_call_logs writes DM kind "call".
- GIF pass: POST /me/gif-access/purchase (19,999💎, 7d, idempotent request_id, ledger); _gif_eligible; _freeze_expired_gifs loop (60s) → static first frame; GifAccessModal.

## Iter-142 — ID search, room report, chat mute/lock, minimize to tabs (DONE)
- /search?mode=id (Messages add friend): exact numeric ID → profile; Search button in bar; discovery results badges Age·VIP·Wealth·Charm.
- RoomCard name plain text; Me tab spacing; profile posts 96px tiles vertical; language page closes then applies.
- POST /rooms/{id}/report (user_reports target_type room, review only); /report?room_id notice.
- POST /rooms/{id}/chat-mute, /chat-lock; WS chat_rejected CHAT_MUTED/CHAT_LOCKED; card Mute from Chat; Room Controls Mute Room Chat.
- Minimize → /home; FloatingMiniRoom only on /home,/me,/messages,/posts; edge docking.

## Iter-143 — FINAL UPDATE Batch A (DONE)
- Toast: black rounded pill, fixed 40px logo tile (OrioLogo — swap for user's uploaded logo when provided), bottom anchored, fade only; deleted profile → toast + back.
- Rooms empty state text only. Splash: 187px rounded logo, more spacing, no spinner.
- Silent mic chat events. Entrance once per genuine /join (room_entries.entrance_played).
- Profile latest 5 posts horizontal row. Reports: 1–3 reasons (user/room/post/comment), /posts/{id}/report, /comments/{id}/report.
- Room audio button visible. Global ranking redesign (no All, plain tabs, Messages-like rows, 🔥 K/M, fixed my row).
## Batch B (NEXT SESSION — user approved split)
Account deletion page + 72h scheduling; 20 animated emoji reactions; room gift panel changes; global luxury gift banner (>2,999💎); gift animations ≤50% width + Royal Dragon 500k / Mythical Phoenix 1M; official ORIO diamond everywhere (user will upload artwork + toast logo); profile scroll header + VIP names everywhere; posts media 3×3 + post ••• Report + comments badges/Reply/Report; APK size optimization; network weak/restored toasts.

## Batch B — Phase 1 (DONE, tested iteration_83)
- Toast: official ORIO planet logo (assets/images/orio-toast-logo.png) in 28px rounded-square tile, compact pill, fade only; NetworkWatcher (weak/lost/restored, AR/EN).
- Account deletion: /delete-account page (user-supplied Arabic policy + EN), confirm modal, POST /api/account/deletion/request, 72h window (login cancels, one-shot /auth/me deletion_cancelled), backend/account_deletion.py finalizer loop (10 min), 3-day credential reuse cooldown (deleted_credentials), /users/{id} → 410.
- Queued (user request): Login screen update — Google big button + Phone/Email/Facebook/Snapchat row, phone screen w/ searchable countries + SMS/WhatsApp via Twilio Verify. Needs Twilio, Facebook, Snapchat credentials.

## Batch B — Phases 2–5 (DONE, tested iterations 84–86)
- Logo rule: OrioLogo removed from ConfirmModal, BanScreen, Messages official thread, chat header (toast only). Login + splash still show branding (pending user confirmation).
- Phase 2: Gift panel (GiftCard shake, "إهداء/Gift" compact button, الجميع+room / الجميع+mic chips, owner pinned + backend allows owner recipient, balance→Wallet, live balance). Gifts use Noto transparent PNG + Lottie (animation_url); new royal_dragon 500k + mythical_phoenix 1M (luxury_fx). GiftFxOverlay ≤50% width. Global gold banner via /api/ws/global (total_cost > 2999), Go/Cancel dialog.
- Phase 3: 20 Noto Lottie reactions (src/reactions), room WS "reaction" (2.5s cooldown, seat overlay 5s or chat), DM POST /api/messages/reaction (kind emoji, tap to replay).
- Phase 4: CommentsSheet (badges, replies parent_id, Reply/Report, avatar→profile), post ••• Report for others, profile scroll header, single-image aspect ratio + 3-col grid, VipName in share sheet + calls.
- Phase 5: expo-build-properties (R8/proguard, shrinkResources, arm64/armv7 only), plugins/withAgoraSlim.js (drop Agora video extensions), levels PNGs resized 54MB→22MB.
- PENDING: official diamond image (swap src/components/Diamond.tsx), login screen update (needs Twilio/Facebook/Snapchat keys).

## Iter-147 — Room/Gifts/Emoji/Ranking update (DONE, tested iteration_87)
- VIP5+ custom image gifts: fixed 5,000 (CUSTOM_GIFT_PRICE), upload purpose=gift via object storage, auto-approved, sendable as cg_<id> (creator only).
- RoomComboButton (red, top-left, 3s SVG ring, real re-send per tap, idempotent request_id); panel closes after send; gift chat notices compact + broadcast to all; banner narrower.
- One-tap seat join (staff too when unseated); red mute badge; RoomMenu Mute → Mute Chat (owner/mods, server chat_locked); staff-only mic mute in card.
- RoomUserCard compact action row (others: Gift | Follow/Unfollow | Mute[staff]; self: Leave Seat | Gift | Mute/Unmute), white text.
- Join names yellow (VIP6+ keeps VIP color), reactions in chat via ChatIdentityRow content (looping), mirrored kiss 1f618_m; ranking tabs sticky.

## Batch C — Rankings / Posts / Chat / Music (implemented)
- Rankings: GET /api/rankings/v3/{category} {items, me}; wealth/charm/rooms = gift_transactions.total_cost × 10 (RANK_POINTS_PER_DIAMOND); rooms → RoomCard + own room pinned; room ranking ×10 + `me`. Shared src/rankings/RankingView.tsx + crimson SVG FlameBadge.
- Room UI: HOST label removed, card avatar purple ring removed, Me spacing, Activities sub-tabs only on main (Live Now/جار الآن), My Activities shows all own events.
- Posts: badges under author, compact progressive grid, viewer opens tapped image (FlatList initialScrollIndex), /user-posts?author_id&focus (re-exports posts tab in author mode), Arabic delete ConfirmModal.
- Chat: dedupe by id, gift play icon → GiftFxOverlay centered, presence (GET /api/users/{id}/presence; offline keeps last_seen).
- Music: backend rooms.music state + /api/music/catalog (30 Arabic songs metadata; playable only with admin-set db.music_catalog.licensed_url) + /rooms/{id}/music(/add,/control) broadcast music_state. Native: src/room/musicEngine.ts Agora startAudioMixing (DJ broadcast, mic mute via recording volume while music active). Web: local preview only. MusicSheet rewritten (phone via expo-media-library/legacy on Android, document picker iOS/web).

## Iter-149 — Music sheet requirements (DONE)
- From Phone auto-lists all device audio (paged scan, rescanned each open, no file picker)
- (+) adds in place -> 'Added / تم الإضافة' pill (server-derived, persists), no duplicates (phone dedup by uri+owner)
- Playlist Delete/حذف toggle with red trash per row
- Not seated -> toast 'يرجى الصعود على المايك للتشغيل'

## Iter-150 (DONE)
- Edit profile cover on top behind avatar; nickname <=20; monthly name-change limits by VIP (config override db.config name_change_limits)
- Push: backend/push.py + /api/register-push, /users/me/push pref, triggers on DMs, DM gifts, mic invites, system notifications. Needs google-services.json + deploy build
- Room: empty mic sheet for staff, brighter backdrop, stable chat ids, 180s seat grace, full-mute (rooms.full_muted_users) vs voice mute, image chat VIP5+, gift message format, yellow system notice, combo at bottom
- Private chat gift sheet = room catalog; emoji not pressable; custom gift optional <=10s video; mini room height 48

## Iter-151 (DONE)
- Custom gifts: full-screen Customize Gift (name, 4,999 fixed, video<=10s + cover required), public catalog for all users, admin /admin/custom-gifts remove; full-screen video FX for all room users
- Gift panel zIndex above FX; white RoomUserCard; new multi-line welcome notice; chat mute banners/toasts

## Iter-152 (DONE)
- Chat bubble wraps fully; removed bottom bar blur; chat-mute via placeholder + dimmed input + blocker toast; unlimited VIP5+ custom gifts

## Iter-153 (DONE)
- From Internet = Audius public API (streamable/ungated only, search ?q=), legacy unlicensed titles hidden; phone audio extension filter; ranking room flame pill on card corner

## Iter-154 (DONE)
- Release build safety: proguard/minify/shrinkResources OFF; userInterfaceStyle light; global dark-content status bar, light inside rooms
- Contrast fixes: login links, Me banner bg, level progress pill, rankings chip, wallet gradient

## Iter-155 (DONE)
- Android JS bundle compiles (expo export android: 2566 modules OK; hermesc can't run in container arch)
- Native diagnostics: src/diagnostics.ts (global handler + console.error + ErrorBoundary) -> POST /api/client-errors; admin page /admin/client-errors; release ErrorBoundary now shows error message
