import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { connectDatabase, transaction, type Database } from '../db/connection';
import { devices, pairingChallenges, players, recoveryCredentials } from '../db/schema';
import { findSession, lockPlayer, newDevice, sessionHash, withSession } from './auth';
import { ApiError } from './errors';
import {
  checkOrigin,
  crossOriginRequest,
  PAIRING_SECONDS,
  readCredential,
  readJson,
  secureTransport,
  validateFrontendOrigin,
  writeCredential,
  type CredentialMode,
} from './http';
import { formatCode, hashSecret, randomCode, randomToken } from './secrets';
import {
  deviceIdInput,
  deviceInput,
  emptyInput,
  pairingApprovalInput,
  profileInput,
  recoveryInput,
} from './validation';
import { registerWeekRoutes } from './weeks';
import { registerGroupRoutes } from './groups';

export type AppEnvironment = { Variables: { db: Database; credentialMode: CredentialMode } };

export interface AppOptions {
  frontendOrigin?: string;
  credentialMode?: CredentialMode;
}

function pairingUnavailable() {
  return new ApiError(
    404,
    'PAIRING_UNAVAILABLE',
    'This pairing code expired or is no longer available. Start again on the new device.',
  );
}

export function createApp(databaseUrl: string, options: AppOptions = {}) {
  const app = new Hono<AppEnvironment>();
  const credentialMode = options.credentialMode ?? 'cookie';
  const frontendOrigin =
    credentialMode === 'bearer' ? validateFrontendOrigin(options.frontendOrigin) : undefined;

  app.onError((error, c) => {
    if (error instanceof ApiError)
      return c.json({ error: { code: error.code, message: error.message } }, error.status);
    // Never log SQL parameters, cookies, recovery codes, or connection strings.
    console.error(
      JSON.stringify({ event: 'api_request_failed', name: error.name, path: c.req.path }),
    );
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } },
      500,
    );
  });

  app.use('/api/*', async (c, next) => {
    c.set('credentialMode', credentialMode);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    secureTransport(c);
    if (frontendOrigin) {
      const response = crossOriginRequest(c, frontendOrigin);
      if (response) return response;
    } else if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) checkOrigin(c);
    await next();
  });

  app.use('/api/*', async (c, next) => {
    const { client, db } = await connectDatabase(databaseUrl);
    c.set('db', db);
    try {
      // A browser can switch players while another tab still has its prior
      // player's cache open. This assertion prevents saving that cache into the
      // newly connected identity; authorization comes from the device credential.
      const expectedPlayer = c.req.header('X-Player-Id');
      if (
        expectedPlayer &&
        ![
          '/api/session',
          '/api/players',
          '/api/pairing',
          '/api/pairing/complete',
          '/api/recovery',
        ].includes(c.req.path)
      ) {
        const session = await findSession(db, await sessionHash(c));
        if (session.player.id !== expectedPlayer)
          throw new ApiError(
            409,
            'PLAYER_CHANGED',
            'This browser is connected to a different player.',
          );
      }
      await next();
    } finally {
      await client.end();
    }
  });

  app.get('/api/health', async (c) => {
    await c.get('db').execute(sql`select 1`);
    return c.json({ status: 'ok', database: 'ok' });
  });

  const startSession = async (c: Context<AppEnvironment>) => {
    const { deviceName } = await readJson(c, deviceInput);
    const token = readCredential(c, 'session');
    if (token) {
      try {
        const session = await findSession(c.get('db'), await hashSecret(token));
        return c.json({
          ...session,
          ...(credentialMode === 'bearer' ? { sessionToken: token } : {}),
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
    }
    const result = await transaction(c.get('db'), async (tx) => {
      // Retry the unlikely public-code collision without aborting the transaction.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const friendCode = formatCode(randomCode(12));
        const [player] = await tx
          .insert(players)
          .values({ displayName: friendCode, friendCode })
          .onConflictDoNothing({ target: players.friendCode })
          .returning();
        if (player) return { player, ...(await newDevice(tx, player.id, deviceName)) };
      }
      throw new ApiError(503, 'TRY_AGAIN', 'Please try connecting again.');
    });
    writeCredential(c, 'session', result.token);
    return c.json(
      {
        player: result.player,
        deviceId: result.deviceId,
        hasRecoveryCode: false,
        ...(credentialMode === 'bearer' ? { sessionToken: result.token } : {}),
      },
      201,
    );
  };
  app.post('/api/session', startSession);
  app.post('/api/players', startSession);

  app.get('/api/session', async (c) =>
    c.json(await findSession(c.get('db'), await sessionHash(c))),
  );

  app.patch('/api/profile', async (c) => {
    const profile = await readJson(c, profileInput);
    const player = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const [updated] = await tx
        .update(players)
        .set({ displayName: profile.displayName || session.player.friendCode })
        .where(eq(players.id, session.player.id))
        .returning();
      return updated;
    });
    return c.json({ player });
  });

  app.get('/api/devices', async (c) => {
    const result = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const rows = await tx
        .select({
          id: devices.id,
          name: devices.name,
          createdAt: devices.createdAt,
          expiresAt: devices.expiresAt,
        })
        .from(devices)
        .where(
          and(
            eq(devices.playerId, session.player.id),
            gt(devices.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .orderBy(asc(devices.createdAt), asc(devices.id));
      return rows.map((device) => ({
        ...device,
        createdAt: device.createdAt.toISOString(),
        expiresAt: device.expiresAt.toISOString(),
        current: device.id === session.deviceId,
      }));
    });
    return c.json({ devices: result });
  });

  app.delete('/api/devices/:id', async (c) => {
    const parsed = deviceIdInput.safeParse(c.req.param('id'));
    if (!parsed.success) throw new ApiError(400, 'INVALID_INPUT', 'Choose a valid device.');
    const self = await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const removed = await tx
        .delete(devices)
        .where(and(eq(devices.id, parsed.data), eq(devices.playerId, session.player.id)))
        .returning({ id: devices.id });
      if (!removed.length)
        throw new ApiError(404, 'DEVICE_NOT_FOUND', 'This device is no longer available.');
      return session.deviceId === parsed.data;
    });
    if (self) writeCredential(c, 'session', '');
    return c.json({ ok: true });
  });

  app.post('/api/logout', async (c) => {
    await readJson(c, emptyInput);
    await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      await tx.delete(devices).where(eq(devices.id, session.deviceId));
    });
    writeCredential(c, 'session', '');
    return c.json({ ok: true });
  });

  app.post('/api/pairing', async (c) => {
    const input = await readJson(c, deviceInput);
    const code = randomCode(16);
    const claim = randomToken();
    const expiresAt = new Date(Date.now() + PAIRING_SECONDS * 1000);
    await c
      .get('db')
      .insert(pairingChallenges)
      .values({
        codeHash: await hashSecret(code),
        claimHash: await hashSecret(claim),
        deviceName: input.deviceName,
        expiresAt,
      });
    writeCredential(c, 'pairing', claim);
    return c.json(
      {
        code: formatCode(code),
        expiresAt: expiresAt.toISOString(),
        ...(credentialMode === 'bearer' ? { pairingToken: claim } : {}),
      },
      201,
    );
  });

  app.post('/api/pairing/approve', async (c) => {
    const input = await readJson(c, pairingApprovalInput);
    const codeHash = await hashSecret(input.code);
    await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      const [candidate] = await tx
        .select()
        .from(pairingChallenges)
        .where(
          and(
            eq(pairingChallenges.codeHash, codeHash),
            gt(pairingChallenges.expiresAt, sql`clock_timestamp()`),
          ),
        );
      if (!candidate) throw pairingUnavailable();
      if (candidate.playerId)
        throw new ApiError(409, 'PAIRING_APPROVED', 'This pairing code has already been approved.');
      const approved = await tx
        .update(pairingChallenges)
        .set({ playerId: session.player.id, approvedByDeviceId: session.deviceId })
        .where(
          and(
            eq(pairingChallenges.id, candidate.id),
            isNull(pairingChallenges.playerId),
            gt(pairingChallenges.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .returning({ id: pairingChallenges.id });
      if (!approved.length)
        throw new ApiError(409, 'PAIRING_UNAVAILABLE', 'This pairing code is no longer available.');
    });
    return c.json({ ok: true });
  });

  app.post('/api/pairing/complete', async (c) => {
    await readJson(c, emptyInput);
    const claim = readCredential(c, 'pairing');
    if (!claim) throw pairingUnavailable();
    const claimHash = await hashSecret(claim);
    const result = await transaction(c.get('db'), async (tx) => {
      const [candidate] = await tx
        .select()
        .from(pairingChallenges)
        .where(
          and(
            eq(pairingChallenges.claimHash, claimHash),
            gt(pairingChallenges.expiresAt, sql`clock_timestamp()`),
          ),
        );
      if (!candidate) throw pairingUnavailable();
      if (!candidate.playerId)
        throw new ApiError(
          409,
          'PAIRING_PENDING',
          'Approve this code from a connected device first.',
        );
      await lockPlayer(tx, candidate.playerId);
      const [challenge] = await tx
        .select()
        .from(pairingChallenges)
        .where(
          and(
            eq(pairingChallenges.id, candidate.id),
            gt(pairingChallenges.expiresAt, sql`clock_timestamp()`),
          ),
        )
        .for('update');
      if (!challenge?.playerId || !challenge.approvedByDeviceId) throw pairingUnavailable();
      const [approver] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(
          and(
            eq(devices.id, challenge.approvedByDeviceId),
            eq(devices.playerId, challenge.playerId),
            gt(devices.expiresAt, sql`clock_timestamp()`),
          ),
        );
      if (!approver) throw pairingUnavailable();
      const [player] = await tx.select().from(players).where(eq(players.id, challenge.playerId));
      await tx.delete(pairingChallenges).where(eq(pairingChallenges.id, challenge.id));
      const [recovery] = await tx
        .select({ playerId: recoveryCredentials.playerId })
        .from(recoveryCredentials)
        .where(eq(recoveryCredentials.playerId, player.id));
      return {
        player,
        hasRecoveryCode: Boolean(recovery),
        ...(await newDevice(tx, player.id, challenge.deviceName)),
      };
    });
    writeCredential(c, 'session', result.token);
    writeCredential(c, 'pairing', '');
    return c.json({
      player: result.player,
      deviceId: result.deviceId,
      hasRecoveryCode: result.hasRecoveryCode,
      ...(credentialMode === 'bearer' ? { sessionToken: result.token } : {}),
    });
  });

  app.post('/api/recovery', async (c) => {
    const input = await readJson(c, recoveryInput);
    const codeHash = await hashSecret(input.code);
    const recoveryCode = randomCode(32);
    const newCodeHash = await hashSecret(recoveryCode);
    const invalid = () =>
      new ApiError(
        401,
        'INVALID_RECOVERY',
        'This recovery code is invalid or has already been replaced.',
      );
    const result = await transaction(c.get('db'), async (tx) => {
      const [candidate] = await tx
        .select()
        .from(recoveryCredentials)
        .where(eq(recoveryCredentials.codeHash, codeHash));
      if (!candidate) throw invalid();
      await lockPlayer(tx, candidate.playerId);
      const consumed = await tx
        .delete(recoveryCredentials)
        .where(
          and(
            eq(recoveryCredentials.playerId, candidate.playerId),
            eq(recoveryCredentials.codeHash, codeHash),
          ),
        )
        .returning();
      if (!consumed.length) throw invalid();
      await tx
        .insert(recoveryCredentials)
        .values({ playerId: candidate.playerId, codeHash: newCodeHash });
      const [player] = await tx.select().from(players).where(eq(players.id, candidate.playerId));
      return { player, ...(await newDevice(tx, player.id, input.deviceName)) };
    });
    writeCredential(c, 'session', result.token);
    return c.json({
      player: result.player,
      deviceId: result.deviceId,
      hasRecoveryCode: true,
      recoveryCode: formatCode(recoveryCode),
      ...(credentialMode === 'bearer' ? { sessionToken: result.token } : {}),
    });
  });

  app.post('/api/recovery/rotate', async (c) => {
    await readJson(c, emptyInput);
    const recoveryCode = randomCode(32);
    const codeHash = await hashSecret(recoveryCode);
    await withSession(c.get('db'), await sessionHash(c), async (tx, session) => {
      await tx
        .insert(recoveryCredentials)
        .values({ playerId: session.player.id, codeHash })
        .onConflictDoUpdate({ target: recoveryCredentials.playerId, set: { codeHash } });
    });
    return c.json({ recoveryCode: formatCode(recoveryCode) });
  });

  registerWeekRoutes(app);
  registerGroupRoutes(app);

  app.notFound((c) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } }, 404),
  );
  return app;
}
