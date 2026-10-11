import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Trans } from '@lingui/react/macro';
import { Bug, FileText, Languages, Lightbulb, Mail, Scale, Shield } from 'lucide-react';
import { GitHubMark } from './icons';
import { assetUrl } from './urls';
import { CONTACT_EMAIL, REPOSITORY_URL } from '../shared/contact';
import './footer.css';

/** Opens off-site pages in a new tab, so the app stays where it was. */
function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-columns">
        <div className="site-footer-about">
          <p className="site-footer-brand">
            <img
              src={assetUrl('icons/brand-96.webp')}
              srcSet={`${assetUrl('icons/brand-192.webp')} 2x`}
              width={44}
              height={44}
              alt=""
            />
            Turnip Tycoon
          </p>
          <div className="site-footer-credits">
            <p>
              <Trans>
                A fan project, not affiliated with Nintendo. Forecasts adapted from{' '}
                <External href="https://turnipprophet.io">Turnip Prophet</External>.
              </Trans>
            </p>
            <p>
              <Trans>
                Thanks to{' '}
                <External href="https://gist.github.com/Treeki/85be14d297c80c8b3c0a76375743325b">
                  Ninji
                </External>
                , who first worked out how the game sets turnip prices.
              </Trans>
            </p>
          </div>
        </div>
        <nav aria-labelledby="footer-github">
          <h2 id="footer-github">
            <Trans>On GitHub</Trans>
          </h2>
          <ul>
            <li>
              <External href={`${REPOSITORY_URL}/issues`}>
                <Bug size={18} aria-hidden="true" />
                <Trans>Report a bug</Trans>
              </External>
            </li>
            <li>
              <External href={`${REPOSITORY_URL}/discussions`}>
                <Lightbulb size={18} aria-hidden="true" />
                <Trans>Ideas and questions</Trans>
              </External>
            </li>
            <li>
              <External href={`${REPOSITORY_URL}#help-translate`}>
                <Languages size={18} aria-hidden="true" />
                <Trans>Help translate</Trans>
              </External>
            </li>
            <li>
              <External href={REPOSITORY_URL}>
                <GitHubMark size={18} aria-hidden="true" />
                <Trans>Source code</Trans>
              </External>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="footer-fine-print">
          <h2 id="footer-fine-print">
            <Trans>The fine print</Trans>
          </h2>
          <ul>
            <li>
              <Link to="/terms">
                <FileText size={18} aria-hidden="true" />
                <Trans>Terms</Trans>
              </Link>
            </li>
            <li>
              <Link to="/privacy">
                <Shield size={18} aria-hidden="true" />
                <Trans>Privacy</Trans>
              </Link>
            </li>
            <li>
              <Link to="/licenses">
                <Scale size={18} aria-hidden="true" />
                <Trans>Licenses</Trans>
              </Link>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`}>
                <Mail size={18} aria-hidden="true" />
                <Trans>Contact</Trans>
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div className="site-footer-base">
        <p>
          <Trans>
            Open source under the <Link to="/licenses">Apache License 2.0</Link>
          </Trans>
        </p>
        <p>
          <Trans>
            For anything private, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
          </Trans>
        </p>
      </div>
    </footer>
  );
}
