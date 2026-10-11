import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, Share2, UserPlus } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FriendInvitePreview, FriendRequest, SharedPlayerWeek } from '../shared/groups';
import { ApiError, request } from './data/api';
import type { useGroups } from './data/use-groups';
import { PlayerAvatar } from './player-avatar';
import { Button, Field, messageOf, Notice } from './ui';
import { appUrl } from './urls';
import { clearWelcomeJoin, isWelcomeJoin } from './welcome-join';
import './friends.css';

type GroupData = ReturnType<typeof useGroups>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A friend link's code is made here, so the share sheet can open in the same tap. */
function newInviteCode(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => CODE_ALPHABET[byte & 31],
  ).join('');
}

type InviteState =
  | { status: 'loading' }
  | { status: 'ready'; preview: FriendInvitePreview }
  | { status: 'error'; message: string; retry: boolean };

function useInvitePreview(code: string): [InviteState, () => void] {
  const [state, setState] = useState<{ code: string; attempt: number; result: InviteState }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const done = (result: InviteState) => {
      if (active) setState({ code, attempt, result });
    };
    request<FriendInvitePreview>(`/friends/invites/preview?code=${encodeURIComponent(code)}`)
      .then((preview) => done({ status: 'ready', preview }))
      .catch((error: unknown) =>
        done({
          status: 'error',
          message: messageOf(error),
          // An expired or used link stays that way; a lost connection may not.
          retry: !(error instanceof ApiError && error.status === 404),
        }),
      );
    return () => {
      active = false;
    };
  }, [code, attempt]);
  const current = state?.code === code && state.attempt === attempt ? state.result : null;
  return [current ?? { status: 'loading' }, () => setAttempt((value) => value + 1)];
}

/**
 * A friend link someone shared: one tap makes you friends, as sharing it was their request.
 * Someone who chose “Save and accept” in the welcome dialog accepts without a second tap.
 */
export function FriendInvite({
  code,
  data,
  owner,
  onClose,
}: {
  code: string;
  data: GroupData;
  owner: string;
  onClose: (done?: string) => void;
}) {
  const [state, retry] = useInvitePreview(code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoAccept = useRef(isWelcomeJoin(code));
  const preview = state.status === 'ready' ? state.preview : null;
  const name = preview?.player.displayName ?? '';
  const own = preview !== null && preview.player.id === owner;
  const already = preview !== null && data.friendIds.includes(preview.player.id);
  async function accept() {
    setBusy(true);
    setError('');
    try {
      await data.acceptInvite(code);
      onClose(t`You and ${name} are now friends.`);
    } catch (error) {
      setError(messageOf(error));
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!autoAccept.current || !preview || data.status !== 'ready') return;
    autoAccept.current = false;
    clearWelcomeJoin();
    if (!own && !already) void accept();
  });
  const close = (
    <Button secondary onClick={() => onClose()}>
      <Trans>Close</Trans>
    </Button>
  );
  if (state.status === 'loading')
    return (
      <section className="friend-requests friend-invite">
        <p className="friend-invite-text" role="status">
          <Trans>Checking this friend link…</Trans>
        </p>
      </section>
    );
  if (!preview || own || already)
    return (
      <section className="friend-requests friend-invite">
        <p className="friend-invite-text" role="status">
          {state.status === 'error'
            ? state.message
            : own
              ? t`This is your own friend link. Share it with a friend instead.`
              : t`You and ${name} are already friends.`}
        </p>
        <div className="friend-link-actions">
          {state.status === 'error' && state.retry && (
            <Button onClick={retry}>
              <Trans>Try again</Trans>
            </Button>
          )}
          {close}
        </div>
      </section>
    );
  return (
    <section className="friend-requests friend-invite" aria-labelledby="friend-invite-title">
      <div className="friend-link">
        <PlayerAvatar name={name} />
        <span className="friend-link-who">
          <h2 id="friend-invite-title">
            <Trans>{name} wants to be your friend</Trans>
          </h2>
          <span className="friend-invite-detail">
            <Trans>Accept to see each other’s prices and forecasts.</Trans>
          </span>
        </span>
        <span className="friend-link-actions">
          <Button
            busy={busy}
            disabled={data.status !== 'ready'}
            onClick={() => {
              void accept();
            }}
          >
            <Check size={16} aria-hidden="true" />
            <Trans comment="Button: accept a friend request">Accept</Trans>
          </Button>
          <Button secondary disabled={busy} onClick={() => onClose()}>
            <Trans>Not now</Trans>
          </Button>
        </span>
        {error && <Notice>{error}</Notice>}
      </div>
    </section>
  );
}

