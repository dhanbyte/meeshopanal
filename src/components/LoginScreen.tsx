import { ArrowRight, LockKeyhole, PackageCheck } from "lucide-react";
import { useState, type FormEvent } from "react";
import { isEmailNotConfirmedError } from "../lib/auth";

interface LoginScreenProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onResendConfirmation: (email: string) => Promise<void>;
  onDemo: () => void;
}

export function LoginScreen({ onLogin, onResendConfirmation, onDemo }: LoginScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);
  const [resendStatus, setResendStatus] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResendStatus("");
    setConfirmationRequired(false);
    setBusy(true);
    try {
      await onLogin(email, password);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not sign in. Check your details and try again.");
      setConfirmationRequired(isEmailNotConfirmedError(issue) || /email not confirmed/i.test(issue instanceof Error ? issue.message : ""));
    } finally {
      setBusy(false);
    }
  }

  async function handleResendConfirmation() {
    setResendStatus("");
    try {
      await onResendConfirmation(email);
      setResendStatus("Confirmation email sent. Check your inbox and spam folder.");
    } catch (issue) {
      setResendStatus(issue instanceof Error ? issue.message : "Could not resend the confirmation email.");
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
          {confirmationRequired ? <button className="button button-secondary button-full" type="button" onClick={handleResendConfirmation}>Resend confirmation email</button> : null}
          {resendStatus ? <div className="form-hint" role="status">{resendStatus}</div> : null}
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
