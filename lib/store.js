import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { freshState, mutate, RaceError } from './race.js';

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'awana.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS event (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (revision INTEGER PRIMARY KEY, at TEXT NOT NULL, json TEXT NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO event(id,json) VALUES (1,?)').run(JSON.stringify(freshState()));
  function read() { return JSON.parse(db.prepare('SELECT json FROM event WHERE id=1').get().json); }
  if (read().schema !== 1) throw new Error('지원하지 않는 데이터 버전입니다.');
  return { db, read,
    audit: () => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all(),
    update(action, body) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const state = read();
        if (!Number.isInteger(body.revision) || body.revision !== state.revision) throw new RaceError('다른 화면에서 내용이 변경되었습니다. 새로고침 후 다시 입력하세요.', 409);
        const before = JSON.stringify(state);
        mutate(state, action, body);
        state.revision++; state.updatedAt = new Date().toISOString();
        db.prepare('INSERT INTO snapshots(revision,at,json) VALUES (?,?,?)').run(state.revision - 1, state.updatedAt, before);
        db.prepare('UPDATE event SET json=? WHERE id=1').run(JSON.stringify(state));
        db.prepare('INSERT INTO audit(at,action,detail) VALUES (?,?,?)').run(state.updatedAt, action, JSON.stringify(body));
        db.exec('COMMIT');
        return state;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }, close: () => db.close()
  };
}
