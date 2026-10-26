import { I18nManager } from "react-native";
import { getRefreshToken, setRefreshToken } from "./auth/storage";
import { getDeviceId, emitBan } from "./auth/device";

const RAW = process.env.EXPO_PUBLIC_BACKEND_URL ?? "";
export const API_BASE = `${RAW}/api`;

let accessToken: string | null = null;
export function setAccessToken(t: string | null) { accessToken = t; }
export function getAccessToken() { return accessToken; }

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let seenToken: { token: string; at: number } | null = null;
function expiresSoon(token: string): boolean {
  if (seenToken?.token !== token) seenToken = { token, at: Date.now() };
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const { exp, iat } = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
    if (typeof exp !== "number" || typeof iat !== "number") return false;
    return Date.now() - seenToken.at > (exp - iat) * 1000 - 30_000;
  } catch {
    return false;
  }
}

async function request<T = any>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  if (retry && (!path.startsWith("/auth/") || path === "/auth/me")) {
    if (accessToken ? expiresSoon(accessToken) : refreshInFlight || (await getRefreshToken())) await tryRefresh();
  }
  const deviceId = await getDeviceId();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // Never let the browser serve a stale JSON response from HTTP cache; this
    // matters especially for /auth/me where role flags (is_admin, is_superadmin)
    // must reflect the latest DB state immediately after login/promotion.
    cache: "no-store",
    credentials: init.credentials ?? "omit",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      ...(init.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
  });
  if (res.status === 401 && retry && accessToken) {
    const ok = await tryRefresh();
    if (ok) return request<T>(path, init, false);
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      // Iter-118 — server-enforced ban → global ban screen with countdown.
      if (res.status === 403 && body?.detail?.code === "BANNED") {
        emitBan({ ...body.detail, receivedAt: Date.now() });
      }
      if (body?.detail) msg = typeof body.detail === "string" ? body.detail : (body.detail.message || JSON.stringify(body.detail));
      // Iter-135 — server content moderation → clear localized warning.
      if (msg === "CONTENT_BLOCKED") {
        msg = I18nManager.isRTL
          ? "لا يمكن الإرسال: يحتوي النص على كلمات مسيئة أو محظورة."
          : "Can't send: this text contains abusive or prohibited words.";
      }
    } catch {}
    throw new ApiError(msg, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Iter-122 — single-flight refresh: concurrent 401s share ONE rotation so a
// rotated token is never replayed. Only a real 401 from /auth/refresh clears
// the stored session; network errors keep it for the next attempt.
let refreshInFlight: Promise<boolean> | null = null;
export function tryRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function doRefresh(): Promise<boolean> {
  const rt = await getRefreshToken();
  if (!rt) return false;
  try {
    const t = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    });
    if (t.status === 401) {
      // Only drop the token if it's still the one we tried (another account may have switched in).
      if ((await getRefreshToken()) === rt) await setRefreshToken(null);
      accessToken = null;
      return false;
    }
    if (!t.ok) return false;
    const data = await t.json();
    accessToken = data.access_token;
    await setRefreshToken(data.refresh_token);
    return true;
  } catch {
    return false;
  }
}

// Email sign-up is disabled: email is login-only (the backend route is commented out too).
// export async function apiRegister(email: string, password: string, username: string, nickname: string) {
//   const t = await request<any>("/auth/register", { method: "POST", body: JSON.stringify({ email, password, username, nickname }) });
//   accessToken = t.access_token; await setRefreshToken(t.refresh_token);
//   return t;
// }
export async function apiLogin(email: string, password: string) {
  const t = await request<any>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
  accessToken = t.access_token; await setRefreshToken(t.refresh_token);
  return t;
}
export async function apiLogout() {
  const rt = await getRefreshToken();
  if (rt) await request("/auth/logout", { method: "POST", body: JSON.stringify({ refresh_token: rt }) }).catch(() => {});
  await setRefreshToken(null); accessToken = null;
}
// Multi-account — revoke a saved (non-active) account's refresh session.
export async function apiRevokeRefresh(refresh_token: string) {
  await fetch(`${API_BASE}/auth/logout`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token }),
  }).catch(() => {});
}
export async function apiMe() { return request<any>("/auth/me"); }
export async function apiRequestAccountDeletion() {
  return request<{ status: string; scheduled_at: string }>("/account/deletion/request", { method: "POST", body: JSON.stringify({ confirm: true }) });
}
export async function apiUpdateMe(body: any) { return request<any>("/users/me", { method: "PATCH", body: JSON.stringify(body) }); }
/** VIP5+ only — server enforces eligibility. `cover_url` = uploaded /api/media/files/{id}. */
export async function apiUpdateProfileCover(cover_url: string) { return request<any>("/users/me/cover", { method: "PATCH", body: JSON.stringify({ cover_url }) }); }
export async function apiGetUser(id: string) { return request<any>(`/users/${id}`); }
export async function apiGetUserByNumericId(nid: string) { return request<any>(`/users/by-numeric-id/${nid}`); }
export async function apiUserGiftsReceived(id: string) { return request<any>(`/users/${id}/gifts-received`); }
export async function apiFollow(id: string) { return request<any>(`/users/${id}/follow`, { method: "POST" }); }
export async function apiUnfollow(id: string) { return request<any>(`/users/${id}/follow`, { method: "DELETE" }); }
export async function apiBlockUser(id: string) { return request<any>(`/users/${id}/block`, { method: "POST" }); }
export async function apiUnblockUser(id: string) { return request<any>(`/users/${id}/block`, { method: "DELETE" }); }
export async function apiReportUser(id: string, body: { reason?: string; details?: string; media_data_url?: string; media_kind?: "image" | "video"; media_urls?: string[] }) {
  return request<any>(`/users/${id}/report`, { method: "POST", body: JSON.stringify(body) });
}

export async function apiListRooms(opts?: { category?: string; country_code?: string; sort?: "listeners" | "recommended" }) {
  const params = new URLSearchParams();
  if (opts?.category && opts.category !== "all") params.set("category", opts.category);
  if (opts?.country_code && opts.country_code !== "all") params.set("country_code", opts.country_code);
  if (opts?.sort) params.set("sort", opts.sort);
  const q = params.toString();
  return request<any[]>(`/rooms${q ? `?${q}` : ""}`);
}
export async function apiCreateRoom(body: any) { return request<any>("/rooms", { method: "POST", body: JSON.stringify(body) }); }
export async function apiGetRoom(id: string) { return request<any>(`/rooms/${id}`); }
export async function apiJoinRoom(id: string) { return request<any>(`/rooms/${id}/join`, { method: "POST" }); }
export async function apiLeaveRoom(id: string) { return request<any>(`/rooms/${id}/leave`, { method: "POST" }); }
export async function apiTakeSeat(id: string, seat_index: number) { return request<any>(`/rooms/${id}/seats/take`, { method: "POST", body: JSON.stringify({ seat_index }) }); }
export async function apiLeaveSeat(id: string) { return request<any>(`/rooms/${id}/seats/leave`, { method: "POST" }); }
export async function apiToggleMute(id: string) { return request<any>(`/rooms/${id}/seats/mute`, { method: "POST" }); }
export async function apiChangeLayout(id: string, num_seats: 8 | 15 | 20 | 25) {
  return request<any>(`/rooms/${id}/layout`, { method: "PATCH", body: JSON.stringify({ num_seats }) });
}
// Iter-73 — Premium room background catalog + preset setter.
export type PremiumRoomBackground = {
  id: string;
  title_en: string;
  title_ar: string;
  category: string;
  image_url: string;
};
export async function apiRoomBackgroundsCatalog() {
  const r = await request<{ backgrounds: PremiumRoomBackground[] }>("/rooms/backgrounds/catalog");
  return r.backgrounds || [];
}
export async function apiSetRoomBackgroundPreset(id: string, bg_id: string) {
  return request<any>(`/rooms/${id}/background/preset`, { method: "POST", body: JSON.stringify({ bg_id }) });
}
// Iter-74 — Custom (user-uploaded) room background submission.
// Iter-82 — submission is NOT per-upload charged. The user pays once via
// `/purchase-15d` for a 15-day pass (50 000 Diamonds) or holds VIP6+ for
// unlimited uploads. Backend still pre-moderates and may reject (400) and
// moderation goes through within 24 h as before.
export async function apiSubmitCustomRoomBackground(id: string, image_url: string) {
  return request<{ ok: boolean; sub_id: string; status: string; message: string }>(
    `/rooms/${id}/background`,
    { method: "POST", body: JSON.stringify({ image_url }) },
  );
}
export const ROOM_BG_CUSTOM_COST = 50000;

