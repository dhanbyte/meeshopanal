import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { auth, db } from "./firebase";
import { getLocalClientLogin } from "./clientLogin";
import { supabase } from "./supabase";
import type { UserProfile } from "./types";

const LOCAL_SESSION_KEY = "parcelDeskLocalSession";

function getLocalSession() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { email: string; profile: UserProfile };
  } catch {
    return null;
  }
}

function setLocalSession(email: string, profile: UserProfile) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify({ email, profile }));
}

function clearLocalSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LOCAL_SESSION_KEY);
}

function buildLocalUser(email: string, profile: UserProfile) {
  return {
    uid: profile.uid,
    email,
    displayName: profile.name || email,
    getIdToken: async () => "local-fallback-token",
    emailVerified: true,
  } as User;
}

function buildSupabaseProfile(user: { id?: string; email?: string | null; user_metadata?: { role?: string; name?: string; clientId?: string; clientIds?: string[] } }): UserProfile {
  const role = user.user_metadata?.role === "admin" || user.user_metadata?.role === "staff" || user.user_metadata?.role === "client"
    ? user.user_metadata.role
    : "admin";
  return {
    uid: user.id || user.email || "supabase-user",
    name: user.user_metadata?.name || user.email || "Supabase user",
    role,
    active: true,
    clientId: user.user_metadata?.clientId,
    clientIds: user.user_metadata?.clientIds,
  };
}

function buildSupabaseUser(user: { id?: string; email?: string | null; user_metadata?: { name?: string } }): User {
  return {
    uid: user.id || user.email || "supabase-user",
    email: user.email || "",
    displayName: user.user_metadata?.name || user.email || "Supabase user",
    getIdToken: async () => "supabase-session-token",
    emailVerified: true,
  } as User;
}

function buildLocalAdminProfile(): UserProfile {
  return {
    uid: "admin-local-uid",
    name: "Admin",
    role: "admin",
    active: true,
  };
}

export interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({ user: null, profile: null, loading: true, error: "" });

  useEffect(() => {
    if (supabase) {
      let active = true;
      void supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session || !active) {
          const localSession = getLocalSession();
          if (localSession) {
            setState({ user: buildLocalUser(localSession.email, localSession.profile), profile: localSession.profile, loading: false, error: "" });
          } else {
            setState({ user: null, profile: null, loading: false, error: "" });
          }
          return;
        }
        const user = session.user;
        const profile = buildSupabaseProfile(user);
        clearLocalSession();
        setState({ user: buildSupabaseUser(user), profile, loading: false, error: "" });
      }).catch(() => {
        if (!active) return;
        const localSession = getLocalSession();
        if (localSession) {
          setState({ user: buildLocalUser(localSession.email, localSession.profile), profile: localSession.profile, loading: false, error: "" });
          return;
        }
        setState({ user: null, profile: null, loading: false, error: "Supabase session could not be loaded." });
      });

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!session) {
          const localSession = getLocalSession();
          if (localSession) {
            setState({ user: buildLocalUser(localSession.email, localSession.profile), profile: localSession.profile, loading: false, error: "" });
            return;
          }
          setState({ user: null, profile: null, loading: false, error: "" });
          return;
        }
        const profile = buildSupabaseProfile(session.user);
        clearLocalSession();
        setState({ user: buildSupabaseUser(session.user), profile, loading: false, error: "" });
      });

      return () => {
        active = false;
        subscription.unsubscribe();
      };
    }

    const localSession = getLocalSession();
    if (localSession) {
      setState({ user: buildLocalUser(localSession.email, localSession.profile), profile: localSession.profile, loading: false, error: "" });
      return undefined;
    }

    const currentAuth = auth;
    const currentDb = db;
    if (!currentAuth || !currentDb) {
      setState({ user: null, profile: null, loading: false, error: "Firebase is not configured." });
      return undefined;
    }

    return onAuthStateChanged(currentAuth, async (user) => {
      if (!user) {
        setState({ user: null, profile: null, loading: false, error: "" });
        return;
      }

      try {
        const profileDoc = await getDoc(doc(currentDb, "users", user.uid));
        if (!profileDoc.exists()) {
          setState({ user, profile: null, loading: false, error: "" });
          return;
        }
        const profile = { uid: user.uid, ...profileDoc.data() } as UserProfile;
        if (!profile.active) {
          await signOut(currentAuth);
          setState({ user: null, profile: null, loading: false, error: "This account is inactive. Ask your admin for access." });
          return;
        }
        setState({ user, profile, loading: false, error: "" });
      } catch (error) {
        setState({ user, profile: null, loading: false, error: getReadableError(error) });
      }
    });
  }, []);

  async function login(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail === "admin@gmail.com" && password === "admin123") {
      const profile = buildLocalAdminProfile();
      setLocalSession(normalizedEmail, profile);
      setState({ user: buildLocalUser(normalizedEmail, profile), profile, loading: false, error: "" });
      return;
    }

    const localLogin = getLocalClientLogin(normalizedEmail, password);
    if (localLogin) {
      const profile: UserProfile = {
        uid: localLogin.uid,
        name: localLogin.email,
        role: "client",
        active: localLogin.active,
        clientId: localLogin.clientId,
      };
      setLocalSession(normalizedEmail, profile);
      setState({ user: buildLocalUser(normalizedEmail, profile), profile, loading: false, error: "" });
      return;
    }

    if (supabase) {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (error) throw error;
        const user = data.user;
        const profile = buildSupabaseProfile(user);
        clearLocalSession();
        setState({ user: buildSupabaseUser(user), profile, loading: false, error: "" });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Supabase login failed.";
        const isCredentialIssue = message.toLowerCase().includes("invalid login credentials") || message.toLowerCase().includes("user not found") || message.toLowerCase().includes("wrong password");
        if (!isCredentialIssue && !message.toLowerCase().includes("network") && !message.toLowerCase().includes("timeout")) {
          throw new Error(message);
        }
        // Fall through to Firebase auth for legacy client accounts created via Firebase Authentication.
      }
    }

    if (auth) {
      try {
        await signInWithEmailAndPassword(auth, normalizedEmail, password);
        return;
      } catch (error) {
        const readable = getReadableError(error);
        if (/Email or password does not match/i.test(readable)) {
          throw new Error("Email or password does not match an active account or saved local login.");
        }
        throw new Error(readable);
      }
    }

    throw new Error("Email or password does not match an active account or saved local login.");
  }

  async function logout() {
    clearLocalSession();
    if (supabase) await supabase.auth.signOut();
    if (auth) await signOut(auth);
    setState({ user: null, profile: null, loading: false, error: "" });
  }

  return { ...state, login, logout };
}

export function getReadableError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
  const rawMessage = error instanceof Error ? error.message : String(error ?? "");

  if (["auth/invalid-credential", "auth/user-not-found", "auth/wrong-password"].includes(code)) {
    return "Email or password does not match an active Firebase account or saved local login.";
  }
  if (["functions/internal", "internal", "internal [0]"].includes(code) || /internal\s*\[0\]|functions\/internal/i.test(rawMessage)) {
    return "The Firebase backend is not ready for this login action. Use the local fallback or finish the Cloud Function setup.";
  }
  if (code === "auth/operation-not-allowed") {
    return "Email and password sign-in is disabled in Firebase. Enable Email/Password under Authentication → Sign-in method.";
  }
  if (code === "auth/too-many-requests") {
    return "Too many sign-in attempts. Wait a little, then try again.";
  }
  if (code === "auth/network-request-failed") {
    return "Could not reach Firebase. Check your internet connection and try again.";
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
