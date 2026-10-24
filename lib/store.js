import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { freshState, mutate, RaceError } from './race.js';
import { validateBackup, mediaPath } from './restore.js';

export function createStore(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'awana.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS event (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots (revision INTEGER PRIMARY KEY, at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS media (path TEXT PRIMARY KEY, data BLOB NOT NULL);`);
  db.prepare('INSERT OR IGNORE INTO event(id,json) VALUES (1,?)').run(JSON.stringify(freshState()));
  function read() { return JSON.parse(db.prepare('SELECT json FROM event WHERE id=1').get().json); }
  function saveImage(data) {
    if (typeof data !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length > 250000) throw new RaceError('사진을 다시 선택하세요. 저장용 사진은 JPEG 180KB 이하여야 합니다.');
    const bytes = Buffer.from(data.split(',')[1], 'base64');
    if (bytes.length > 180000 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[bytes.length-2] !== 255 || bytes[bytes.length-1] !== 217) throw new RaceError('올바른 JPEG 사진이 아닙니다.');
    const path = '/media/' + createHash('sha256').update(bytes).digest('hex') + '.jpg';
    db.prepare('INSERT OR IGNORE INTO media(path,data) VALUES (?,?)').run(path,bytes);
    return path;
  }
  function exportState(state = read()) {
    const paths = new Set(Object.values(state.divisions).flatMap(d=>d.participants.flatMap(p=>[p.photoUrl,p.carPhotoUrl].filter(Boolean))));
    const images = {};
    for (const path of paths) {
      const row = db.prepare('SELECT data FROM media WHERE path=?').get(path);
      if (!row) throw new RaceError('사진 파일을 찾을 수 없어 백업하지 못했습니다.');
      images[path] = 'data:image/jpeg;base64,' + Buffer.from(row.data).toString('base64');
    }
    return {exportedAt:new Date().toISOString(),state,images};
  }
  if (read().schema !== 1) throw new Error('지원하지 않는 데이터 버전입니다.');
  return { db, read, export: exportState,
    media: path => db.prepare('SELECT data FROM media WHERE path=?').get(path)?.data,
    resetBackup() {
      const file = read().lastReset?.backupFile;
      if (!file || !/^before-reset-[0-9a-f-]+\.json$/.test(file)) throw new RaceError('초기화 백업이 없습니다.', 404);
      return readFileSync(join(dir, 'rehearsal-backups', file), 'utf8');
    },
    audit: () => db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 200').all(),
    update(action, body) {
      db.exec('BEGIN IMMEDIATE');
      try {
        let state = read();
        if (!Number.isInteger(body.revision) || body.revision !== state.revision) throw new RaceError('다른 화면에서 내용이 변경되었습니다. 새로고침 후 다시 입력하세요.', 409);
        const before = JSON.stringify(state);
        let detail = {...body};
        if (action === 'restore') {
          if (body.confirmation !== '백업 복원') throw new RaceError('확인란에 백업 복원을 정확히 입력하세요.');
          const restored = validateBackup(body.backup);
          const images = body.backup.images ?? {};
          if (!images || typeof images !== 'object' || Array.isArray(images) || Object.keys(images).length > 400) throw new RaceError('사진 백업이 올바르지 않습니다.');
          for (const [path,data] of Object.entries(images)) if (!mediaPath.test(path) || saveImage(data) !== path) throw new RaceError('사진 백업이 손상되었습니다.');
          for (const d of Object.values(restored.divisions)) for (const p of d.participants) for (const field of ['photoUrl','carPhotoUrl']) if (p[field] && !db.prepare('SELECT path FROM media WHERE path=?').get(p[field])) throw new RaceError('백업에 필요한 사진이 빠져 있습니다.');
          restored.revision = state.revision;
          state = restored;
          detail = {revision:body.revision,restoredParticipants:Object.values(state.divisions).reduce((n,d)=>n+d.participants.length,0)};
        } else {
          if (action === 'participant-update') {
            detail = {...body};
            for (const [input,field] of [['photoData','photoUrl'],['carPhotoData','carPhotoUrl']]) if (Object.hasOwn(body,input)) {
              detail[field] = body[input] === '' ? '' : saveImage(body[input]);
              delete detail[input];
            }
            for (const field of ['photoUrl','carPhotoUrl']) if (detail[field] && !db.prepare('SELECT path FROM media WHERE path=?').get(detail[field])) throw new RaceError('저장된 사진을 찾을 수 없습니다.');
          }
          mutate(state, action, detail);
        }
        if (action === 'reset-records' || action === 'restore' || action === 'four-lane-reset' || action === 'round-robin-order') {
          const folder = join(dir, 'rehearsal-backups');
          const backupFile = `before-reset-${randomUUID()}.json`;
          mkdirSync(folder, { recursive: true });
          // If backup creation fails, the transaction rolls back and no records are cleared.
          writeFileSync(join(folder, backupFile), JSON.stringify(exportState(JSON.parse(before)), null, 2), { encoding: 'utf8', flag: 'wx' });
          state.lastReset = { at: new Date().toISOString(), backupFile };
        }
        state.revision++; state.updatedAt = new Date().toISOString();
        db.prepare('INSERT INTO snapshots(revision,at,json) VALUES (?,?,?)').run(state.revision - 1, state.updatedAt, before);
        db.prepare('UPDATE event SET json=? WHERE id=1').run(JSON.stringify(state));
        db.prepare('INSERT INTO audit(at,action,detail) VALUES (?,?,?)').run(state.updatedAt, action, JSON.stringify(detail));
        db.exec('COMMIT');
        return state;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    }, close: () => db.close()
  };
}
