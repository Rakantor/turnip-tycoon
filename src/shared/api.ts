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
