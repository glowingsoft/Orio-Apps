// @ts-nocheck
import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

// Iter-92 — Sync lang/dir bootstrap. Runs BEFORE React Native Web renders so
// RTL-mirrored flex-direction CSS is correct on first paint (no flicker).
const BOOTSTRAP = `
  try {
    var saved = (typeof localStorage !== 'undefined') ? localStorage.getItem('orio_lang') : null;
    var isAr = saved === 'ar';
    document.documentElement.lang = isAr ? 'ar' : 'en';
    document.documentElement.dir = isAr ? 'rtl' : 'ltr';
  } catch (e) {}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" dir="ltr" style={{ height: "100%" }}>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        {/* Sync RTL/LTR bootstrap — must run FIRST so RN Web styles compile with the correct I18nManager state. */}
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP }} />
        {/*
          Disable body scrolling on web to make ScrollView components work correctly.
          If you want to enable scrolling, remove `ScrollViewStyleReset` and
          set `overflow: auto` on the body style below.
        */}
        <ScrollViewStyleReset />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body { overflow-x: hidden !important; }
              body > div:first-child { position: fixed !important; top: 0; left: 0; right: 0; bottom: 0; }
              [role="tablist"] [role="tab"] * { overflow: visible !important; }
              [role="heading"], [role="heading"] * { overflow: visible !important; }
              /* Iter-48 — kill the gray web scrollbar tracks that bleed through
                 ScrollView on web and look like a vertical border on the left
                 edge of posts/rooms/profile/messages. Scrolling still works. */
              *::-webkit-scrollbar { width: 0 !important; height: 0 !important; background: transparent !important; }
              * { scrollbar-width: none !important; -ms-overflow-style: none !important; }
              /* Iter-57 — Animated rainbow for VIP 6-7 usernames (web only).
                 Native uses MaskedView + Reanimated; this is the web fallback
                 for the identical animation. */
              @keyframes orio-rainbow {
                0%   { background-position: 0% 50%; }
                100% { background-position: 200% 50%; }
              }
              /* Iter-120 — rainbow flow + glossy shine sweep (start→end). */
              @keyframes orio-rainbow-shine {
                0%   { background-position: 150% 50%, 0% 50%; }
                80%  { background-position: -50% 50%, 160% 50%; }
                100% { background-position: -50% 50%, 200% 50%; }
              }
            `,
          }}
        />
      </head>
      <body
        style={{
          margin: 0,
          height: "100%",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {children}
      </body>
    </html>
  );
}