// Iter-82 — Custom-background 15-day pass.
export async function apiPurchaseCustomBgPass() {
  return request<{ ok: boolean; entitlement_until: string; diamonds_remaining: number; days: number }>(
    `/rooms/custom-background/purchase-15d`,
    { method: "POST" },
  );
}
export type CustomBgEntitlement = {
  vip_level: number;
  vip6_unlimited: boolean;
  pass_active: boolean;
  entitlement_until: string | null;
  can_submit: boolean;
  price_diamonds: number;
  days: number;
};
export async function apiGetCustomBgEntitlement() {
  return request<CustomBgEntitlement>(`/rooms/custom-background/entitlement`);
}
export async function apiRoomParticipants(id: string) { return request<any>(`/rooms/${id}/participants`); }
export async function apiRoomLock(id: string, pin: string) { return request<any>(`/rooms/${id}/lock`, { method: "POST", body: JSON.stringify({ pin }) }); }
export async function apiRoomUnlock(id: string) { return request<any>(`/rooms/${id}/unlock`, { method: "POST" }); }
export async function apiMicInvite(id: string, target_user_id: string, seat_index: number) {
  return request<any>(`/rooms/${id}/mic-invite`, { method: "POST", body: JSON.stringify({ target_user_id, seat_index }) });
}
export async function apiMicInviteAccept(id: string) {
  return request<any>(`/rooms/${id}/mic-invite/accept`, { method: "POST" });
}
export async function apiMicInviteReject(id: string) {
  return request<any>(`/rooms/${id}/mic-invite/reject`, { method: "POST" });
}
export async function apiMicChangeSeat(id: string, from_index: number, to_index: number) {
  return request<any>(`/rooms/${id}/mic-change-seat`, { method: "POST", body: JSON.stringify({ from_index, to_index }) });
}

// Iter-52 — Room deletion (owner only) + supporter ranking
export async function apiDeleteRoom(id: string) {
  return request<{ ok: boolean }>(`/rooms/${id}`, { method: "DELETE" });
}
export type RankMetric = "contribution" | "charm";
export type RankPeriod = "daily" | "weekly" | "monthly" | "all";
export async function apiRoomRanking(id: string, metric: RankMetric, period: RankPeriod) {
  const qs = new URLSearchParams({ metric, period }).toString();
  return request<{
    metric: RankMetric;
    period: RankPeriod;
    items: {
      rank: number;
      amount: number;
      gift_count: number;
      user: { id: string; nickname: string; avatar_url?: string; vip_level?: number; numeric_id?: string; country_flag?: string; is_new?: boolean };
    }[];
  }>(`/rooms/${id}/ranking?${qs}`);
}
// Iter-55 — Global supporter ranking + VIP maintenance snapshot
export async function apiGlobalRanking(metric: RankMetric, period: RankPeriod) {
  const qs = new URLSearchParams({ metric, period }).toString();
  return request<{
    metric: RankMetric;
    period: RankPeriod;
    items: {
      rank: number;
      amount: number;
      gift_count: number;
      user: { id: string; nickname: string; avatar_url?: string; vip_level?: number; numeric_id?: string; country_flag?: string; is_new?: boolean };
    }[];
  }>(`/rankings/global?${qs}`);
}
export async function apiVipMaintenance() {
  return request<{
    level: number;
    growth_points: number;
    vip_expires_at: string | null;
    remaining_days: number;
    maintenance_threshold: number;
    maintenance_remaining: number;
    requirements: { level: number; threshold: number }[];
  }>(`/vip/maintenance`);
}
export async function apiRoomModerate(id: string, action: string, seat_index: number) {
  return request<any>(`/rooms/${id}/moderate`, { method: "POST", body: JSON.stringify({ action, seat_index }) });
}
export async function apiPkStart(id: string, seat_a: number, seat_b: number, duration_seconds = 180) {
  return request<any>(`/rooms/${id}/pk/start`, { method: "POST", body: JSON.stringify({ seat_a, seat_b, duration_seconds }) });
}
export async function apiPkState(id: string) { return request<any>(`/rooms/${id}/pk`); }
export async function apiPkEnd(id: string) { return request<any>(`/rooms/${id}/pk/end`, { method: "POST" }); }
export async function apiJoinWithPin(id: string, pin?: string) {
  return request<any>(`/rooms/${id}/join`, { method: "POST", body: pin ? JSON.stringify({ pin }) : undefined });
}
/** Room Locked modal — same 5-digit code checked against the PIN lock and/or Room Password. */
export async function apiJoinRoomWithCode(id: string, code: string) {
  return request<any>(`/rooms/${id}/join`, { method: "POST", body: JSON.stringify({ pin: code, room_password: code }) });
}
export async function apiJoinWithRoomPassword(id: string, room_password?: string) {
  return request<any>(`/rooms/${id}/join`, { method: "POST", body: room_password ? JSON.stringify({ room_password }) : undefined });
}
// Room settings (Notice + Personalized Welcome Message)
// Rooms I own / manage
export async function apiRoomsMine() {
  return request<any[]>(`/rooms/mine`);
}
export async function apiRoomsManaged() {
  return request<any[]>(`/rooms/managed`);
}
export async function apiRoomUpdateSettings(id: string, patch: { name?: string; notice?: string; welcome_msg?: string }) {
  return request<any>(`/rooms/${id}/settings`, { method: "PATCH", body: JSON.stringify(patch) });
}
// Separate 5-digit Room Password (distinct from PIN Lock)
export async function apiRoomPasswordSet(id: string, password: string) {
  return request<any>(`/rooms/${id}/password`, { method: "POST", body: JSON.stringify({ password }) });
}
export async function apiRoomPasswordClear(id: string) {
  return request<any>(`/rooms/${id}/password`, { method: "DELETE" });
}
// Iter-18 follow / membership / moderators / bans
export async function apiRoomFollow(id: string) { return request<any>(`/rooms/${id}/follow`, { method: "POST" }); }
export async function apiRoomUnfollow(id: string) { return request<any>(`/rooms/${id}/follow`, { method: "DELETE" }); }
export async function apiRoomFollowStatus(id: string) { return request<any>(`/rooms/${id}/follow-status`); }
export async function apiRoomMembershipRequest(id: string) { return request<any>(`/rooms/${id}/membership/request`, { method: "POST" }); }
export async function apiRoomMembershipPending(id: string) { return request<any[]>(`/rooms/${id}/membership/pending`); }
export async function apiRoomMembershipReview(id: string, request_id: string, action: "approve" | "reject") {
  return request<any>(`/rooms/${id}/membership/review`, { method: "POST", body: JSON.stringify({ request_id, action }) });
}
export async function apiRoomMembers(id: string) { return request<any[]>(`/rooms/${id}/members`); }
export async function apiRoomModerators(id: string) { return request<any[]>(`/rooms/${id}/moderators`); }
export async function apiRoomModAdd(id: string, user_id: string) {
  return request<any>(`/rooms/${id}/moderators/add`, { method: "POST", body: JSON.stringify({ user_id }) });
}
export async function apiRoomModRemove(id: string, user_id: string) {
  return request<any>(`/rooms/${id}/moderators/remove`, { method: "POST", body: JSON.stringify({ user_id }) });
}
export async function apiRoomBans(id: string) { return request<any[]>(`/rooms/${id}/bans`); }
export async function apiRoomBanAdd(id: string, user_id: string, reason?: string) {
  return request<any>(`/rooms/${id}/bans/add`, { method: "POST", body: JSON.stringify({ user_id, reason }) });
}
export async function apiRoomBanRemove(id: string, user_id: string) {
  return request<any>(`/rooms/${id}/bans/remove`, { method: "POST", body: JSON.stringify({ user_id }) });
}
export async function apiListRoomsRecommended() { return request<any[]>(`/rooms?sort=recommended`); }
export async function apiListRoomsPopular(country_code?: string) {
  const q = new URLSearchParams({ sort: "popular" });
  if (country_code && country_code !== "all") q.set("country_code", country_code);
  return request<any[]>(`/rooms?${q}`);
}
export async function apiListRoomsPk(country_code?: string) {
  const q = new URLSearchParams({ sort: "pk" });
  if (country_code && country_code !== "all") q.set("country_code", country_code);
  return request<any[]>(`/rooms?${q}`);
}
export async function apiRoomsFollowing(country_code?: string) {
  const q = new URLSearchParams();
  if (country_code && country_code !== "all") q.set("country_code", country_code);
  const suffix = q.toString();
  return request<any[]>(`/rooms/following${suffix ? `?${suffix}` : ""}`);
}
export async function apiRoomsWatched(country_code?: string) {
  const q = new URLSearchParams();
  if (country_code && country_code !== "all") q.set("country_code", country_code);
  const suffix = q.toString();
  return request<any[]>(`/rooms/watched${suffix ? `?${suffix}` : ""}`);
}
export async function apiUpdateRoomSettings(id: string, settings: { entrance_effects?: boolean; noise_reduction?: boolean; music_control_role?: "owner" | "mods" | "seat" }) {
  return request<any>(`/rooms/${id}/settings`, { method: "PATCH", body: JSON.stringify(settings) });
}
export async function apiCloseRoom(id: string) { return request<any>(`/rooms/${id}/close`, { method: "POST" }); }
export async function apiClearRoomChat(id: string) { return request<any>(`/rooms/${id}/chat/clear`, { method: "POST" }); }

