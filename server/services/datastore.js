import fs from 'node:fs';

const toEntryMap = (entries) => {
  if (entries instanceof Map) return new Map(entries);
  return new Map(Array.from(entries || []));
};

class DataStore {
  constructor({
    db,
    jsonPath,
    tableName,
    primaryKey,
    readJson,
    writeJson,
    listSqlEntries,
    getSqlValue,
    upsertSqlValue,
    deleteSqlValue,
    clearSql,
    countSql,
    debounceMs = 500,
    logLabel = tableName,
  }) {
    this.db = db;
    this.jsonPath = jsonPath;
    this.tableName = tableName;
    this.primaryKey = primaryKey;
    this.readJson = readJson;
    this.writeJson = writeJson;
    this.listSqlEntries = listSqlEntries;
    this.getSqlValue = getSqlValue;
    this.upsertSqlValue = upsertSqlValue;
    this.deleteSqlValue = deleteSqlValue;
    this.clearSql = clearSql;
    this.countSql = countSql;
    this.debounceMs = debounceMs;
    this.logLabel = logLabel;
    this.jsonCache = null;
    this.flushTimer = null;

    this.replaceAllTx = this.db.transaction((entries) => {
      this.clearSql();
      for (const [key, value] of entries) {
        this.upsertSqlValue(key, value);
      }
    });
    this.migrateTx = this.db.transaction((entries) => {
      for (const [key, value] of entries) {
        this.upsertSqlValue(key, value);
      }
    });
    this.setTx = this.db.transaction((key, value) => {
      this.upsertSqlValue(key, value);
    });
    this.deleteTx = this.db.transaction((key) => {
      this.deleteSqlValue(key);
    });
  }

  loadJsonEntries() {
    if (this.jsonCache) return this.jsonCache;

    const entries = new Map();
    try {
      if (!fs.existsSync(this.jsonPath)) {
        this.jsonCache = entries;
        return entries;
      }

      const raw = fs.readFileSync(this.jsonPath, 'utf8');
      if (!raw.trim()) {
        this.jsonCache = entries;
        return entries;
      }

      this.jsonCache = toEntryMap(this.readJson(JSON.parse(raw)));
      return this.jsonCache;
    } catch (error) {
      console.warn(`[${this.logLabel}] Failed to load JSON fallback`, error);
      this.jsonCache = entries;
      return entries;
    }
  }

  scheduleJsonFlush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushJson().catch((error) => {
        console.warn(`[${this.logLabel}] Failed to persist JSON fallback`, error);
      });
    }, this.debounceMs);
  }

  async flushJson() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const snapshot = new Map(this.loadJsonEntries());
    const payload = this.writeJson(snapshot);
    const tmp = `${this.jsonPath}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await fs.promises.rename(tmp, this.jsonPath);
  }

  hasRows() {
    return Number(this.countSql()) > 0;
  }

  get(key) {
    const sqlValue = this.getSqlValue(key);
    if (sqlValue !== undefined) return sqlValue;
    return this.loadJsonEntries().get(key);
  }

  set(key, value) {
    this.setTx(key, value);
    this.loadJsonEntries().set(key, value);
    this.scheduleJsonFlush();
    return value;
  }

  delete(key) {
    this.deleteTx(key);
    const deleted = this.loadJsonEntries().delete(key);
    this.scheduleJsonFlush();
    return deleted;
  }

  entries() {
    const merged = new Map(this.loadJsonEntries());
    for (const [key, value] of toEntryMap(this.listSqlEntries())) {
      merged.set(key, value);
    }
    return merged;
  }

  replaceAll(entries) {
    const nextEntries = Array.from(toEntryMap(entries).entries());
    this.replaceAllTx(nextEntries);
    this.jsonCache = new Map(nextEntries);
    this.scheduleJsonFlush();
  }

  migrateFromJson() {
    if (this.hasRows()) return { migrated: false, count: 0 };

    const entries = Array.from(this.loadJsonEntries().entries());
    if (entries.length === 0) return { migrated: false, count: 0 };

    this.migrateTx(entries);
    return { migrated: true, count: entries.length };
  }
}

export { DataStore };
