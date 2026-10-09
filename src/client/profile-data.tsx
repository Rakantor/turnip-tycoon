import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { CONTACT_EMAIL } from '../shared/contact';
import type { ProfileExportPage } from '../shared/profile-data';
import { isCurrentIdentityResponse, request } from './data/api';
import { database } from './data/database';
import { pendingEdits } from './data/pending-edits';
import { collectProfileExport } from './data/profile-export';
import { activeIdentity } from './data/runtime';
import { Button, messageOf, Notice, useApp } from './ui';
import './profile-data.css';

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function DeleteConfirmation({ close }: { close: () => void }) {
  const identity = useApp();
  const dialog = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const online = useOnline();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="profile-delete-dialog"
      ref={dialog}
      aria-labelledby="delete-profile-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <h2 id="delete-profile-title">
        <Trans>Delete your profile?</Trans>
      </h2>
      <p>
        <Trans>
          This permanently removes your name, friend code, price history, purchases, sales, and
          group memberships from the app’s database.
        </Trans>
      </p>
      <p>
        <Trans>
          All connected devices and your recovery code will lose access. Groups with other members
          will stay, along with their records.
        </Trans>
      </p>
      <p>
        <Trans>
          Saved data and unsent edits on this browser will be cleared. Other devices clear their
          copies when they next check access online. Friends may still have offline copies or
          screenshots.
        </Trans>
      </p>
      <p>
        <Trans>
          Download your data first if you want to keep it. This cannot be undone.{' '}
          <Link to="/privacy#privacy-retention">Backup and log details</Link>.
        </Trans>
      </p>
      <label className="profile-delete-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy}
        />{' '}
        <Trans>I understand that my profile and its records will be deleted.</Trans>
      </label>
      {!online && (
        <Notice>
          <Trans>Connect to the internet to delete your profile.</Trans>
        </Notice>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="button-row">
        <Button secondary disabled={busy} onClick={close}>
          <Trans>Keep my profile</Trans>
        </Button>
        <Button
          className="button-danger"
          busy={busy}
          disabled={!confirmed || !online}
          onClick={() => {
            if (!identity.session) return;
            setBusy(true);
            void identity.removeProfile(identity.session.player.id).catch((error) => {
              setError(messageOf(error));
              setBusy(false);
            });
          }}
        >
          <Trans>Permanently delete profile</Trans>
        </Button>
      </div>
    </dialog>
  );
}

export function ProfileDataSettings() {
  const { hash } = useLocation();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    if (hash === '#your-data') section.current?.scrollIntoView();
  }, [hash]);
  const identity = useApp();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  const available = online && identity.status === 'ready';
  async function download() {
    if (!identity.session) return;
    const owner = identity.session.player.id;
    setBusy(true);
    setError('');
    setDownloaded(false);
    try {
      const data = await collectProfileExport(owner, {
        db: database,
        savePending: () => pendingEdits.flushOwner(owner),
        current: () => activeIdentity.connected && activeIdentity.owner === owner,
        page: async (section, after) => {
          const result = await request<ProfileExportPage>(
            `/profile/export?section=${section}${after ? `&after=${after}` : ''}`,
          );
          if (!isCurrentIdentityResponse(result))
            throw new Error(t`Your profile changed. Start the download again.`);
          return result;
        },
      });
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `turnip-tycoon-data-${data.completedAt.slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setDownloaded(true);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-section" id="your-data" ref={section}>
      <h2>
        <Trans>Your data</Trans>
      </h2>
      <p>
        <Trans>
          Download your profile, all saved prices and trades, group memberships, and device details
          as a JSON file. Unsent edits on this browser are included separately. Keep the file
          somewhere private.
        </Trans>
      </p>
      <p>
        <Trans>
          Go online on your other devices first if you want their latest edits included.
        </Trans>
      </p>
      {!available && (
        <p className="hint">
          <Trans>Connect your profile online to download or delete its data.</Trans>
        </p>
      )}
      <div className="button-row">
        <Button
          secondary
          busy={busy}
          disabled={!available}
          onClick={() => {
            void download();
          }}
        >
          <Trans>Download my data</Trans>
        </Button>
        <Button
          className="button-danger"
          disabled={!available || busy}
          onClick={() => setConfirming(true)}
        >
          <Trans>Delete my profile</Trans>
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {downloaded && (
        <Notice success>
          <Trans>Your download is ready. Check your browser’s downloads.</Trans>
        </Notice>
      )}
      {confirming && <DeleteConfirmation close={() => setConfirming(false)} />}
    </section>
  );
}

/** Replaces data-entry screens until a deletion is resolved or the user chooses to start again. */
export function ProfileRemovalNotice() {
  const identity = useApp();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const online = useOnline();
  const removal = identity.removal!;
  const pending = removal.phase === 'pending';
  const waiting = busy || identity.status === 'connecting';
  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    void work()
      .catch((error) => setError(messageOf(error)))
      .finally(() => setBusy(false));
  };
  return (
    <main className="page narrow-page" id="main-content">
      <h1>
        {pending
          ? waiting
            ? t`Deleting your profile…`
            : t`Deletion needs another check`
          : removal.phase === 'deleted'
            ? t`Your profile is deleted`
            : t`This profile is no longer connected`}
      </h1>
      {pending ? (
        <>
          <p>
            <Trans>
              Uploads are paused. If the connection was interrupted, the deletion may already have
              reached the server. We will only show a successful deletion when the server confirms
              it.
            </Trans>
          </p>
          {!waiting && (
            <>
              <Button
                disabled={!online}
                onClick={() => run(() => identity.removeProfile(removal.owner))}
              >
                <Trans>Retry deletion</Trans>
              </Button>
              <p>
                <Trans>
                  If this device no longer has access, contact{' '}
                  <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> about an unconfirmed
                  request. You can clear this browser’s saved data and access below. That does not
                  confirm server deletion, and removes the ability to retry here.
                </Trans>
              </p>
              <Button secondary onClick={() => run(identity.clearRemovalAccess)}>
                <Trans>Clear this device’s saved data</Trans>
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <p>
            {removal.phase === 'deleted'
              ? t`Your profile and its records have been removed from the app’s database, and all connected devices have lost access.`
              : t`Its saved records and access have been cleared from this browser. This can happen when a device is removed, its profile is deleted, or you choose to clear this device. It does not by itself confirm deletion from the server.`}
          </p>
          <p>
            <Trans>
              No new profile has been created. You can close the app, or start again when you are
              ready.
            </Trans>
          </p>
          <Button busy={busy} onClick={() => run(identity.startAfterRemoval)}>
            <Trans>Return to welcome</Trans>
          </Button>
        </>
      )}
      {(error || identity.error) && <Notice>{error || identity.error}</Notice>}
      <p className="access-alternative">
        <Link to="/privacy#your-choices">
          <Trans>Privacy and data requests</Trans>
        </Link>
      </p>
    </main>
  );
}
