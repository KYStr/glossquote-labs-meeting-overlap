const ROOT = [['dateRaw', 'string'], ['timeBasisRaw', 'string'], ['durationMinutesRaw', 'string'], ['participants', 'array']];
const PERSON = [['id', 'string'], ['nameRaw', 'string'], ['intervals', 'array']];
const INTERVAL = [['id', 'string'], ['startRaw', 'string'], ['endRaw', 'string']];
const ID = /^[a-z][a-z0-9_-]{0,31}$/;

function error(code, path, participantId = null, intervalId = null) {
  return { ok: false, error: { code, path, participantId, intervalId } };
}
function fieldPath(path, key) { return path === '$' ? key : `${path}.${key}`; }

// Callers supply ordinary app-created data. This does not attempt to identify Proxies.
function record(input, schema, path) {
  if (input === null || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) return error('ROOT_NOT_PLAIN_OBJECT', path);
  const keys = Object.getOwnPropertyNames(input);
  if (keys.some(key => !schema.some(([name]) => key === name))) return error('UNKNOWN_FIELD', path);
  if (schema.some(([key]) => !Object.hasOwn(input, key))) return error('MISSING_FIELD', path);
  if (Object.getOwnPropertySymbols(input).length) return error('SYMBOL_KEY', path);
  const value = {};
  for (const [key, type] of schema) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    const at = fieldPath(path, key);
    if (!Object.hasOwn(descriptor, 'value')) return error('ACCESSOR_PROPERTY', at);
    if (!descriptor.enumerable) return error('NON_ENUMERABLE_PROPERTY', at);
    if (type === 'string' ? typeof descriptor.value !== 'string' : !Array.isArray(descriptor.value)) return error('WRONG_TYPE', at);
    value[key] = descriptor.value;
  }
  return { ok: true, value };
}

function denseArray(input, path, maximum, limitCode) {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype) return error('WRONG_TYPE', path);
  const length = Object.getOwnPropertyDescriptor(input, 'length').value;
  // The resource gate precedes all own-key/index enumeration and element reads.
  if (length > maximum) return error(limitCode, 'participants');
  if (Object.getOwnPropertySymbols(input).length) return error('SYMBOL_KEY', path);
  for (const key of Object.getOwnPropertyNames(input)) {
    if (key !== 'length' && (!/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= length || String(Number(key)) !== key)) return error('ARRAY_EXTRA_PROPERTY', path);
  }
  for (let i = 0; i < length; i++) if (!Object.hasOwn(input, i)) return error('ARRAY_NOT_DENSE', `${path}[${i}]`);
  const value = [];
  for (let i = 0; i < length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
    if (!Object.hasOwn(descriptor, 'value')) return error('ACCESSOR_PROPERTY', `${path}[${i}]`);
    if (!descriptor.enumerable) return error('NON_ENUMERABLE_PROPERTY', `${path}[${i}]`);
    value.push(descriptor.value);
  }
  return { ok: true, value };
}

function rawLimit(value, path, participantId = null, intervalId = null) {
  return value.length > 256 ? error('RAW_TEXT_TOO_LONG', path, participantId, intervalId) : null;
}
function plainText(raw, path, kind, maximum, participantId = null) {
  const tooLong = rawLimit(raw, path, participantId);
  if (tooLong) return tooLong;
  for (let i = 0; i < raw.length; i++) {
    const unit = raw.charCodeAt(i);
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = raw.charCodeAt(++i);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return error('TEXT_UNPAIRED_SURROGATE', path, participantId);
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) return error('TEXT_UNPAIRED_SURROGATE', path, participantId);
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) return error('TEXT_CONTROL_CHARACTER', path, participantId);
  const value = raw.trim();
  const size = Array.from(value).length;
  if (size === 0) return error(`${kind}_EMPTY`, path, participantId);
  if (size > maximum) return error(`${kind}_TOO_MANY_CODEPOINTS`, path, participantId);
  return { ok: true, value };
}
function dateValue(raw) {
  const tooLong = rawLimit(raw, 'dateRaw');
  if (tooLong) return tooLong;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(raw)) return error('DATE_FORMAT', 'dateRaw');
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(5, 7));
  const day = Number(raw.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > lengths[month - 1]) return error('DATE_NOT_REAL', 'dateRaw');
  return { ok: true, value: raw };
}
function durationValue(raw) {
  const tooLong = rawLimit(raw, 'durationMinutesRaw');
  if (tooLong) return tooLong;
  if (!/^[0-9]{1,4}$/.test(raw)) return error('DURATION_FORMAT', 'durationMinutesRaw');
  const value = Number(raw);
  return value < 1 || value > 1440 ? error('DURATION_RANGE', 'durationMinutesRaw') : { ok: true, value };
}
function clockValue(raw, boundary, path, participantId, intervalId) {
  const tooLong = rawLimit(raw, path, participantId, intervalId);
  if (tooLong) return tooLong;
  const prefix = boundary === 'start' ? 'START' : 'END';
  if (!/^[0-9]{2}:[0-9]{2}$/.test(raw)) return error(`${prefix}_TIME_FORMAT`, path, participantId, intervalId);
  const hour = Number(raw.slice(0, 2));
  const minute = Number(raw.slice(3));
  if (minute > 59 || hour > 23 && !(boundary === 'end' && hour === 24 && minute === 0)) return error(`${prefix}_TIME_RANGE`, path, participantId, intervalId);
  return { ok: true, value: hour * 60 + minute };
}

