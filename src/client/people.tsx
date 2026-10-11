import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Check, ChevronDown, Copy, Ellipsis, Plus, Share2, Users } from 'lucide-react';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type {
  FriendInvitePreview,
  FriendRequest,
  GroupPreview,
  GroupSummary,
  SharedPlayerWeek,
} from '../shared/groups';
import { ApiError, request } from './data/api';
import type { useGroups } from './data/use-groups';
import { PlayerAvatar } from './player-avatar';
import { Button, Field, messageOf, Notice } from './ui';
import { appUrl } from './urls';
import { clearWelcomeJoin, isWelcomeJoin } from './welcome-join';
import './people.css';

type GroupData = ReturnType<typeof useGroups>;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** A friend link's code is made here, so the share sheet can open in the same tap. */
function newInviteCode(): string {
  return Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => CODE_ALPHABET[byte & 31],
  ).join('');
}
const sameCode = (left: string, right: string) =>
  left.replace(/[^a-z0-9]/gi, '').toUpperCase() === right.replace(/[^a-z0-9]/gi, '').toUpperCase();

type Preview<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; message: string; retry: boolean };

/** What a group or friend link shows before anyone acts on it. */
function usePreview<T>(path: string): [Preview<T>, () => void] {
  const [state, setState] = useState<{ path: string; attempt: number; result: Preview<T> }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const done = (result: Preview<T>) => {
      if (active) setState({ path, attempt, result });
    };
    request<T>(path)
      .then((data) => done({ status: 'ready', data }))
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
  }, [path, attempt]);
  const current = state?.path === path && state.attempt === attempt ? state.result : null;
  return [current ?? { status: 'loading' }, () => setAttempt((value) => value + 1)];
}

