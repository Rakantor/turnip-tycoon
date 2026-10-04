import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

// Development-only credentials. The database listens exclusively on loopback.
export const LOCAL_DATABASE_URL = 'postgresql://turnip:turnip-local-only@127.0.0.1:54329/turnip';

export async function migrateDatabase(url: string) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await migrate(drizzle(client), { migrationsFolder: resolve('drizzle') });
  } finally {
    await client.end();
  }
}

export async function startDatabase(options: {
  directory: string;
  port: number;
  persistent: boolean;
}) {
  await mkdir(options.directory, { recursive: true });
  const log: string[] = [];
  const postgres = new EmbeddedPostgres({
    databaseDir: options.directory,
    user: 'turnip',
    password: 'turnip-local-only',
    port: options.port,
    persistent: options.persistent,
    authMethod: 'scram-sha-256',
    postgresFlags: ['-h', '127.0.0.1', '-k', options.directory],
    onLog: (message) => {
      log.push(message);
    },
    onError: (error: unknown) => {
      log.push(String(error));
    },
  });
  try {
    if (!existsSync(resolve(options.directory, 'PG_VERSION'))) await postgres.initialise();
    await postgres.start();
    const client = postgres.getPgClient('postgres', '127.0.0.1');
    try {
      await client.connect();
      const result = await client.query("SELECT 1 FROM pg_database WHERE datname = 'turnip'");
      if (!result.rowCount) await client.query('CREATE DATABASE turnip');
    } finally {
      await client.end();
    }
    const url = `postgresql://turnip:turnip-local-only@127.0.0.1:${options.port}/turnip`;
    await migrateDatabase(url);
    return { url, stop: () => postgres.stop() };
  } catch (error) {
    await postgres.stop().catch(() => undefined);
    throw new Error(`Local PostgreSQL failed to start. ${log.slice(-6).join('\n')}`, {
      cause: error,
    });
  }
}
