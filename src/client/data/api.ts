import type { WeekRecord } from '../../shared/week';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public week?: WeekRecord,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let expectedPlayer: string | null = null;
export function setExpectedPlayer(id: string | null) {
  expectedPlayer = id;
}

export async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const publicPath = [
    '/session',
    '/players',
    '/pairing',
    '/pairing/complete',
    '/recovery',
  ].includes(path);
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(!publicPath && expectedPlayer ? { 'X-Player-Id': expectedPlayer } : {}),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const body = (await response.json()) as T & {
    error?: { code: string; message: string };
    week?: WeekRecord;
  };
  if (!response.ok) {
    if (!publicPath && (response.status === 401 || body.error?.code === 'PLAYER_CHANGED')) {
      globalThis.dispatchEvent(new Event('turnip-session-stale'));
    }
    throw new ApiError(
      response.status,
      body.error?.code ?? 'REQUEST_FAILED',
      body.error?.message ?? 'Could not reach the server.',
      body.week,
    );
  }
  return body;
}
