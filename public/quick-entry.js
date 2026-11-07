// Numeric shorthand uses milliseconds; explicit decimal input always means seconds.
export function quickTime(raw, original = '') {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) return { ok: false, empty: true, error: '기록을 입력하세요.' };
  if (value === 'DNF') return { ok: true, value: 'DNF', label: '미완주 DNF' };
  let milliseconds;
  if (/^\d{1,6}$/.test(value)) {
    // 3 => 3.000 seconds; 321 => 0.321; 3215 => 3.215.
    milliseconds = Number(value) * (value.length < 3 ? 1000 : 1);
  } else if (/^\d{1,3}\.\d{1,3}$/.test(value)) {
    const [seconds, fraction] = value.split('.');
    milliseconds = Number(seconds) * 1000 + Number(fraction.padEnd(3, '0'));
  } else {
    return { ok: false, error: '3215 또는 3.215처럼 입력하세요. 소수점 뒤는 세 자리까지입니다.' };
  }
  if (milliseconds < 1 || milliseconds > 999999) {
    return { ok: false, error: '0.001초부터 999.999초까지 입력하세요. 미완주는 DNF입니다.' };
  }
  const normalized = `${Math.floor(milliseconds / 1000)}.${String(milliseconds % 1000).padStart(3, '0')}`;
  return { ok: true, value: normalized, label: `${normalized}초` };
}
