// Sign-in screen. In production this is the Cognito hosted UI in front of the
// ALB; the POC replicates the experience with hardcoded demo accounts.

import { useState } from 'react';
import { Check } from 'lucide-react';
import { DEMO_PASSWORD, USERS } from '../data/fixtures';
import { useStore } from '../state/store';

export default function LoginPage() {
  const { dispatch } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showAccounts, setShowAccounts] = useState(false);

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    const user = USERS.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || password !== DEMO_PASSWORD) {
      setError('Incorrect username or password.');
      return;
    }
    dispatch({ type: 'login', user });
  };

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="login-hero-inner">
          <div className="login-wordmark">
            <img src="/lps-logo-horizontal.png" alt="LPS - a Lenovo company" />
          </div>
          <h1>TendrAI</h1>
          <p>
            From tender document to Deal Review Board - draft business cases generated in minutes,
            grounded in what we have won before.
          </p>
          <ul className="login-points">
            <li><Check size={14} aria-hidden />Upload a tender and receive a first-cut business case with cited comparables</li>
            <li><Check size={14} aria-hidden />Review, adjust and approve with costs recalculated in real time</li>
            <li><Check size={14} aria-hidden />One-click submission form and MSPO template population</li>
          </ul>
        </div>
      </div>

      <div className="login-panel">
        <form className="login-card" onSubmit={submit}>
          <div className="login-logo">
            <img src="/lps-logo-stacked.png" alt="LPS - a Lenovo company" />
          </div>
          <h2>Sign in to TendrAI</h2>
          <label>
            Email
            <input
              type="email"
              value={email}
              placeholder="name@lpstech.com"
              autoFocus
              onChange={(e) => { setEmail(e.target.value); setError(''); }}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              placeholder="Password"
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
            />
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="btn primary wide" type="submit">Sign in</button>
          <div className="login-links">
            <a onClick={(e) => e.preventDefault()} href="#">Forgot your password?</a>
          </div>
          <div className="login-sso muted">Secured by AWS Cognito · Single sign-on</div>

          <button
            type="button"
            className="demo-toggle"
            onClick={() => setShowAccounts((v) => !v)}
          >
            {showAccounts ? 'Hide demo accounts' : 'Demo accounts'}
          </button>
          {showAccounts && (
            <div className="demo-accounts">
              {USERS.map((u) => (
                <button
                  type="button"
                  key={u.email}
                  onClick={() => { setEmail(u.email); setPassword(DEMO_PASSWORD); setError(''); }}
                >
                  <b>{u.name}</b>
                  <span>{u.roleLabel}</span>
                </button>
              ))}
              <div className="muted small">Password for all accounts: <code>{DEMO_PASSWORD}</code></div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
