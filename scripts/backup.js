import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const source = resolve(process.env.DATA_DIR || './data', 'awana.sqlite');
if (!existsSync(source)) throw new Error('경기 DB가 없습니다. 서버를 먼저 실행하세요.');
const folder = resolve('./backups');
mkdirSync(folder, { recursive: true });
const target = join(folder, `awana-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
const db = new DatabaseSync(source);
await backup(db, target);
db.close();
console.log(`백업 완료: ${target}`);
