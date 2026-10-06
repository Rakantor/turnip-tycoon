import { useState } from 'react';
import { Link } from 'react-router';
import projectNotice from '../../NOTICE?raw';
import { assetUrl } from './urls';
import { CONTACT_EMAIL } from '../shared/contact';
import './about.css';

const LICENSE_ROOT = assetUrl('licenses/turnip-prophet');

export function About() {
  const [licenses, setLicenses] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  async function loadLicenses() {
    if (status === 'loading' || status === 'ready') return;
    setStatus('loading');
    try {
      const texts = await Promise.all(
        ['NOTICE', 'LICENSE'].map(async (name) => {
          const response = await fetch(`${LICENSE_ROOT}/${name}`);
          if (!response.ok) throw new Error('Could not load the license.');
          return response.text();
        }),
      );
      setLicenses([projectNotice, ...texts].join('\n\n'));
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }

  return (
    <footer className="about-footer">
      <nav className="about-links" aria-label="Site information">
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
        <a href={`mailto:${CONTACT_EMAIL}`}>Contact</a>
      </nav>
      <p>
        Inspired by{' '}
        <a href="https://turnipprophet.io" target="_blank" rel="noreferrer">
          Turnip Prophet
        </a>
        . A fan project, not affiliated with Nintendo.
      </p>
      <details
        onToggle={(event) => {
          if (event.currentTarget.open) void loadLicenses();
        }}
      >
        <summary>Licenses</summary>
        <p>
          Turnip Tycoon is licensed under the{' '}
          <a href={`${LICENSE_ROOT}/LICENSE`}>Apache License, Version 2.0</a>. Third-party
          components retain their respective licenses, including the{' '}
          <a href={assetUrl('licenses/fonts/Fredoka-OFL.txt')}>Fredoka</a> and{' '}
          <a href={assetUrl('licenses/fonts/Nunito-OFL.txt')}>Nunito</a> fonts.
        </p>
        {status === 'error' ? (
          <p className="about-license-error" role="alert">
            Could not load the licenses.{' '}
            <button type="button" onClick={() => void loadLicenses()}>
              Try again
            </button>{' '}
            or open the <a href={`${LICENSE_ROOT}/NOTICE`}>notice</a> and{' '}
            <a href={`${LICENSE_ROOT}/LICENSE`}>license</a>.
          </p>
        ) : (
          <pre aria-busy={status === 'loading'}>{licenses ?? 'Loading…'}</pre>
        )}
      </details>
    </footer>
  );
}
