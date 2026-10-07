import { useState } from 'react';
import { useLocation } from 'react-router';
import { Button, Notice } from './ui';
import { updatePwa, usePwa } from './pwa';

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
