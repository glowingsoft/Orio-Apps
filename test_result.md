#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  ORIO — Room Discovery + Room UI + Mic Layout + Host Chair + User Popup + Chat polish.
  Preserve all working systems (Agora, VIP, Profile, Auth). Real data only.
  Key requirements this iteration:
    1) Compact 2-column room-discovery cards (dark/premium, small cover strip + info footer).
    2) Country selector single button + real filtering; no "LIVE" text; dynamic room type badge.
    3) Mic layout semantics: `num_seats` = numbered mic seats (excluding host). Total slots = num_seats+1.
       Allowed: 1 host + 8 mic (=9 slots), 1 host + 15 (=16), 1 host + 20 (=21).
    4) Dedicated Host chair separate from numbered grid, upper-left, always present, real owner state.
    5) Numbered mic seats: same size across 8/15/20 layouts, no overlap.
    6) Chat compact, below mic area, doesn't cover seats.
    7) Room user popup (bottom sheet): tap avatar → half-screen sheet, real 8-digit ID with copy,
       real gifts gallery (aggregated from gift_transactions), Family placeholder, Leave-Seat for self,
       Send Gift for others (opens gift-panel with correct recipient). Opening the card must NOT
       remove the user from their seat.
    8) 8-digit ID copyable everywhere it appears (me.tsx, RoomUserCard, ProfileView).
    9) Received Gifts page (/user/{id}/gifts) with real backend data (aggregated + recent).
    10) Minimized room ~half its previous size (140x44), still draggable+voice-persistent.

backend:
  - task: "Room seat model: host + numbered semantics"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Redefined `num_seats` in CreateRoomIn as "numbered mic seats" only (excludes host).
            create_room now provisions `num_seats + 1` seat slots; seats[0] = dedicated host chair.
            /rooms/{id}/layout produces `num_seats + 1` total slots and preserves existing seat state.
            seed_demo_rooms updated to 9 slots (host + 8 numbered).
            Added `_migrate_rooms_host_plus_numbered` lifespan migration: for every existing room whose
            seats array has < num_seats+1 entries, we pad with empty slots (idempotent). Verified in mongo:
            all 66 rooms now have `len(seats) == num_seats + 1` (8→9, 15→16, 20→21).
            SeatActionIn max index raised 19→20 to allow the top numbered index in a 20-mic room.

  - task: "GET /users/{id}/gifts-received endpoint"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            New endpoint aggregates gift_transactions by recipient. Accepts either 24-char ObjectId
            or 8-digit numeric_id in the path. Returns:
              - `user`: id/nickname/avatar_url/numeric_id
              - `gifts`: [{gift_id, gift_name, gift_image, unit_price, total_quantity, total_cost,
                          last_at, senders[<=5]}], sorted by total_cost DESC
              - `recent`: last 20 raw gift_transactions (chronological DESC)
              - `total_gifts`, `total_value`
            Curl-tested via demo login: `keys=['user','gifts','recent','total_gifts','total_value']`.
            404 if user not found. Existing gift_transactions indexes already cover the recipient query.

frontend:
  - task: "Compact room discovery cards"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/home.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Replaced the giant portrait card (aspectRatio 0.85, absolute overlay text) with a
            compact 2-column card: 1.2 aspect-ratio cover strip on top + a 2-line info footer
            (name + listeners + owner nickname). Type badge (CHAT/DJ/PK/TEAM/GAME/MEET/STUDY/VOICE)
            and country flag remain as small overlays. All Countries selector unchanged. Verified
            visually — cards now fit ~6 per screen instead of 2.

  - task: "Room screen: host chair + numbered mic seats"
    implemented: true
    working: "NA"
    file: "frontend/app/room/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            `computeSeatMetrics` now takes numbered-mic-seats count (excludes host). Rows layout:
            8 → [4,4], 15 → [5,5,5], 20 → [5,5,5,5]. Seat size is dynamic and clamped so the widest
            row fits within screen width.
            The dedicated Host chair (`testID=host-chair`, badge `host-chair-badge`) is now rendered
            as a separate block above the numbered grid, aligned to the upper-left corner (upper-right
            in RTL). SeatBubble accepts `hideIndex` (used only by host) and `testID` overrides.
            Numbered seat labels now show `seat.index` (1..N) since host occupies index 0.
            LayoutPicker labels: "1 host + 8 mic seats" etc.
            Renamed the local variable numSeats → numberedMicSeats and fixed the LayoutPicker prop.

  - task: "Chat + bottom action bar polish"
    implemented: true
    working: "NA"
    file: "frontend/app/room/[id].tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Chat feed maxHeight 200→140, bottom offset 100→76, sits above the compacted action bar
            and no longer covers the mic seats. Bottom action buttons 48→40 px, chat input 44→40 px,
            icon sizes 22→18. Keyboard-avoiding view unchanged so keyboard doesn't move mic grid.

  - task: "RoomUserCard bottom sheet with real gifts + copy ID"
    implemented: true
    working: "NA"
    file: "frontend/src/room/RoomUserCard.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Converted from centered floating card to a slide-up bottom sheet (~62% screen height).
            Displays real user data: nickname, 8-digit ID (tappable, tap-to-copy with
            testID=card-copy-id + green "Copied!" state + haptic on native), country flag,
            gender+age pill, account age chip, Wealth/Charm/VIP stats, Family placeholder.
            Gift Gallery preview now consumes GET /users/{id}/gifts-received (first 4 gifts with
            real images + quantity badges). Tapping the gallery navigates to /user/{id}/gifts.
            Action bar preserved: Leave-Seat for self+on-seat, Send Gift for others (opens
            gift-panel with correct recipient), Open Profile fallback for self+off-seat.

  - task: "Received-gifts page /user/[id]/gifts"
    implemented: true
    working: "NA"
    file: "frontend/app/user/[id]/gifts.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            New route that fetches apiUserGiftsReceived(id) and shows a 3-column grid of received
            gifts, each with image, quantity badge (×N), name and total diamonds cost. Summary
            header shows recipient avatar, 8-digit ID, total gifts count and total value.
            Empty state shown when the user has never been gifted. Pull-to-refresh via
            OrioRefreshControl.

  - task: "Copy-to-clipboard 8-digit ID everywhere"
    implemented: true
    working: "NA"
    file: "frontend/src/utils/copyId.ts, frontend/app/(tabs)/me.tsx, frontend/src/room/RoomUserCard.tsx, frontend/src/profile/ProfileView.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            New shared util `copyIdToClipboard()` (uses expo-clipboard + expo-haptics on native).
            me.tsx: ID chip is now a Pressable (`testID=me-copy-id`) that copies numeric_id and
            flashes a green "Copied!" state. RoomUserCard: `testID=card-copy-id`. ProfileView
            already had copy behavior (kept as-is).

  - task: "FloatingMiniRoom size reduction"
    implemented: true
    working: "NA"
    file: "frontend/src/room/FloatingMiniRoom.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
        - working: "NA"
          agent: "main"
          comment: |
            Width 200→140 px, height 56→44 px, avatar 36→30 px, close 24→20 px, meta text sizes
            reduced accordingly. Drag/clamp/tap-to-restore behavior unchanged. Agora voice remains
            live while minimized (behavior driven by RoomSessionProvider — untouched).

metadata:
  created_by: "main_agent"
  version: "0.1"
  test_sequence: 24
  run_ui: false

