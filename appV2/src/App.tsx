// TendrAI shell: top bar with navigation and the user menu, scrolling main
// content - same layout and design system as the companion app.

import { useEffect, useState } from 'react';
import { ChevronDown, Moon, Sun } from 'lucide-react';
import { StoreProvider, useStore } from './state/store';
import { ToastProvider } from './ui/toast';
import LoginPage from './pages/LoginPage';
import TendersPage from './pages/TendersPage';
import TemplatesPage from './pages/TemplatesPage';
import RepositoryPage from './pages/RepositoryPage';
import { CitationProvider } from './ui/citation';

const NAV = [
  { key: 'tenders', label: 'Tenders' },
  { key: 'templates', label: 'Templates' },
  { key: 'historical', label: 'Historical data' },
];

function Shell() {
  const { state, dispatch } = useStore();
  const [page, setPage] = useState('tenders');
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
  const navigate = (nextPage: string) => {
    setPage(nextPage);
    if (nextPage !== 'tenders') dispatch({ type: 'close-tender' });
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img src="/lps-logo-horizontal.png" alt="LPS - a Lenovo company" className="brand-logo" />
        </div>
        <nav aria-label="Main">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={page === n.key ? 'active' : ''}
              onClick={() => navigate(n.key)}
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
              <button onClick={() => { setMenuOpen(false); setPage('tenders'); dispatch({ type: 'logout' }); }}>
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
      </main>
      <footer className="footer muted small">© 2026 Lenovo PCCW Solutions</footer>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ToastProvider>
        <CitationProvider>
          <Shell />
        </CitationProvider>
      </ToastProvider>
    </StoreProvider>
  );
}
