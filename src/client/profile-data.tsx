import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
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
      <h2 id="delete-profile-title">Delete your profile?</h2>
      <p>
        This permanently removes your name, friend code, price history, purchases, sales, and group
        memberships from the app’s database.
      </p>
      <p>
        All connected devices and your recovery code will lose access. Groups with other members
        will stay, along with their records.
      </p>
      <p>
        Saved data and unsent edits on this browser will be cleared. Other devices clear their
        copies when they next check access online. Friends may still have offline copies or
        screenshots.
      </p>
      <p>
        Download your data first if you want to keep it. This cannot be undone.{' '}
        <Link to="/privacy#privacy-retention">Backup and log details</Link>.
      </p>
      <label className="profile-delete-check">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
          disabled={busy}
        />{' '}
        I understand that my profile and its records will be deleted.
      </label>
      {!online && <Notice>Connect to the internet to delete your profile.</Notice>}
      {error && <Notice>{error}</Notice>}
      <div className="button-row">
        <Button secondary disabled={busy} onClick={close}>
          Keep my profile
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
          Permanently delete profile
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
            throw new Error('Your profile changed. Start the download again.');
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
      <h2>Your data</h2>
      <p>
        Download your profile, all saved prices and trades, group memberships, and device details as
        a JSON file. Unsent edits on this browser are included separately. Keep the file somewhere
        private.
      </p>
      <p>Go online on your other devices first if you want their latest edits included.</p>
      {!available && (
        <p className="hint">Connect your profile online to download or delete its data.</p>
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
          Download my data
        </Button>
        <Button
          className="button-danger"
          disabled={!available || busy}
          onClick={() => setConfirming(true)}
        >
          Delete my profile
        </Button>
      </div>
      {error && <Notice>{error}</Notice>}
      {downloaded && (
        <Notice success>Your download is ready. Check your browser’s downloads.</Notice>
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
            ? 'Deleting your profile…'
            : 'Deletion needs another check'
          : removal.phase === 'deleted'
            ? 'Your profile is deleted'
            : 'This profile is no longer connected'}
      </h1>
      {pending ? (
        <>
          <p>
            Uploads are paused. If the connection was interrupted, the deletion may already have
            reached the server. We will only show a successful deletion when the server confirms it.
          </p>
          {!waiting && (
            <>
              <Button
                disabled={!online}
                onClick={() => run(() => identity.removeProfile(removal.owner))}
              >
                Retry deletion
              </Button>
              <p>
                If this device no longer has access, contact{' '}
                <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> about an unconfirmed
                request. You can clear this browser’s saved data and access below. That does not
                confirm server deletion, and removes the ability to retry here.
              </p>
              <Button secondary onClick={() => run(identity.clearRemovalAccess)}>
                Clear this device’s saved data
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          <p>
            {removal.phase === 'deleted'
              ? 'Your profile and its records have been removed from the app’s database, and all connected devices have lost access.'
              : 'Its saved records and access have been cleared from this browser. This can happen when a device is removed, its profile is deleted, or you choose to clear this device. It does not by itself confirm deletion from the server.'}
          </p>
          <p>
            No new profile has been created. You can close the app, or start again when you are
            ready.
          </p>
          <Button busy={busy} onClick={() => run(identity.startAfterRemoval)}>
            Return to welcome
          </Button>
        </>
      )}
      {(error || identity.error) && <Notice>{error || identity.error}</Notice>}
      <p className="access-alternative">
        <Link to="/privacy#your-choices">Privacy and data requests</Link>
      </p>
    </main>
  );
}
