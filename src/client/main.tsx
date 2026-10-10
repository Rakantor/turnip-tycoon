import { Fragment, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  BrowserRouter,
  HashRouter,
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router';
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
import { isLegalPath, Privacy, Terms } from './legal';
import { ProfileRemovalNotice } from './profile-data';
import { WelcomeDialog } from './welcome';
import { assetUrl, hashRouting } from './urls';
import { startPwa, usePwa } from './pwa';
import { UpdateNotice } from './pwa/update-notice';
import { HeaderInstallButton, startInstallPromptCapture } from './pwa/install';
import { activateLocale, preferredLocale } from './i18n';
import './fonts.css';
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
  const location = useLocation();
  const identity = useIdentity(!isLegalPath(location.pathname));
  const pwa = usePwa();
  const { t, i18n } = useLingui();
  return (
    <AppContext.Provider value={identity}>
      <div inert={pwa.updating || undefined}>
        <Link
          to={{ pathname: location.pathname, search: location.search, hash: '#main-content' }}
          className="skip-link"
          onClick={(event) => {
            event.preventDefault();
            const content = document.getElementById('main-content');
            if (content) {
              content.tabIndex = -1;
              content.focus({ preventScroll: true });
              content.scrollIntoView();
            }
          }}
        >
          <Trans>Skip to content</Trans>
        </Link>
        <header className="site-header">
          <Link to="/" className="brand">
            <img
              className="brand-mark"
              src={assetUrl('icons/brand-96.webp')}
              srcSet={`${assetUrl('icons/brand-192.webp')} 2x`}
              width={48}
              height={48}
              alt=""
            />
            <span className="brand-name">Turnip Tycoon</span>
          </Link>
          <nav aria-label={t`Main navigation`}>
            <NavLink to="/" end>
              <CalendarDays size={18} aria-hidden="true" />
              <Trans comment="Main navigation: the current week's prices and forecast">
                Prices
              </Trans>
            </NavLink>
            <NavLink to="/groups">
              <Users size={18} aria-hidden="true" />
              <Trans>Friends</Trans>
            </NavLink>
            <NavLink to="/history">
              <HistoryIcon size={18} aria-hidden="true" />
              <Trans>History</Trans>
            </NavLink>
          </nav>
          <HeaderInstallButton />
          <NavLink
            to="/settings"
            className="settings-link icon-button"
            aria-label={t`Settings`}
            title={t`Settings`}
          >
            <SettingsIcon size={20} aria-hidden="true" />
          </NavLink>
        </header>
        <ScrollToPage />
        {/* Pages remount in a new language, so no memoized text keeps the old one. */}
        <Fragment key={i18n.locale}>
          {identity.removal && !isLegalPath(location.pathname) ? (
            <ProfileRemovalNotice />
          ) : (
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
              <Route path="/terms" element={<Terms />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )}
          <About />
          {!isLegalPath(location.pathname) && <WelcomeDialog />}
        </Fragment>
      </div>
      <UpdateNotice />
    </AppContext.Provider>
  );
}

const Router = hashRouting ? HashRouter : BrowserRouter;

startInstallPromptCapture();
startPwa();

void activateLocale(preferredLocale()).then(() =>
  createRoot(document.getElementById('root')!).render(
    <I18nProvider i18n={i18n}>
      <Router basename={hashRouting ? undefined : import.meta.env.BASE_URL}>
        <App />
      </Router>
    </I18nProvider>,
  ),
);
