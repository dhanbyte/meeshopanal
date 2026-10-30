import { CircleHelp, CloudCog, ExternalLink, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAuth } from "./lib/auth";
import { firebaseReady } from "./lib/firebase";
import { isSupabaseReady } from "./lib/supabase";
import type { UserProfile } from "./lib/types";
import { LoginScreen } from "./components/LoginScreen";
import { Workspace } from "./components/Workspace";

const demoProfile: UserProfile = { uid: "demo-user", name: "Demo account", role: "admin", active: true, clientIds: [] };

export default function App() {
  const authState = useAuth();
  const [demoMode, setDemoMode] = useState(false);

  if (demoMode) return <Workspace user={{ email: "demo@parceldesk.local" }} profile={demoProfile} onLogout={async () => setDemoMode(false)} demoMode />;
  if (!firebaseReady && !isSupabaseReady()) {
    return <SetupCard icon={<CloudCog size={22} />} title="Add Firebase or Supabase configuration" text="The app reads auth settings from the local .env.local file. Add Firebase or Supabase values, then restart the development server." onDemo={() => setDemoMode(true)} />;
  }
  if (authState.loading) return <div className="loading-screen"><span className="loader-mark" /><p>Opening your workspace…</p></div>;
  if (!authState.user) return <LoginScreen onLogin={authState.login} onDemo={() => setDemoMode(true)} />;
  if (authState.error) return <SetupCard icon={<CircleHelp size={22} />} title="Could not load your access" text={`Firestore denied the signed-in user's profile read. ${authState.error} Check that the secure Firestore rules are published in the same Firebase project.`} detail={authState.user ? `Signed-in UID: ${authState.user.uid}` : undefined} onDemo={() => setDemoMode(true)} />;
  if (!authState.profile) {
    return <SetupCard icon={<ShieldCheck size={22} />} title="Admin access needs setup" text="Create a users/{uid} profile document in Firestore for this Firebase Auth user. Add role=admin and active=true, then reload." detail={`Signed-in UID: ${authState.user.uid}`} onDemo={() => setDemoMode(true)} />;
  }
  return <Workspace user={authState.user} profile={authState.profile} onLogout={authState.logout} />;
}

function SetupCard({ icon, title, text, detail, onDemo }: { icon: ReactNode; title: string; text: string; detail?: string; onDemo?: () => void }) {
  return <main className="setup-page"><section className="setup-card"><span className="setup-icon">{icon}</span><span className="eyebrow">PARCEL DESK SETUP</span><h1>{title}</h1><p>{text}</p>{detail ? <code className="setup-code">{detail}</code> : null}<a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="button button-primary">Open Firebase Console <ExternalLink size={15} /></a>{onDemo ? <button className="button button-secondary setup-demo-button" type="button" onClick={onDemo}>Open demo workspace</button> : null}<small>See README.md for step-by-step setup and security rules.</small></section></main>;
}