function WaitingItem({
  avatar,
  title,
  detail,
  error,
  children,
}: {
  avatar: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  error?: string;
  children?: ReactNode;
}) {
  return (
    <li className="waiting-item">
      <div className="waiting-who">
        {avatar}
        <div className="waiting-text">
          <strong>{title}</strong>
          {detail && <span>{detail}</span>}
        </div>
      </div>
      {children && <div className="waiting-actions">{children}</div>}
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

function GroupIcon() {
  return (
    <span className="player-avatar people-group-icon">
      <Users size={20} aria-hidden="true" />
    </span>
  );
}

/** A group invite link: one tap joins. “Save and join” in the welcome dialog joins at once. */
function GroupLink({
  code,
  data,
  onClose,
}: {
  code: string;
  data: GroupData;
  onClose: (done?: string) => void;
}) {
  const [state, retry] = usePreview<GroupPreview>(
    `/groups/preview?code=${encodeURIComponent(code)}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoJoin = useRef(isWelcomeJoin(code));
  const preview = state.status === 'ready' ? state.data : null;
  const member = data.groups.find((group) => sameCode(group.code, code));
  const full = preview !== null && preview.group.memberCount >= preview.group.capacity;
  const groupName = preview?.group.name ?? '';
  async function join() {
    setBusy(true);
    setError('');
    try {
      await data.join(code);
      onClose(t`Joined ${groupName}.`);
    } catch (error) {
      setError(messageOf(error));
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!autoJoin.current || !preview || data.status !== 'ready') return;
    autoJoin.current = false;
    clearWelcomeJoin();
    if (!member && !full) void join();
  });
  if (state.status === 'loading')
    return <WaitingItem avatar={<GroupIcon />} title={t`Checking this group link…`} />;
  if (!preview || member || full)
    return (
      <WaitingItem
        avatar={<GroupIcon />}
        title={
          state.status === 'error'
            ? state.message
            : member
              ? t`You’re already in ${groupName}.`
              : t`${groupName} is full right now.`
        }
      >
        {state.status === 'error' && state.retry && (
          <Button onClick={retry}>
            <Trans>Try again</Trans>
          </Button>
        )}
        <Button secondary onClick={() => onClose()}>
          <Trans>Close</Trans>
        </Button>
      </WaitingItem>
    );
  const members = preview.group.memberCount;
  const capacity = preview.group.capacity;
  return (
    <WaitingItem
      avatar={<GroupIcon />}
      title={groupName}
      detail={t`${members} of ${capacity} players`}
      error={error}
    >
      <Button
        busy={busy}
        disabled={data.status !== 'ready'}
        onClick={() => {
          void join();
        }}
      >
        <Users size={16} aria-hidden="true" />
        <Trans>Join group</Trans>
      </Button>
      <Button secondary disabled={busy} onClick={() => onClose()}>
        <Trans>Not now</Trans>
      </Button>
    </WaitingItem>
  );
}

/** A friend link: sharing it was their request, so accepting makes friends at once. */
function FriendLink({
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
  const [state, retry] = usePreview<FriendInvitePreview>(
    `/friends/invites/preview?code=${encodeURIComponent(code)}`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const autoAccept = useRef(isWelcomeJoin(code));
  const preview = state.status === 'ready' ? state.data : null;
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
  if (state.status === 'loading')
    return <WaitingItem avatar={<PlayerAvatar name="" />} title={t`Checking this friend link…`} />;
  if (!preview || own || already)
    return (
      <WaitingItem
        avatar={<PlayerAvatar name={name} />}
        title={
          state.status === 'error'
            ? state.message
            : own
              ? t`This is your own friend link. Share it with a friend instead.`
              : t`You and ${name} are already friends.`
        }
      >
        {state.status === 'error' && state.retry && (
          <Button onClick={retry}>
            <Trans>Try again</Trans>
          </Button>
        )}
        <Button secondary onClick={() => onClose()}>
          <Trans>Close</Trans>
        </Button>
      </WaitingItem>
    );
  return (
    <WaitingItem
      avatar={<PlayerAvatar name={name} />}
      title={name}
      detail={t`Sent you a friend link`}
      error={error}
    >
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
    </WaitingItem>
  );
}

function ReceivedRequest({
  request,
  data,
  onDone,
}: {
  request: FriendRequest;
  data: GroupData;
  onDone: (message: string) => void;
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
        onDone(t`You and ${name} are now friends.`);
      } else await data.removeFriend(player.id);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(null);
    }
  }
  return (
    <WaitingItem
      avatar={<PlayerAvatar name={name} />}
      title={name}
      detail={<span className="friend-code">{player.friendCode}</span>}
      error={error}
    >
      <Button
        busy={busy === 'accept'}
        disabled={busy !== null || data.status !== 'ready'}
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
        disabled={busy !== null || data.status !== 'ready'}
        aria-label={t`Decline ${name}’s friend request`}
        onClick={() => {
          void answer(false);
        }}
      >
        <Trans comment="Button: decline a friend request">Decline</Trans>
      </Button>
    </WaitingItem>
  );
}

/**
 * Everything that needs an answer from you: a group or friend link you just opened,
 * and friend requests. Buttons sit under each one, at every width.
 */
export function WaitingForYou({
  data,
  owner,
  groupCode,
  inviteCode,
  onClose,
  onDone,
  className = '',
}: {
  data: GroupData;
  owner: string;
  groupCode: string;
  inviteCode: string;
  onClose: (link: 'code' | 'invite', done?: string) => void;
  onDone: (message: string) => void;
  className?: string;
}) {
  const received = data.requests.received;
  const count = received.length + (groupCode ? 1 : 0) + (inviteCode ? 1 : 0);
  if (!count) return null;
  return (
    <section className={`people-card waiting ${className}`} aria-labelledby="waiting-title">
      <div className="waiting-heading">
        <h2 id="waiting-title">
          <Trans>Waiting for you</Trans>
        </h2>
        <span className="people-count">{count}</span>
      </div>
      <ul className="waiting-list">
        {groupCode && (
          <GroupLink
            key={groupCode}
            code={groupCode}
            data={data}
            onClose={(done) => onClose('code', done)}
          />
        )}
        {inviteCode && (
          <FriendLink
            key={inviteCode}
            code={inviteCode}
            data={data}
            owner={owner}
            onClose={(done) => onClose('invite', done)}
          />
        )}
        {received.map((entry) => (
          <ReceivedRequest key={entry.player.id} request={entry} data={data} onDone={onDone} />
        ))}
      </ul>
    </section>
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
    <div className="people-share">
      <Button
        disabled={data.status !== 'ready'}
        onClick={() => {
          void share();
        }}
      >
        <Share2 size={16} aria-hidden="true" />
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
    <div>
      <div className="group-code-line people-own-code">
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
    </div>
  );
}

/** One field takes a group's invite code or a player's friend code. */
function CodeForm({ data }: { data: GroupData }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const result = await data.redeem(code.trim());
      if ('group' in result) {
        const groupName = result.group.name;
        setDone(t`Joined ${groupName}.`);
      } else {
        const name = result.friend.player.displayName;
        setDone(
          result.friend.status === 'friends'
            ? t`You and ${name} are now friends.`
            : t`Friend request sent to ${name}.`,
        );
      }
      setCode('');
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="people-code-wrap">
      <form
        className="people-code"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field
          label={t`Got a code?`}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={t`Friend or group code`}
          maxLength={24}
          required
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
        <Button
          type="submit"
          secondary
          busy={busy}
          disabled={data.status !== 'ready' || !code.trim()}
        >
          <Trans comment="Button: add a friend or group">Add</Trans>
        </Button>
      </form>
      {error && <Notice>{error}</Notice>}
      {done && <Notice success>{done}</Notice>}
    </div>
  );
}

function NewGroup({ data, onClose }: { data: GroupData; onClose: (done?: string) => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      const group = await data.create(name.trim());
      const groupName = group.name;
      onClose(t`Created ${groupName}.`);
    } catch (error) {
      setError(messageOf(error));
      setBusy(false);
    }
  }
  return (
    <form
      className="people-new-group"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Field
        label={t`Group name`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder={t({ message: 'Sunday turnip crew', comment: 'An example group name' })}
        maxLength={60}
        required
        autoComplete="off"
        autoFocus
      />
      <div className="people-actions">
        <Button type="submit" busy={busy} disabled={data.status !== 'ready' || !name.trim()}>
          <Plus size={16} aria-hidden="true" />
          <Trans>Create group</Trans>
        </Button>
        <button className="text-button muted" type="button" onClick={() => onClose()}>
          <Trans>Cancel</Trans>
        </button>
      </div>
      <p className="hint">
        <Trans>
          Up to 12 players. Members can see each other’s name, friend code, weekly prices and
          history.
        </Trans>
      </p>
      {error && <Notice>{error}</Notice>}
    </form>
  );
}

/** Ways to bring people in: a friend link first, then your code, any code, or a new group. */
function InviteCard({ data, friendCode }: { data: GroupData; friendCode: string }) {
  const [creating, setCreating] = useState(false);
  const [done, setDone] = useState('');
  return (
    <section
      className="people-card people-invite"
      id="invite-friends"
      aria-labelledby="invite-title"
    >
      <h3 id="invite-title">
        <Trans>Invite a friend</Trans>
      </h3>
      <p className="hint">
        <Trans>Send a link. One tap and you’re friends, no code to type.</Trans>
      </p>
      <ShareLink data={data} />
      <OwnCode code={friendCode} />
      <CodeForm data={data} />
      {creating ? (
        <NewGroup
          data={data}
          onClose={(created) => {
            setCreating(false);
            setDone(created ?? '');
          }}
        />
      ) : (
        <button
          className="text-button people-start-group"
          type="button"
          onClick={() => {
            setDone('');
            setCreating(true);
          }}
        >
          <Trans>Start a new group</Trans>
        </button>
      )}
      {done && <Notice success>{done}</Notice>}
    </section>
  );
}

function seatsOf(data: GroupData, group: GroupSummary, owner: string): SharedPlayerWeek[] {
  return data.players
    .filter((member) => member.groupIds.includes(group.id))
    .sort(
      (left, right) =>
        Number(right.player.id === owner) - Number(left.player.id === owner) ||
        left.player.displayName.localeCompare(right.player.displayName),
    );
}

function weekLink(member: SharedPlayerWeek, owner: string): string {
  return member.player.id === owner
    ? '/'
    : `/players/${member.player.id}/weeks/${member.week.weekStart}`;
}

/** A group's players, its code and link, and leaving, opened from its row. */
function GroupPanel({
  id,
  group,
  data,
  owner,
}: {
  id: string;
  group: GroupSummary;
  data: GroupData;
  owner: string;
}) {
  const [message, setMessage] = useState('');
  const [fallbackLink, setFallbackLink] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const groupName = group.name;
  const seated = seatsOf(data, group, owner);
  const full = group.memberCount >= group.capacity;
  async function share() {
    const url = appUrl(`/groups/join?code=${encodeURIComponent(group.code)}`);
    if (navigator.share) {
      try {
        await navigator.share({
          title: group.name,
          text: t`Join ${groupName} on Turnip Tycoon`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage(t`Group link copied.`);
      setFallbackLink('');
    } catch {
      setFallbackLink(url);
      setMessage(t`Copy this group link to share it.`);
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(group.code);
      setMessage(t`Group code copied.`);
    } catch {
      setMessage(t`Select and copy the group code above.`);
    }
  }
  async function leave() {
    setLeaving(true);
    setMessage('');
    try {
      await data.leave(group.id);
    } catch (error) {
      setMessage(messageOf(error));
      setLeaving(false);
    }
  }
  return (
    <div className="people-panel" id={id}>
      <ul className="group-seats" aria-label={t`${groupName} players`}>
        {seated.map((member) => {
          const self = member.player.id === owner;
          const name = member.player.displayName;
          return (
            <li key={member.player.id} className={self ? 'group-seat-self' : undefined}>
              <Link
                to={weekLink(member, owner)}
                aria-label={self ? t`Your week` : t`${name}’s week`}
              >
                <PlayerAvatar name={name} />
                <span className="group-seat-name">{self ? t`You` : name}</span>
              </Link>
            </li>
          );
        })}
        {!full && (
          <li className="group-seat-open">
            <button
              type="button"
              onClick={() => {
                void share();
              }}
              aria-label={t`Invite a player to ${groupName}`}
            >
              <span className="group-seat-invite">
                <Plus size={18} aria-hidden="true" />
              </span>
              <span className="group-seat-name">
                <Trans>Invite</Trans>
              </span>
            </button>
          </li>
        )}
      </ul>
      <div className="group-code-line">
        <span>
          <Trans>Group code</Trans>
        </span>
        <code>{group.code}</code>
        <button
          className="icon-button"
          type="button"
          aria-label={t`Copy ${groupName} group code`}
          onClick={() => {
            void copyCode();
          }}
        >
          <Copy size={15} />
        </button>
      </div>
      <div className="people-actions">
        <Button
          secondary
          disabled={full}
          onClick={() => {
            void share();
          }}
        >
          <Share2 size={15} aria-hidden="true" />
          {full ? t`Group full` : t`Share group link`}
        </Button>
        <button
          className="text-button muted"
          type="button"
          disabled={data.status === 'offline'}
          onClick={() => setConfirmLeave(true)}
        >
          <Trans>Leave group</Trans>
        </button>
      </div>
      {confirmLeave && (
        <div className="leave-confirmation">
          <p>
            <Trans>
              Leave {groupName}? You’ll stop sharing with players unless you share another group.
            </Trans>
          </p>
          <div>
            <Button secondary onClick={() => setConfirmLeave(false)}>
              <Trans>Stay</Trans>
            </Button>
            <Button
              busy={leaving}
              onClick={() => {
                void leave();
              }}
            >
              <Trans>Leave group</Trans>
            </Button>
          </div>
        </div>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
      {fallbackLink && (
        <input
          aria-label={t`Group share link`}
          className="share-fallback"
          readOnly
          value={fallbackLink}
          onFocus={(event) => event.target.select()}
        />
      )}
    </div>
  );
}

function GroupRow({ group, data, owner }: { group: GroupSummary; data: GroupData; owner: string }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const seated = seatsOf(data, group, owner);
  const shown = seated.slice(0, seated.length > 3 ? 2 : 3);
  const more = seated.length - shown.length;
  const members = group.memberCount;
  const capacity = group.capacity;
  return (
    <li>
      <button
        type="button"
        className="people-row"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(!open)}
      >
        <span className="people-stack" aria-hidden="true">
          {shown.map((member) => (
            <PlayerAvatar key={member.player.id} name={member.player.displayName} small />
          ))}
          {more > 0 && <span className="player-avatar player-avatar-small">+{more}</span>}
        </span>
        <span className="people-text">
          <strong>{group.name}</strong>
          <span>
            <Trans>
              {members} of {capacity} players
            </Trans>
          </span>
        </span>
        <ChevronDown size={20} className="people-chevron" aria-hidden="true" />
      </button>
      {open && <GroupPanel id={panel} group={group} data={data} owner={owner} />}
    </li>
  );
}

function FriendRow({ entry, data }: { entry: SharedPlayerWeek; data: GroupData }) {
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
      setBusy(false);
    }
  }
  return (
    <li>
      <div className="people-row">
        <Link
          className="people-row-link"
          to={`/players/${player.id}/weeks/${entry.week.weekStart}`}
        >
          <PlayerAvatar name={name} />
          <span className="people-text">
            <strong>{name}</strong>
            <span className="friend-code">{player.friendCode}</span>
          </span>
        </Link>
        <button
          className="icon-button"
          type="button"
          aria-label={t`Remove ${name}`}
          aria-expanded={confirm}
          disabled={data.status === 'offline'}
          onClick={() => setConfirm(!confirm)}
        >
          <Ellipsis size={18} aria-hidden="true" />
        </button>
      </div>
      {confirm && (
        <div className="leave-confirmation people-confirm">
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
    <li>
      <div className="people-row">
        <span className="player-avatar people-pending" aria-hidden="true">
          {name.slice(0, 1).toUpperCase()}
        </span>
        <span className="people-text">
          <strong>{name}</strong>
          <span>
            <Trans comment="A friend request that the other player hasn't answered yet">
              Request sent
            </Trans>
          </span>
        </span>
        <button
          className="text-button muted"
          type="button"
          aria-label={t`Cancel your friend request to ${name}`}
          disabled={busy || data.status === 'offline'}
          onClick={() => {
            void cancel();
          }}
        >
          <Trans>Cancel</Trans>
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
    </li>
  );
}

/** Inviting people, then your groups and friends, all in one place. */
export function YourPeople({
  data,
  owner,
  friendCode,
  className = '',
}: {
  data: GroupData;
  owner: string;
  friendCode: string;
  className?: string;
}) {
  const friendIds = new Set(data.friendIds);
  const friends = data.players.filter((entry) => friendIds.has(entry.player.id));
  const sent = data.requests.sent;
  const groupCount = data.groups.length;
  const friendCount = friends.length;
  return (
    <section className={`people ${className}`} aria-labelledby="people-title">
      <h2 id="people-title">
        <Trans>Your people</Trans>
      </h2>
      <InviteCard data={data} friendCode={friendCode} />
      {groupCount > 0 && (
        <div>
          <h3 className="people-label">
            <Trans>Groups</Trans> <span className="people-count">{groupCount}</span>
          </h3>
          <ul className="people-card people-list">
            {data.groups.map((group) => (
              <GroupRow key={group.id} group={group} data={data} owner={owner} />
            ))}
          </ul>
        </div>
      )}
      {(friendCount > 0 || sent.length > 0) && (
        <div>
          <h3 className="people-label">
            <Trans>Friends</Trans> <span className="people-count">{friendCount}</span>
          </h3>
          <ul className="people-card people-list">
            {friends.map((entry) => (
              <FriendRow key={entry.player.id} entry={entry} data={data} />
            ))}
            {sent.map((entry) => (
              <SentRequest key={entry.player.id} request={entry} data={data} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
