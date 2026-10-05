import 'dotenv/config';
import { LOCAL_DATABASE_URL, migrateDatabase } from './database';

const url = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL;
await migrateDatabase(url);
console.log(`Database migrations applied to ${new URL(url).host}.`);
