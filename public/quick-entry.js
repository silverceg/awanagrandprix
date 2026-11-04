// Convert the host's shorthand into the seconds format used by the API.
// Stored three-decimal values are preserved only when they are unchanged.
export function quickTime(raw, original = '') {
  const value = String(raw ?? '').trim().toUpperCase();
  if (!value) return { ok: false, empty: true, error: '기록을 입력하세요.' };
  if (value === 'DNF') return { ok: true, value: 'DNF', label: '미완주 DNF' };
  if (value === original && /^\d{1,3}\.\d{3}$/.test(original)) {
    return { ok: true, value, label: `${value}초 · 기존 기록 유지` };
  }
  let hundredths;
  if (/^\d{1,5}$/.test(value)) {
    // One or two digits keep their familiar seconds meaning (3 => 3.00).
    // Three to five digits omit the decimal point (321 => 3.21).
    hundredths = Number(value) * (value.length < 3 ? 100 : 1);
  } else if (/^\d{1,3}\.\d{1,2}$/.test(value)) {
    const [seconds, fraction] = value.split('.');
    hundredths = Number(seconds) * 100 + Number(fraction.padEnd(2, '0'));
  } else {
    return { ok: false, error: '321 또는 3.21처럼 입력하세요. 소수점 뒤는 두 자리까지입니다.' };
  }
  if (hundredths < 1 || hundredths > 99999) {
    return { ok: false, error: '0.01초부터 999.99초까지 입력하세요. 미완주는 DNF입니다.' };
  }
  const normalized = `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
  return { ok: true, value: normalized, label: `${normalized}초` };
}
