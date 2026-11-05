// TendrAI shell: top bar with navigation and the user menu, scrolling main
// content - same layout and design system as the companion app.

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Moon, Sun } from 'lucide-react';
import { StoreProvider, useStore } from './state/store';
import { LeaveGuardProvider, useLeaveGuard } from './lib/leaveGuard';
import { ToastProvider, useToast } from './ui/toast';
import LoginPage from './pages/LoginPage';
import { APP_VERSION } from './version';
import TendersPage from './pages/TendersPage';
import TemplatesPage from './pages/TemplatesPage';
import RepositoryPage from './pages/RepositoryPage';
import AuditPage from './pages/AuditPage';
import RulesPage from './pages/RulesPage';
import { CitationProvider } from './ui/citation';

const NAV = [
  { key: 'tenders', label: 'Tenders' },
  { key: 'templates', label: 'Templates' },
  { key: 'rules', label: 'Business case management' },
  { key: 'historical', label: 'Historical data' },
  { key: 'audit', label: 'Audit log' },
];

/** Audited actions whose screens don't already confirm them with their own
 *  toast. Every user action ends in visible feedback either way. */
const CONFIRM_FROM_AUDIT = new Set([
  'Clause updated',
  'Template selected',
  'Tender created',
  'Tender details edited',
  'Tender deleted',
  'Document reordered',
  'File downloaded',
  'Certificate linked',
  'MSPO mapping reset to default',
]);

function AuditToaster() {
  const { state } = useStore();
  const toast = useToast();
  const seen = useRef(state.audit.length);
  useEffect(() => {
    const fresh = state.audit.slice(seen.current);
    seen.current = state.audit.length;
    for (const e of fresh) {
      if (CONFIRM_FROM_AUDIT.has(e.action)) toast.push('success', e.action, e.detail);
    }
  }, [state.audit, toast]);
  return null;
}

function Shell() {
  const { state, dispatch } = useStore();
  const [page, setPage] = useState('tenders');
  const [menuOpen, setMenuOpen] = useState(false);
  const { requestLeave } = useLeaveGuard();
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

  // pages can ask the shell to switch (View history, uploads from a tender, Back to tender)
  const navN = state.nav?.n;
  useEffect(() => { if (state.nav) setPage(state.nav.page); }, [navN]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!state.user) return <LoginPage />;
  const user = state.user;
  const initials = user.name.split(' ').map((p) => p[0]).slice(0, 2).join('');
  const navigate = (nextPage: string) => {
    setPage(nextPage);
    dispatch({ type: 'clear-return' });
    if (nextPage !== 'tenders') dispatch({ type: 'close-tender' });
  };

  return (
    <div className="app">
      <AuditToaster />
      <header className="topbar">
        <div className="brand">
          <img src="/lps-logo-horizontal.png" alt="LPS - a Lenovo company" className="brand-logo" />
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={page === n.key ? 'active' : ''}
              onClick={() => requestLeave(() => navigate(n.key))}
            >
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
              <button onClick={() => { setMenuOpen(false); requestLeave(() => { setPage('tenders'); dispatch({ type: 'logout' }); }); }}>
                Sign out
              </button>
            </div>
          )}
        </div>
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
        {page === 'tenders' && <TendersPage />}
        {page === 'templates' && <TemplatesPage />}
        {page === 'historical' && <RepositoryPage />}
        {page === 'rules' && <RulesPage />}
        {page === 'audit' && <AuditPage />}
      </main>
      <footer className="footer muted small">
        <span>TendrAI {APP_VERSION}</span>
        <span>© 2026 Lenovo PCCW Solutions</span>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <CitationProvider>
          <LeaveGuardProvider>
            <Shell />
          </LeaveGuardProvider>
        </CitationProvider>
      </ToastProvider>
    </StoreProvider>
  );
}
