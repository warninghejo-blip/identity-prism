import Database from 'better-sqlite3';
import { ensureAppDbDirectory, getAppDbPath, initAppDbSchema } from './dbSchema.js';

function openAppDb(dbPath = getAppDbPath()) {
  const resolvedPath = ensureAppDbDirectory(dbPath);
  const db = new Database(resolvedPath);
  initAppDbSchema(db);
  return db;
}

const APP_DB_PATH = ensureAppDbDirectory(getAppDbPath());
const appDb = openAppDb(APP_DB_PATH);

export { APP_DB_PATH, appDb, openAppDb };
