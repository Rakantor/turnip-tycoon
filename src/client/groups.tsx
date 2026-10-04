import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowRight, Check, Copy, Plus, RefreshCw, Share2, Users, X } from 'lucide-react';
import { predictWeek } from '../prediction';
import { currentSlot, currentWeekStart } from '../shared/calendar';
import type { GroupSummary, SharedPlayerWeek } from '../shared/groups';
import type { WeekRecord } from '../shared/week';
import { useGroups } from './data/use-groups';
import { GroupPriceTable } from './group-price-table';
import { Button, Field, messageOf, Notice, useApp, weekLabel } from './ui';
import './groups.css';

type GroupData = ReturnType<typeof useGroups>;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const PERIODS = ['Sunday buy price', ...DAYS.flatMap((day) => [`${day} AM`, `${day} PM`])];
function initialPeriod(): number {
  return (currentSlot() ?? -1) + 1;
}
function reportedPrice(member: SharedPlayerWeek, period: number): number | null {
  return period === 0 ? member.week.purchasePrice : (member.week.prices[period - 1] ?? null);
}
export function PlayerAvatar({ name, small = false }: { name: string; small?: boolean }) {
  const letters = name
    .split(/[\s-]+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <span className={`player-avatar${small ? ' player-avatar-small' : ''}`} aria-hidden="true">
      {letters}
    </span>
  );
}

function ForecastSummary({ week }: { week: WeekRecord }) {
  const forecast = useMemo(() => predictWeek(week), [week]);
  if (forecast.status === 'needs-input')
    return <span className="member-forecast muted">No forecast yet</span>;
  if (forecast.status === 'inconsistent')
    return <span className="member-forecast forecast-unmatched">Prices don’t match a pattern</span>;
  const likely = forecast.patterns[0];
  return (
    <span className="member-forecast">
      <span className="pattern-dot" />
      {likely.label}
      <span className="muted">{Math.round(likely.probability * 100)}%</span>
    </span>
  );
}

