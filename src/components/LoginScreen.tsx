import { ArrowRight, LockKeyhole, PackageCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onDemo: () => void;
}

export function LoginScreen({ onLogin, onDemo }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onLogin(email, password);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not sign in. Check your details and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-lockup auth-brand">
          <span className="brand-mark"><PackageCheck size={20} /></span>
          <span><strong>Parcel Desk</strong><small>Meesho operations</small></span>
        </div>
        <div className="auth-copy">
          <span className="eyebrow">WORKSPACE SIGN IN</span>
          <h1>Welcome back</h1>
          <p>Manage orders, returns and client payments from one secure place.</p>
        </div>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.com" required />
          <label className="field-label" htmlFor="login-password">Password</label>
          <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
          {error ? <div className="form-error" role="alert">{error}</div> : null}
          <button className="button button-primary button-full" type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}<ArrowRight size={17} />
          </button>
        </form>
        <button className="button button-secondary button-full demo-entry" type="button" onClick={onDemo}>Open demo dashboard<ArrowRight size={17} /></button>
        <p className="demo-hint">Sample client included. Label OCR runs in this browser; demo records stay temporary and never go to Firebase.</p>
        <div className="auth-note"><LockKeyhole size={15} /><span>Private workspace. Admins create accounts; public sign-up is disabled.</span></div>
      </section>
      <div className="auth-decoration" aria-hidden="true"><span className="decor-circle decor-one" /><span className="decor-circle decor-two" /><div className="decor-copy"><span>One view for every client</span><strong>Orders, returns and balances—kept in sync.</strong></div></div>
    </main>
  );
}
