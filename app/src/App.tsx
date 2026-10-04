import { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './state/store';
import DashboardPage from './pages/DashboardPage';

import TendersPage from './pages/TendersPage';

import HistoricalPage from './pages/HistoricalPage';
import AuditPage from './pages/AuditPage';
import LoginPage from './pages/LoginPage';

const NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'tenders', label: 'Tenders' },
  { key: 'historical', label: 'Historical Data' },
  { key: 'audit', label: 'Audit Trail' },
];

function Shell() {
  const { state, dispatch } = useStore();
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      return localStorage.getItem('tendrai-theme') === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('tendrai-theme', theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  if (!state.user) return <LoginPage />;
  const user = state.user;
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/lps-logo-horizontal.png" alt="LPS - a Lenovo company" className="brand-logo" />
          <span className="brand-divider" />
          <span className="brand-name">TendrAI</span>
        </div>
        <nav>
          {NAV.map((n) => (
            <button key={n.key} className={page === n.key ? 'active' : ''} onClick={() => setPage(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="user-menu">
          <button className="user-chip" onClick={() => setMenuOpen((v) => !v)}>
            <span className="avatar">{initials}</span>
            <span className="user-chip-text">
              <b>{user.name}</b>
              <span>{user.roleLabel}</span>
            </span>
            <span className="caret">▾</span>
          </button>
          {menuOpen && (
            <div className="user-dropdown" onMouseLeave={() => setMenuOpen(false)}>
              <div className="user-dropdown-head">
                <b>{user.name}</b>
                <div className="muted small">{user.email}</div>
                <div className="muted small">{user.roleLabel}</div>
              </div>
              <button onClick={() => { setMenuOpen(false); setPage('dashboard'); dispatch({ type: 'logout' }); }}>
                Sign out
              </button>
            </div>
          )}
        </div>
        <button
          className="theme-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </header>
      <main>
        {page === 'dashboard' && <DashboardPage goTo={setPage} />}
        {page === 'tenders' && <TendersPage />}
        {page === 'historical' && <HistoricalPage />}
        {page === 'audit' && <AuditPage />}
      </main>
      <footer className="footer muted small">
        © 2026 Lenovo PCCW Solutions · TendrAI
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
