import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { createStore } from './lib/store.js';
import { RaceError, standings, formatTime } from './lib/race.js';

const root = dirname(fileURLToPath(import.meta.url));
const digest = s => createHash('sha256').update(s).digest();
const csvCell = value => {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
};
export function createApp({ dataDir = process.env.DATA_DIR || join(root, 'data'), pin = process.env.HOST_PIN, production = process.env.NODE_ENV === 'production' } = {}) {
  const passwordRequired = typeof pin === 'string' && pin.trim().length > 0;
  if (passwordRequired && (pin.length < 8 || pin === 'change-this-to-your-own-password')) throw new Error('비밀번호 없이 사용하려면 HOST_PIN을 비우거나 삭제하세요. 비밀번호를 사용할 경우 8자 이상으로 설정하세요.');
  const store = createStore(resolve(dataDir));
  const sessions = new Map(), attempts = new Map(), clients = new Set();
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  const tokenOf = req => (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('awana_session='))?.slice(14);
  function authorized(req) { if (!passwordRequired) return true; const token = tokenOf(req); return token && (sessions.get(token) || 0) > Date.now(); }
  const sessionCookie = value => `awana_session=${value}; HttpOnly; SameSite=Strict; Path=/; ${production ? 'Secure; ' : ''}`;
  function broadcast(state) {
    const message = `event: state\ndata: ${JSON.stringify(state)}\n\n`;
    for (const res of clients) { if (!res.write(message)) { res.end(); clients.delete(res); } }
  }
  const timer = setInterval(() => {
    for (const res of clients) res.write(': heartbeat\n\n');
    const now = Date.now();
    for (const [key, value] of sessions) if (value < now) sessions.delete(key);
    for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  }, 15000);
  timer.unref();
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET') {
        if (path === '/healthz') { store.read(); return json(res, 200, { ok: true }); }
        if (path === '/api/state') return json(res, 200, store.read());
        if (path === '/api/session') return json(res, 200, { authenticated: Boolean(authorized(req)), passwordRequired });
        if (path === '/api/events') {
          if (clients.size >= 100) throw new RaceError('연결 수가 많습니다. 잠시 후 새로고침하세요.', 503);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write(`event: state\ndata: ${JSON.stringify(store.read())}\n\n`);
          clients.add(res); req.on('close', () => clients.delete(res)); return;
        }
        if (['/api/audit', '/api/export', '/api/csv', '/api/reset-backup'].includes(path)) {
          if (!authorized(req)) throw new RaceError('진행자 로그인이 필요합니다.', 401);
          if (path === '/api/reset-backup') {
            const backup = store.resetBackup();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="awana-before-reset.json"' });
            res.end(backup); return;
          }
          if (path === '/api/audit') return json(res, 200, store.audit());
          const state = store.read();
          if (path === '/api/export') {
            res.setHeader('Content-Disposition', 'attachment; filename="awana-records.json"');
            return json(res, 200, store.export());
          }
          const rows = [['부문', '라운드', '상태', '순위', '차량번호', '이름', '자동차 이름', '1차(초)', '2차(초)', '최고기록(초)', '재경기(초)', '진출']];
          for (const d of Object.values(state.divisions)) for (const r of d.rounds) for (const row of standings(d, r)) {
            rows.push([d.name, r.name, r.status, row.rank, row.car, row.name, row.carName || '', ...row.times.map(formatTime), Number.isFinite(row.best) ? formatTime(row.best) : '', formatTime(row.tieBreak), r.advancedIds?.includes(row.id) ? '진출' : '']);
          }
          res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="awana-results.csv"' });
          res.end('\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n')); return;
        }
        if (/^\/media\/[a-f0-9]{64}\.jpg$/.test(path)) {
          const bytes = store.media(path);
          if (!bytes) throw new RaceError('사진을 찾을 수 없습니다.',404);
          res.writeHead(200, {'Content-Type':'image/jpeg','Cache-Control':'public, max-age=31536000, immutable'});
          res.end(Buffer.from(bytes)); return;
        }
        const assets = { '/leaderboard':'leaderboard.html', '/leaderboard.js':'leaderboard.js', '/leaderboard.css':'leaderboard.css', '/': 'host.html', '/host': 'host.html', '/tv': 'tv.html', '/host.js': 'host.js', '/tv.js': 'tv.js', '/common.js': 'common.js', '/style.css': 'style.css', '/tv.css': 'tv.css', '/fonts/Jua-Regular.ttf': 'fonts/Jua-Regular.ttf', '/fonts/LilitaOne-Regular.ttf': 'fonts/LilitaOne-Regular.ttf', '/fonts/Jua-Regular.ttf': 'fonts/Jua-Regular.ttf', '/fonts/LilitaOne-Regular.ttf': 'fonts/LilitaOne-Regular.ttf', '/race-hero.jpg': 'race-hero.jpg', '/favicon.svg': 'favicon.svg' };
        if (!Object.hasOwn(assets, path)) throw new RaceError('페이지를 찾을 수 없습니다.', 404);
        const file = assets[path], extension = file.split('.').at(-1);
        const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', jpg: 'image/jpeg', ttf: 'font/ttf', ttf: 'font/ttf' };
        res.writeHead(200, { 'Content-Type': types[extension] + '; charset=utf-8' });
        res.end(await readFile(join(root, 'public', file))); return;
      }
      if (req.method !== 'POST' || !path.startsWith('/api/')) throw new RaceError('지원하지 않는 요청입니다.', 405);
      // Browser requests must come from the same host; JSON-only bodies prevent simple cross-site form submissions.
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new RaceError('다른 사이트에서 보낸 요청을 허용하지 않습니다.', 403);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new RaceError('JSON 요청만 허용합니다.', 415);
      const chunks = []; let size = 0;
      const bodyLimit = path === '/api/restore' ? 100000000 : path === '/api/participant-update' ? 520000 : 128000;
      if (path !== '/api/login' && !authorized(req)) throw new RaceError('진행자 로그인이 필요합니다.',401);
      for await (const chunk of req) { size += chunk.length; if (size > bodyLimit) throw new RaceError('요청이 너무 큽니다.', 413); chunks.push(chunk); }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RaceError('올바르지 않은 JSON입니다.'); }
      if (!body || Array.isArray(body) || typeof body !== 'object') throw new RaceError('올바르지 않은 요청입니다.');
      if (path === '/api/login') {
        if (!passwordRequired) return json(res, 200, { ok: true });
        // Render terminates HTTPS at its proxy. Use the rightmost forwarded address for throttling.
        const ip = (production ? req.headers['x-forwarded-for']?.split(',').at(-1)?.trim() : null) || req.socket.remoteAddress;
        let attempt = attempts.get(ip);
        if (!attempt || attempt.until < Date.now()) { attempt = { count: 0, until: Date.now() + 600000 }; attempts.set(ip, attempt); }
        if (attempt.count >= 10) throw new RaceError('로그인 시도가 너무 많습니다. 10분 후 다시 시도하세요.', 429);
        if (typeof body.pin !== 'string' || !timingSafeEqual(digest(body.pin), digest(pin))) { attempt.count++; throw new RaceError('비밀번호를 확인하세요.', 401); }
        attempts.delete(ip);
        const token = randomBytes(32).toString('hex');
        sessions.set(token, Date.now() + 12 * 3600000);
        res.setHeader('Set-Cookie', sessionCookie(token) + 'Max-Age=43200');
        return json(res, 200, { ok: true });
      }
      if (!authorized(req)) throw new RaceError('진행자 로그인이 필요합니다.', 401);
      if (path === '/api/logout') { sessions.delete(tokenOf(req)); res.setHeader('Set-Cookie', sessionCookie('') + 'Max-Age=0'); return json(res, 200, { ok: true }); }
      const state = store.update(path.slice(5), body);
      broadcast(state); return json(res, 200, state);
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!(error instanceof RaceError)) console.error(error);
      json(res, error.status || 500, { error: error.status ? error.message : '서버 저장에 실패했습니다. 입력값을 보관하고 연결을 확인하세요.' });
    }
  });
  server.requestTimeout = 30000;
  return { server, store, async close() { clearInterval(timer); for (const res of clients) res.end(); await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); }); store.close(); } };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const app = createApp();
    const port = Number(process.env.PORT || 3000);
    app.server.listen(port, '0.0.0.0', () => console.log(`어와나 그랑프리: http://localhost:${port}/host | 관객: /tv`));
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { app.close().then(() => process.exit(0)); setTimeout(() => process.exit(1), 9000).unref(); });
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
