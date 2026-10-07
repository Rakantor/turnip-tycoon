import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { ChevronLeft, User } from 'lucide-react';
import { DISPLAY_NAME_MAX_LENGTH } from '../shared/api';
import type { GroupPreview } from '../shared/groups';
import { request } from './data/api';
import { PlayerAvatar } from './groups';
import { PairingCode } from './pairing';
import { Button, defaultDeviceName, useApp } from './ui';
import { assetUrl } from './urls';
import { rememberWelcomeJoin } from './welcome-join';
import './welcome.css';

function useInvitePreview(code: string | null): GroupPreview | null {
  const [preview, setPreview] = useState<{ code: string; data: GroupPreview | null } | null>(null);
  useEffect(() => {
    if (!code) return;
    let active = true;
    request<GroupPreview>(`/groups/preview?code=${encodeURIComponent(code)}`)
      .then((data) => {
        if (active) setPreview({ code, data });
      })
      .catch(() => {
        // An unknown or expired code just shows the ordinary welcome.
        if (active) setPreview({ code, data: null });
      });
    return () => {
      active = false;
    };
  }, [code]);
  return code && preview?.code === code ? preview.data : null;
}

/** Three seats fit one row on the narrowest phones. */
const PREVIEW_SEATS = 3;

/** The new player's seat, as friends will see it, beside the group's players. */
function SeatPreview({ name, members }: { name: string; members: string[] | null }) {
  const trimmed = name.trim();
  // A larger group shows its first player, then a count of the rest.
  const shown =
    members && members.length >= PREVIEW_SEATS ? members.slice(0, PREVIEW_SEATS - 2) : members;
  const more = members && shown ? members.length - shown.length : 0;
  return (
    <ul className="group-seats welcome-seats" aria-hidden="true">
      <li className="group-seat-self">
        <span className="welcome-seat">
          {trimmed ? (
            <PlayerAvatar name={trimmed} />
          ) : (
            <span className="player-avatar">
              <User size={18} />
            </span>
          )}
          <span className="group-seat-name">{trimmed || 'You'}</span>
        </span>
      </li>
      {shown
        ? shown.map((member, index) => (
            <li key={`${member}-${index}`}>
              <span className="welcome-seat">
                <PlayerAvatar name={member} />
                <span className="group-seat-name">{member}</span>
              </span>
            </li>
          ))
        : Array.from({ length: PREVIEW_SEATS - 1 }, (_, index) => (
            <li key={index} className="welcome-seat-blank">
              <span className="welcome-seat">
                <span className="player-avatar" />
                <span className="welcome-seat-bar" />
              </span>
            </li>
          ))}
      {more > 0 && (
        <li className="welcome-seat-more">
          <span className="welcome-seat">
            <span className="player-avatar">+{more}</span>
            <span className="group-seat-name">{more} more</span>
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * Shown the first time Turnip Tycoon opens on a device, before any profile
 * exists: pick a name, or connect a profile already used on another device.
 * Closing it with Escape or a tap outside skips naming.
 */
export function WelcomeDialog() {
  const identity = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<'name' | 'connect'>('name');
  const [name, setName] = useState('');
  const open = identity.needsProfile && !['/connect', '/recover'].includes(location.pathname);
  const inviteCode =
    open && location.pathname === '/groups/join'
      ? new URLSearchParams(location.search).get('code')
      : null;
  const preview = useInvitePreview(inviteCode);
  const full = preview ? preview.group.memberCount >= preview.group.capacity : false;

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function skip() {
    void identity.answerWelcome(null);
  }
  function save() {
    if (inviteCode && preview && !full) rememberWelcomeJoin(inviteCode);
    void identity.answerWelcome(name);
  }

  return (
    <dialog
      ref={dialog}
      className="welcome-dialog"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        skip();
      }}
      onClick={(event) => {
        // A tap on the backdrop lands on the dialog element itself.
        if (event.target === event.currentTarget) skip();
      }}
    >
      <div className="welcome-body">
        {step === 'name' ? (
          <form
            className="welcome-form"
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
          >
            <div className="welcome-heading">
              <img
                src={assetUrl('icons/brand-96.webp')}
                srcSet={`${assetUrl('icons/brand-192.webp')} 2x`}
                width={56}
                height={56}
                alt=""
              />
              <h2 id={`${id}-title`}>Welcome to Turnip Tycoon!</h2>
            </div>
            <p className="welcome-text">
              {preview ? (
                full ? (
                  <>
                    <strong>{preview.group.name}</strong> is full right now. What should your
                    friends call you?
                  </>
                ) : (
                  <>
                    You’re invited to <strong>{preview.group.name}</strong>. What should they call
                    you?
                  </>
                )
              ) : (
                'What should your friends call you?'
              )}
            </p>
            <SeatPreview name={name} members={preview?.members ?? null} />
            <div className="field welcome-field">
              <label htmlFor={`${id}-name`}>
                Your display name
                <span className="welcome-count">
                  {name.length}/{DISPLAY_NAME_MAX_LENGTH}
                </span>
              </label>
              <input
                id={`${id}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                autoComplete="nickname"
                autoFocus
                required
              />
            </div>
            <p className="welcome-privacy">
              Continuing creates a profile and saves your prices online and on this device. Read our{' '}
              <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy page</Link>.
            </p>
            <Button type="submit" disabled={!name.trim()}>
              {preview && !full ? 'Save and join' : 'Save name'}
            </Button>
            <button
              className="text-button welcome-switch"
              type="button"
              onClick={() => setStep('connect')}
            >
              I already play on another device
            </button>
          </form>
        ) : (
          <div className="welcome-form">
            <button
              className="text-button welcome-back"
              type="button"
              onClick={() => setStep('name')}
            >
              <ChevronLeft size={16} aria-hidden="true" />
              Back
            </button>
            <h2 id={`${id}-title`}>Connect your other device</h2>
            <p className="welcome-text">
              On the device you already use, open Settings, choose “Approve another device” and
              enter this code.
            </p>
            <PairingCode deviceName={defaultDeviceName()} />
            <button
              className="text-button welcome-switch"
              type="button"
              onClick={() => {
                void navigate('/recover');
              }}
            >
              Use a recovery code instead
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