function RefreshGroups({ data }: { data: GroupData }) {
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setClock(Date.now()),
      Math.max(0, data.refreshAvailableAt - Date.now()) + 20,
    );
    return () => window.clearTimeout(timeout);
  }, [data.refreshAvailableAt]);
  const waiting = clock < data.refreshAvailableAt;
  return (
    <div className="group-refresh">
      <span className="muted">
        {data.lastRefreshedAt
          ? `Updated ${new Date(data.lastRefreshedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : 'Prices shared with your groups'}
      </span>
      <button
        className="text-button refresh-button"
        type="button"
        disabled={waiting || data.status === 'loading'}
        onClick={() => {
          void data.refresh();
        }}
        title={waiting ? 'Refresh is available once a minute' : 'Refresh shared prices'}
      >
        <RefreshCw size={14} aria-hidden="true" />
        {data.status === 'loading' ? 'Updating…' : waiting ? 'Up to date' : 'Refresh'}
      </button>
    </div>
  );
}

function MemberList({
  players,
  period,
  owner,
  compact = false,
}: {
  players: SharedPlayerWeek[];
  period: number;
  owner: string;
  compact?: boolean;
}) {
  const sorted = useMemo(
    () =>
      [...players].sort((left, right) => {
        const a = reportedPrice(left, period);
        const b = reportedPrice(right, period);
        if (a === null)
          return b === null ? left.player.displayName.localeCompare(right.player.displayName) : 1;
        if (b === null) return -1;
        return period === 0 ? a - b : b - a;
      }),
    [players, period],
  );
  const entered = sorted.filter((member) => reportedPrice(member, period) !== null);
  const best = entered.length > 1 ? reportedPrice(entered[0], period) : null;
  return (
    <ul className={`friend-list${compact ? ' friend-list-compact' : ''}`}>
      {sorted.map((member) => {
        const price = reportedPrice(member, period);
        const self = member.player.id === owner;
        return (
          <li className="friend-row" key={member.player.id}>
            <PlayerAvatar name={member.player.displayName} />
            <div className="friend-identity">
              <Link
                to={self ? '/' : `/players/${member.player.id}/weeks/${member.week.weekStart}`}
                className="friend-name"
              >
                {member.player.displayName}
                {self && <span className="you-label">you</span>}
              </Link>
              {!compact && <span className="friend-code">{member.player.friendCode}</span>}
              <ForecastSummary week={member.week} />
            </div>
            <div className="friend-price">
              <span
                className={
                  price !== null && price === best ? 'reported-price best-price' : 'reported-price'
                }
              >
                {price ?? '—'}
                {price !== null && <small> bells</small>}
              </span>
              <span className="friend-period">
                {price === null ? 'Not entered' : PERIODS[period]}
                {price !== null && price === best
                  ? period === 0
                    ? ' · Lowest'
                    : ' · Highest'
                  : ''}
              </span>
            </div>
            {!compact && (
              <Link
                className="friend-open"
                to={self ? '/' : `/players/${member.player.id}/weeks/${member.week.weekStart}`}
                aria-label={`View ${member.player.displayName}’s week`}
              >
                <ArrowRight size={18} />
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function GroupForm({
  data,
  initialCode = '',
  onDone,
}: {
  data: GroupData;
  initialCode?: string;
  onDone?: () => void;
}) {
  const [mode, setMode] = useState<'create' | 'join'>(initialCode ? 'join' : 'create');
  const [name, setName] = useState('');
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    setDone('');
    try {
      const group =
        mode === 'create' ? await data.create(name.trim()) : await data.join(code.trim());
      setDone(`${mode === 'create' ? 'Created' : 'Joined'} ${group.name}.`);
      setName('');
      setCode('');
      onDone?.();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="group-form-wrap">
      <div className="segmented-control" aria-label="Group action">
        <button
          type="button"
          aria-pressed={mode === 'create'}
          onClick={() => {
            setMode('create');
            setError('');
          }}
        >
          Create a group
        </button>
        <button
          type="button"
          aria-pressed={mode === 'join'}
          onClick={() => {
            setMode('join');
            setError('');
          }}
        >
          Join a group
        </button>
      </div>
      <form
        className="group-entry-form"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {mode === 'create' ? (
          <Field
            label="Group name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Sunday turnip crew"
            maxLength={60}
            required
            autoComplete="off"
          />
        ) : (
          <Field
            label="Group code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Paste a group code"
            maxLength={24}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
          />
        )}
        <Button
          type="submit"
          busy={busy}
          disabled={
            data.status === 'offline' ||
            data.status === 'loading' ||
            (mode === 'create' ? !name.trim() : !code.trim())
          }
        >
          {mode === 'create' ? <Plus size={16} /> : <Users size={16} />}
          {mode === 'create' ? 'Create group' : 'Join group'}
        </Button>
      </form>
      <p className="hint">
        Up to 8 players. Members can see each other’s name, friend code, weekly prices and history.
      </p>
      {error && <Notice>{error}</Notice>}
      {done && <Notice success>{done}</Notice>}
    </div>
  );
}

function GroupDetails({ group, data }: { group: GroupSummary; data: GroupData }) {
  const [message, setMessage] = useState('');
  const [fallbackLink, setFallbackLink] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  async function share() {
    const url = `${location.origin}/groups/join?code=${encodeURIComponent(group.code)}`;
    if (navigator.share) {
      try {
        await navigator.share({
          title: group.name,
          text: `Join ${group.name} on Turnip Tycoon`,
          url,
        });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setMessage('Group link copied.');
      setFallbackLink('');
    } catch {
      setFallbackLink(url);
      setMessage('Copy this group link to share it.');
    }
  }
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(group.code);
      setMessage('Group code copied.');
    } catch {
      setMessage('Select and copy the group code above.');
    }
  }
  async function leave() {
    setLeaving(true);
    setMessage('');
    try {
      await data.leave(group.id);
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setLeaving(false);
    }
  }
  return (
    <section className="group-detail-card" aria-label={`${group.name} details`}>
      <div className="group-card-heading">
        <div>
          <h3>{group.name}</h3>
          <p>
            {group.memberCount} of {group.capacity} players
          </p>
        </div>
        <span className="group-badge">
          <Users size={18} />
        </span>
      </div>
      <div className="group-code-line">
        <span>Group code</span>
        <code>{group.code}</code>
        <button
          className="icon-button"
          type="button"
          aria-label={`Copy ${group.name} group code`}
          onClick={() => {
            void copyCode();
          }}
        >
          <Copy size={15} />
        </button>
      </div>
      <div className="group-card-actions">
        <Button
          secondary
          onClick={() => {
            void share();
          }}
          disabled={group.memberCount >= group.capacity}
        >
          <Share2 size={15} />
          {group.memberCount >= group.capacity ? 'Group full' : 'Share group link'}
        </Button>
        <button className="text-button muted" type="button" onClick={() => setConfirmLeave(true)}>
          Leave group
        </button>
      </div>
      {confirmLeave && (
        <div className="leave-confirmation">
          <p>
            Leave {group.name}? You’ll stop sharing with players unless you share another group.
          </p>
          <div>
            <Button secondary onClick={() => setConfirmLeave(false)}>
              Stay
            </Button>
            <Button
              busy={leaving}
              onClick={() => {
                void leave();
              }}
            >
              Leave group
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
          aria-label="Group share link"
          className="share-fallback"
          readOnly
          value={fallbackLink}
          onFocus={(event) => event.target.select()}
        />
      )}
    </section>
  );
}

function ConnectionMessage({ data }: { data: GroupData }) {
  const identity = useApp();
  if (data.status === 'offline')
    return (
      <div className="group-connection">
        <p>Connect to see your friends’ shared prices.</p>
        <Button
          secondary
          onClick={() => {
            void identity.retry();
          }}
        >
          Reconnect
        </Button>
      </div>
    );
  if (data.error)
    return (
      <div className="group-connection">
        <Notice>{data.error}</Notice>
        <Button
          secondary
          onClick={() => {
            void data.refresh();
          }}
        >
          Try again
        </Button>
      </div>
    );
  return null;
}

export function FriendsPanel({ weekStart, week }: { weekStart: string; week?: WeekRecord }) {
  const identity = useApp();
  const data = useGroups(weekStart, identity.session, identity.status === 'ready');
  const [period, setPeriod] = useState(initialPeriod);
  const players = data.players.map((member) =>
    week && member.player.id === identity.session?.player.id ? { ...member, week } : member,
  );
  return (
    <section className="friends-panel" aria-labelledby="friends-panel-title">
      <div className="section-heading">
        <div>
          <span className="section-eyebrow">YOUR GROUPS</span>
          <h2 id="friends-panel-title">Friends’ prices</h2>
        </div>
        <Link className="text-link" to="/groups">
          Your groups <ArrowRight size={16} />
        </Link>
      </div>
      <ConnectionMessage data={data} />
      {data.status === 'loading' && !players.length && (
        <p className="muted" role="status">
          Loading your groups…
        </p>
      )}
      {data.status === 'ready' && !data.groups.length && (
        <div className="friends-empty">
          <span className="friends-empty-icon">
            <Users size={25} />
          </span>
          <div>
            <h3>A good price is better shared.</h3>
            <p>Start a group with friends to compare prices and forecasts.</p>
          </div>
          <Link className="button" to="/groups">
            Create or join a group <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {players.length > 0 && (
        <>
          <div className="friends-toolbar">
            <span className="muted">Reported prices · {weekLabel(weekStart)}</span>
            <label className="period-select">
              Compare
              <select value={period} onChange={(event) => setPeriod(Number(event.target.value))}>
                {PERIODS.map((label, index) => (
                  <option key={label} value={index}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <MemberList
            players={players}
            period={period}
            owner={identity.session?.player.id ?? ''}
            compact
          />
          <RefreshGroups data={data} />
        </>
      )}
    </section>
  );
}

export function Groups() {
  const identity = useApp();
  const [params, setParams] = useSearchParams();
  const linkCode = params.get('code') ?? '';
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const weekStart = currentWeekStart(now);
  const { groupId } = useParams();
  const data = useGroups(weekStart, identity.session, identity.status === 'ready');
  const [selectedGroup, setSelectedGroup] = useState(groupId ?? 'all');
  useEffect(() => setSelectedGroup(groupId ?? 'all'), [groupId]);
  const [showForm, setShowForm] = useState(false);
  const existingSelection = data.groups.some((group) => group.id === selectedGroup)
    ? selectedGroup
    : 'all';
  const players =
    existingSelection === 'all'
      ? data.players
      : data.players.filter((member) => member.groupIds.includes(existingSelection));
  const hasGroups = data.groups.length > 0;
  const formOpen = linkCode || showForm || (!hasGroups && data.status === 'ready');
  return (
    <main className="page groups-page" id="main-content">
      <div className="page-heading">
        <div>
          <h1>Friends</h1>
        </div>
        {hasGroups && (
          <Button secondary onClick={() => setShowForm(!showForm)}>
            {showForm ? <X size={16} /> : <Plus size={16} />}
            {showForm ? 'Close' : 'Create or join'}
          </Button>
        )}
      </div>
      <ConnectionMessage data={data} />
      {formOpen && (
        <section className="group-create-card">
          <div className="section-heading">
            <div>
              <span className="section-eyebrow">FRIENDS &amp; GROUPS</span>
              <h2>
                {linkCode
                  ? 'Join your friends'
                  : hasGroups
                    ? 'Room for another group?'
                    : 'Bring your friends along'}
              </h2>
            </div>
            <Users size={28} className="muted" />
          </div>
          <p className="muted">Compare your prices and find a good time to sell, together.</p>
          <GroupForm
            key={linkCode || 'group-form'}
            data={data}
            initialCode={linkCode}
            onDone={() => {
              setShowForm(false);
              setParams({});
            }}
          />
        </section>
      )}
      {data.status === 'loading' && !hasGroups && (
        <p className="muted" role="status">
          Loading your groups…
        </p>
      )}
      {hasGroups && (
        <>
          <section className="friends-comparison" aria-labelledby="comparison-heading">
            <div className="section-heading">
              <div>
                <span className="section-eyebrow">THIS WEEK</span>
                <h2 id="comparison-heading">Prices at a glance</h2>
              </div>
              <span className="week-chip">{weekLabel(weekStart)}</span>
            </div>
            <div className="friends-toolbar">
              <div className="group-filters" aria-label="Show group">
                <button
                  type="button"
                  aria-pressed={existingSelection === 'all'}
                  onClick={() => setSelectedGroup('all')}
                >
                  All friends <span>{data.players.length}</span>
                </button>
                {data.groups.map((group) => (
                  <button
                    key={group.id}
                    type="button"
                    aria-pressed={existingSelection === group.id}
                    onClick={() => setSelectedGroup(group.id)}
                  >
                    {group.name}
                  </button>
                ))}
              </div>
            </div>
            <GroupPriceTable players={players} owner={identity.session?.player.id ?? ''} />
            <RefreshGroups data={data} />
          </section>
          <section className="your-groups" aria-labelledby="your-groups-title">
            <div className="section-heading">
              <h2 id="your-groups-title">Your groups</h2>
              <span className="muted">Share a link to add a friend</span>
            </div>
            <div className="group-card-grid">
              {data.groups.map((group) => (
                <GroupDetails key={group.id} group={group} data={data} />
              ))}
            </div>
          </section>
        </>
      )}
      {identity.session && (
        <div className="your-friend-code">
          <Check size={15} />
          <span>
            Your friend code <strong>{identity.session.player.friendCode}</strong>
          </span>
          <Link to="/settings">Edit your name</Link>
        </div>
      )}
    </main>
  );
}
