import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "voiceup_refresh_token";

export async function getRefreshToken(): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(KEY); } catch { return null; }
  }
  return await SecureStore.getItemAsync(KEY);
}

export async function setRefreshToken(v: string | null): Promise<void> {
  if (Platform.OS === "web") {
    try {
      if (v === null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, v);
    } catch {}
  } else if (v === null) await SecureStore.deleteItemAsync(KEY);
  else await SecureStore.setItemAsync(KEY, v);
  // Multi-account — mirror every rotated refresh token into its owner's
  // vault slot (owner resolved from the JWT `sub`) so saved sessions survive.
  if (v) {
    const sub = jwtSub(v);
    if (sub) await secureSet(rtKey(sub), v);
  }
}

// ---------------------------------------------------------------------------
// Multi-account vault (max 5 per device). Tokens live in SecureStore (one key
// per account); non-sensitive display metadata lives in AsyncStorage.
// ---------------------------------------------------------------------------
export const MAX_ACCOUNTS = 5;
const ACCOUNTS_KEY = "orio_accounts";
const rtKey = (id: string) => `orio_acct_rt_${id}`;

export type SavedAccount = {
  id: string;
  nickname?: string;
  username?: string;
  avatar_url?: string | null;
  numeric_id?: string;
  last_used: number;
};

function jwtSub(token: string): string | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = (globalThis as any).atob(b64 + "===".slice((b64.length + 3) % 4));
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && /^[A-Za-z0-9_-]+$/.test(sub) ? sub : null;
  } catch { return null; }
}

async function secureSet(k: string, v: string | null) {
  if (Platform.OS === "web") {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {}
    return;
  }
  if (v === null) await SecureStore.deleteItemAsync(k);
  else await SecureStore.setItemAsync(k, v);
}

export async function getAccountToken(id: string): Promise<string | null> {
  if (Platform.OS === "web") {
    try { return localStorage.getItem(rtKey(id)); } catch { return null; }
  }
  return await SecureStore.getItemAsync(rtKey(id));
}

export async function listAccounts(): Promise<SavedAccount[]> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNTS_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedAccount[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

async function writeAccounts(list: SavedAccount[]) {
  await AsyncStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list));
}

/** Insert/update the signed-in account. When the device is full, the least
 * recently used other account is evicted so the cap of 5 is never exceeded. */
export async function upsertAccount(acc: Omit<SavedAccount, "last_used">): Promise<SavedAccount[]> {
  let list = (await listAccounts()).filter((a) => a.id !== acc.id);
  while (list.length >= MAX_ACCOUNTS) {
    const lru = [...list].sort((a, b) => a.last_used - b.last_used)[0];
    list = list.filter((a) => a.id !== lru.id);
    await secureSet(rtKey(lru.id), null);
  }
  list = [{ ...acc, last_used: Date.now() }, ...list];
  await writeAccounts(list);
  return list;
}

export async function removeAccount(id: string): Promise<SavedAccount[]> {
  const list = (await listAccounts()).filter((a) => a.id !== id);
  await writeAccounts(list);
  await secureSet(rtKey(id), null);
  return list;
}
