/* eslint-disable react-refresh/only-export-components */
import { createContext, useEffect, useState } from 'react';
import { ChevronDown, Moon, Settings, Sun } from 'lucide-react';
import { StoreProvider, useStore } from './state/store';
import { ToastProvider } from './ui/toast';
import DashboardPage from './pages/DashboardPage';
import TendersPage from './pages/TendersPage';
import HistoricalPage from './pages/HistoricalPage';
import AuditPage from './pages/AuditPage';
import AdminPage from './pages/AdminPage';
import LoginPage from './pages/LoginPage';
import { APP_VERSION } from './version';

export interface AuditPrefill {
  tender?: string;
  section?: string;
}

/** Cross-page navigation for deep links (e.g. Edit history -> filtered Audit log) */
export const NavCtx = createContext<{ goToAudit: (p: AuditPrefill) => void }>({ goToAudit: () => {} });

const NAV = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'tenders', label: 'Tenders' },
  { key: 'historical', label: 'Historical data' },
  { key: 'audit', label: 'Audit log' },
];

/** Swap this for the real SVG lockup when supplied. */
function BrandLogo() {
  return <img src="/lps-logo-horizontal.png" alt="LPS - a Lenovo company" className="brand-logo" />;
}

function Shell() {
  const { state, dispatch } = useStore();
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [auditPrefill, setAuditPrefill] = useState<AuditPrefill | null>(null);
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

  const goToAudit = (p: AuditPrefill) => { setAuditPrefill({ ...p }); setPage('audit'); };

  if (!state.user) return <LoginPage />;
  const user = state.user;
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('');

  return (
    <NavCtx.Provider value={{ goToAudit }}>
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandLogo />
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <button key={n.key} className={page === n.key ? 'active' : ''} onClick={() => setPage(n.key)}>
              {n.label}
            </button>
          ))}
        </nav>
        <div className="user-menu">
          <button
            className="user-chip"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="avatar" aria-hidden>{initials}</span>
            <span className="user-chip-text">
              <b>{user.name}</b>
              <span>{user.roleLabel}</span>
            </span>
            <span className="caret" aria-hidden><ChevronDown size={14} /></span>
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
        {user.role === 'admin' && (
          <button
            className={`theme-toggle ${page === 'admin' ? 'active' : ''}`}
            title="Admin console"
            aria-label="Admin console"
            onClick={() => setPage('admin')}
          >
            <Settings size={16} aria-hidden />
          </button>
        )}
        <button
          className="theme-toggle"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to night mode'}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? <Sun size={16} aria-hidden /> : <Moon size={16} aria-hidden />}
        </button>
      </header>
      <main>
        {page === 'dashboard' && <DashboardPage goTo={setPage} />}
        {page === 'tenders' && <TendersPage />}
        {page === 'historical' && <HistoricalPage />}
        {page === 'audit' && <AuditPage prefill={auditPrefill} />}
        {page === 'admin' && user.role === 'admin' && <AdminPage />}
      </main>
      <footer className="footer muted small">
        <span>TendrAI {APP_VERSION}</span>
        <span>© 2026 Lenovo PCCW Solutions</span>
      </footer>
    </div>
    </NavCtx.Provider>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </StoreProvider>
  );
}
