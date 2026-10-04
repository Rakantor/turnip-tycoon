import { useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from './ui';

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type InstallState = {
  available: boolean;
  installed: boolean;
  ios: boolean;
  busy: boolean;
  message: string | null;
};

let state: InstallState = {
  available: false,
  installed: false,
  ios: false,
  busy: false,
  message: null,
};
let started = false;
let installPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function publish(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;

/** Capture at startup: the browser may offer installation before Settings opens. */
export function startInstallPromptCapture(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const standalone = window.matchMedia('(display-mode: standalone)');
  const iosStandalone = 'standalone' in navigator && navigator.standalone === true;
  let installedThisVisit = false;
  const updateDisplayMode = () => {
    const installed = installedThisVisit || standalone.matches || iosStandalone;
    if (installed) installPrompt = null;
    publish({ installed, available: !installed && installPrompt !== null });
  };
  publish({
    ios:
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  });
  updateDisplayMode();
  standalone.addEventListener('change', updateDisplayMode);
  window.addEventListener('appinstalled', () => {
    installedThisVisit = true;
    installPrompt = null;
    publish({ installed: true, available: false, busy: false, message: null });
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!('prompt' in event) || typeof event.prompt !== 'function') return;
    // Only the Settings button may open a prompt; never interrupt price entry.
    event.preventDefault();
    if (state.installed) return;
    installPrompt = event as InstallPromptEvent;
    publish({ available: true, message: null });
  });
}

async function install() {
  const prompt = installPrompt;
  if (!prompt || state.busy || state.installed) return;
  // A captured prompt can only be used once, including after dismissal.
  installPrompt = null;
  publish({ available: false, busy: true, message: null });
  try {
    const choice = await prompt.prompt();
    if (choice.outcome === 'accepted' && !state.installed)
      publish({ message: 'Installation started. Follow your browser’s instructions to finish.' });
  } catch {
    if (!state.installed)
      publish({ message: 'The install prompt could not open. Use your browser’s menu instead.' });
  } finally {
    publish({ busy: false });
  }
}

export function InstallApp() {
  const current = useSyncExternalStore(subscribe, snapshot);
  return (
    <section className="settings-section" id="install-app">
      <h2>Install app</h2>
      {current.installed ? (
        <p role="status">Turnip Tycoon is installed on this device.</p>
      ) : (
        <>
          <p>Add Turnip Tycoon to your home screen or apps for quick access.</p>
          {current.available || current.busy ? (
            <Button
              type="button"
              secondary
              busy={current.busy}
              onClick={() => {
                void install();
              }}
            >
              {!current.busy && <Download size={16} aria-hidden="true" />}
              Install Turnip Tycoon
            </Button>
          ) : current.ios ? (
            <p>
              In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Keep{' '}
              <strong>Open as Web App</strong> enabled if shown, then tap <strong>Add</strong>.
            </p>
          ) : (
            <p>
              Open your browser’s menu and look for <strong>Install app</strong> or{' '}
              <strong>Add to Home Screen</strong>, if available.
            </p>
          )}
          {current.message && <p role="status">{current.message}</p>}
        </>
      )}
    </section>
  );
}
