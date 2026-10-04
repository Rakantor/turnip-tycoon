import 'dotenv/config';
import { LOCAL_DATABASE_URL, migrateDatabase } from './database';

await migrateDatabase(process.env.DATABASE_URL ?? LOCAL_DATABASE_URL);
console.log('Database migrations applied.');
