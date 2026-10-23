import Constants, { ExecutionEnvironment } from "expo-constants";

// True when running inside the Expo Go client, which only ships a fixed set
// of native modules — custom native modules (Agora, FCM topic subscription,
// ...) throw if touched here. A development build has none of these gaps.
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

// expo-notifications' own index file calls requireNativeModule() at import
// time (for Android topic subscriptions), which throws immediately in Expo
// Go. So the package must be require()'d lazily, never statically imported,
// anywhere it might run there.
let _notifications: typeof import("expo-notifications") | null = null;
export function loadNotifications(): typeof import("expo-notifications") | null {
  if (isExpoGo) return null;
  if (!_notifications) _notifications = require("expo-notifications");
  return _notifications;
}