test_plan:
  current_focus:
    - "Backend: rooms have num_seats+1 slots (host + numbered) after migration"
    - "Backend: POST /rooms creates num_seats+1 slots and seat[0] is owner"
    - "Backend: PATCH /rooms/{id}/layout resizes to num_seats+1 slots for 8/15/20"
    - "Backend: GET /users/{id}/gifts-received (both ObjectId and numeric_id path params)"
    - "Frontend: room discovery cards render compact (2-column, 1.2 aspect ratio cover strip)"
    - "Frontend: room screen shows dedicated host chair + numbered grid (testIDs host-chair, host-chair-badge, seat-1..N)"
    - "Frontend: LayoutPicker labels show '1 host + N mic seats'"
    - "Frontend: RoomUserCard bottom sheet — tap avatar, copy ID, real gift gallery, Send Gift routes to correct recipient, opening card does NOT change seat state"
    - "Frontend: /user/{id}/gifts renders real backend gifts + summary + empty state"
    - "Frontend: me.tsx ID chip copies numeric_id and shows 'Copied!'"
    - "Frontend: FloatingMiniRoom is 140x44 and stays inside viewport when dragged"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Iteration 19 — Fixed mic size + username plate + real-time people strip + expanded Discovery categories.
      Preserved: Agora, RoomSession, seat model, VIP, Profile, Auth, iter-16/17/18 behavior.

      BACKEND additions:
        1) GET /rooms?sort=popular — sort by follow_count DESC then listeners DESC.
        2) GET /rooms?sort=pk — rooms currently running an active PK match.
        3) GET /rooms/following — real followed-rooms list for the caller.
        4) GET /rooms/watched — recently visited rooms (uses new `room_visits` collection).
        5) room_visits collection with unique (user_id, room_id) + (user_id, visited_at desc) indexes; POST /rooms/{id}/join now upserts a `visited_at` row.

      FRONTEND additions:
        A) Room screen (app/room/[id].tsx)
           - computeSeatMetrics returns a FIXED seat size (62px) regardless of mic mode. Rows stay 4/4, 5/5/5, 5/5/5/5 for 8/15/20. No dynamic shrink.
           - Every seat username now uses a translucent black plate (styles.seatName). Marquee unchanged.
           - NEW `RoomPeopleStrip` component below the header: horizontal, no scrollbar, real WS `session.participants` de-duplicated by user id, tapping avatar opens `RoomUserCard` without altering seat state. Trailing pill shows the real count (`room-people-count`).

        B) Discover Rooms (app/(tabs)/home.tsx)
           - Replaced iter-18 Countries/Recommended segmented control with a full horizontal ScrollView of 9 categories: Recommended, Most Popular, PK, Games, Chat, Music, Following, Family, Watched. Selected tab uses purple ORIO active pill.
           - Country selector is ALWAYS visible below the tab row (both filters combine).
           - Per-category empty states (localized Arabic/English).
           - Wired to the new backend endpoints.

        C) src/api.ts
           - apiListRoomsPopular, apiListRoomsPk, apiRoomsFollowing, apiRoomsWatched.

      Testing scope:
        BACKEND
          B1. GET /rooms?sort=popular returns rooms sorted by follow_count DESC then listeners DESC. Empty-listeners rule still applies.
          B2. GET /rooms?sort=pk returns only rooms with an active PK match. Verify by starting a PK.
          B3. GET /rooms/following returns the caller's followed rooms; unfollowing removes it.
          B4. GET /rooms/watched returns rooms in newest-visit order; joining a new room adds it; duplicate visit updates `visited_at`.
          B5. Regression: iter-18 follow/membership/mod/ban endpoints still 100% pass.

        FRONTEND
          F1. Room screen — seat size is identical for 8/15/20 modes. Measure `seat-1` bounding-box width; assert equal across the 3 modes (owner switches Mic Mode via bottom-more → room-info → mic mode — OR: hard-verify by loading three demo rooms with num_seats=8/15/20).
          F2. Every seat with a user shows a `<Text>` inside a black translucent plate (`backgroundColor: rgba(0,0,0,0.55)`).
          F3. `room-people-strip` visible in the room; `strip-person-*` avatars present; count matches `session.participants.length`.
          F4. Tapping a strip avatar opens `room-user-card`; seat DOM unchanged before/after.
          F5. Discover Rooms — tab row scrolls horizontally, no visible scrollbar; `tab-recommended`, `tab-popular`, `tab-pk`, `tab-games`, `tab-chat`, `tab-music`, `tab-following`, `tab-family`, `tab-watched` all present.
          F6. Selecting a tab drives a fresh query (verify by intercepting fetch OR snapshot of the empty state / room count changing).
          F7. Country selector is visible regardless of the current tab; opening it and picking a country re-runs the same tab's query with `country_code`.
          F8. Following-tab empty state shows the localized "You aren't following any rooms yet." text (only when the demo user follows 0 rooms).
          F9. Regression: `room-follow-heart` still works; `create-room-btn` still holds `<svg>`; iter-16..18 checks (removed header pieces, `room-name-btn`, `room-info-screen`, `room-more-sheet`) still pass.

      Save to /app/test_reports/iteration_19.json.

  - agent: "main"
    message: |
      Iteration 18 — Room Header simplification + Room Info screen + Follow/Membership/Moderator/Bans + Two-part discovery + custom ORIO icons.
      Preserved: Agora, RoomSession, seat model, VIP, Profile, Auth, all iter-16/17 behavior.

      BACKEND additions (curl-verified):
        1) public_room now exposes `is_deleted`, `follow_count`, `member_count`, `background_url` (falls back to cover_url).
        2) GET /api/rooms now accepts `?sort=recommended` — server-side aggregation ranks by
           listeners*3 + follow_count*2 + recent_gifts*5 (last hour).
        3) Rooms are NEVER auto-deleted. Discovery filter `is_deleted != true` + existing `listeners>0` gating only.
        4) Ban enforcement: banned users get 403 "You are banned from this room" on POST /rooms/{id}/join.
        5) Room follow: POST /rooms/{id}/follow (idempotent), DELETE /rooms/{id}/follow, GET /rooms/{id}/follow-status.
        6) Room membership: POST /rooms/{id}/membership/request (must follow first), GET /rooms/{id}/membership/pending (owner/mod), POST /rooms/{id}/membership/review (owner only, approve/reject → creates room_members row).
        7) Members list: GET /rooms/{id}/members.
        8) Moderators: GET /rooms/{id}/moderators, POST /rooms/{id}/moderators/add (owner only + user must be approved member first), POST /rooms/{id}/moderators/remove (owner only).
        9) Bans: GET /rooms/{id}/bans, POST /rooms/{id}/bans/add, POST /rooms/{id}/bans/remove (owner/mod).
        10) Unique indexes created for room_follows, room_members, room_membership_requests, room_bans.
        11) After follow/unfollow, room.follow_count is atomically synced from the count of room_follows.

      FRONTEND additions (lint clean, expo restarted OK):
        A) Room screen (app/room/[id].tsx)
           - Top header now shows ONLY the room name + `RoomFollowHeart` (custom blue ORIO heart with real count from the new follow-status endpoint).
           - Removed from header: minimize icon, ID text, Voice Off pill, category badge, three-dot menu, participants button.
           - Tapping the room name → navigates to `/room/{id}/info` (testID `room-name-btn`, `room-name`).
           - RoomFollowHeart also renders `OrioMembership` beside the heart when the user is following. Membership request creates a real backend request (testID `room-membership-btn`).
           - BottomMoreSheet expanded to include: Music (placeholder), PK Challenge (real), Minimize (`more-minimize`), Room Info (`more-room-info`), Mute Room (`more-room-mute`). Everything the old three-dot menu did is re-homed here.
           - RoomMenu component itself is retained (dead-code, not triggered) — it's still safe to re-enable in future.

        B) NEW Room Info screen (app/room/[id]/info.tsx)
           - Real room background/cover, real room name.
           - Custom-ORIO Follow heart (`room-info-follow`) with live count (`room-info-follow-count`).
           - Custom-ORIO Membership button (`room-info-membership`) with progressive states: Join → Pending → Member.
           - Owner card with tap-to-copy 8-digit ORIO ID (`room-info-owner-id`).
           - Pending Membership Requests section (owner only) — Approve/Reject buttons (`pending-approve-*`, `pending-reject-*`).
           - Horizontal Members list (`section-members`) with per-member `mod-add-*` / `mod-remove-*` when owner.
           - Horizontal Moderators list (`section-mods`).
           - Horizontal Banned Users list (`section-bans`) with `ban-remove-*` when owner/mod.
           - Real Share via `expo.Share.share({ Linking.createURL('/room/{id}') })`.

        C) NEW custom ORIO icons (src/components/OrioIcons.tsx) — pure SVG:
           - `OrioHeart` (blue V-notched, active state gradient + glow ring)
           - `OrioMembership` (orange winged plus, diamond body)
           - `OrioCreateRoom` (gold house silhouette with + door notch)
           - `OrioMoveMic` (transfer arrows between two circles) — imported but not currently placed; ready for owner Move-Mic feature.

        D) Discover Rooms (app/(tabs)/home.tsx)
           - Replaced the generic + Create Room icon with `OrioCreateRoom` inside a dark rounded button.
           - Added two-part segmented filter: `filter-countries` and `filter-recommended` (50/50 width). Selection state highlights gold.
           - Recommended tab drives `apiListRooms({ sort: 'recommended' })` (real server ranking).
           - Country picker button now renders below the segmented row and is only visible in the Countries tab. React Query key includes `tab`.

        E) Create Room CTA (app/create-room.tsx)
           - "Go Live 🎙️" → "Create Room".

      Curl-verified end-to-end:
        - Follow (POST) idempotent: two follows produce follow_count=1 exactly.
        - Membership request without follow → 400.
        - Membership request after follow → 200 pending.
        - Owner approves → member row created; GET /rooms/{id}/members returns the row.
        - `moderators/add` after approval → 200; GET /moderators includes them.
        - `bans/add` on a valid user → 200; GET /bans includes them.
        - `?sort=recommended` returns rooms ordered by real activity signal.

      Testing scope for the testing agent:
        BACKEND (high priority):
          B1. Follow flow: POST /rooms/{id}/follow twice → follow_count stays at 1 (idempotent); DELETE /rooms/{id}/follow → 0. Concurrent follows do not double-count.
          B2. GET /rooms/{id}/follow-status: returns is_following/is_member/has_pending_request/follow_count/member_count.
          B3. Membership: POST /membership/request without follow → 400. With follow → 200. Duplicate pending → 409. Owner sees pending. Non-owner reviewing → 403. Approve → member appears. Reject → member does NOT appear.
          B4. Moderators: owner adds non-member → 400 "must be an approved member". Owner adds after approval → 200. Non-owner adds → 403. Owner removes → 200.
          B5. Bans: owner/mod ban valid target → row present. Ban owner → 400. Banned user joining → 403. Unban → row removed.
          B6. Room persistence: create room, leave, verify GET /rooms/{id} still 200; verify listeners_count reflects real count; verify the room is NOT deleted.
          B7. Recommended sort: create two rooms — one with only listeners_count=0 (empty), one with follows/gifts — both must be excluded when empty; the seeded rooms with listeners>0 should return sorted by reco_score.

        FRONTEND (high priority):
          F1. Discover Rooms: two `filter-*` buttons visible, each with roughly 50% width (verify: `filter-countries` width and `filter-recommended` width are within 10% of each other). Tap Recommended → rooms list refreshes (queryKey change). Country picker `country-selector-btn` visible only in Countries tab.
          F2. Create room icon: `create-room-btn` contains an SVG element (not an <Ionicons ellipsis-*> font glyph). Verify by checking the DOM child is `<svg>` and viewBox="0 0 24 24".
          F3. Room screen header: has `room-name-btn` and `room-name`. Does NOT have `room-menu-btn`, `room-minimize-btn`, `voice-status`, `room-participants-btn`, or "LIVE"/"ID XX" text (assert count of these testIDs is 0).
          F4. Room screen: `room-follow-heart` visible with `room-follow-count`. Tap it → count changes atomically (increment then decrement on next tap).
          F5. Membership button hidden until follow: assert `room-membership-btn` count = 0 initially, then tap heart → count = 1.
          F6. Tap `room-name-btn` → route lands on `/room/{id}/info`; `room-info-screen` visible. Section testIDs `section-members`, `section-mods`, `section-bans` render.
          F7. Bottom four-dot menu (`room-more-btn` → `room-more-sheet`) contains: `more-music`, `more-pk`, `more-minimize`, `more-room-info`, `more-room-mute`.
          F8. `create-room-submit` label: no "Go Live" text anywhere on the Create Room screen; the button text is "Create Room".
          F9. Lint & runtime — no console errors on room screen or /room/{id}/info.

        Rules
        - Preserve rule: Do NOT touch Agora hook, RoomSession, VIP, Profile, or Auth.
        - Fix P0/P1 minimally if found, then re-verify only the affected checks.
        - Save JSON to /app/test_reports/iteration_18.json.

  - agent: "main"
    message: |
      Iteration 17 — ROOM UI/UX + PERMISSIONS + PK + LOCK + REAL PRESENCE (huge patch).
      All requested surgical changes to the EXISTING room system. Preserved: Agora, RoomSession,
      seat model (num_seats = numbered mic seats, seat[0] = host), VIP, Profile, Auth.

      Backend additions (all lint clean, backend restarted OK):
        1) POST /rooms/{id}/seats/take — Host chair (seat 0) now rejects non-owner/mod with
           HTTP 403 "هذا المقعد لصاحب الغرفة فقط".
        2) POST /rooms/{id}/join — accepts optional body {pin: "5-digit"}; 403 when locked
           and caller isn't owner/mod/seated.
        3) GET /rooms/{id}/participants — real WS presence list from `_hub.presence`.
        4) POST /rooms/{id}/lock (owner/mod) with 5-digit pin (regex ^\d{5}$) — bcrypt-hashed
           into pin_hash; broadcasts system "room_locked".
        5) POST /rooms/{id}/unlock — clears pin_hash; system "room_unlocked".
        6) POST /rooms/{id}/mic-invite — owner/mod invites a presence user to an EMPTY seat.
           Rejects when target isn't in WS presence; enforces host-seat restriction.
        7) POST /rooms/{id}/mic-change-seat — owner/mod moves seated user from→to; preserves
           mute state; refuses locked/occupied/host-forbidden destinations.
        8) POST /rooms/{id}/pk/start, GET /rooms/{id}/pk, POST /rooms/{id}/pk/end — minimal 1v1
           PK match between two SEATED users; only 1 active per room; server-authoritative
           winner. Scoring is automatic: when POST /gifts/send is called with `room_id` and the
           recipient occupies a PK seat, the gift's total_cost is $inc'd into score_a or score_b
           and pk_score is broadcast over the WS.
        9) public_room now exposes is_locked; pin_hash never leaks to responses.
       10) _ModerateIn.seat_index upper bound raised 19→20 to match new host+20 layouts.

      Frontend additions (lint clean, expo restarted OK):
        A) app/room/[id].tsx
           - Top header: room name moved to upper corner (RTL-aware); added
             `room-participants-btn` with real-time count + `room-menu-btn` uses ellipsis-horizontal
             (`•••`) and HIDES while the menu sheet is open.
           - Minimize icon → `contract-outline` (arrows-inward).
           - handleExit: available to ALL users (no more owner-only close confirm dialog).
           - handleSeat: owner/mod → opens `MicActionSheet` for the tapped seat; normal user
             direct-tap still works exactly as before. Take-seat errors (host-only) surfaced
             as native Alert with the Arabic 403 message.
           - LayoutPicker title now "Mic Mode / وضعيات الميكات".
           - New sheets: `ParticipantsSheet`, `MicActionSheet` (Change Seat / Invite / Lock or
             "Open Mic" if locked), `InviteToSeatSheet` (in-room non-seated users),
             `ChangeSeatSheet`, `LockRoomPrompt` (5-digit input), `BottomMoreSheet`
             (Music placeholder + PK), `PkPanel` (start/end + live score bar via polling every 3s).
           - Bottom action bar: `exit-room-btn` REMOVED; new `room-more-btn` (four-dot `apps`).
           - RoomMenu redesigned: Exit / Share / Minimize / Mute Room (toggles session.roomMuted)
             / Clear Chat (mod) / Lock or Unlock Room (mod) / Mic Mode (mod) / Mute self.

        B) src/room/RoomUserCard.tsx
           - Modal backdrop is transparent — the room stays at normal brightness when opening
             a profile (no dark overlay).
           - Removed the horizontal cover strip above the avatar (unwanted bar).
           - Send Gifts always renders for OTHER users; Leave Seat only when the target user
             is *me* AND on a seat; Open Profile appears for me-off-seat.

        C) src/hooks/useAgora.ts
           - New `roomMuted` option: when true, calls `muteAllRemoteAudioStreams(true)` (native)
             or `adjustPlaybackSignalVolume(0)` (web) so the local user hears no room audio while
             still publishing their own mic if seated. Reactive via useEffect.

        D) src/room/RoomSession.tsx
           - Tracks WS `present[]` for user_joined/user_left → exposed as `participants`.
           - Owns `roomMuted` + `setRoomMuted` and forwards to useAgora.
           - cleanup clears both.

        E) src/api.ts
           - Added apiRoomParticipants, apiRoomLock, apiRoomUnlock, apiMicInvite,
             apiMicChangeSeat, apiRoomModerate, apiPkStart, apiPkState, apiPkEnd,
             apiJoinWithPin.

        F) Seat mute indicator (Section 13)
           - Rendered OUTSIDE the Pressable (which has overflow:hidden) so the mute badge
             now sits outside the circular avatar boundary; wrapper is position:relative.

      Curl-verified against localhost:
        - POST /rooms → 9 slots for num_seats=8 (still passes iter16 contract).
        - GET /rooms/{id}/participants → count/participants array.
        - POST /rooms/{id}/lock with valid pin → 200 is_locked:true; bad pin ("abc12") → 400.
        - is_locked exposed in public_room; pin_hash NEVER exposed.
        - POST /rooms/{id}/unlock → is_locked:false.
        - POST /rooms/{id}/pk/start with unoccupied seats → 400 "Both seats must be occupied".
        - Owner taking seat 2 → 200 (host chair rule doesn't affect numbered seats).

      Testing scope for the testing agent:
        Backend (high priority — new + regression):
          1) Host chair permission: as a non-owner user, POST /rooms/{someone_elses_room}/seats/take
             with seat_index=0 → 403 with detail exactly "هذا المقعد لصاحب الغرفة فقط".
          2) POST /rooms/{id}/lock: owner sets pin "12345" → 200 is_locked:true.
             pin "abc12" → 400. pin "1234" → 400.
             Non-owner call → 403.
          3) POST /rooms/{id}/join with pin body: locked room + wrong pin → 403; correct pin → 200.
             Owner joining locked room without pin → 200 (owners bypass).
          4) GET /rooms/{id}/participants → shape {room_id, count, participants:[]}.
          5) POST /rooms/{id}/mic-invite: owner invites a presence user to empty seat → 200,
             seat[idx].user = target. Non-owner call → 403. Target not in presence → 400.
             Invite into host seat (idx=0) for a non-owner target → 403 with host message.
          6) POST /rooms/{id}/mic-change-seat: from occupied→empty → 200 and mute preserved.
             from empty → 400. from→to identical → returns room unchanged.
             Non-mod call → 403.
          7) PK flow: start with two seated users → 200 status=active; GET returns match;
             concurrent second start → 409; send a gift with room_id → score increments for
             the correct side (checkable via GET); end → 200 status=ended, winner ∈ {a,b,tie}.
          8) is_locked exposed on public_room; pin_hash never leaks.

        Frontend (high priority):
          9) Top header — `room-name` in the upper corner (not center); `room-participants-btn`
             + `room-participants-count`; `room-menu-btn` uses ellipsis-horizontal and hides
             while the menu sheet is open, then returns to `•••` on close.
         10) LayoutPicker title contains "Mic Mode" (English) and "وضعيات الميكات" (Arabic).
         11) Bottom bar has `mic-btn`, `gift-btn`, `room-more-btn` — NO `exit-room-btn`.
         12) Room menu items include `menu-exit`, `menu-share`, `menu-minimize`, `menu-room-mute`,
             `menu-clear-chat`, `menu-lock-room`, `menu-mic-mode`, `menu-mute` — no "Close Room".
         13) Minimize icon renders `contract-outline` (arrows inward).
         14) Tap own avatar on the host chair as owner: `MicActionSheet` does NOT appear (self
             seat → RoomUserCard opens instead).
             Tap ANY OTHER seat as owner: `mic-action-sheet` appears with the right items
             (open → Invite + Lock; locked → Open Mic only; occupied → Change Seat + Lock).
         15) RoomUserCard: backdrop is transparent (room stays lit); no cover strip; Send Gifts
             shown for others; Leave Seat only when self on seat.
         16) Chat: no scrollbar visible (showsVerticalScrollIndicator=false already), still
             swipe-scrollable, doesn't overlap mic grid.
         17) FloatingMiniRoom 140x44 preserved.
         18) Muted seat: badge visible OUTSIDE the circular avatar boundary
             (verify a seated + muted user shows the badge below-right, not clipped).

      Rules for testing agent:
        - Do NOT edit files; verification only. If a P0/P1 issue is found, fix it minimally
          in the file it lives in and re-run only the affected checks.
        - Do NOT touch Agora hook, RoomSession, VIP, Auth.
        - Auth: demo@voiceup.app / demo1234. Backend + expo already running (confirmed OK).

  - agent: "main"
    message: |
      Iteration 16 — Room/Discovery/User-popup/Gift polish is implemented and lint-clean.
      Verified locally:
        * All 66 rooms in Mongo now have `len(seats) == num_seats + 1` (host + numbered).
        * GET /api/users/{id}/gifts-received returns keys ['user','gifts','recent','total_gifts','total_value'].
        * GET /api/rooms returns 31 active rooms, `New Friends` has num_seats=8, seats_len=9.
        * Manual screenshot: compact 2-column cards + dedicated HOST badge + 8 numbered seats,
          chat + action bar compact.
      Testing scope (frontend + backend):
        1) Backend contract for seats: after any POST /rooms with num_seats in {8,15,20}, verify
           len(seats)==num_seats+1 and seats[0].user.id == owner. Then PATCH /rooms/{id}/layout for
           each of {8,15,20} and re-check len(seats)==num_seats+1, seats[0] preserved.
        2) Backend contract for GET /users/{id}/gifts-received: 200 with the schema documented in
           status_history; 404 for non-existent id; accepts numeric_id path parameter.
        3) Frontend: rooms tab has compact cards (aspectRatio cover strip ~1.2, no giant portrait),
           first card shows `room-type-{id}` chip with a real category (never "LIVE"), tapping a
           card navigates to room-detail-screen without a JS error.
        4) Frontend room detail: `host-chair` and `host-chair-badge` are present; there are exactly
           `num_seats` numbered seat bubbles rendered after host (visible on 8-seat rooms as
           `seat-1`..`seat-8`). LayoutPicker text contains "1 host + 8 mic seats" etc.
        5) Frontend RoomUserCard: tapping any seat opens `room-user-card`; DOM comparison of the
           seat DOM before/after opening must be identical (opening the card does NOT free the
           seat). `card-copy-id` visible and shows "Copied!" after tap. Gift gallery renders real
           images if gift transactions exist, placeholder tiles otherwise. `card-send-gift` opens
           `gift-panel` with the correct recipient pill.
        6) /user/{id}/gifts page: `gifts-received-screen` present, `gifts-received-list` populated
           when transactions exist, empty state otherwise.
        7) me.tsx: `me-copy-id` copies and shows "Copied!".
      Preserve rules: do NOT modify Agora/RoomSession context, do NOT restyle unrelated screens.
      Auth: demo@voiceup.app / demo1234. Backend + expo already running.

