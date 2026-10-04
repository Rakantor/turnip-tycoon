import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from './schema';

// Hyperdrive pools upstream connections. Clients stay scoped to one request.
export async function connectDatabase(connectionString: string) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
  // pg can emit an error between queries rather than rejecting a query promise.
  client.on('error', (error) => {
    console.error(JSON.stringify({ event: 'database_connection_error', name: error.name }));
  });
  try {
    await client.connect();
  } catch (error) {
    await client.end();
    throw error;
  }
  return { client, db: drizzle(client, { schema }) };
}

export type Database = Awaited<ReturnType<typeof connectDatabase>>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export function transaction<T>(db: Database, work: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // Hyperdrive pools by transaction: these limits must be set inside each one.
    await tx.execute(sql`set local statement_timeout = '10s'`);
    await tx.execute(sql`set local lock_timeout = '5s'`);
    return work(tx);
  });
}
