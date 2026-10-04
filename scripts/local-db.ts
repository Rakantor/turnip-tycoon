import { resolve } from 'node:path';
import { startDatabase } from './database';

const database = await startDatabase({
  directory: resolve('.local/postgres'),
  port: 54329,
  persistent: true,
});
console.log('Local PostgreSQL is ready on 127.0.0.1:54329. Data is saved in .local/postgres.');
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await database.stop();
  process.exit(0);
};
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
