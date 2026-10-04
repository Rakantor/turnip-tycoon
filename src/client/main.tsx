import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import {
  Settings as SettingsIcon,
  CalendarDays,
  Users,
  History as HistoryIcon,
} from 'lucide-react';
import { useIdentity } from './data/identity';
import { AppContext } from './ui';
import { Calculator } from './calculator';
import { History } from './history';
import { Connect, Recover, Settings } from './settings';
import { Groups } from './groups';
import { SharedPlayer, SharedHistory } from './shared-player';
import { About } from './about';
import './styles.css';

function ScrollToPage() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
  return null;
}

function App() {
  const identity = useIdentity();
  return (
    <AppContext.Provider value={identity}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand">
          <img
            className="brand-mark"
            src="/icons/brand-96.webp"
            srcSet="/icons/brand-192.webp 2x"
            width={40}
            height={40}
            alt=""
          />
          Turnip Tycoon
        </Link>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <CalendarDays size={16} aria-hidden="true" />
            Prices
          </NavLink>
          <NavLink to="/groups">
            <Users size={16} aria-hidden="true" />
            Friends
          </NavLink>
          <NavLink to="/history">
            <HistoryIcon size={16} aria-hidden="true" />
            History
          </NavLink>
        </nav>
        <NavLink
          to="/settings"
          className="settings-link icon-button"
          aria-label="Settings"
          title="Settings"
        >
          <SettingsIcon size={19} aria-hidden="true" />
        </NavLink>
      </header>
      <ScrollToPage />
      <Routes>
        <Route path="/" element={<Calculator />} />
        <Route path="/weeks/:weekStart" element={<Calculator />} />
        <Route
          path="/groups"
          element={<Groups key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route
          path="/groups/join"
          element={<Groups key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route
          path="/groups/:groupId"
          element={<Groups key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route
          path="/players/:playerId/weeks/:weekStart"
          element={<SharedPlayer key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route
          path="/players/:playerId/history"
          element={<SharedHistory key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route
          path="/history"
          element={<History key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route
          path="/settings"
          element={<Settings key={identity.session?.player.id ?? 'connecting'} />}
        />
        <Route path="/connect" element={<Connect />} />
        <Route path="/recover" element={<Recover />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <About />
    </AppContext.Provider>
  );
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
