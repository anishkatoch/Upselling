import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Brand from "../components/Brand";
import { useAuth } from "../lib/auth";
import "./auth.css";

function Shell({ title, lead, children, footer }: { title: string; lead: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side" aria-hidden="true">
        <div className="auth-brand">
          <Brand size={30} />
        </div>
        <h2>See how every salesperson is really doing.</h2>
        <ul>
          <li>How every salesperson treats customers</li>
          <li>Who needs support, and what to coach</li>
          <li>The exact words behind every finding</li>
        </ul>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-card">
          <h1>{title}</h1>
          <p className="auth-lead">{lead}</p>
          {children}
          <p className="auth-foot">{footer}</p>
        </div>
      </main>
    </div>
  );
}

function Field({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="auth-field">
      <span>{label}</span>
      <input {...props} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function useAfterAuth() {
  const nav = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from;
  return () => nav(from && from !== "/login" && from !== "/signup" ? from : "/", { replace: true });
}

export function Login() {
  const { login } = useAuth();
  const done = useAfterAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canSignup, setCanSignup] = useState(true);
  const [demo, setDemo] = useState<{ email: string; password: string } | null>(null);
  const [filled, setFilled] = useState(false);

  useEffect(() => {
    fetch("/api/auth/options")
      .then((r) => r.json())
      .then((o: { signup: boolean; demo?: { email: string; password: string } | null }) => {
        setCanSignup(o.signup);
        setDemo(o.demo ?? null); // only sent while the demo login is switched on
      })
      .catch(() => undefined);
    document.title = "Log in - SouqCue";
  }, []);

  /** Ticking fills the form with the demo login (the user still presses Log in); unticking clears what it filled. */
  const fillDemo = (on: boolean) => {
    if (!demo) return;
    setFilled(on);
    if (on) {
      setEmail(demo.email);
      setPassword(demo.password);
    } else {
      setEmail((e) => (e === demo.email ? "" : e));
      setPassword((p) => (p === demo.password ? "" : p));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't log you in. Please try again.");
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Welcome back"
      lead="Log in to see how your team is doing."
      footer={
        canSignup ? (
          <>
            New here? <Link to="/signup">Create an account</Link>
          </>
        ) : (
          "Need an account? Ask your administrator."
        )
      }
    >
      <form onSubmit={submit} className="auth-form" noValidate>
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="auth-submit" disabled={busy || !email || !password}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
      {demo && (
        <label className="auth-fill">
          <input type="checkbox" checked={filled} onChange={(e) => fillDemo(e.target.checked)} />
          Fill in the demo login
        </label>
      )}
    </Shell>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const done = useAfterAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Create account - SouqCue";
  }, []);

  const tooShort = password.length > 0 && password.length < 8;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Choose a password of at least 8 characters.");
    setBusy(true);
    setError(null);
    try {
      await signup(name, email, password);
      done();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't create your account. Please try again.");
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Create your account"
      lead="It takes a minute. You'll be signed in straight away."
      footer={
        <>
          Already have an account? <Link to="/login">Log in</Link>
        </>
      }
    >
      <form onSubmit={submit} className="auth-form" noValidate>
        <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus maxLength={80} required />
        <Field label="Work email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint={tooShort ? "At least 8 characters." : "Use at least 8 characters."}
          aria-invalid={tooShort}
          required
        />
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="auth-submit" disabled={busy || !name.trim() || !email || !password}>
          {busy ? "Creating account…" : "Create account"}
        </button>
      </form>
    </Shell>
  );
}
