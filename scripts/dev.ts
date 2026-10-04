import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startDatabase } from './database';

const database = await startDatabase({
  directory: resolve('.local/postgres'),
  port: 54329,
  persistent: true,
});
console.log('Local PostgreSQL is ready. Starting Turnip Tycoon…');
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
  stdio: 'inherit',
  env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
});
let stopping = false;
const shutdown = async (exitCode: number) => {
  if (stopping) return;
  stopping = true;
  if (vite.exitCode === null) {
    const closed = new Promise<void>((done) => {
      vite.once('close', () => done());
    });
    vite.kill('SIGTERM');
    await closed;
  }
  await database.stop();
  process.exit(exitCode);
};
vite.on('error', (error) => {
  console.error(error);
  void shutdown(1);
});
vite.on('exit', (code) => {
  void shutdown(code ?? 0);
});
process.on('SIGINT', () => {
  void shutdown(0);
});
process.on('SIGTERM', () => {
  void shutdown(0);
});
