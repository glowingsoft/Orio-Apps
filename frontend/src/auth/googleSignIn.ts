
import {
  GoogleAuthProvider,
  inMemoryPersistence,
  initializeAuth,
  signInWithCredential,
  signOut,
  type Auth,
} from "firebase/auth";
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from "@react-native-google-signin/google-signin";
import { getFirebaseApp, GoogleSignInError, isFirebaseConfigured } from "./firebaseClient";

export { GoogleSignInError };

// The web OAuth client ID: Google issues the ID token for this audience.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

let auth: Auth | null = null;
function getFirebaseAuth(): Auth {
  if (!auth) auth = initializeAuth(getFirebaseApp(), { persistence: inMemoryPersistence });
  return auth;
}

let configured = false;
let inFlight: Promise<string> | null = null;

/** Shows the native Google account picker and resolves with a Firebase ID token. */
export function getGoogleIdToken(): Promise<string> {
  if (!isFirebaseConfigured() || !WEB_CLIENT_ID) {
    return Promise.reject(new GoogleSignInError("not_configured", "Google sign-in is not configured"));
  }
  if (!inFlight) {
    inFlight = (async () => {
      if (!configured) {
        GoogleSignin.configure({ webClientId: WEB_CLIENT_ID });
        configured = true;
      }
      const a = getFirebaseAuth();
      try {
        await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
        const res = await GoogleSignin.signIn();
        if (!isSuccessResponse(res)) throw new GoogleSignInError("cancelled", "Sign-in cancelled");
        const googleIdToken = res.data.idToken;
        if (!googleIdToken) throw new GoogleSignInError("failed", "Google sign-in failed");
        const cred = await signInWithCredential(a, GoogleAuthProvider.credential(googleIdToken));
        return await cred.user.getIdToken();
      } catch (e: any) {
        if (e instanceof GoogleSignInError) throw e;
        if (isErrorWithCode(e)) {
          if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) {
            throw new GoogleSignInError("cancelled", "Sign-in cancelled");
          }
          if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
            throw new GoogleSignInError("play_services", "Google Play services is not available or needs an update.");
          }
          if (String(e.code) === "10" || String(e.code) === "DEVELOPER_ERROR") {
            // Android: SHA-1 of the signing key is not registered for this package in Firebase.
            throw new GoogleSignInError("developer_error", "Google sign-in is not set up for this build yet.");
          }
        }
        if (String(e?.code || "") === "auth/network-request-failed") {
          throw new GoogleSignInError("network", "Network error. Check your connection and try again.");
        }
        throw new GoogleSignInError("failed", "Google sign-in failed");
      } finally {
        signOut(a).catch(() => {});
        GoogleSignin.signOut().catch(() => {});
      }
    })().finally(() => { inFlight = null; });
  }
  return inFlight;
}
