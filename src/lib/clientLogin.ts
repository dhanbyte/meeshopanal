import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "./firebase";

const LOCAL_CLIENT_LOGIN_KEY = "parcelDeskLocalClientLogins";

type LocalClientLogin = {
  uid: string;
  clientId: string;
  email: string;
  password: string;
  role: "client";
  active: boolean;
  name?: string;
};

function readLocalClientLogins(): Record<string, LocalClientLogin> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LOCAL_CLIENT_LOGIN_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, LocalClientLogin>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocalClientLogins(logins: Record<string, LocalClientLogin>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_CLIENT_LOGIN_KEY, JSON.stringify(logins));
}

export function getLocalClientLogin(email: string, password: string) {
  const key = email.trim().toLowerCase();
  const logins = readLocalClientLogins();
  const login = logins[key];
  if (!login || login.password !== password) return null;
  return login;
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
      password,
      role: "client",
      active: true,
    };
    logins[normalizedEmail] = nextLogin;
    writeLocalClientLogins(logins);
    return { uid };
  };

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
