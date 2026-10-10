import { useState } from 'react';
import { useLocation } from 'react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Button, Notice } from '../ui';
import { updatePwa, usePwa } from './index';

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
    <aside className="app-update" aria-label={t`App update`}>
      <div>
        <strong>
          <Trans>An update is ready</Trans>
        </strong>
        <p>
          <Trans>Your saved prices will stay on this device.</Trans>
        </p>
        {pwa.error && <Notice>{pwa.error}</Notice>}
      </div>
      <div className="button-row">
        <Button
          busy={pwa.updating}
          onClick={() => {
            void updatePwa();
          }}
        >
          <Trans>Update now</Trans>
        </Button>
        <Button secondary disabled={pwa.updating} onClick={() => setDismissedOn(pathname)}>
          <Trans>Later</Trans>
        </Button>
      </div>
    </aside>
  );
}