- task: "Room header + controls restoration (iter-20)"
  implemented: true
  working: "NA"
  file: "/app/frontend/app/room/[id].tsx"
  stuck_count: 0
  priority: high
  needs_retesting: true
  status_history:
    - working: "NA"
      agent: main
      comment: |
        Room header/menu restoration — no other changes:
        * Header layout is now: [Room Name plate] [flex spacer] [People Count] [•••]
          - testID `room-name` wrapped in a translucent black rounded plate (rgba(0,0,0,0.55), radius 10).
          - testID `header-viewers-btn` shows `people` icon + `header-viewers-count` (real-time WS
            participant length). Tapping it opens the participants sheet.
          - testID `header-menu-btn` (••• icon) opens the RoomMenu.
          - Follow heart was removed from the header per the user's exact mockup; Follow remains
            fully functional inside `/room/{id}/info` (Room Info screen, reached by tapping the room
            name).
        * RoomMenu order restored to: 1.Share  2.Exit  3.Minimize  4.Clear Chat  5.Mute  6.Mic Mode
          then toggles: 7.Entrance Effects  8.Noise Reduction  9.Network Speed ("XX ms").
        * Removed old menu tiles: "Mute Room" and "Lock Room" (Room Lock functionality remains in
          codebase; Lock action can be re-added if needed. Not exposed in this restored menu per
          the user's exact list).
        * Untouched: Agora, seats, chat, gifts, VIP, RoomInfo, PK, music sheet, minimize behavior,
          RoomPeopleStrip, WebSocket presence, room persistence.
      testing_scope:
        - Verify `room-name` visible with translucent plate.
        - Verify `header-viewers-btn` visible, count matches WS participant list length, tap opens
          `participants-sheet` (existing testID).
        - Verify `header-menu-btn` visible, tap opens `room-menu`.
        - Verify menu grid order (testIDs): menu-share → menu-exit → menu-minimize → menu-clear-chat
          → menu-mute → menu-mic-mode.
        - Verify toggles order: menu-entrance-effects, menu-noise-reduction, menu-network-speed
          (label shows "XX ms" once ping completes).
        - Verify Exit still routes user out, Minimize collapses room into Mini Room (RoomSession
          preserved), Share fires Share.share.
      preserve_rules:
        - Do NOT redesign the room. Do NOT touch seats/chat/gifts/Agora.
        - Follow existing testID conventions.
        - Auth for test flow: demo@voiceup.app / demo1234.

- task: "Room mic + minimized-room polish (iter-21)"
  implemented: true
  working: "NA"
  file: "/app/frontend/app/room/[id].tsx"
  stuck_count: 0
  priority: high
  needs_retesting: true
  status_history:
    - working: "NA"
      agent: main
      comment: |
        Focused polish — no redesign, no Agora/chat/gift/VIP/header changes:
        * Numbered mic seats: SEAT_SIZE reduced 62 → 54 (uniform across 8/15/20). Positions
          stay fixed; the seat grid is inside the seats ScrollView so chat/keyboard/panels
          never shift the mic layout.
        * Host chair: now a royal throne visual — small crown (diamond icon) above HOST
          badge, ornate gold LinearGradient ring around the avatar, decorative gold
          "throne plate" foot beneath. hostSize kept at 88 (down from 92) so it stays
          proportional. Existing host-seat backend permission preserved (backend returns
          "هذا المقعد لصاحب الغرفة فقط" 403 for non-owners).
        * MicActionSheet: now always renders three rows in this exact order for owners/mods:
            testID `mic-action-move`  → opens ChangeSeatSheet → PATCH /api/rooms/{id}/mic/change-seat
            testID `mic-action-lock`  → toggles PATCH /api/rooms/{id}/mic/lock (label flips
              between "Lock" and "Unlock", icon flips lock-closed ↔ lock-open)
            testID `mic-action-invite`→ opens InviteToSeatSheet → PATCH /api/rooms/{id}/mic/invite
          Rows disable contextually: Move disabled on empty/locked seats; Invite disabled
          on occupied/locked seats. Lock always enabled.
        * Bottom-sheet viewport safety: added `maxHeight: 90%` to the shared `menuSheet`
          style so every bottom sheet (RoomMenu, MicActionSheet, InviteToSeatSheet,
          ChangeSeatSheet, LockRoomPrompt, BottomMoreSheet, LayoutPicker) is clamped
          inside the viewport; existing per-sheet maxHeights (70/80%) remain.
        * FloatingMiniRoom (unchanged, verified working): draggable pan-responder,
          clamps inside viewport on drag release and on rotation, tap = restore,
          testID `mini-room-close` (X button) = leave; Agora publishes/receives
          continuously in RoomSession (voice keeps running when minimized).
      testing_scope:
        - Seat size: measure `seat-1` (or any numbered seat) bounding box width ≈ 54 px.
        - Grid stability: focusing/blurring `chat-input`, sending a message, or opening
          `room-menu` must NOT change `seat-1` bounding box position (x/y unchanged).
        - Host throne: `host-chair` and `host-chair-badge` present; new decorative
          `host-chair-wrap` exists.
        - Owner/mod mic actions (auth as demo@voiceup.app if that user owns/mods a room,
          otherwise use any owner-seeded room like "New Friends"): tapping a peer's mic
          opens `mic-action-sheet` with rows in this DOM order:
            mic-action-move → mic-action-lock → mic-action-invite
          `mic-action-move` opens `change-seat-sheet`; `mic-action-invite` opens
          `invite-sheet`; `mic-action-lock` fires the lock mutation.
        - Viewport safety: on 390x844 viewport, every open sheet fits inside the screen
          (no vertical clipping); on smaller 320x568 viewport, same holds (sheets clamp
          to 90% max height, content scrolls internally where needed).
        - Minimized room: navigate to a room, tap Minimize (bottom four-dot →
          `bottom-menu-minimize` or ••• menu → `menu-minimize`). `mini-room-widget`
          renders. Drag it to another corner → it stays inside viewport. Tap the widget
          → returns to /room/{id}. Tap `mini-room-close` → session leaves.
      preserve_rules:
        - Do NOT touch Agora, RoomSession context, chat, gifts, VIP, header, three-dot
          menu order, or any WebSocket presence code.
        - Backend permission logic unchanged; frontend just disables actions that don't
          apply. Backend still validates every mic mutation.
        - Auth: demo@voiceup.app / demo1234.


- task: "P0 – Real Multi-User Agora Voice + Speaking Wave + Language Switcher (iter-32)"
  implemented: true
  working: "NA"
  file:
    - "/app/frontend/src/hooks/useAgora.ts"
    - "/app/frontend/app/settings.tsx"
  stuck_count: 0
  priority: high
  needs_retesting: true
  status_history:
    - working: "NA"
      agent: main
      comment: |
        Surgical fixes for three carried-over P0 items — NO redesign, NO refactor.

        1) REAL MULTI-USER AGORA VOICE (useAgora.ts)
           - Backend already exposes /api/rtc/config + /api/rtc/token with AGORA_APP_ID +
             AGORA_APP_CERTIFICATE configured. Channel profile is LiveBroadcasting so we
             can have N simultaneous broadcasters (unlimited-mic party model).
           - Existing join flow: user connects to `orio_<roomId>`, role = publisher if
             they hold a seat, otherwise subscriber. `autoSubscribeAudio: true` so every
             participant (mic OR listener) hears ALL active mic publishers automatically.
           - BUG we fixed: on subsequent seat take / seat leave the code only called
             `setClientRole` + `muteLocalAudioStream`. On some react-native-agora builds
             this alone doesn't flip the actual publishing state of the microphone
             track. Result: user takes a mic mid-session but nobody hears them.
           - Fix: whenever `wantPublisher` or `localMuted` changes we now call
             `engine.updateChannelMediaOptions({ publishMicrophoneTrack, autoSubscribeAudio, clientRoleType })`
             together with `engine.enableLocalAudio(wantPublisher)` and
             `engine.muteLocalAudioStream(!wantPublisher || localMuted)`. Belt & suspenders.
           - Multi-user matrix (unchanged, verified by design):
              • 2 seated  → 2 broadcasters, everyone hears both.
              • 5 seated  → 5 broadcasters, everyone hears all 5.
              • 8/15/20 seats → up to N broadcasters. Listeners (not on mic) never
                publish because their `wantPublisher=false` forces
                publishMicrophoneTrack=false + muteLocalAudioStream(true).
           - Room Mute (menu → Mute Room) still silences remote playback locally via
             `muteAllRemoteAudioStreams(true)`; publisher side unchanged. Preserved.

        2) REAL SPEAKING WAVE
           - Wiring was already correct end-to-end and left visually untouched:
              enableAudioVolumeIndication(300ms, smooth=3, reportLocalVolume=true) →
              onAudioVolumeIndication callback →
                setIsLocalSpeaking(uid===0 && volume>5)
                setRemoteAudioLevels({ <numericUid>: volume, ... })
             The room screen's `seatSpeaking(seat)` reads:
                • local user → session.isLocalSpeaking && !localMuted
                • remote users → remoteAudioLevels[uidFromObjectId(u.id)] > 5
             Result: SeatBubble renders the existing green glow ONLY while that
             specific user is actually speaking, and multiple seats can glow at
             the same time. Visual design of the wave is unchanged.
           - No changes needed here beyond the Agora publish fix in (1), which is
             the upstream source of the volume events.

        3) REAL LANGUAGE / TRANSLATION (settings.tsx)
           - Root cause: /app/frontend/app/settings.tsx used a LOCAL
             `useState<"en"|"ar">("en")` for the language pill instead of the
             global `useI18n()` context. Result: tapping EN/AR only flipped the
             pill visually in that one screen — no i18n change, no RTL flip,
             no persistence. This was the "language switch does nothing" report.
           - Fix (surgical): replaced the local useState with
             `const { lang, setLang, isRTL } = useI18n()`. Tapping a pill now
             calls the async global `setLang`, which:
                • updates STRINGS lookup for every screen that uses useI18n()
                • persists selection under AsyncStorage key `orio_lang`
                • flips I18nManager RTL + `document.documentElement.dir` on web
             The pill row itself now uses `flexDirection: isRTL ? "row-reverse" : "row"`
             for consistency. No layout/design changes.
           - The login screen's language selector was already correctly wired to
             useI18n — this is verified working (English → Arabic switches the
             full login layout including RTL, tagline, buttons, T&C text).
           - MusicSheet, RoomSession, Agora hook, chat, gifts, VIP, seats
             remain 100% untouched.

      testing_scope:
        BACKEND:
          - GET  /api/rtc/config       → { enabled: true, app_id: "5f4f337f..." }
          - POST /api/rtc/token       → { token: "...", channel, uid, role, expires_at }
            (role should be "publisher" for the room owner, "subscriber" for a
             listener; validates uid, channel format `orio_<roomId>`).
          - Regression: /api/auth/login (demo@voiceup.app / demo1234) still works.
          - Regression: /api/rooms/mine, /api/rooms/managed, /api/rooms/{id}/join,
            /api/rooms/{id}/leave, /api/rooms/{id}/mic/take, mic/leave, mic/mute,
            mic/unmute, mic/lock, /api/ws/rooms/{id} still work and emit correct
            room_state / user_joined / user_left / voice_state events.

        FRONTEND (Web preview — no native voice validation):
          - Login → tap "Language" → pick العربية. UI flips to Arabic + RTL.
            Reload page → language persists.
          - Login → sign in demo@voiceup.app / demo1234 → tap Settings gear on
            profile tab → the Language pill in Settings now reflects the CURRENT
            global lang, and tapping EN/AR actually flips the app language +
            RTL (previously did nothing). Persist across reload.
          - Enter any seeded room. Check that voice pill shows "VOICE ON" once
            Agora status connects, or a graceful "VOICE OFF" pill on the web
            preview (useAgora.web.ts is a no-op — expected). Seats/chat/gifts
            unchanged. Speaking wave visual unchanged; wiring path verified via
            code review (see comment above). Full audio verification requires
            a native dev build with a real microphone.

      preserve_rules:
        - Do NOT touch RoomSession, chat, gifts, VIP, seats layout, floating
          mini-room, MusicSheet, or any UI design.
        - Web preview cannot run react-native-agora — that's expected. Do not
          claim voice is broken based on the web preview alone; verify code
          paths and backend endpoints instead.
        - Auth: demo@voiceup.app / demo1234.

  - task: "Iter-42 — ORIO Games Foundation (Ludo) + Financial Intermediary / Recharge Agent"
    status: "complete"
    priority: "P0"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/backend/server.py  # Appended new section + v42 index bootstrap
      - /app/backend/tests/test_iter42_games_and_recharge_agent.py
      - /app/frontend/app/games/index.tsx
      - /app/frontend/app/games/ludo/[gameId].tsx
      - /app/frontend/src/games/LudoBoard.tsx
      - /app/frontend/app/recharge-agent/index.tsx
      - /app/frontend/app/recharge-agent/new.tsx
      - /app/frontend/app/recharge-agent/[id].tsx
      - /app/frontend/app/payout-methods/index.tsx  # +Financial Intermediary card
      - /app/frontend/app/_layout.tsx  # AuthGate whitelist +games +recharge-agent
      - /app/frontend/app/room/[id].tsx  # BottomMoreSheet +Games tile
      - /app/frontend/src/api.ts  # Game/Recharge-Agent API helpers + types
      - /app/frontend/src/i18n.tsx  # EN + AR strings
    verification:
      - Backend 113/113 PASS: iter42 (20) + iter41 (11) + phase2b (28) + iter38 + iter37
      - Live preview: Payout Methods shows "Financial Intermediary - Recharge Agent" card
        at top with gold ring; tap → Recharge Agent Center renders with hero, warning,
        and real agent list.
      - Live preview: /games renders Ludo card with multi-colored badge, XP pill,
        and reusable architecture placeholder for Dominoes/UNO/Carrom/Team Battle/Dice.
      - Lint: clean.
      - No regressions to iter-41 precision, agency join, withdrawals, gifts,
        VIP, room UI, or Agora voice.
    invariants_preserved:
      - 9,999 Diamonds = $1 USD (verified by test_preservation_rate_is_still_9999)
      - 50% Host / 5% Agency / 45% ORIO split (untouched)
      - Minimum withdrawal $10 / maximum $1,000 (untouched)
      - Games NEVER modify diamond balances (verified by test_games_do_not_touch_wallet)
      - Existing recharge packages, payout methods, financial ledger — all untouched
    preserve_rules:
      - Casual XP ONLY — Games must NEVER touch user.coins/diamonds/growth_points.
      - Recharge Agent is a SEPARATE recharge channel, NOT a payout method.
      - Admin verify ADDS a wallet_transactions row of type "recharge_agent"
        (same contract as /wallet/recharge). Historical rows are immutable.
      - Ludo: all state computed server-side; client is purely a renderer.
      - Reusable arch: `_GameHub`, `games`, `game_moves` are reusable for
        Dominoes/UNO/Carrom/Team Battle/Dice without changes.

  - task: "Iter-43 — Room Tools scrollable panel · In-room half-screen games · Billiards · Betting catalog"
    status: "complete"
    priority: "P0"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/backend/server.py  # +Billiards state machine +room_games catalog endpoints +v43 index bootstrap
      - /app/backend/tests/test_iter43_billiards_and_catalog.py
      - /app/frontend/app/room/[id].tsx  # Scrollable 3-section BottomMoreSheet + InRoomGameSurface overlay
      - /app/frontend/src/components/InRoomGameSurface.tsx
      - /app/frontend/src/games/BilliardsBoard.tsx
      - /app/frontend/src/api.ts  # +RoomGamesCatalog, Billiards types/helpers
    verification:
      - Backend 41/41 PASS: iter43 (10) + iter42 (20 — flake fixed) + iter41 (11)
      - Live preview: Room Tools now shows 3 sections exactly as spec:
          Section 1 "Room tools" (Music, PK Challenge, Games, Minimize)
          Section 2 "Room Entertainment Games (ألعاب الغرفة الترفيهية)" (Ludo, Billiards)
          Section 3 "Betting Games (ألعاب الرهان)" (Slots locked, Roulette available only when admin + licensed)
      - Tapping Ludo opens half-screen surface over the room; room header,
        host avatar, seats grid, chat all remain visible above.
      - Tapping Billiards opens half-screen pool table with felt, 6 pockets,
        cue + 6 racked balls.
      - Close (X) button unmounts the surface; room returns to normal.
      - Lint clean.
    preserve_rules:
      - DO NOT re-open Agora, mute, or reset mic state on game open/close.
      - DO NOT allow betting entries without legal_status="licensed" to be enabled.
      - DO NOT touch wallet/financial ledger from any game endpoint.
      - DO NOT redesign existing Room UI (seats/chat/gift bar/floating-mini-room/Music/PK) beyond adding the Games tile.


  - task: "Iter-53 — Verify & complete Profile Visitor Tracking (Who viewed my profile)"
    status: "complete"
    priority: "P1"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/backend/server.py  # +profile_visitors indexes, viewer_pub refresh on repeat view, real numeric_id in short_id
      - /app/backend/tests/test_iter53_profile_visitors.py  # 5 new tests
      - /app/frontend/src/profile/ProfileView.tsx  # useEffect → apiRecordView on other-user profile open
    verification:
      - Backend 47/47 PASS (iter47–53): 5 new iter-53 tests
          * test_view_requires_auth
          * test_self_view_does_not_count
          * test_remote_view_counts_once_within_window
          * test_multiple_viewers_sorted_by_last_visit
          * test_view_404_for_bad_user
      - Frontend lint: clean. Expo restarted; preview renders OK.
    changes:
      - FE: ProfileView now calls POST /api/users/{id}/view (fire-and-forget) whenever
        a non-owner opens another user's profile. Backend dedup window (5 min)
        prevents inflation.
      - BE: Added unique index (target_id, viewer_id) + sorted index (target_id, last_visit DESC)
        on profile_visitors for correctness + fast reads.
      - BE: record_view now refreshes viewer_pub on repeat visits (nickname/avatar
        stay current for the owner).
      - BE: viewer_pub.short_id now prefers the real 8-digit numeric_id so the
        owner can look up / message the visitor; falls back to the legacy
        short-hash only when numeric_id is missing.
    preserve_rules:
      - Surgical only: zero changes to any screen's design, Agora, RoomSession,
        auth, gifts, VIP, families, agencies, withdrawals, games.
      - No new routes; the /visitors screen was already wired and functional.
      - Dedup / self-view / 404 semantics unchanged from previous iterations.


  - task: "Iter-54 — Profile Visitor UI Completion (Who viewed my profile)"
    status: "complete"
    priority: "P1"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/backend/server.py  # +today_views in /users/me/visitors response
      - /app/backend/tests/test_iter53_profile_visitors.py  # +today_views assertions
      - /app/frontend/src/i18n.tsx  # +visitorsTitle, visitorsTodayLabel, visitorsLifetimeLabel, visitorsEmpty, visitorsSubRow, timeJustNow/Minutes/Hours/Days, visitsPlural (en+ar)
      - /app/frontend/app/visitors.tsx  # Rewrote with i18n + today card + useFocusEffect refetch + empty-state testID
      - /app/frontend/app/(tabs)/me.tsx  # Shared ["visitors"] query drives the row sub + badge "Viewed today: N"
    verification:
      - Backend 47/47 PASS (iter47–53 incl updated iter53 asserting today_views).
      - Live preview after demo@voiceup.app login: /visitors renders localized title
        "Who viewed my profile", stat cards (Viewed Today, Lifetime Views) backed by
        real backend numbers, real visitor row (Alice, ID 24C7A133, 6d ago, ×1 visit).
      - Arabic switch (orio_lang=ar) flips UI strings to "من شاهد ملفي" etc.
      - Owner-only enforced server-side: /users/me/visitors uses current_user.
      - Row tap routes to /user/{visitor_id} = existing ProfileView (no duplicate component).
      - Empty state message "No visits yet" / "لا توجد مشاهدات حتى الآن" when visitors empty.
      - Dedup, self-view exclusion, 5-min window all preserved from iter-53.
      - Realtime refresh: useFocusEffect triggers refetch when screen regains focus;
        shared React Query cache key keeps Me tab and Visitors screen in sync without
        extra network calls.
    preserve_rules:
      - No new routes, no redesign of existing screens.
      - ProfileView auto-records a view on open (iter-53 wire-up) — unchanged.
      - Shared query key avoids double-fetching between Me and Visitors.
      - Visitor rows exclusively use real backend data; no mock fallbacks.

  - task: "Iter-92 — Full-App Localization + True RTL/LTR Mirroring"
    status: "complete"
    priority: "P0"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/frontend/src/i18n.tsx  # +~130 keys EN/AR; deduped collisions (ok/cancel/save/comingSoon); kept comingSoon(provider→string) function, repointed string usage to comingSoonLabel
      - /app/frontend/src/rtl-bootstrap.ts  # also sets document.lang + injects global overflow-x: hidden + scrollbar hide
      - /app/frontend/app/+html.tsx  # sync <script> that applies lang+dir from localStorage before RN Web first paint
      - /app/frontend/app/(tabs)/_layout.tsx  # tab titles via t.*
      - /app/frontend/app/(tabs)/home.tsx  # greeting / country picker / discovery pills / empty states / Start a Room
      - /app/frontend/app/(tabs)/me.tsx  # entire menu + chips + shortcuts + agency label + copied toast
      - /app/frontend/app/(tabs)/messages.tsx  # title + empty state
      - /app/frontend/app/(tabs)/wallet.tsx  # tabs + hero + package tier labels via t.pkgLabel
      - /app/frontend/app/(tabs)/posts.tsx  # user fallback strings
      - /app/frontend/app/(auth)/register.tsx  # full rewrite with t.*
      - /app/frontend/app/chat/[id].tsx  # title fallback + placeholder + back chevron mirror
      - /app/frontend/app/my-rooms.tsx  # title + empty state + listeners + LIVE
      - /app/frontend/app/rankings.tsx  # title + categories + periods + score line
      - /app/frontend/app/invite.tsx  # full rewrite with t.*
      - /app/frontend/app/friendship.tsx  # full rewrite with t.*
      - /app/frontend/app/cp.tsx  # full rewrite with t.*
      - /app/frontend/app/edit-profile.tsx  # placeholder + fixed comingSoon → comingSoonLabel
      - /app/frontend/app/earnings.tsx  # Agency Owner/Host + Gift received/Refund labels
      - /app/frontend/app/create-room.tsx  # localized notice defaults
      - /app/frontend/app/index.tsx  # splash tagline via t.*
      - /app/frontend/src/profile/ProfileView.tsx  # chat/follow/unfollow/block/report/alerts/report modal + fixed comingSoon → comingSoonLabel
    verification:
      - Native RN Web mirroring: I18nManager.forceRTL() runs synchronously before any StyleSheet.create() so flexDirection:'row' compiles to row-reverse under AR.
      - DOM check: document.documentElement.dir='rtl', lang='ar', computed flex-direction='row-reverse' on login buttons.
      - Visual check Arabic: login, home, me, wallet, profile, posts, messages, rankings, friendship, cp, invite, my-rooms — all translated, mirrored, no horizontal overflow.
      - Visual check English: login, me, wallet — unchanged LTR layout, all strings in English.
      - Logical element order preserved (first child remains first; only visual position mirrored).
      - User-generated content (usernames, nicknames, room names, post text, message bodies) untouched.
      - comingSoon function/string collision fixed → no "Functions are not valid as a React child" error.
    preserve_rules:
      - Surgical edits only; no redesign of any screen or component.
      - Did not create a new RTL system — reuses existing I18nManager + i18n context.
      - Did not translate user-generated content.
      - Did not touch backend auth, wallet, VIP, admin, or RTC logic.

  - task: "Iter-93 — Surgical RTL/LTR Correction (greeting removal, My Rooms sheet, chip mirror, row-reverse sweep, country localization)"
    status: "complete"
    priority: "P0"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/frontend/app/(tabs)/home.tsx  # removed Hi greeting; removed My Rooms sheet + double-tap state; localized country selector via `localizedName(c)` using backend `name_ar`
      - /app/frontend/app/(tabs)/_layout.tsx  # removed home-tab-double-press event emitter
      - /app/frontend/src/profile/ProfileView.tsx  # removed scaleX:-1 chip row transform (was mirroring Arabic glyphs); +translated block/report dialogs
      - /app/frontend/app/room/[id].tsx  # chat composer placeholder localized
      - /app/frontend/src/room/RoomSession.tsx  # system welcome message localized ("مرحباً بكم في الغرفة…")
      - 27 extra files swept for the row-reverse double-flip bug (tasks, friendship, global-ranking, invite, cp, edit-profile, my-rooms, room-ranking, (auth)/login, (auth)/phone, (tabs)/messages, (tabs)/wallet, (tabs)/me, (tabs)/posts, search, report, settings, language, create-room, rankings, vip, chat/[id], profile-completion, RoomUserCard, PremiumPodiumFrame, Toast, UtcResetTimer)
    verification:
      - DOM check: With document.dir="rtl" and plain flex-direction:row, first child renders on the right (natural RTL mirroring). Removing explicit `isRTL ? row-reverse` restored this.
      - Arabic login: G/mail/phone/FB icons on the RIGHT, Arabic label on the LEFT (correct RTL).
      - Arabic Party Rooms: "Hi" greeting gone; title on right, trophy/search/home icons on left.
      - Arabic Posts: title right, + button left.
      - Arabic Messages: title right, Add Friend icon left.
      - Arabic Profile chips (VIP/Days/Gender/Wealth/Charm): text reads naturally, no visual reversal.
      - Arabic Room screen: welcome message in Arabic, chat composer placeholder in Arabic.
      - Country selector: Arabic shows "مصر", "الولايات المتحدة", "المملكة العربية السعودية" etc.; flags unchanged.
      - English LTR regression: login, home, me, wallet, posts, messages, profile, room all render correctly LTR with icons on the correct sides.
      - Re-tap on Home tab: no longer opens My Rooms sheet (user-requested removal).
    preserve_rules:
      - Did NOT change DOM order of any header/chip/button → avoided altering the pre-existing design.
      - Did NOT translate user-generated content (usernames, nicknames, room names, bios, messages).
      - Did NOT touch unrelated backend/API/auth/wallet/VIP/admin logic.
      - Did NOT add row-reverse everywhere — removed it so direction:rtl can mirror naturally.
      - Preserved CP and PK as brand abbreviations.

  - task: "Iter-94 — VIP chip clone · Messages Inbox tiles · Language flag removal"
    status: "complete"
    priority: "P0"
    needs_retesting: false
    agent_tested: true
    user_tested: false
    files:
      - /app/frontend/src/components/VipChip.tsx  # NEW — reusable clone of the stat-row VIP chip using tierFor() colors
      - /app/frontend/app/(tabs)/me.tsx  # replaced <VipBadge/> beside profile photo with <VipChip/>
      - /app/backend/server.py  # +5 endpoints: /inbox/overview, /notifications/system, /support/messages (GET+POST), /activities
      - /app/frontend/src/api.ts  # +apiInboxOverview, apiSystemNotifications, apiSupportMessages, apiSupportSend, apiActivities
      - /app/frontend/app/(tabs)/messages.tsx  # 4 inbox tiles above thread list with real counts from apiInboxOverview
      - /app/frontend/app/notifications.tsx  # NEW — system notifications list screen
      - /app/frontend/app/support.tsx  # NEW — support team chat screen with real GET/POST
      - /app/frontend/app/activities.tsx  # NEW — activity feed listing real wallet_transactions
      - /app/frontend/app/language.tsx  # removed flag emoji from rows
      - /app/frontend/src/i18n.tsx  # +8 keys EN+AR for inbox tile labels/subtitles
    verification:
      - Backend: `/api/inbox/overview` returns real counts queried from friendships, system_notifications, support_messages, wallet_transactions collections. Tested with demo@voiceup.app — got friend_requests:0, system_notifications:0, support_team:0, activities:29923.
      - Backend: `/api/activities` returns real wallet_transactions rows ordered by created_at desc.
      - Me screen (AR + EN): standalone V+number beside the username is replaced with "V · VIP 7" chip using the correct tier color. Chip is tappable → navigates to /vip. Stat-row VIP chip under username is UNCHANGED.
      - Messages tab (AR + EN): 4 vertical tiles under the header — Friend Requests, System Notifications, Support Team, Activities — with icons, labels, subtitles, unread badges (when count>0) and chevron. Divider separates tiles from thread list. Each tile navigates to its real screen.
      - Language picker (AR + EN): no 🇺🇸 or 🇸🇦 flags; shows only "English" and "العربية" with direction label.
      - User-generated content preserved (thread user names).
    preserve_rules:
      - Did NOT change any previously completed work.
      - Did NOT modify unrelated code.
      - Original VIP chip under username in ProfileView.tsx untouched.
      - All new user-facing strings use the i18n system.
      - 100% backend-connected — no mocks.