/** Requests waiting for you stay at the top of Friends until you answer them. */
export function FriendRequests({ data }: { data: GroupData }) {
  const [done, setDone] = useState('');
  const received = data.requests.received;
  if (!received.length) return done ? <Notice success>{done}</Notice> : null;
  return (
    <section className="friend-requests" aria-labelledby="friend-requests-title">
      <h2 id="friend-requests-title">
        <Trans>Friend requests</Trans>
      </h2>
      <ul className="friend-link-list">
        {received.map((request) => (
          <ReceivedRequest
            key={request.player.id}
            request={request}
            data={data}
            onAccepted={(name) => setDone(t`You and ${name} are now friends.`)}
          />
        ))}
      </ul>
      {done && <Notice success>{done}</Notice>}
    </section>
  );
}

function ReceivedRequest({
  request,
  data,
  onAccepted,
}: {
  request: FriendRequest;
  data: GroupData;
  onAccepted: (name: string) => void;
}) {
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState('');
  const { player } = request;
  const name = player.displayName;
  async function answer(accept: boolean) {
    setBusy(accept ? 'accept' : 'decline');
    setError('');
    try {
      if (accept) {
        await data.acceptFriend(player.id);
        onAccepted(name);
      } else await data.removeFriend(player.id);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <li className="friend-link">
      <PlayerAvatar name={name} />
      <span className="friend-link-who">
        <strong>{name}</strong>
        <span className="friend-code">{player.friendCode}</span>
      </span>
      <span className="friend-link-actions">
        <Button
          busy={busy === 'accept'}
          disabled={busy !== null || data.status === 'offline'}
          aria-label={t`Accept ${name}’s friend request`}
          onClick={() => {
            void answer(true);
          }}
        >
          <Check size={16} aria-hidden="true" />
          <Trans comment="Button: accept a friend request">Accept</Trans>
        </Button>
        <Button
          secondary
          busy={busy === 'decline'}
          disabled={busy !== null || data.status === 'offline'}
          aria-label={t`Decline ${name}’s friend request`}
          onClick={() => {
            void answer(false);
          }}
        >
          <Trans comment="Button: decline a friend request">Decline</Trans>
        </Button>
      </span>
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

function AddFriend({ data }: { data: GroupData }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const friend = await data.addFriend(code.trim());
      const name = friend.player.displayName;
      setDone(
        friend.status === 'friends'
          ? t`You and ${name} are now friends.`
          : t`Friend request sent to ${name}.`,
      );
      setCode('');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="group-form-wrap">
      <form
        className="group-entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label={t`Friend code`}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t`Paste a friend code`}
          maxLength={24}
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Button
          type="submit"
          busy={busy}
          disabled={data.status === 'offline' || data.status === 'loading' || !code.trim()}
        >
          <UserPlus size={16} aria-hidden="true" />
          <Trans>Send request</Trans>
        </Button>
      </form>
      <p className="hint">
        <Trans>
          Once they accept, you can see each other’s name, friend code, weekly prices and history.
        </Trans>
      </p>
      {error && <Notice>{error}</Notice>}
      {done && <Notice success>{done}</Notice>}
    </div>
  );
}

/** Shares a one-time link that makes the person who opens it a friend in one tap. */
function ShareLink({ data }: { data: GroupData }) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fallbackLink, setFallbackLink] = useState('');
  async function share() {
    setMessage('');
    setError('');
    setFallbackLink('');
    const code = newInviteCode();
    const url = appUrl(`/friends/add?invite=${code}`);
    // The share sheet must open within the tap, so the link is saved alongside it.
    const saved = data.shareInvite(code).then(
      () => true,
      () => false,
    );
    let shown = '';
    try {
      if (!navigator.share) throw new Error('No share sheet');
      await navigator.share({
        title: 'Turnip Tycoon',
        text: t`Add me as a friend on Turnip Tycoon`,
        url,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(url);
        setMessage(t`Friend link copied.`);
      } catch {
        shown = url;
        setMessage(t`Copy this friend link to share it.`);
      }
    }
    if (await saved) setFallbackLink(shown);
    else {
      setMessage('');
      setError(t`That link couldn’t be saved, so it won’t work. Share a new one.`);
    }
  }
  return (
    <div className="friend-share">
      <Button
        secondary
        disabled={data.status !== 'ready'}
        onClick={() => {
          void share();
        }}
      >
        <Share2 size={15} aria-hidden="true" />
        <Trans>Share friend link</Trans>
      </Button>
      <p className="hint">
        <Trans>Each link adds one friend and works for 7 days.</Trans>
      </p>
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {fallbackLink && (
        <input
          aria-label={t`Friend link`}
          className="share-fallback"
          readOnly
          value={fallbackLink}
          onFocus={(event) => event.target.select()}
        />
      )}
      {error && <Notice>{error}</Notice>}
    </div>
  );
}

function OwnCode({ code }: { code: string }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setMessage(t`Friend code copied.`);
    } catch {
      setMessage(t`Select and copy your friend code above.`);
    }
  }
  return (
    <>
      <div className="group-code-line">
        <span>
          <Trans>Your friend code</Trans>
        </span>
        <code>{code}</code>
        <button
          className="icon-button"
          type="button"
          aria-label={t`Copy your friend code`}
          onClick={() => {
            void copy();
          }}
        >
          <Copy size={15} />
        </button>
      </div>
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </>
  );
}

