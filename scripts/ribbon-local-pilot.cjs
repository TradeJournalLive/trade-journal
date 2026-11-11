// Isolated pilot. Not imported by the production host or webhook.
const { DatabaseSync } = require('node:sqlite');
const { isDeepStrictEqual } = require('node:util');

class RibbonLocalPilot {
  constructor(file, initialState) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inbox(seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, body TEXT NOT NULL, processed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, body TEXT NOT NULL, sent INTEGER NOT NULL DEFAULT 0);
    `);
    this.db.prepare('INSERT OR IGNORE INTO state VALUES (1,0,?)').run(JSON.stringify(initialState));
  }

  receive(signal) {
    if (signal.strategyId !== 'nifty_ribbon_test_3m_v1' || !signal.id) throw Error('Invalid Ribbon signal');
    const inserted = this.db.prepare('INSERT OR IGNORE INTO inbox(id,body) VALUES (?,?)').run(signal.id, JSON.stringify(signal));
    if (!inserted.changes) {
      const previous = this.db.prepare('SELECT body FROM inbox WHERE id=?').get(signal.id);
      if (!isDeepStrictEqual(JSON.parse(previous.body), signal)) throw Error('Conflicting Ribbon signal');
    }
    return Boolean(inserted.changes);
  }

  read() {
    const row = this.db.prepare('SELECT revision,body FROM state WHERE id=1').get();
    return { revision: row.revision, state: JSON.parse(row.body) };
  }

  // The writer lock covers selection, strategy evaluation, and the durable commit.
  // Reducers must be synchronous and have no external side effects.
  advance(expectedRevision, reduce, { signal = false } = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.read();
      if (current.revision !== expectedRevision) throw Error('Stale Ribbon writer');
      const row = signal && this.db.prepare('SELECT id,body FROM inbox WHERE processed=0 ORDER BY seq LIMIT 1').get();
      if (signal && !row) { this.db.exec('COMMIT'); return null; }
      const next = reduce(current.state, row ? JSON.parse(row.body) : null);
      this.db.prepare('UPDATE state SET revision=revision+1, body=? WHERE id=1').run(JSON.stringify(next.state));
      for (const record of next.records) {
        const inserted = this.db.prepare('INSERT OR IGNORE INTO outbox(id,body) VALUES (?,?)').run(record.id, JSON.stringify(record));
        if (!inserted.changes && !isDeepStrictEqual(JSON.parse(this.db.prepare('SELECT body FROM outbox WHERE id=?').get(record.id).body), record)) {
          throw Error('Conflicting Ribbon outbox record');
        }
      }
      if (row) this.db.prepare('UPDATE inbox SET processed=1 WHERE id=?').run(row.id);
      this.db.exec('COMMIT');
      return this.read();
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async flush(transport) {
    const records = this.db.prepare('SELECT id,body FROM outbox WHERE sent=0 ORDER BY seq LIMIT 50').all();
    if (!records.length) return 0;
    // The remote transport must upsert and verify immutable IDs before returning.
    await transport(records.map(row => JSON.parse(row.body)));
    const acknowledge = this.db.prepare('UPDATE outbox SET sent=1 WHERE id=?');
    for (const row of records) acknowledge.run(row.id);
    return records.length;
  }

  close() { this.db.close(); }
}

module.exports = { RibbonLocalPilot };
