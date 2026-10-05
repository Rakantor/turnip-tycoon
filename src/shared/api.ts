/** Names fit one line in a group card's seat on every screen. */
export const DISPLAY_NAME_MAX_LENGTH = 10;

/** A player who hasn't chosen a name goes by the first block of their friend code. */
export function defaultDisplayName(friendCode: string): string {
  return friendCode.slice(0, 4);
}

export interface Player {
  id: string;
  displayName: string;
  islandName: string | null;
  friendCode: string;
}

export interface SessionResponse {
  player: Player;
  deviceId: string;
  hasRecoveryCode: boolean;
}

// Credentials belong to the API transport, never the cached player metadata.
export interface SessionCredentialsResponse extends SessionResponse {
  sessionToken?: string;
}

export interface AccessResponse extends SessionCredentialsResponse {
  recoveryCode: string;
}

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
}

export interface PairingResponse {
  code: string;
  expiresAt: string;
  pairingToken?: string;
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