export function validateDraft(input) {
  const root = record(input, ROOT, '$');
  if (!root.ok) return root;
  const people = denseArray(root.value.participants, 'participants', 20, 'PARTICIPANT_COUNT_HIGH');
  if (!people.ok) return people;
  if (people.value.length < 2) return error('PARTICIPANT_COUNT_LOW', 'participants');
  if (people.value.length > 20) return error('PARTICIPANT_COUNT_HIGH', 'participants');
  const rows = [];
  let total = 0;
  for (let i = 0; i < people.value.length; i++) {
    const path = `participants[${i}]`;
    const person = record(people.value[i], PERSON, path);
    if (!person.ok) return person;
    const intervals = denseArray(person.value.intervals, `${path}.intervals`, 240 - total, 'TOTAL_INTERVALS_HIGH');
    if (!intervals.ok) return intervals;
    const values = [];
    for (let j = 0; j < intervals.value.length; j++) {
      const item = record(intervals.value[j], INTERVAL, `${path}.intervals[${j}]`);
      if (!item.ok) return item;
      values.push(item.value);
    }
    total += values.length;
    rows.push({ ...person.value, intervals: values });
  }
  if (total > 240) return error('TOTAL_INTERVALS_HIGH', 'participants');
  for (let i = 0; i < rows.length; i++) {
    const count = rows[i].intervals.length;
    if (count < 1) return error('INTERVAL_COUNT_LOW', `participants[${i}].intervals`);
    if (count > 12) return error('INTERVAL_COUNT_HIGH', `participants[${i}].intervals`);
  }
  const personIDs = new Set();
  for (let i = 0; i < rows.length; i++) {
    const { id } = rows[i];
    const at = `participants[${i}].id`;
    const tooLong = rawLimit(id, at);
    if (tooLong) return tooLong;
    if (!ID.test(id)) return error('INVALID_PARTICIPANT_ID', at);
    if (personIDs.has(id)) return error('DUPLICATE_PARTICIPANT_ID', at);
    personIDs.add(id);
  }
  for (let i = 0; i < rows.length; i++) {
    const seen = new Set();
    for (let j = 0; j < rows[i].intervals.length; j++) {
      const { id } = rows[i].intervals[j];
      const at = `participants[${i}].intervals[${j}].id`;
      const tooLong = rawLimit(id, at, rows[i].id);
      if (tooLong) return tooLong;
      if (!ID.test(id)) return error('INVALID_INTERVAL_ID', at, rows[i].id);
      if (seen.has(id)) return error('DUPLICATE_INTERVAL_ID', at, rows[i].id);
      seen.add(id);
    }
  }
  const date = dateValue(root.value.dateRaw);
  if (!date.ok) return date;
  const basis = plainText(root.value.timeBasisRaw, 'timeBasisRaw', 'TIME_BASIS', 60);
  if (!basis.ok) return basis;
  const duration = durationValue(root.value.durationMinutesRaw);
  if (!duration.ok) return duration;
  const normalized = { date: date.value, timeBasis: basis.value, meetingDurationMinutes: duration.value, participants: [] };
  for (let i = 0; i < rows.length; i++) {
    const name = plainText(rows[i].nameRaw, `participants[${i}].nameRaw`, 'NAME', 40, rows[i].id);
    if (!name.ok) return name;
    normalized.participants.push({ id: rows[i].id, name: name.value, intervals: [] });
  }
  for (let i = 0; i < rows.length; i++) {
    for (let j = 0; j < rows[i].intervals.length; j++) {
      const item = rows[i].intervals[j];
      const at = `participants[${i}].intervals[${j}]`;
      const start = clockValue(item.startRaw, 'start', `${at}.startRaw`, rows[i].id, item.id);
      if (!start.ok) return start;
      const end = clockValue(item.endRaw, 'end', `${at}.endRaw`, rows[i].id, item.id);
      if (!end.ok) return end;
      if (start.value >= end.value) return error('INTERVAL_START_NOT_BEFORE_END', at, rows[i].id, item.id);
      normalized.participants[i].intervals.push({ id: item.id, startMinute: start.value, endMinute: end.value });
    }
  }
  return { ok: true, value: normalized };
}