function Friend({ entry, data }: { entry: SharedPlayerWeek; data: GroupData }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { player } = entry;
  const name = player.displayName;
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await data.removeFriend(player.id);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="friend-link">
      <Link
        className="friend-link-player"
        to={`/players/${player.id}/weeks/${entry.week.weekStart}`}
      >
        <PlayerAvatar name={name} />
        <span className="friend-link-who">
          <strong>{name}</strong>
          <span className="friend-code">{player.friendCode}</span>
        </span>
      </Link>
      <span className="friend-link-actions">
        <button
          className="text-button muted"
          type="button"
          aria-label={t`Remove ${name}`}
          aria-expanded={confirm}
          disabled={data.status === 'offline'}
          onClick={() => setConfirm(!confirm)}
        >
          <Trans comment="Button: remove a friend">Remove</Trans>
        </button>
      </span>
      {confirm && (
        <div className="leave-confirmation">
          <p>
            <Trans>
              Remove {name} from your friends? You’ll stop sharing prices unless you share a group.
            </Trans>
          </p>
          <div>
            <Button secondary onClick={() => setConfirm(false)}>
              <Trans comment="Button: keep a friend instead of removing them">Keep</Trans>
            </Button>
            <Button
              busy={busy}
              onClick={() => {
                void remove();
              }}
            >
              <Trans comment="Button: remove a friend">Remove</Trans>
            </Button>
          </div>
        </div>
      )}
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

function SentRequest({ request, data }: { request: FriendRequest; data: GroupData }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { player } = request;
  const name = player.displayName;
  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await data.removeFriend(player.id);
    } catch (error) {
      setError(messageOf(error));
      setBusy(false);
    }
  }
  return (
    <li className="friend-link friend-link-waiting">
      <PlayerAvatar name={name} />
      <span className="friend-link-who">
        <strong>{name}</strong>
        <span className="friend-link-status">
          <Trans comment="A friend request that the other player hasn't answered yet">
            Request sent
          </Trans>
        </span>
      </span>
      <span className="friend-link-actions">
        <button
          className="text-button muted"
          type="button"
          aria-label={t`Cancel your friend request to ${name}`}
          disabled={busy || data.status === 'offline'}
          onClick={() => {
            void cancel();
          }}
        >
          <Trans>Cancel request</Trans>
        </button>
      </span>
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

/** Friends added by code, the requests you sent, and your own code to share. */
export function YourFriends({ data, friendCode }: { data: GroupData; friendCode: string }) {
  const friendIds = new Set(data.friendIds);
  const friends = data.players.filter((entry) => friendIds.has(entry.player.id));
  const sent = data.requests.sent;
  return (
    <section className="your-friends" aria-labelledby="your-friends-title">
      <div className="section-heading">
        <h2 id="your-friends-title">
          <Trans>Your friends</Trans>
        </h2>
      </div>
      {/* One column of the groups grid, so it lines up with a group card. */}
      <div className="group-card-grid">
        <div className="group-detail-card friends-card">
          <OwnCode code={friendCode} />
          <ShareLink data={data} />
          <AddFriend data={data} />
          {(friends.length > 0 || sent.length > 0) && (
            <ul className="friend-link-list">
              {friends.map((entry) => (
                <Friend key={entry.player.id} entry={entry} data={data} />
              ))}
              {sent.map((request) => (
                <SentRequest key={request.player.id} request={request} data={data} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
