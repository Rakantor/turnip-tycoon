import { useSyncExternalStore } from 'react';
import { Download, LoaderCircle } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type RelatedAppsNavigator = Navigator & {
  getInstalledRelatedApps?: () => Promise<{ platform: string }[]>;
};

type InstallState = {
  available: boolean;
  installed: boolean;
  busy: boolean;
};

let state: InstallState = {
  available: false,
  installed: false,
  busy: false,
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

/** Capture at startup: the browser may offer installation at any time. */
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
  updateDisplayMode();
  standalone.addEventListener('change', updateDisplayMode);
  // Chromium on Android can report an installed copy even from a normal browser tab,
  // using the manifest's related_applications entry.
  const related = (navigator as RelatedAppsNavigator).getInstalledRelatedApps;
  if (related)
    void related
      .call(navigator)
      .then((apps) => {
        if (!apps.some((app) => app.platform === 'webapp')) return;
        installedThisVisit = true;
        updateDisplayMode();
      })
      .catch(() => undefined);
  window.addEventListener('appinstalled', () => {
    installedThisVisit = true;
    installPrompt = null;
    publish({ installed: true, available: false, busy: false });
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!('prompt' in event) || typeof event.prompt !== 'function') return;
    // Only an Install button the player taps may open the prompt; never interrupt price entry.
    event.preventDefault();
    if (state.installed) return;
    installPrompt = event as InstallPromptEvent;
    publish({ available: true });
  });
}

async function install() {
  const prompt = installPrompt;
  if (!prompt || state.busy || state.installed) return;
  // A captured prompt can only be used once, including after dismissal.
  installPrompt = null;
  publish({ available: false, busy: true });
  try {
    await prompt.prompt();
  } catch {
    // The browser's own menu can still install the app.
  } finally {
    publish({ busy: false });
  }
}

/** A phone header shortcut, shown only while the browser offers its install prompt. */
export function HeaderInstallButton() {
  const current = useSyncExternalStore(subscribe, snapshot);
  if (current.installed || !(current.available || current.busy)) return null;
  return (
    <button
      type="button"
      className="icon-button install-link"
      aria-label="Install Turnip Tycoon"
      aria-busy={current.busy || undefined}
      disabled={current.busy}
      onClick={() => {
        void install();
      }}
    >
      {current.busy ? (
        <LoaderCircle size={19} className="spin" aria-hidden="true" />
      ) : (
        <Download size={19} aria-hidden="true" />
      )}
      <span className="install-label">Install</span>
    </button>
  );
}
