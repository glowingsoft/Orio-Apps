/**
 * Native placeholder for ./googleWeb.web.ts. Google Sign-In through Firebase is
 * web-only for now; Android/iOS builds resolve this file and never load Firebase.
 */
export class GoogleSignInError extends Error {
  code: "cancelled" | "popup_blocked" | "network" | "not_configured" | "unauthorized_domain" | "failed";
  constructor(code: GoogleSignInError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export function isGoogleWebConfigured(): boolean {
  return false;
}

export function getGoogleIdTokenWeb(): Promise<string> {
  return Promise.reject(new GoogleSignInError("not_configured", "Google sign-in is not available in the app yet"));
}
