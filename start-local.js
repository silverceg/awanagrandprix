import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';

// Local-only launcher: predictable port and project-local data, without .env overrides.
const dataDir = fileURLToPath(new URL('../data', import.meta.url));
const app = createApp({ dataDir, pin: '', production: false });
app.server.once('error', async error => {
  console.error(error.code === 'EADDRINUSE' ? '3000번 포트가 사용 중입니다. 이미 실행한 어와나 창이 있는지 확인하세요.' : error.message);
  await app.close(); process.exitCode = 1;
});
app.server.listen(3000, '0.0.0.0', () => {
  console.log('\n어와나 그랑프리가 시작되었습니다. 비밀번호 없이 사용합니다.');
  console.log('\n호스트 노트북: http://localhost:3000/host');
  console.log('\nTV 노트북: 같은 공유기/Wi-Fi에 연결한 뒤 아래 주소를 여세요.');
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const a of addresses || []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) console.log(`  ${name}: http://${a.address}:3000/tv`);
  }
  console.log(`\n기록 저장 폴더: ${dataDir}`);
  console.log('경기 중에는 이 창을 열어두고 노트북 절전 모드를 꺼두세요.');
  console.log('종료: 이 창에서 Ctrl+C. 저장된 기록은 다음 실행 때 이어집니다.\n');
});
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  if (stopping) return; stopping = true;
  const timeout = setTimeout(() => process.exit(1), 9000); timeout.unref();
  await app.close(); process.exit(0);
});