function mergeIntervals(intervals) {
  const sorted = intervals.map(({ startMinute, endMinute }) => ({ startMinute, endMinute })).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  const merged = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.startMinute <= last.endMinute) last.endMinute = Math.max(last.endMinute, interval.endMinute);
    else merged.push(interval);
  }
  return merged;
}
function intersect(left, right) {
  const result = [];
  let a = 0;
  let b = 0;
  while (a < left.length && b < right.length) {
    const startMinute = Math.max(left[a].startMinute, right[b].startMinute);
    const endMinute = Math.min(left[a].endMinute, right[b].endMinute);
    if (startMinute < endMinute) result.push({ startMinute, endMinute });
    const leftEnd = left[a].endMinute;
    const rightEnd = right[b].endMinute;
    if (leftEnd <= rightEnd) a++;
    if (rightEnd <= leftEnd) b++;
  }
  return mergeIntervals(result);
}

export function calculateMeetingWindows(input) {
  const checked = validateDraft(input);
  if (!checked.ok) return checked;
  const normalized = checked.value;
  let common = mergeIntervals(normalized.participants[0].intervals);
  for (let i = 1; i < normalized.participants.length; i++) common = intersect(common, mergeIntervals(normalized.participants[i].intervals));
  const windows = common.filter(window => window.endMinute - window.startMinute >= normalized.meetingDurationMinutes).map(window => ({
    ...window,
    durationMinutes: window.endMinute - window.startMinute,
    latestStartMinute: window.endMinute - normalized.meetingDurationMinutes,
  }));
  return { ok: true, value: { date: normalized.date, timeBasis: normalized.timeBasis, meetingDurationMinutes: normalized.meetingDurationMinutes, participantCount: normalized.participants.length, windows } };
}

export function formatClock(minute, boundary) {
  if (!['start', 'end'].includes(boundary) || !Number.isInteger(minute) || minute < 0 || minute > (boundary === 'end' ? 1440 : 1439)) return null;
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function buildPlainTextReport(result, locale) {
  const zh = locale === 'zh-Hant';
  const lines = zh ? [
    '會議空檔交集', `日期：${result.date}`, `共同時間基準：${result.timeBasis}`,
    `會議長度：${result.meetingDurationMinutes} 分鐘`, `參與者：${result.participantCount} 人`, '', '可用窗口：',
  ] : [
    'Meeting overlap', `Date: ${result.date}`, `Shared time basis: ${result.timeBasis}`,
    `Meeting length: ${result.meetingDurationMinutes} minutes`, `Participants: ${result.participantCount}`, '', 'Available windows:',
  ];
  if (!result.windows.length) lines.push(zh ? '沒有足夠長的全員共同時段。' : 'No common interval fits the meeting length.');
  for (let i = 0; i < result.windows.length; i++) {
    const window = result.windows[i];
    const start = formatClock(window.startMinute, 'start');
    const end = formatClock(window.endMinute, 'end');
    const latest = formatClock(window.latestStartMinute, 'start');
    lines.push(zh
      ? `${i + 1}. ${start}–${end}；可用 ${window.durationMinutes} 分鐘；可開始 ${start}–${latest}；最晚開始 ${latest}`
      : `${i + 1}. ${start}–${end}; ${window.durationMinutes} available minutes; starts ${start}–${latest}; latest start ${latest}`);
  }
  return lines.join('\n');
}
