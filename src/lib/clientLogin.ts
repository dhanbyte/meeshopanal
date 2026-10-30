import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";
import { supabase } from "./supabase";

const LOCAL_CLIENT_LOGIN_KEY = "parcelDeskLocalClientLogins";

type LocalClientLogin = {
  uid: string;
  clientId: string;
  email: string;
  role: "client";
  active: boolean;
  name?: string;
};

function sanitizeLocalClientLogins(input: unknown): Record<string, LocalClientLogin> {
  if (!input || typeof input !== "object") return {};

  const cleaned: Record<string, LocalClientLogin> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;

    const candidate = value as Record<string, unknown>;
    const { password: _password, ...rest } = candidate;
    const login = rest as Partial<LocalClientLogin>;
    if (!login.uid || !login.clientId || !login.email) continue;

    cleaned[key] = {
      uid: String(login.uid),
      clientId: String(login.clientId),
      email: String(login.email),
      role: "client",
      active: login.active !== false,
      ...(login.name ? { name: String(login.name) } : {}),
    };
  }

  return cleaned;
}

function readLocalClientLogins(): Record<string, LocalClientLogin> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_CLIENT_LOGIN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeLocalClientLogins(parsed);
    if (JSON.stringify(sanitized) !== raw) {
      writeLocalClientLogins(sanitized);
    }
    return sanitized;
  } catch {
    return {};
  }
}

function writeLocalClientLogins(logins: Record<string, LocalClientLogin>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_CLIENT_LOGIN_KEY, JSON.stringify(logins));
}

export function getLocalClientLogin(email: string, _password: string) {
  const key = email.trim().toLowerCase();
  const logins = readLocalClientLogins();
  const login = logins[key];
  if (!login) return null;
  // Passwords are never stored locally for client logins.
  return null;
}

function extractErrorCode(issue: unknown) {
  if (typeof issue === "object" && issue !== null && "code" in issue) {
    return String((issue as { code?: unknown }).code ?? "");
  }
  return "";
}

export async function saveClientLogin(clientId: string, email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const localFallback = () => {
    const logins = readLocalClientLogins();
    const uid = `local-client-${clientId}-${Math.random().toString(36).slice(2, 10)}`;
    const nextLogin: LocalClientLogin = {
      uid,
      clientId,
      email: normalizedEmail,
      role: "client",
      active: true,
    };
    logins[normalizedEmail] = nextLogin;
    writeLocalClientLogins(logins);
    return { uid };
  };

  if (supabase) {
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            clientId,
            role: "client",
            name: normalizedEmail,
          },
        },
      });

      if (!error && data?.user) {
        localFallback();
        return { uid: data.user.id };
      }
      if (error && error.message && /already registered|user already/i.test(error.message)) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
        if (!signInError && signInData?.user) {
          localFallback();
          return { uid: signInData.user.id };
        }
      }
    } catch {
      // Fall through to Firebase/local fallback below.
    }
  }

  if (!app) return localFallback();

  const saveLogin = httpsCallable<{ clientId: string; email: string; password?: string }, { uid: string }>(getFunctions(app, "us-central1"), "setClientLogin");
  try {
    const result = await saveLogin({ clientId, email: normalizedEmail, password: password || undefined });
    return result.data;
  } catch (issue) {
    const code = extractErrorCode(issue);
    const message = issue instanceof Error ? issue.message : String(issue ?? "");
    const isInternalCloudFailure = ["functions/not-found", "functions/internal", "functions/failed-precondition", "internal", "internal [0]"].includes(code)
      || /internal\s*\[0\]|functions\/internal/i.test(message);
    if (isInternalCloudFailure) {
      return localFallback();
    }
    throw issue;
  }
}
