import { Platform } from "react-native";
import type { useRouter } from "expo-router";

type Router = ReturnType<typeof useRouter>;


export function safeBack(router: Router, fallback: string = "/(tabs)/home") {
  const hasHistory = Platform.OS !== "web" || (typeof window !== "undefined" && window.history.length > 1);
  if (hasHistory && router.canGoBack()) router.back();
  else router.replace(fallback as any);
}
