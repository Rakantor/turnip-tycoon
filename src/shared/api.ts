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

export interface AccessResponse extends SessionResponse {
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
}

export interface ApiErrorResponse {
  error: { code: string; message: string };
}
