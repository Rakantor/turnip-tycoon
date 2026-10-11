import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Copy, UserPlus } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FriendRequest, SharedPlayerWeek } from '../shared/groups';
import type { useGroups } from './data/use-groups';
import { PlayerAvatar } from './player-avatar';
import { Button, Field, messageOf, Notice } from './ui';
import './friends.css';

type GroupData = ReturnType<typeof useGroups>;

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
