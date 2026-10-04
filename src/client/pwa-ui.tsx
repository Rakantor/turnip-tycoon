import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button, Notice } from './ui';
import { checkPwaUpdate, updatePwa, usePwa } from './pwa';

export function UpdateNotice() {
  const pwa = usePwa();
  const { pathname } = useLocation();
  const [dismissedOn, setDismissedOn] = useState<string | null>(null);
  // Leaving this screen makes the notice available again when returning to Prices.
  if (dismissedOn !== null && dismissedOn !== pathname) setDismissedOn(null);
  // Avoid reloading access/settings/group forms with unfinished actions or secrets.
  const safePage = pathname === '/' || pathname === '/history' || pathname.startsWith('/weeks/');
  if (!pwa.updateAvailable || dismissedOn === pathname || !safePage) return null;
  return (
    <aside className="app-update" aria-label="App update">
      <div>
        <strong>An update is ready</strong>
        <p>Your saved prices will stay on this device.</p>
        {pwa.error && <Notice>{pwa.error}</Notice>}
      </div>
      <div className="button-row">
        <Button
          busy={pwa.updating}
          onClick={() => {
            void updatePwa();
          }}
        >
          Update now
        </Button>
        <Button secondary disabled={pwa.updating} onClick={() => setDismissedOn(pathname)}>
          Later
        </Button>
      </div>
    </aside>
  );
}

export function OfflineSettings() {
  const pwa = usePwa();
  const [checking, setChecking] = useState(false);
  return (
    <section className="settings-section" id="offline-access">
      <h2>Offline access</h2>
      <p role="status">
        {pwa.ready
          ? 'Ready to open offline. Your saved prices and forecasts stay available without a connection.'
          : pwa.supported
            ? 'Preparing offline access. Keep the app open with a connection for a moment.'
            : 'Offline opening is available in supported browsers on the published app.'}
      </p>
      {pwa.ready && (
        <p>
          New prices sync when you reconnect and the app is open. Friends’ prices need a connection.
        </p>
      )}
      {pwa.updateAvailable && (
        <p>An update is ready. Return to Prices when you’re finished here to apply it.</p>
      )}
      {pwa.error && <Notice>{pwa.error}</Notice>}
      {pwa.supported && (
        <Button
          secondary
          busy={checking}
          onClick={() => {
            setChecking(true);
            void Promise.resolve(checkPwaUpdate()).finally(() => setChecking(false));
          }}
        >
          {pwa.ready ? 'Check for updates' : 'Retry offline setup'}
        </Button>
      )}
    </section>
  );
}
