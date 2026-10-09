import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { PairingResponse, SessionResponse } from '../shared/api';
import { request } from './data/api';
import { Button, messageOf, Notice, useApp } from './ui';
import { appUrl } from './urls';

/**
 * This device's connection code and QR code. Another device already connected
 * to the profile approves it in Settings, then this device finishes connecting.
 */
export function PairingCode({
  deviceName,
  onConnected,
}: {
  deviceName: string;
  onConnected?: () => void;
}) {
  const { adopt, beginIdentityChange } = useApp();
  const [pairing, setPairing] = useState<PairingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);

  const begin = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      beginIdentityChange();
      setPairing(
        await request<PairingResponse>('/pairing', { method: 'POST', body: { deviceName } }),
      );
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }, [beginIdentityChange, deviceName]);

  useEffect(() => {
    // One code per visit, even when React runs this effect twice in development.
    if (started.current) return;
    started.current = true;
    void begin();
  }, [begin]);

  async function complete() {
    setBusy(true);
    setError('');
    try {
      beginIdentityChange();
      const result = await request<SessionResponse>('/pairing/complete', {
        method: 'POST',
        body: {},
      });
      await adopt(result);
      onConnected?.();
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  const url = pairing ? appUrl(`/settings?pair=${encodeURIComponent(pairing.code)}`) : '';
  const expires = pairing
    ? i18n.date(new Date(pairing.expiresAt), { hour: 'numeric', minute: '2-digit' })
    : '';
  return (
    <div className="pairing-content">
      {pairing && (
        <>
          <div className="pairing-code">
            <span className="field-label">
              <Trans>Connection code</Trans>
            </span>
            <strong>{pairing.code}</strong>
          </div>
          <div className="qr-row">
            <QRCodeSVG
              value={url}
              size={120}
              title={t`Scan this code on your connected device to approve the connection`}
            />
            <div>
              <p>
                <Trans>Or scan this code on your connected device.</Trans>
              </p>
              <p className="hint">
                <Trans>Expires at {expires}. Keep this page open.</Trans>
              </p>
            </div>
          </div>
        </>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="button-row">
        <Button
          busy={busy}
          disabled={!pairing}
          onClick={() => {
            void complete();
          }}
        >
          <Trans>Finish connecting</Trans>
        </Button>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => {
            void begin();
          }}
        >
          <Trans>Get a new code</Trans>
        </button>
      </div>
    </div>
  );
}
