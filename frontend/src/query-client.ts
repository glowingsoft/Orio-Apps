// One QueryClient for the whole app; the provider in app/_layout.tsx uses
// this instance. Import it for cache calls outside components, for example
// queryClient.invalidateQueries or setQueryData in websocket or push
// handlers; inside components useQueryClient() returns this same instance.
import { QueryClient } from "@tanstack/react-query";

// iter-44 Phase 5 — pragmatic defaults so flipping tabs doesn't re-trigger
// every list fetch. Individual queries can still override via staleTime.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,              // 30s warm cache
      gcTime: 5 * 60_000,             // keep in cache 5min after unmount
      refetchOnWindowFocus: false,    // Expo-RN: no window-focus thrash
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});