export async function apiPackages(channel: "mobile" | "web" = "mobile") { return request<any[]>(`/wallet/packages?channel=${channel}`); }
export async function apiRecharge(package_id: string, request_id?: string) { return request<any>("/wallet/recharge", { method: "POST", body: JSON.stringify({ package_id, request_id }) }); }
export async function apiRechargeEligibility() { return request<{ allowed: boolean; mode: string }>("/wallet/recharge/eligibility"); }
export async function apiTransactions() { return request<any[]>("/wallet/transactions"); }
export async function apiGifts() { return request<any[]>("/gifts"); }
export async function apiSendGift(gift_id: string, recipient_id: string, quantity = 1, room_id?: string) {
  return request<any>("/gifts/send", { method: "POST", body: JSON.stringify({ gift_id, recipient_id, quantity, room_id, request_id: giftRequestId() }) });
}
export async function apiSendGiftMulti(gift_id: string, recipient_ids: string[], quantity = 1, room_id?: string, combo_of?: string) {
  return request<any>("/gifts/send-multi", { method: "POST", body: JSON.stringify({ gift_id, recipient_ids, quantity, room_id, combo_of, request_id: giftRequestId() }) });
}
// Iter-115 — one idempotency key per gift send (server ignores replays of the same key).
function giftRequestId() { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
export async function apiGiftCategories() {
  return request<{ categories: string[] }>("/gifts/categories");
}
export async function apiCustomGiftSettings() {
  return request<{ enabled: boolean; min_vip_level: number; price: number; allowed_types: string[]; max_file_bytes: number; max_video_duration_s: number; eligible: boolean }>("/gifts/custom/settings");
}
export async function apiListMyCustomGifts() {
  return request<{ items: any[] }>("/gifts/custom");
}
export async function apiCreateCustomGift(payload: { media_url: string; media_type: "image" | "video"; name?: string; video_url?: string }) {
  return request<any>("/gifts/custom", { method: "POST", body: JSON.stringify(payload) });
}
export async function apiDeleteCustomGift(cg_id: string) {
  return request<any>(`/gifts/custom/${cg_id}`, { method: "DELETE" });
}
export async function apiSetProfileMedia(payload: { url: string; kind: "avatar" | "animated_avatar" }) {
  return request<any>("/users/me/profile-media", { method: "PATCH", body: JSON.stringify(payload) });
}
export async function apiRecordView(user_id: string) {
  return request<any>(`/users/${user_id}/view`, { method: "POST" });
}
export async function apiMyVisitors() { return request<any>("/users/me/visitors"); }

export async function apiDailyStatus() { return request<any>("/wallet/daily-status"); }
export async function apiClaimDaily() { return request<any>("/wallet/daily-bonus", { method: "POST" }); }

export async function apiThreads() { return request<any[]>("/messages/threads"); }
export async function apiMessagesWith(id: string) { return request<any[]>(`/messages/with/${id}`); }
export async function apiPostVisibility(id: string, visibility: "public" | "mutual") { return request<any>(`/posts/${id}/visibility`, { method: "PATCH", body: JSON.stringify({ visibility }) }); }
export async function apiSharePost(id: string, recipient_ids: string[]) { return request<{ sent: string[]; skipped: string[] }>(`/posts/${id}/share`, { method: "POST", body: JSON.stringify({ recipient_ids }) }); }
export async function apiMyMutuals() { return request<any[]>("/users/me/mutuals"); }
export async function apiGetPost(id: string) { return request<any>(`/posts/${id}`); }
export async function apiReportPost(postId: string, body: any) { return request<any>(`/posts/${postId}/report`, { method: "POST", body: JSON.stringify(body) }); }
export async function apiReportComment(commentId: string, body: any) { return request<any>(`/comments/${commentId}/report`, { method: "POST", body: JSON.stringify(body) }); }
export async function apiReportRoom(roomId: string, body: any) { return request<any>(`/rooms/${roomId}/report`, { method: "POST", body: JSON.stringify(body) }); }
export async function apiRoomChatMute(roomId: string, user_id: string, muted: boolean) { return request<any>(`/rooms/${roomId}/chat-mute`, { method: "POST", body: JSON.stringify({ user_id, muted }) }); }
export async function apiRoomFullMute(roomId: string, user_id: string, mute: boolean) { return request<any>(`/rooms/${roomId}/seats/full-mute`, { method: "POST", body: JSON.stringify({ user_id, mute }) }); }
export async function apiRoomChatImage(roomId: string, media_url: string) { return request<any>(`/rooms/${roomId}/chat/image`, { method: "POST", body: JSON.stringify({ media_url }) }); }
export async function apiNameChanges() { return request<{ used: number; limit: number; remaining: number; vip_level: number; table: { vip: string; limit: number }[] }>("/users/me/name-changes"); }
export async function apiPushPref() { return request<{ enabled: boolean }>("/users/me/push"); }
export async function apiSetPushPref(enabled: boolean) { return request<{ enabled: boolean }>("/users/me/push", { method: "PUT", body: JSON.stringify({ enabled }) }); }
export async function apiRegisterPush(platform: string, device_token: string) { return request<any>("/register-push", { method: "POST", body: JSON.stringify({ platform, device_token }) }); }
export async function apiRoomChatLock(roomId: string, locked: boolean) { return request<any>(`/rooms/${roomId}/chat-lock`, { method: "POST", body: JSON.stringify({ locked }) }); }
export async function apiThreadPin(peerId: string, pinned: boolean) { return request<any>(`/messages/threads/${peerId}/pin`, { method: "POST", body: JSON.stringify({ pinned }) }); }
export async function apiThreadDelete(peerId: string) { return request<any>(`/messages/threads/${peerId}`, { method: "DELETE" }); }
export async function apiMessageUnsend(id: string) { return request<any>(`/messages/${id}/unsend`, { method: "POST" }); }
export async function apiMessageDelete(id: string, scope: "me" | "everyone") { return request<any>(`/messages/${id}/delete`, { method: "POST", body: JSON.stringify({ scope }) }); }
export async function apiSendMessage(recipient_id: string, text: string) {
  return request<any>("/messages/send", { method: "POST", body: JSON.stringify({ recipient_id, text }) });
}
export async function apiSendChatReaction(recipient_id: string, emoji: string) {
  return request<any>("/messages/reaction", { method: "POST", body: JSON.stringify({ recipient_id, emoji }) });
}
export async function apiPresence(user_id: string) {
  return request<{ online: boolean; last_seen_at: string | null }>(`/users/${user_id}/presence`);
}
export async function apiMusicCatalog(q?: string) { return request<{ items: any[] }>(`/music/catalog${q ? `?q=${encodeURIComponent(q)}` : ""}`); }
export async function apiMusicState(room_id: string) { return request<any>(`/rooms/${room_id}/music`); }
export async function apiMusicAdd(room_id: string, body: { source: "phone" | "internet"; title: string; artist?: string; catalog_id?: string; local_uri?: string }) {
  return request<any>(`/rooms/${room_id}/music/add`, { method: "POST", body: JSON.stringify(body) });
}
export async function apiMusicControl(room_id: string, action: string, extra: { index?: number; value?: number } = {}) {
  return request<any>(`/rooms/${room_id}/music/control`, { method: "POST", body: JSON.stringify({ action, ...extra }) });
}
// Iter-134 — private chat media / gifts / one-to-one calls.
export async function apiSendChatMedia(recipient_id: string, kind: "image" | "voice", media_url: string, duration?: number, waveform?: number[]) {
  return request<any>("/messages/send", { method: "POST", body: JSON.stringify({ recipient_id, kind, media_url, duration, waveform }) });
}
export async function apiDmGift(recipient_id: string, gift_id: string, quantity: number, request_id: string) {
  return request<any>("/messages/gift", { method: "POST", body: JSON.stringify({ recipient_id, gift_id, quantity, request_id }) });
}
export type CallRtc = { app_id: string; channel: string; uid: number; token: string; expires_at: number };
export type CallInfo = {
  id: string; status: string; channel: string; direction: "incoming" | "outgoing"; accepted_at: string | null;
  peer: { id: string; nickname?: string; avatar_url?: string; vip_level: number };
};
export async function apiCallStart(callee_id: string) {
  return request<{ call: CallInfo; rtc: CallRtc }>("/calls/start", { method: "POST", body: JSON.stringify({ callee_id }) });
}
export async function apiCallCurrent() { return request<{ call: CallInfo | null }>("/calls/current"); }
export async function apiCallAccept(id: string) { return request<{ call: CallInfo; rtc: CallRtc }>(`/calls/${id}/accept`, { method: "POST" }); }
export async function apiCallEnd(id: string) { return request<any>(`/calls/${id}/end`, { method: "POST" }); }
export async function apiCallToken(id: string) { return request<CallRtc>(`/calls/${id}/token`, { method: "POST" }); }
// Iter-135 — presence, unread counts, moderation words (admin).
export async function apiPresencePing() { return request<any>("/presence/ping", { method: "POST" }); }
export async function apiUnreadCount() { return request<{ unread: number }>("/messages/unread-count"); }
export async function apiAdminBannedWords() { return request<{ words: string[]; builtin_en: string[]; builtin_ar: string[] }>("/admin/moderation/words"); }
export async function apiAdminSetBannedWords(words: string[]) { return request<{ words: string[] }>("/admin/moderation/words", { method: "PUT", body: JSON.stringify({ words }) }); }
export const fmtCount = (n?: number) => (!n ? "" : n > 9 ? "9+" : String(n));
export async function apiLeaderboard(kind: "wealth" | "charm" | "level") {
  return request<any[]>(`/leaderboards/${kind}`);
}

export async function apiListGames() { return request<any[]>("/games"); }
export async function apiPlayGame(gameId: string, bet: number, pick?: string) {
  return request<any>(`/games/${gameId}/play`, { method: "POST", body: JSON.stringify({ bet, pick }) });
}
export async function apiGameHistory() { return request<any[]>("/games/history"); }

// Phase 3 additions
export async function apiCountries() { return request<any[]>("/countries"); }
export async function apiRoomFilterCountries() { return request<any[]>("/room-filter-countries"); }
export async function apiRoomSupportBadges(roomId: string, userId: string) {
  return request<{ sent: number; received: number }>(`/rooms/${roomId}/support-badges/${userId}`);
}
export async function apiVipTiers() { return request<any>("/vip/tiers"); }
export async function apiVipPurchase(level: number) { return request<any>("/vip/purchase", { method: "POST", body: JSON.stringify({ level }) }); }
export async function apiUpdateGallery(body: any) { return request<any>("/users/me/gallery", { method: "PATCH", body: JSON.stringify(body) }); }

export async function apiPosts(feed: "latest" | "popular" | "friends" = "latest", tag?: string | null, media?: "photos" | "videos" | null) {
  return request<any[]>(`/posts?feed=${feed}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}${media ? `&media=${media}` : ""}`);
}
export async function apiUserPosts(userId: string, limit = 5) { return request<any[]>(`/users/${userId}/posts?limit=${limit}`); }
export async function apiRoomsSearch(q: string) { return request<{ rooms: any[]; users_without_room: any[] }>(`/rooms/search?q=${encodeURIComponent(q)}`); }
export async function apiBuyGifAccess(request_id: string) { return request<any>("/me/gif-access/purchase", { method: "POST", body: JSON.stringify({ request_id }) }); }
export async function apiCreatePost(text: string, image_url?: string) { return request<any>("/posts", { method: "POST", body: JSON.stringify({ text, image_url }) }); }
export async function apiCreatePostFull(body: { text: string; images?: string[]; video_url?: string; video_duration?: number | null; hashtags?: string[]; visibility?: "public" | "mutual" }) {
  return request<any>("/posts", { method: "POST", body: JSON.stringify(body) });
}
export const POST_HASHTAGS = ["سفر", "طعام", "الحياة_اليومية", "أجواء_الشتاء", "أجواء_الخريف", "أجواء_الصيف", "أجواء_الربيع"];
export async function apiReferralStatus() { return request<any>("/referral/status"); }
export async function apiReferralRedeem(code: string) { return request<any>("/referral/redeem", { method: "POST", body: JSON.stringify({ code }) }); }
export async function apiTaskHeartbeat(room_id: string) { return request<any>("/tasks/heartbeat", { method: "POST", body: JSON.stringify({ room_id }) }); }
export async function apiLikePost(id: string) { return request<any>(`/posts/${id}/like`, { method: "POST" }); }
export async function apiDeletePost(id: string) { return request<any>(`/posts/${id}`, { method: "DELETE" }); }

export async function apiFriendship() { return request<any[]>("/friendship"); }
export async function apiFriendshipRequest(user_id: string) { return request<any>("/friendship/request", { method: "POST", body: JSON.stringify({ user_id }) }); }
export async function apiFriendshipAccept(user_id: string) { return request<any>("/friendship/accept", { method: "POST", body: JSON.stringify({ user_id }) }); }

export async function apiCp() { return request<any[]>("/cp"); }
export async function apiCpRequest(user_id: string) { return request<any>("/cp/request", { method: "POST", body: JSON.stringify({ user_id }) }); }
export async function apiCpAccept(user_id: string) { return request<any>("/cp/accept", { method: "POST", body: JSON.stringify({ user_id }) }); }

export async function apiFamilies() { return request<any[]>("/families"); }
export async function apiFamiliesMine() { return request<any[]>("/families/mine"); }
export async function apiFamilyCreate(body: any) { return request<any>("/families", { method: "POST", body: JSON.stringify(body) }); }
export async function apiFamilyJoin(id: string) { return request<any>(`/families/${id}/join`, { method: "POST" }); }
export async function apiFamilyLeave(id: string) { return request<any>(`/families/${id}/leave`, { method: "POST" }); }
export async function apiFamilyGet(id: string) { return request<any>(`/families/${id}`); }
export async function apiFamilyMessages(id: string) { return request<any[]>(`/families/${id}/messages`); }
export async function apiFamilySendMessage(id: string, text: string) { return request<any>(`/families/${id}/messages`, { method: "POST", body: JSON.stringify({ text }) }); }

export async function apiRankings(category: string, period: string = "all", country?: string) {
  const q = new URLSearchParams({ period });
  if (country) q.set("country", country);
  return request<any[]>(`/rankings/v2/${category}?${q.toString()}`);
}
export async function apiRankingsV3(category: string, period: string = "all") {
  return request<{ items: any[]; me: any | null }>(`/rankings/v3/${category}?period=${period}`);
}
export async function apiMyRooms() { return request<any[]>("/rooms/mine"); }
export async function apiReferral() { return request<any>("/referral/me"); }

// ---------- ORIO Realtime & Production ----------
export async function apiGoogleSession(session_id: string) {
  const t = await request<any>("/auth/google/session", { method: "POST", body: JSON.stringify({ session_id }) });
  accessToken = t.access_token;
  await setRefreshToken(t.refresh_token);
  return t;
}

// Iter-47 Phase 6 — Phone OTP (Twilio Verify) + Facebook Login + providers config.
export type AuthProviders = {
  google: boolean;
  email: boolean;
  phone: boolean;
  facebook: boolean;
  apple?: boolean;
};
export async function apiAppleSignIn(identity_token: string, full_name?: string | null, email?: string | null) {
  const t = await request<any>("/auth/apple", {
    method: "POST",
    body: JSON.stringify({ identity_token, full_name: full_name || null, email: email || null }),
  });
  accessToken = t.access_token;
  await setRefreshToken(t.refresh_token);
  return t;
}
export async function apiAuthProviders() {
  return request<AuthProviders>("/auth/providers");
}
export async function apiPhoneSendOtp(phone: string) {
  return request<{ ok: boolean; status: string; resend_cooldown_seconds: number }>("/auth/phone/send-otp", {
    method: "POST",
    body: JSON.stringify({ phone }),
  });
}
export async function apiPhoneVerifyOtp(phone: string, code: string, nickname?: string) {
  const t = await request<any>("/auth/phone/verify-otp", {
    method: "POST",
    body: JSON.stringify({ phone, code, nickname }),
  });
  accessToken = t.access_token;
  await setRefreshToken(t.refresh_token);
  return t;
}
export async function apiFacebookExchange(access_token: string) {
  const t = await request<any>("/auth/facebook/exchange", {
    method: "POST",
    body: JSON.stringify({ access_token }),
  });
  accessToken = t.access_token;
  await setRefreshToken(t.refresh_token);
  return t;
}

export async function apiRtcConfig() { return request<{ enabled: boolean; app_id: string | null }>("/rtc/config"); }
export async function apiRtcToken(channel: string, uid: number) {
  return request<any>("/rtc/token", { method: "POST", body: JSON.stringify({ channel, uid }) });
}

export async function apiRoomChatHistory(room_id: string) { return request<any[]>(`/rooms/${room_id}/chat`); }

export async function apiCreateEnvelope(room_id: string, amount: number, slots: number, message?: string) {
  return request<any>(`/rooms/${room_id}/envelopes`, { method: "POST", body: JSON.stringify({ amount, slots, message }) });
}
export async function apiClaimEnvelope(env_id: string) {
  return request<any>(`/envelopes/${env_id}/claim`, { method: "POST" });
}
export async function apiListEnvelopes(room_id: string) { return request<any[]>(`/rooms/${room_id}/envelopes`); }

export type ModerateAction = "mute_seat" | "unmute_seat" | "lock_seat" | "unlock_seat" | "kick_seat";
export async function apiModerate(room_id: string, action: ModerateAction, seat_index: number) {
  return request<any>(`/rooms/${room_id}/moderate`, { method: "POST", body: JSON.stringify({ action, seat_index }) });
}

export async function apiPostComments(post_id: string) { return request<any[]>(`/posts/${post_id}/comments`); }
export async function apiAddPostComment(post_id: string, text: string, parent_id?: string) {
  return request<any>(`/posts/${post_id}/comments`, { method: "POST", body: JSON.stringify({ text, parent_id }) });
}

// ---------- Room levels, mic requests, background moderation, emoji, VIP heads, tasks ----------
export async function apiRoomLevel(room_id: string) { return request<any>(`/rooms/${room_id}/level`); }
export async function apiListMicRequests(room_id: string) { return request<any[]>(`/rooms/${room_id}/mic-requests`); }
export async function apiMicRequest(room_id: string, action: "request" | "cancel" | "accept" | "reject" | "remove", user_id?: string, seat_index?: number) {
  return request<any>(`/rooms/${room_id}/mic-requests`, { method: "POST", body: JSON.stringify({ action, user_id, seat_index }) });
}
export async function apiSubmitRoomBackground(room_id: string, image_url: string) {
  return request<any>(`/rooms/${room_id}/background`, { method: "POST", body: JSON.stringify({ image_url }) });
}
export async function apiRoomBackgroundStatus(room_id: string) { return request<any[]>(`/rooms/${room_id}/background/status`); }

// Iter-67 — Room cover (avatar) moderation + update endpoints.
export async function apiModerateRoomCover(cover_url: string) {
  return request<{ ok: boolean; cover_url: string }>("/room-covers/moderate", { method: "POST", body: JSON.stringify({ cover_url }) });
}
export async function apiUpdateRoomCover(room_id: string, cover_url: string) {
  return request<{ ok: boolean; cover_url: string }>(`/rooms/${room_id}/cover`, { method: "PATCH", body: JSON.stringify({ cover_url }) });
}

// Iter-69 — Profile avatar/GIF endpoints with 3-day block + VIP5+ gate.
export async function apiMediaBlockStatus() {
  return request<{ blocked: boolean; blocked_until: string | null }>("/me/media-block");
}
export async function apiModerateProfileAvatar(avatar_url: string, kind: "photo" | "gif") {
  return request<{ ok: boolean; avatar_url: string; kind: "photo" | "gif" }>(
    "/me/profile-avatar/moderate",
    { method: "POST", body: JSON.stringify({ avatar_url, kind }) },
  );
}
export async function apiUpdateProfileAvatar(avatar_url: string, kind: "photo" | "gif") {
  return request<any>(
    "/me/profile-avatar",
    { method: "PATCH", body: JSON.stringify({ avatar_url, kind }) },
  );
}

export async function apiEmojiPacks() { return request<any[]>("/emoji-packs"); }
export async function apiVipHeads() { return request<any[]>("/vip/heads"); }

export async function apiTasks() { return request<any[]>("/tasks"); }
// Iter-97 — Level / Bag / Store / Medal screens.
export async function apiMyLevels() { return request<any>("/me/levels"); }
export async function apiMyBag(category: string) { return request<any>(`/me/bag?category=${encodeURIComponent(category)}`); }
export async function apiCosmeticsStore(category: string) { return request<any>(`/cosmetics/store?category=${encodeURIComponent(category)}`); }
export async function apiCosmeticPurchase(item_id: string) {
  return request<any>(`/cosmetics/${encodeURIComponent(item_id)}/purchase`, { method: "POST" });
}
export async function apiMyConnections(type: "friends" | "following" | "followers") {
  return request<{ type: string; items: any[]; counts: { friends: number; following: number; followers: number } }>(`/me/connections?type=${type}`);
}
export async function apiBagEquip(body: { category: string; item_id: string; source: "store" | "room" | "vip" }, equip: boolean) {
  return request<any>(`/me/bag/${equip ? "equip" : "unequip"}`, { method: "POST", body: JSON.stringify(body) });
}
export async function apiMyMedals() { return request<any>("/me/medals"); }
export async function apiTaskProgress(task_id: string, increment = 1) {
  return request<any>("/tasks/progress", { method: "POST", body: JSON.stringify({ task_id, increment }) });
}
export async function apiTaskClaim(task_id: string) {
  return request<any>(`/tasks/${task_id}/claim`, { method: "POST" });
}

export async function apiVipProgress() {
  return request<{
    level: number; spent: number; growth_points: number; current_floor: number;
    next_level: number | null; next_threshold: number | null;
    remaining: number; progress: number; recharged_diamonds: number;
    thresholds: { level: number; threshold: number }[];
    levels: { level: number; threshold: number; remaining: number; unlocked: boolean }[];
  }>("/vip/progress");
}

// Iter-133 — Stripe checkout; Diamonds are credited only after server verification.
export async function apiCheckout(package_id: string, origin_url: string) {
  return request<{ url: string; session_id: string }>("/payments/checkout", { method: "POST", body: JSON.stringify({ package_id, origin_url }) });
}
export async function apiPaymentStatus(session_id: string) {
  return request<{ status: string; payment_status: string; credited_now: boolean; diamonds: number; coins: number; vip_level: number }>(`/payments/status/${session_id}`);
}

export async function apiVipConvert(amount: number) {
  return request<{
    ok: boolean; tx_id: string; converted: number;
    diamonds: number; growth_points: number;
  }>("/vip/convert", { method: "POST", body: JSON.stringify({ amount }) });
}

export async function apiVipThresholds() {
  return request<{ thresholds: { level: number; threshold: number }[] }>("/vip/thresholds");
}

export type GrowthHistoryItem = {
  tx_id: string;
  source: "recharge" | "conversion" | "vip_activation" | string;
  amount: number;
  growth_after?: number;
  diamonds_after?: number;
  package_id?: string;
  from_level?: number;
  to_level?: number;
  created_at: string;
};
export async function apiVipGrowthHistory(limit = 100) {
  return request<{ items: GrowthHistoryItem[] }>(`/vip/growth-history?limit=${limit}`);
}

// ---------- Phase 2A — Agency Center + Host Earnings ----------
export type AgencySummary = {
  id: string;
  name: string;
  owner_user_id: string;
  status: "active" | "suspended" | "disabled";
  earnings: number;
  created_at: string;
};
export type MyAgencyResponse = {
  membership: null | { id: string; agency_id: string; user_id: string; role: "HOST" | "AGENCY_OWNER"; status: string; joined_at: string };
  agency: AgencySummary | null;
  role: "HOST" | "AGENCY_OWNER" | null;
};
export type HostEarnings = {
  user_id: string;
  agency_id: string | null;
  currency: string;
  available: { host: number; gross: number; entries: number };
  pending: { host: number; gross: number; entries: number };
};
export type LedgerEntry = {
  transaction_id: string;
  reference_id: string;
  user_id: string;
  agency_id: string | null;
  type: "earning" | "reversal";
  status: "completed" | "refunded" | "reversed" | "pending" | "failed";
  gross_amount: number;
  host_amount: number;
  agency_amount: number;
  orio_amount: number;
  currency: string;
  source: string;
  metadata?: Record<string, any>;
  created_at: string;
  completed_at?: string;
};
export type InvitationRow = {
  id: string;
  agency_id: string;
  user_id: string;
  invited_by: string;
  status: "pending" | "accepted" | "rejected" | "cancelled";
  message: string | null;
  created_at: string;
  responded_at: string | null;
  agency?: AgencySummary;
  user?: { id: string; nickname?: string; username?: string; numeric_id?: string; avatar_url?: string };
};
export type AgencyHostRow = {
  id: string;
  user_id: string;
  role: "HOST" | "AGENCY_OWNER";
  status: "active" | "suspended" | "removed";
  joined_at: string;
  user?: { id: string; nickname?: string; username?: string; numeric_id?: string; avatar_url?: string; vip_level?: number };
  host_earnings: number | null;
};

export async function apiMyEarnings() {
  return request<HostEarnings>("/hosts/me/earnings");
}
export async function apiMyTransactions(limit = 100) {
  return request<{ items: LedgerEntry[] }>(`/me/transactions?limit=${limit}`);
}
export async function apiMyAgency() {
  return request<MyAgencyResponse>("/me/agency");
}
export async function apiMyInvitations() {
  return request<{ items: InvitationRow[] }>("/me/agency-invitations");
}
export async function apiLeaveMyAgency() {
  return request<{ ok: boolean }>("/me/agency/leave", { method: "POST" });
}
export async function apiAgencyGet(id: string) {
  return request<AgencySummary>(`/agencies/${id}`);
}
export async function apiAgencyEarnings(id: string) {
  return request<{
    agency_id: string; currency: string;
    available: { agency: number; gross: number; entries: number };
    pending: { agency: number; gross: number; entries: number };
  }>(`/agencies/${id}/earnings`);
}
export async function apiAgencyHosts(id: string, status?: "active" | "suspended" | "removed") {
  const q = status ? `?status=${status}` : "";
  return request<{ items: AgencyHostRow[] }>(`/agencies/${id}/hosts${q}`);
}
export async function apiAgencyInvitations(id: string, status: "pending" | "accepted" | "rejected" | "cancelled" = "pending") {
  return request<{ items: InvitationRow[] }>(`/agencies/${id}/invitations?status=${status}`);
}
export async function apiAgencyInvite(id: string, user_identifier: string, message?: string) {
  return request<InvitationRow>(`/agencies/${id}/invitations`, {
    method: "POST", body: JSON.stringify({ user_identifier, message }),
  });
}
export async function apiAgencyCancelInvite(agency_id: string, inv_id: string) {
  return request<{ ok: boolean }>(`/agencies/${agency_id}/invitations/${inv_id}`, { method: "DELETE" });
}
export async function apiAgencyTransactions(id: string, limit = 100) {
  return request<{ items: LedgerEntry[] }>(`/agencies/${id}/transactions?limit=${limit}`);
}
export async function apiAcceptInvitation(inv_id: string) {
  return request<{ ok: boolean; agency_id: string }>(`/agency-invitations/${inv_id}/accept`, { method: "POST" });
}
export async function apiRejectInvitation(inv_id: string) {
  return request<{ ok: boolean }>(`/agency-invitations/${inv_id}/reject`, { method: "POST" });
}
export async function apiAgencySuspendHost(agency_id: string, user_id: string) {
  return request<{ ok: boolean }>(`/agencies/${agency_id}/hosts/${user_id}/suspend`, { method: "POST" });
}
export async function apiAgencyReactivateHost(agency_id: string, user_id: string) {
  return request<{ ok: boolean }>(`/agencies/${agency_id}/hosts/${user_id}/reactivate`, { method: "POST" });
}
export async function apiAgencyRemoveHost(agency_id: string, user_id: string) {
  return request<{ ok: boolean }>(`/agencies/${agency_id}/hosts/${user_id}`, { method: "DELETE" });
}

// ---------- Phase 2B — Withdrawal system (manual payouts) ----------
export type PayoutMethodSchema = {
  key: string; label: string;
  required_fields: string[]; optional_fields: string[];
  network?: string;
};
export type PayoutMethodRow = {
  id: string; method: string; label: string;
  details: Record<string, string>;
  display_hint: string | null;
  is_default: boolean;
  verification_status: "unverified" | "verified";
  created_at: string;
};
export type WithdrawalConfig = {
  minimum_withdrawal_usd: number;
  maximum_withdrawal_usd: number;
  review_period_days: number;
  diamonds_per_usd: number;
};
export type WithdrawalRow = {
  id: string;
  withdrawal_id: string;
  user_id: string;
  agency_id: string | null;
  owner_type: "host" | "agency";
  amount_usd: number;
  amount_diamonds: number;
  exchange_rate: number;
  currency: string;
  status: "REQUESTED" | "UNDER_REVIEW" | "HOLD" | "NEEDS_INFORMATION" |
          "APPROVED" | "PROCESSING" | "PAID" |
          "REJECTED" | "CANCELLED" | "FAILED" | "RETURNED";
  method: string;
  method_label: string;
  destination_hint: string | null;
  external_reference: string | null;
  rejection_reason: string | null;
  failure_reason: string | null;
  info_request: string | null;
  requested_at: string;
  review_start_at: string;
  review_ends_at: string;
  processed_at: string | null;
  paid_at: string | null;
  returned_at: string | null;
  payout_method_snapshot?: {
    method: string; details: Record<string, string>; display_hint?: string;
  };
};

export async function apiSupportedMethods() {
  return request<{ items: PayoutMethodSchema[] }>("/payout/methods");
}
export async function apiWithdrawalConfig() {
  return request<WithdrawalConfig>("/withdrawal/config");
}
export async function apiListPayoutMethods() {
  return request<{ items: PayoutMethodRow[] }>("/me/payout-methods");
}
export async function apiAddPayoutMethod(method: string, details: Record<string, string>, is_default = false) {
  return request<PayoutMethodRow>("/me/payout-methods", {
    method: "POST", body: JSON.stringify({ method, details, is_default }),
  });
}
export async function apiEditPayoutMethod(id: string, details: Record<string, string>) {
  return request<PayoutMethodRow>(`/me/payout-methods/${id}`, {
    method: "PATCH", body: JSON.stringify({ details }),
  });
}
export async function apiDeletePayoutMethod(id: string) {
  return request<{ ok: boolean }>(`/me/payout-methods/${id}`, { method: "DELETE" });
}
export async function apiSetDefaultPayoutMethod(id: string) {
  return request<{ ok: boolean }>(`/me/payout-methods/${id}/default`, { method: "POST" });
}
export async function apiRequestWithdrawal(amount_usd: number, payout_method_id: string, idempotency_key?: string) {
  return request<WithdrawalRow>("/me/withdrawals", {
    method: "POST",
    body: JSON.stringify({ amount_usd, payout_method_id, idempotency_key }),
  });
}
export async function apiListMyWithdrawals(limit = 100) {
  return request<{ items: WithdrawalRow[] }>(`/me/withdrawals?limit=${limit}`);
}
export async function apiGetMyWithdrawal(wid: string) {
  return request<WithdrawalRow>(`/me/withdrawals/${wid}`);
}
export async function apiCancelMyWithdrawal(wid: string) {
  return request<{ ok: boolean }>(`/me/withdrawals/${wid}/cancel`, { method: "POST" });
}
export async function apiRequestAgencyWithdrawal(agency_id: string, amount_usd: number, payout_method_id: string, idempotency_key?: string) {
  return request<WithdrawalRow>(`/agencies/${agency_id}/withdrawals`, {
    method: "POST",
    body: JSON.stringify({ amount_usd, payout_method_id, idempotency_key }),
  });
}
export async function apiListAgencyWithdrawals(agency_id: string, limit = 100) {
  return request<{ items: WithdrawalRow[] }>(`/agencies/${agency_id}/withdrawals?limit=${limit}`);
}

// Admin
export async function apiAdminListWithdrawals(status?: string, owner_type?: string, limit = 100) {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  if (owner_type) qs.set("owner_type", owner_type);
  qs.set("limit", String(limit));
  return request<{ items: WithdrawalRow[] }>(`/admin/withdrawals?${qs.toString()}`);
}
export async function apiAdminGetWithdrawal(wid: string) {
  return request<WithdrawalRow>(`/admin/withdrawals/${wid}`);
}
export async function apiAdminWithdrawalAction(
  wid: string,
  action: "review" | "hold" | "request-info" | "approve" | "reject" | "start-processing" | "mark-paid" | "mark-failed" | "mark-returned",
  body: Record<string, any> = {},
) {
  return request<WithdrawalRow>(`/admin/withdrawals/${wid}/${action}`, {
    method: "POST", body: JSON.stringify(body),
  });
}
export async function apiAdminGetWithdrawalConfig() {
  return request<WithdrawalConfig>("/admin/withdrawal-config");
}
export async function apiAdminPatchWithdrawalConfig(cfg: Partial<WithdrawalConfig> & { reason?: string }) {
  return request<WithdrawalConfig>("/admin/withdrawal-config", {
    method: "PATCH", body: JSON.stringify(cfg),
  });
}

// ---------- Iter-41 — Agency lookup + user-initiated join requests ----------
export async function apiAgencyLookup(agencyId: string) {
  return request<{
    agency: AgencySummary;
    my_membership_status: "active" | null;
    pending_request_id: string | null;
  }>(`/agency-search?id=${encodeURIComponent(agencyId)}`);
}
export async function apiCreateJoinRequest(agencyId: string, message?: string) {
  return request<InvitationRow>(`/agencies/${agencyId}/join-request`, {
    method: "POST", body: JSON.stringify({ message }),
  });
}
export async function apiMyJoinRequests() {
  return request<{ items: InvitationRow[] }>("/me/join-requests");
}
export async function apiCancelMyJoinRequest(reqId: string) {
  return request<{ ok: boolean }>(`/me/join-requests/${reqId}`, { method: "DELETE" });
}
export async function apiOwnerApproveJoinRequest(agencyId: string, reqId: string) {
  return request<{ ok: boolean }>(`/agencies/${agencyId}/join-requests/${reqId}/approve`, { method: "POST" });
}
export async function apiOwnerRejectJoinRequest(agencyId: string, reqId: string) {
  return request<{ ok: boolean }>(`/agencies/${agencyId}/join-requests/${reqId}/reject`, { method: "POST" });
}


// ============================================================================
// Iter-42 — ORIO Games (Ludo) + Financial Intermediary / Recharge Agent
// ============================================================================

export type LudoTokenRender =
  | { zone: "base"; pos: 0 }
  | { zone: "track"; pos: number }
  | { zone: "home"; pos: number }
  | { zone: "finish"; pos: 0 };

export type LudoPlayer = {
  user_id: string;
  nickname: string;
  avatar_url?: string | null;
  vip_level?: number;
  seat: number;
  color: "red" | "green" | "yellow" | "blue";
  is_connected: boolean;
  forfeited: boolean;
};

export type LudoState = {
  current_turn: number;
  dice: number | null;
  consecutive_sixes: number;
  moves_count: number;
  tokens: Record<string, { in_base: boolean; steps: number }[]>;
  last_action_at?: string;
};

export type LudoGame = {
  id: string | null;
  game_id: string;
  game_type: "ludo";
  room_id: string | null;
  owner_id: string;
  mode: "casual";
  status: "waiting" | "active" | "finished" | "abandoned";
  players: LudoPlayer[];
  state: LudoState;
  winner_seat: number | null;
  winner_user_id: string | null;
  xp_awards?: Record<string, number>;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
};

export async function apiCreateLudo(room_id: string) {
  return request<LudoGame>("/games/ludo/create", {
    method: "POST", body: JSON.stringify({ room_id }),
  });
}
export async function apiGetGame(game_id: string) {
  return request<LudoGame>(`/games/${game_id}`);
}
export async function apiGetActiveGameForRoom(room_id: string) {
  return request<{ game: LudoGame | null }>(`/rooms/${room_id}/games/active`);
}
export async function apiJoinGame(game_id: string) {
  return request<LudoGame>(`/games/${game_id}/join`, { method: "POST" });
}
export async function apiLeaveGame(game_id: string) {
  return request<LudoGame>(`/games/${game_id}/leave`, { method: "POST" });
}
export async function apiStartGame(game_id: string) {
  return request<LudoGame>(`/games/${game_id}/start`, { method: "POST" });
}
export async function apiRollDice(game_id: string) {
  return request<LudoGame>(`/games/${game_id}/roll`, { method: "POST" });
}
export async function apiMoveToken(game_id: string, token_index: number) {
  return request<LudoGame>(`/games/${game_id}/move`, {
    method: "POST", body: JSON.stringify({ token_index }),
  });
}
export async function apiGamesXp() {
  return request<{ games_xp: number; ledger: any[] }>("/me/games-xp");
}

// Recharge Agent — user side
export type RechargeAgent = {
  id: string;
  agent_code: string;
  name: string;
  country?: string | null;
  contact?: string | null;
  note?: string | null;
  is_active: boolean;
  created_at: string;
};

export type RechargeAgentTx = {
  id: string;
  user_id: string;
  agent_id: string;
  agent_tx_id: string;
  amount_usd: number;
  diamonds_credited: number;
  status: "pending" | "verified" | "rejected";
  paid_at: string;
  note?: string | null;
  wallet_tx_id?: string | null;
  verified_by?: string | null;
  verified_at?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  agent?: { id: string; agent_code: string; name: string };
};

export async function apiListRechargeAgents() {
  return request<{ items: RechargeAgent[] }>("/recharge-agents");
}
export async function apiGetRechargeAgent(id: string) {
  return request<RechargeAgent>(`/recharge-agents/${id}`);
}
export async function apiSubmitRechargeAgentTx(body: {
  agent_id: string;
  agent_tx_id: string;
  amount_usd: number;
  paid_at: string; // ISO-8601
  note?: string;
}) {
  return request<RechargeAgentTx>("/recharge-agent-transactions", {
    method: "POST", body: JSON.stringify(body),
  });
}
export async function apiListMyRechargeAgentTxs(limit = 100) {
  return request<{ items: RechargeAgentTx[] }>(`/recharge-agent-transactions?limit=${limit}`);
}
export async function apiGetMyRechargeAgentTx(id: string) {
  return request<RechargeAgentTx>(`/recharge-agent-transactions/${id}`);
}

// Admin
export async function apiAdminListRechargeAgents() {
  return request<{ items: RechargeAgent[] }>("/admin/recharge-agents");
}
export async function apiAdminCreateRechargeAgent(body: {
  agent_code: string; name: string; country?: string; contact?: string; note?: string;
}) {
  return request<RechargeAgent>("/admin/recharge-agents", { method: "POST", body: JSON.stringify(body) });
}
export async function apiAdminPatchRechargeAgent(id: string, body: Partial<RechargeAgent>) {
  return request<RechargeAgent>(`/admin/recharge-agents/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}
export async function apiAdminListRechargeAgentTxs(status?: string) {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  return request<{ items: RechargeAgentTx[] }>(`/admin/recharge-agent-transactions${qs}`);
}
export async function apiAdminVerifyRechargeAgentTx(id: string) {
  return request<RechargeAgentTx>(`/admin/recharge-agent-transactions/${id}/verify`, { method: "POST" });
}
export async function apiAdminRejectRechargeAgentTx(id: string, reason: string) {
  return request<RechargeAgentTx>(`/admin/recharge-agent-transactions/${id}/reject`, {
    method: "POST", body: JSON.stringify({ reason }),
  });
}

// Iter-44 — Profile completion (gender-locked after confirm).
export async function apiCompleteProfile(body: {
  nickname: string;
  gender: "male" | "female";
  age: number;
  country_code?: string;
  avatar_url?: string;
}) {
  return request<any>("/me/profile/complete", { method: "POST", body: JSON.stringify(body) });
}

// Iter-44 Phase 3 — Real user search by nickname / username / numeric ID.
export type UserSearchItem = {
  id: string;
  username?: string;
  nickname?: string;
  avatar_url?: string | null;
  numeric_id?: string;
  vip_level?: number;
  level?: number;
  country_flag?: string;
  is_following?: boolean;
};
export async function apiSearchUsers(q: string, limit = 20) {
  const qs = `?q=${encodeURIComponent(q)}&limit=${limit}`;
  return request<{ items: UserSearchItem[]; query: string }>(`/users/search${qs}`);
}

// ============================================================================
// Iter-43 — Room Games Catalog + Billiards (half-screen in-room play)
// ============================================================================

export type RoomGameEntry = {
  id: string;
  category: "entertainment" | "betting";
  game_type: string;
  title_en: string;
  title_ar: string;
  icon?: string | null;
  enabled: boolean;
  order: number;
  min_players?: number | null;
  max_players?: number | null;
  provider_id?: string | null;
  provider_game_id?: string | null;
  jurisdictions?: string[] | null;
  wager_limits?: number[] | null;
  legal_status?: string | null;
  unavailable_reason?: string;
};

export type RoomGamesCatalog = {
  entertainment: RoomGameEntry[];
  betting: RoomGameEntry[];
};

export async function apiRoomGamesCatalog() {
  return request<RoomGamesCatalog>("/room-games/catalog");
}

// Billiards
export type BilliardsBall = { id: number; x: number; y: number; vx?: number; vy?: number; color: string; pocketed: boolean; is_cue: boolean };
export type BilliardsShotFrame = { id: number; x: number; y: number; pocketed: boolean }[];
export type BilliardsLastShot = {
  seat: number; angle_deg: number; power: number;
  events: { type: string; step: number; ball?: number; is_cue?: boolean; a?: number; b?: number }[];
  pocketed: { id: number; is_cue: boolean }[];
  frames: BilliardsShotFrame[];
  seq: number;
  at: string;
};
export type BilliardsPlayer = {
  user_id: string; nickname: string; avatar_url?: string | null; seat: number;
  score: number; legal_pots: number; is_connected: boolean; forfeited: boolean;
};
export type BilliardsGame = {
  id: string | null;
  game_id: string;
  game_type: "billiards";
  room_id: string | null;
  owner_id: string;
  mode: "casual";
  status: "waiting" | "active" | "finished" | "abandoned";
  players: BilliardsPlayer[];
  state: {
    balls: BilliardsBall[];
    current_turn: number;
    shots_count: number;
    last_shot: BilliardsLastShot | null;
    last_action_at?: string;
  };
  winner_seat: number | null;
  winner_user_id: string | null;
  table: { w: number; h: number; ball_r: number; pocket_r: number; pockets: [number, number][] };
};

export async function apiCreateBilliards(room_id: string) {
  return request<BilliardsGame>("/games/billiards/create", { method: "POST", body: JSON.stringify({ room_id }) });
}
export async function apiJoinBilliards(game_id: string) {
  return request<BilliardsGame>(`/games/billiards/${game_id}/join`, { method: "POST" });
}
export async function apiLeaveBilliards(game_id: string) {
  return request<BilliardsGame>(`/games/billiards/${game_id}/leave`, { method: "POST" });
}
export async function apiBilliardsShot(game_id: string, angle_deg: number, power: number) {
  return request<BilliardsGame>(`/games/billiards/${game_id}/shot`, {
    method: "POST", body: JSON.stringify({ angle_deg, power }),
  });
}
export async function apiGetActiveBilliardsForRoom(room_id: string) {
  return request<{ game: BilliardsGame | null }>(`/rooms/${room_id}/games/billiards/active`);
}

// ============================================================================
// Iter-86 — Owner + Approved Admin model
// ============================================================================
export type AdminAccess = {
  is_owner: boolean;
  permissions: string[];
  enabled: boolean;
};
export type AdminTeamMember = {
  email: string;
  permissions: string[];
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
  disabled_at?: string | null;
};
export type AdminTeamResponse = {
  owner_email: string;
  items: AdminTeamMember[];
  all_permissions: string[];
};

export async function apiAdminTeamList() {
  return request<AdminTeamResponse>("/admin/dashboard/team");
}
export async function apiAdminTeamAdd(email: string, permissions: string[]) {
  return request<{ ok: boolean; email: string; permissions: string[]; enabled: boolean }>("/admin/dashboard/team", {
    method: "POST", body: JSON.stringify({ email, permissions }),
  });
}
export async function apiAdminTeamPatch(email: string, body: Partial<{ permissions: string[]; enabled: boolean }>) {
  return request<{ ok: boolean; email: string; permissions: string[]; enabled: boolean }>(
    `/admin/dashboard/team/${encodeURIComponent(email)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}
export async function apiAdminTeamRemove(email: string) {
  return request<{ ok: boolean; email: string }>(
    `/admin/dashboard/team/${encodeURIComponent(email)}`,
    { method: "DELETE" },
  );
}
export async function apiAdminGetOwner() {
  return request<{ owner_email: string; is_owner: boolean }>("/admin/dashboard/owner");
}
export async function apiAdminChangeOwner(new_email: string) {
  return request<{ ok: boolean; owner_email: string; previous_owner_email: string }>("/admin/dashboard/owner", {
    method: "POST", body: JSON.stringify({ new_email }),
  });
}

/**
 * Iter-87 — Admin Owner Google session exchange.
 * Exchanges an Emergent Google session_id for an ORIO admin session.
 * Returns 403 unless the authenticated Google email matches ADMIN_OWNER_EMAIL.
 * On success, stores tokens via the same hooks used by regular login.
 */
export async function apiAdminGoogleExchange(session_id: string): Promise<{ ok: true }> {
  const res = await fetch(`${API_BASE}/admin/auth/google/session`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id }),
  });
  if (!res.ok) {
    let msg = "Admin Google sign-in failed";
    try {
      const j = await res.json();
      if (j?.detail) msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch {}
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  if (data?.access_token) {
    setAccessToken(data.access_token);
  }
  if (data?.refresh_token) {
    await setRefreshToken(data.refresh_token);
  }
  return { ok: true };
}
// ============================================================================
// Iter-85 — Admin Dashboard API (web-based control center)
// ============================================================================
export type AdminStats = {
  users: { total: number; new_24h: number; new_7d: number; vip: number; banned: number; admins: number };
  rooms: { total: number; live: number };
  economy: { diamonds: number; coins: number };
  vip_breakdown: Record<string, number>;
  moderation: { open_reports: number; pending_withdrawals: number };
  server_time: string;
};
export type AdminUser = {
  id: string; email: string; username: string; nickname: string; numeric_id?: string;
  avatar_url?: string; animated_avatar_url?: string | null; vip_level: number;
  coins: number; diamonds: number; level: number;
  is_banned: boolean; created_at?: string; language?: string; phone?: string; facebook_id?: string;
  vip_expires_at?: string | null;
};
export type AdminRoom = {
  id: string; name?: string; title?: string; owner_id?: string;
  owner_nickname?: string; owner_username?: string;
  cover_url?: string; background_url?: string; num_seats?: number;
  is_live: boolean; is_locked: boolean; listeners_count?: number;
  created_at?: string; category?: string; country?: string;
};
export type AdminTx = {
  id: string; user_id: string; type: string; currency: string;
  amount: number; balance_after?: number; status?: string;
  description?: string; created_at?: string;
};
export type AdminReport = {
  id: string; reporter_id?: string; reported_id?: string; reason?: string;
  details?: string; status: string; media_kind?: string; has_media: boolean;
  created_at?: string; resolved_at?: string | null; resolved_by?: string | null;
  action?: string | null;
  reporter?: { username?: string; nickname?: string; avatar_url?: string; numeric_id?: string };
  reported?: { username?: string; nickname?: string; avatar_url?: string; numeric_id?: string };
  media_data_url?: string | null;
};

type Paged<T> = { total: number; items: T[]; skip: number; limit: number };

export async function apiAdminDashStats() {
  return request<AdminStats>("/admin/dashboard/stats");
}
export async function apiAdminDashUsers(p: { q?: string; filter?: string; limit?: number; skip?: number } = {}) {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.filter) qs.set("filter", p.filter);
  qs.set("limit", String(p.limit ?? 50));
  qs.set("skip", String(p.skip ?? 0));
  return request<Paged<AdminUser>>(`/admin/dashboard/users?${qs.toString()}`);
}
export async function apiAdminDashPatchUser(id: string, body: Partial<{
  is_banned: boolean; vip_level: number; vip_days: number;
  diamonds_delta: number; coins_delta: number; reason: string;
}>) {
  return request<{ ok: boolean; user: AdminUser }>(`/admin/dashboard/users/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
  });
}
export async function apiAdminDashRooms(p: { q?: string; filter?: string; limit?: number; skip?: number } = {}) {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.filter) qs.set("filter", p.filter);
  qs.set("limit", String(p.limit ?? 50));
  qs.set("skip", String(p.skip ?? 0));
  return request<Paged<AdminRoom>>(`/admin/dashboard/rooms?${qs.toString()}`);
}
export async function apiAdminDashPatchRoom(id: string, body: Partial<{
  is_live: boolean; is_locked: boolean; reason: string;
}>) {
  return request<{ ok: boolean; room: AdminRoom }>(`/admin/dashboard/rooms/${id}`, {
    method: "PATCH", body: JSON.stringify(body),
  });
}
export async function apiAdminDashTxs(p: { currency?: string; type?: string; limit?: number; skip?: number } = {}) {
  const qs = new URLSearchParams();
  if (p.currency) qs.set("currency", p.currency);
  if (p.type) qs.set("type", p.type);
  qs.set("limit", String(p.limit ?? 100));
  qs.set("skip", String(p.skip ?? 0));
  return request<Paged<AdminTx>>(`/admin/dashboard/transactions?${qs.toString()}`);
}
export async function apiAdminDashVip(p: { min_level?: number; limit?: number; skip?: number } = {}) {
  const qs = new URLSearchParams();
  qs.set("min_level", String(p.min_level ?? 1));
  qs.set("limit", String(p.limit ?? 100));
  qs.set("skip", String(p.skip ?? 0));
  return request<Paged<AdminUser>>(`/admin/dashboard/vip?${qs.toString()}`);
}
export async function apiAdminDashReports(p: { status?: string; limit?: number; skip?: number } = {}) {
  const qs = new URLSearchParams();
  if (p.status) qs.set("status", p.status);
  qs.set("limit", String(p.limit ?? 50));
  qs.set("skip", String(p.skip ?? 0));
  return request<Paged<AdminReport>>(`/admin/dashboard/reports?${qs.toString()}`);
}
export async function apiAdminDashReportDetail(id: string) {
  return request<AdminReport>(`/admin/dashboard/reports/${id}`);
}
export async function apiAdminDashActReport(id: string, action: "resolve" | "dismiss" | "ban_reported" | "warn_reported", note?: string) {
  return request<{ ok: boolean }>(`/admin/dashboard/reports/${id}`, {
    method: "PATCH", body: JSON.stringify({ action, note }),
  });
}
export async function apiAdminDashAudit(p: { limit?: number; skip?: number } = {}) {
  const qs = new URLSearchParams();
  qs.set("limit", String(p.limit ?? 100));
  qs.set("skip", String(p.skip ?? 0));
  return request<Paged<any>>(`/admin/dashboard/audit?${qs.toString()}`);
}

// ---- Iter-118 Admin Phase 1 ----
const AD = "/admin/dashboard";
const jpost = (body: any) => ({ method: "POST", body: JSON.stringify(body) });
export const adminP1 = {
  me: () => request<{ is_owner: boolean; permissions: string[] }>(`${AD}/me`),
  detail: (id: string) => request<any>(`${AD}/users/${id}/detail`),
  relations: (id: string, kind: string) => request<{ items: any[] }>(`${AD}/users/${id}/relations?kind=${kind}`),
  txs: (id: string) => request<{ items: any[] }>(`${AD}/users/${id}/transactions`),
  wallet: (id: string, b: { currency: "coins" | "diamonds"; delta: number; reason: string }) => request<any>(`${AD}/users/${id}/wallet`, jpost(b)),
  levelHistory: (id: string) => request<{ items: any[] }>(`${AD}/users/${id}/level-history`),
  setLevel: (id: string, b: { system: "wealth" | "charm" | "vip"; level: number; reason: string; vip_days?: number }) => request<any>(`${AD}/users/${id}/levels`, jpost(b)),
  editProfile: (id: string, b: any) => request<any>(`${AD}/users/${id}/profile`, { method: "PATCH", body: JSON.stringify(b) }),
  ban: (id: string, b: { type: "account" | "device" | "both"; hours?: number; permanent?: boolean; reason: string }) => request<any>(`${AD}/users/${id}/ban`, jpost(b)),
  unban: (id: string, reason: string) => request<any>(`${AD}/users/${id}/unban`, jpost({ reason })),
  userBans: (id: string) => request<{ items: any[] }>(`${AD}/users/${id}/bans`),
  bans: (active = true) => request<{ items: any[]; server_now: string }>(`${AD}/bans?active=${active}`),
  revokeSessions: (id: string) => request<any>(`${AD}/users/${id}/revoke-sessions`, jpost({})),
  audit: (p: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v) qs.set(k, v); });
    return request<{ total: number; items: any[] }>(`${AD}/audit/search?${qs.toString()}`);
  },
};

// Iter-94 — Messages Inbox tiles
export type InboxTile = { count: number; latest: string | null };
export type InboxOverview = {
  friend_requests: InboxTile;
  system_notifications: InboxTile;
  support_team: InboxTile;
  activities: InboxTile;
};
export async function apiInboxOverview() {
  return request<InboxOverview>("/inbox/overview");
}
export type SystemNotification = {
  id: string;
  title: string;
  body?: string;
  kind?: string;
  params?: Record<string, any>;
  action?: { type: "vip" | "profile" | "room" | "level"; id?: string } | null;
  created_at: string;
  read: boolean;
};
export async function apiSystemNotifications() {
  return request<{ items: SystemNotification[] }>("/notifications/system");
}
export type SupportMessage = {
  id: string;
  text: string;
  from_support: boolean;
  created_at: string;
  read?: boolean;
};
export async function apiSupportMessages() {
  return request<{ items: SupportMessage[]; can_send: boolean; min_vip: number }>("/support/messages");
}
// Iter-98 — Friend requests, room activities, admin support/activities.
export async function apiFriendRequests() { return request<{ items: any[] }>("/friend-requests"); }
export async function apiFriendRequestAct(user_id: string, action: "accept" | "reject") {
  return request<any>(`/friend-requests/${user_id}/${action}`, { method: "POST" });
}
export async function apiRoomEvents(scope: "all" | "mine", phase: "ongoing" | "upcoming") {
  return request<{ items: any[] }>(`/room-events?scope=${scope}&phase=${phase}`);
}
export async function apiRoomEventApply(body: { name: string; date: string; image_url: string }) {
  return request<any>("/room-events/apply", { method: "POST", body: JSON.stringify(body) });
}
export async function apiAdminRoomEvents(status: string) { return request<{ items: any[] }>(`/admin/room-events?status=${status}`); }
export async function apiAdminRoomEventDecision(id: string, approve: boolean) {
  return request<any>(`/admin/room-events/${id}/decision`, { method: "POST", body: JSON.stringify({ approve }) });
}
export async function apiAdminSupportThreads() { return request<{ items: any[] }>("/admin/support/threads"); }
export async function apiAdminSupportThread(user_id: string) { return request<{ items: SupportMessage[] }>(`/admin/support/${user_id}`); }
export async function apiAdminSupportReply(user_id: string, text: string) {
  return request<any>(`/admin/support/${user_id}/reply`, { method: "POST", body: JSON.stringify({ text }) });
}
export async function apiSupportSend(text: string) {
  return request<SupportMessage>("/support/messages", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}
export async function apiActivities() {
  return request<{ items: any[] }>("/activities");
}
export async function apiAdminCustomGifts() { return request<{ items: any[] }>("/admin/custom-gifts"); }
export async function apiAdminDeleteCustomGift(id: string) { return request<any>(`/admin/custom-gifts/${id}`, { method: "DELETE" }); }
export async function apiAdminClientErrors() { return request<{ items: any[] }>("/admin/client-errors?limit=200"); }
