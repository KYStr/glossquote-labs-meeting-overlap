import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDraft, calculateMeetingWindows, formatClock, buildPlainTextReport } from '../public/js/core/meeting-overlap.mjs';

const I = (id, startRaw = '09:00', endRaw = '12:00') => ({ id, startRaw, endRaw });
const P = (id, nameRaw = 'Ada', intervals = [I('s1')]) => ({ id, nameRaw, intervals });
const D = (dateRaw = '2028-02-29', durationMinutesRaw = '60', participants = [P('p1'), P('p2', 'Bo')], timeBasisRaw = 'UTC+08:00') => ({ dateRaw, timeBasisRaw, durationMinutesRaw, participants });
const W = (startMinute, endMinute, durationMinutes, latestStartMinute) => ({ startMinute, endMinute, durationMinutes, latestStartMinute });
const two = (a, b, length = '60') => D('2028-02-29', length, [P('p1', 'Ada', a.map((times, i) => I(`s${i + 1}`, ...times))), P('p2', 'Bo', b.map((times, i) => I(`s${i + 1}`, ...times)))]);
const base = () => two([['09:00', '12:00']], [['10:00', '11:30']]);
const mutate = fn => { const draft = base(); fn(draft); return draft; };
const errorOracle = (code, path, participantId = null, intervalId = null) => ({ ok: false, error: { code, path, participantId, intervalId } });
const coveredCodes = new Set();
function rejected(name, draft, code, path, p = null, s = null, extra) {
  test(name, () => {
    const value = typeof draft === 'function' ? draft() : draft;
    const expected = errorOracle(code, path, p, s);
    assert.deepEqual(validateDraft(value), expected);
    assert.deepEqual(calculateMeetingWindows(value), expected);
    coveredCodes.add(code);
    extra?.();
  });
}
function accepted(name, draft, windows, extra) {
  test(name, () => {
    const value = typeof draft === 'function' ? draft() : draft;
    assert.equal(validateDraft(value).ok, true);
    assert.deepEqual(calculateMeetingWindows(value), { ok: true, value: {
      date: value.dateRaw, timeBasis: value.timeBasisRaw.trim(), meetingDurationMinutes: Number(value.durationMinutesRaw), participantCount: value.participants.length, windows,
    } });
    extra?.(value);
  });
}
const first = 'participants[0].intervals[0]';
accepted('C01 exact two-person intersection', base, [W(600, 690, 90, 630)]);
accepted('C02 overlap merges before length filtering', two([['09:00', '10:00'], ['09:30', '11:00']], [['09:00', '11:00']], '120'), [W(540, 660, 120, 540)]);
accepted('C03 adjacent availability merges', two([['09:00', '10:00'], ['10:00', '11:00']], [['09:00', '11:00']], '120'), [W(540, 660, 120, 540)]);
accepted('C04 ordered separate windows', two([['09:00', '10:00'], ['11:00', '13:00']], [['09:30', '10:00'], ['11:30', '12:30']], '30'), [W(570, 600, 30, 570), W(690, 750, 60, 720)]);
accepted('C05 exact length is included', two([['10:00', '11:00']], [['09:00', '11:00']]), [W(600, 660, 60, 600)]);
const empty = () => two([['09:00', '09:45']], [['09:00', '10:00']]);
accepted('C06 short intersection is valid empty', empty, []);
accepted('C07 touching people have no common minute', two([['09:00', '10:00']], [['10:00', '11:00']], '1'), []);
accepted('C08 every participant is required', D('2028-02-29', '45', [P('p1'), P('p2', 'Bo', [I('s2', '10:00', '12:00')]), P('p3', 'Cy', [I('s3', '10:30', '11:30')])]), [W(630, 690, 60, 645)]);
accepted('C09 end-only 24:00', two([['23:00', '24:00']], [['23:30', '24:00']], '30'), [W(1410, 1440, 30, 1410)]);
accepted('C10 full day 1440 minutes', two([['00:00', '24:00']], [['00:00', '24:00']], '1440'), [W(0, 1440, 1440, 0)]);
accepted('C11 final minute', two([['23:59', '24:00']], [['23:59', '24:00']], '1'), [W(1439, 1440, 1, 1439)]);
rejected('C12 24:00 start', () => mutate(d => d.participants[0].intervals[0].startRaw = '24:00'), 'START_TIME_RANGE', `${first}.startRaw`, 'p1', 's1');
rejected('C13 24:01 end', () => mutate(d => d.participants[0].intervals[0].endRaw = '24:01'), 'END_TIME_RANGE', `${first}.endRaw`, 'p1', 's1');
rejected('C14 equal endpoints', two([['10:00', '10:00']], [['09:00', '12:00']]), 'INTERVAL_START_NOT_BEFORE_END', first, 'p1', 's1');
rejected('C15 reversed endpoints do not cross days', two([['11:00', '10:00']], [['09:00', '12:00']]), 'INTERVAL_START_NOT_BEFORE_END', first, 'p1', 's1');
accepted('C16 Gregorian leap year', D('2024-02-29', '60', [P('p1', 'Ada', [I('s1', '09:00', '10:00')]), P('p2', 'Bo', [I('s2', '09:00', '10:00')])]), [W(540, 600, 60, 540)]);
rejected('C17 century not leap', D('1900-02-29'), 'DATE_NOT_REAL', 'dateRaw');
accepted('C18 minimum year stays literal', D('0001-01-01'), [W(540, 720, 180, 660)]);
rejected('C19 year zero', D('0000-01-01'), 'DATE_NOT_REAL', 'dateRaw');
accepted('C20 leading zeros', two([['09:00', '09:01']], [['09:00', '09:01']], '0001'), [W(540, 541, 1, 540)]);
rejected('C21 zero duration', D('2028-02-29', '0'), 'DURATION_RANGE', 'durationMinutesRaw');
rejected('C22 duration above maximum', D('2028-02-29', '1441'), 'DURATION_RANGE', 'durationMinutesRaw');
rejected('C23 decimal duration', D('2028-02-29', '1.0'), 'DURATION_FORMAT', 'durationMinutesRaw');
rejected('C24 full-width duration', D('2028-02-29', '６０'), 'DURATION_FORMAT', 'durationMinutesRaw');
accepted('C25 duplicate names at 40 codepoints', D('2028-02-29', '60', [P('p1', 'A'.repeat(40), [I('s1', '09:00', '10:00')]), P('p2', 'A'.repeat(40), [I('s1', '09:00', '10:00')])]), [W(540, 600, 60, 540)]);
rejected('C26 participant maximum enforced', D('2028-02-29', '60', Array.from({ length: 21 }, (_, i) => P(`p${i + 1}`))), 'PARTICIPANT_COUNT_HIGH', 'participants');
rejected('C27 participant minimum enforced', D('2028-02-29', '60', [P('p1')]), 'PARTICIPANT_COUNT_LOW', 'participants');
rejected('C28 no intervals', D('2028-02-29', '60', [P('p1', 'Ada', []), P('p2')]), 'INTERVAL_COUNT_LOW', 'participants[0].intervals');
rejected('C29 interval maximum enforced', D('2028-02-29', '60', [P('p1', 'Ada', Array.from({ length: 13 }, (_, i) => I(`s${i + 1}`))), P('p2')]), 'INTERVAL_COUNT_HIGH', 'participants[0].intervals');
const tiny = (n = 12) => Array.from({ length: n }, (_, i) => I(`s${i + 1}`, `00:${String(i * 2).padStart(2, '0')}`, `00:${String(i * 2 + 2).padStart(2, '0')}`));
accepted('C30 20 people and 240 intervals', D('2028-02-29', '24', Array.from({ length: 20 }, (_, i) => P(`p${i + 1}`, 'Ada', tiny()))), [W(0, 24, 24, 0)]);
rejected('C31 total limit precedes per-person limit', D('2028-02-29', '24', Array.from({ length: 20 }, (_, i) => P(`p${i + 1}`, 'Ada', tiny(i === 0 ? 13 : 12)))), 'TOTAL_INTERVALS_HIGH', 'participants');
rejected('C32 unknown root field', () => mutate(d => d.unknown = true), 'UNKNOWN_FIELD', '$');
let reads = 0;
rejected('C33 root getter never executes', () => mutate(d => Object.defineProperty(d, 'dateRaw', { enumerable: true, get() { reads++; return ''; } })), 'ACCESSOR_PROPERTY', 'dateRaw', null, null, () => assert.equal(reads, 0));
rejected('C34 participant hole', () => mutate(d => delete d.participants[1]), 'ARRAY_NOT_DENSE', 'participants[1]');
rejected('C35 missing intervals', () => mutate(d => delete d.participants[0].intervals), 'MISSING_FIELD', 'participants[0]');
rejected('C36 unpaired high surrogate', () => mutate(d => d.participants[0].nameRaw = '\uD800'), 'TEXT_UNPAIRED_SURROGATE', 'participants[0].nameRaw', 'p1');
rejected('C37 LF name', () => mutate(d => d.participants[0].nameRaw = 'A\n'), 'TEXT_CONTROL_CHARACTER', 'participants[0].nameRaw', 'p1');
rejected('C38 raw name length first', () => mutate(d => d.participants[0].nameRaw = 'A'.repeat(257)), 'RAW_TEXT_TOO_LONG', 'participants[0].nameRaw', 'p1');
rejected('C39 codepoint name maximum', () => mutate(d => d.participants[0].nameRaw = 'A'.repeat(41)), 'NAME_TOO_MANY_CODEPOINTS', 'participants[0].nameRaw', 'p1');
rejected('C40 duplicate participant identity', () => mutate(d => d.participants[1].id = 'p1'), 'DUPLICATE_PARTICIPANT_ID', 'participants[1].id');
rejected('C41 duplicate interval identity', () => mutate(d => d.participants[0].intervals.push(I('s1'))), 'DUPLICATE_INTERVAL_ID', 'participants[0].intervals[1].id', 'p1');
rejected('C42 short start format', () => mutate(d => d.participants[0].intervals[0].startRaw = '9:00'), 'START_TIME_FORMAT', `${first}.startRaw`, 'p1', 's1');
const zhReport = '會議空檔交集\n日期：2028-02-29\n共同時間基準：UTC+08:00\n會議長度：60 分鐘\n參與者：2 人\n\n可用窗口：\n1. 10:00–11:30；可用 90 分鐘；可開始 10:00–10:30；最晚開始 10:30';
const enReport = 'Meeting overlap\nDate: 2028-02-29\nShared time basis: UTC+08:00\nMeeting length: 60 minutes\nParticipants: 2\n\nAvailable windows:\n1. 10:00–11:30; 90 available minutes; starts 10:00–10:30; latest start 10:30';
const emptyReport = 'Meeting overlap\nDate: 2028-02-29\nShared time basis: UTC+08:00\nMeeting length: 60 minutes\nParticipants: 2\n\nAvailable windows:\nNo common interval fits the meeting length.';
for (const [id, input, locale, expected] of [['C43', base, 'zh-Hant', zhReport], ['C44', base, 'en', enReport], ['C45', empty, 'en', emptyReport]]) {
  test(`${id} exact UTF-8 report bytes`, () => {
    const actual = buildPlainTextReport(calculateMeetingWindows(input()).value, locale);
    assert.deepEqual(Buffer.from(actual, 'utf8'), Buffer.from(expected, 'utf8'));
    assert.equal(actual.startsWith('\uFEFF'), false); assert.equal(actual.endsWith('\n'), false); assert.equal(actual.includes('\r'), false);
  });
}
rejected('C46 null root', null, 'ROOT_NOT_PLAIN_OBJECT', '$');
rejected('C47 unknown person field', () => mutate(d => d.participants[0].unexpected = true), 'UNKNOWN_FIELD', 'participants[0]');
rejected('C48 root symbol', () => mutate(d => d[Symbol('x')] = true), 'SYMBOL_KEY', '$');
rejected('C49 non-enumerable root field', () => mutate(d => Object.defineProperty(d, 'dateRaw', { enumerable: false })), 'NON_ENUMERABLE_PROPERTY', 'dateRaw');
rejected('C50 number is not raw string', () => mutate(d => d.durationMinutesRaw = 60), 'WRONG_TYPE', 'durationMinutesRaw');
rejected('C51 extra array property', () => mutate(d => d.participants.foo = true), 'ARRAY_EXTRA_PROPERTY', 'participants');
rejected('C52 invalid person id', () => mutate(d => d.participants[0].id = 'P1'), 'INVALID_PARTICIPANT_ID', 'participants[0].id');
rejected('C53 invalid interval id', () => mutate(d => d.participants[0].intervals[0].id = 'S1'), 'INVALID_INTERVAL_ID', `${first}.id`, 'p1');
rejected('C54 empty name', () => mutate(d => d.participants[0].nameRaw = ''), 'NAME_EMPTY', 'participants[0].nameRaw', 'p1');
rejected('C55 empty time basis', () => mutate(d => d.timeBasisRaw = ''), 'TIME_BASIS_EMPTY', 'timeBasisRaw');
rejected('C56 long time basis', () => mutate(d => d.timeBasisRaw = 'A'.repeat(61)), 'TIME_BASIS_TOO_MANY_CODEPOINTS', 'timeBasisRaw');
rejected('C57 date format', D('2024-2-29'), 'DATE_FORMAT', 'dateRaw');
rejected('C58 short end format', () => mutate(d => d.participants[0].intervals[0].endRaw = '9:00'), 'END_TIME_FORMAT', `${first}.endRaw`, 'p1', 's1');
rejected('C59 full-width start', () => mutate(d => d.participants[0].intervals[0].startRaw = '０９:００'), 'START_TIME_FORMAT', `${first}.startRaw`, 'p1', 's1');
accepted('C60 supplementary codepoints preserved', () => mutate(d => d.participants.forEach(p => p.nameRaw = '🙂'.repeat(20))), [W(600, 690, 90, 630)], draft => assert.deepEqual(validateDraft(draft).value.participants.map(p => p.name), ['🙂'.repeat(20), '🙂'.repeat(20)]));
rejected('C61 interval non-record', () => mutate(d => d.participants[0].intervals[0] = 7), 'ROOT_NOT_PLAIN_OBJECT', first);
rejected('C62 interval array hole', () => mutate(d => d.participants[0].intervals.length = 2), 'ARRAY_NOT_DENSE', 'participants[0].intervals[1]');
accepted('C63 trim names and basis', () => mutate(d => { d.timeBasisRaw = ' UTC+08:00 '; d.participants[0].nameRaw = '  Ada  '; d.participants[1].nameRaw = ' Bo '; }), [W(600, 690, 90, 630)], draft => assert.deepEqual(validateDraft(draft).value.participants.map(p => p.name), ['Ada', 'Bo']));
accepted('C64 maximum year literal', D('9999-12-31'), [W(540, 720, 180, 660)]);
rejected('C65 class person with getter', () => mutate(d => { d.participants[1] = new class { extra = true; get id() { throw new Error('MUST_NOT_READ'); } }(); }), 'ROOT_NOT_PLAIN_OBJECT', 'participants[1]');
rejected('C66 root schema before date', () => mutate(d => { d.dateRaw = '2023-02-29'; d.unknown = true; }), 'UNKNOWN_FIELD', '$');
rejected('C67 date before basis', () => mutate(d => { d.dateRaw = '2023-02-29'; d.timeBasisRaw = ''; }), 'DATE_NOT_REAL', 'dateRaw');
rejected('C68 id before name', () => mutate(d => { d.participants[0].id = 'P1'; d.participants[0].nameRaw = ''; }), 'INVALID_PARTICIPANT_ID', 'participants[0].id');
rejected('C69 interval id before clock', () => mutate(d => { d.participants[0].intervals[0].id = 'S1'; d.participants[0].intervals[0].startRaw = '9:00'; }), 'INVALID_INTERVAL_ID', `${first}.id`, 'p1');
rejected('C70 nested schema before date', () => mutate(d => { d.dateRaw = '2023-02-29'; delete d.participants[0].intervals; }), 'MISSING_FIELD', 'participants[0]');
rejected('C71 raw length before controls', () => mutate(d => d.participants[0].nameRaw = 'A'.repeat(256) + '\n'), 'RAW_TEXT_TOO_LONG', 'participants[0].nameRaw', 'p1');
rejected('C72 start before end semantics', () => mutate(d => { d.participants[0].intervals[0].startRaw = '24:00'; d.participants[0].intervals[0].endRaw = '24:01'; }), 'START_TIME_RANGE', `${first}.startRaw`, 'p1', 's1');

const resourceSpy = { reads: 0 };
function sparseWithSpy(length) {
  const array = new Array(length);
  Object.defineProperty(array, '0', { enumerable: true, get() { resourceSpy.reads++; throw new Error('Resource gate must not read this getter'); } });
  return array;
}
rejected('C73 participant length resource gate before sparse/getter checks', () => D('2028-02-29', '60', sparseWithSpy(21)), 'PARTICIPANT_COUNT_HIGH', 'participants', null, null, () => assert.equal(resourceSpy.reads, 0));
rejected('C74 interval length resource gate before sparse/getter checks', () => D('2028-02-29', '60', [P('p1', 'Ada', sparseWithSpy(241)), P('p2')]), 'TOTAL_INTERVALS_HIGH', 'participants', null, null, () => assert.equal(resourceSpy.reads, 0));
rejected('C75 interval remaining budget is checked before reading its indexes', () => D('2028-02-29', '60', Array.from({ length: 20 }, (_, i) => P(`p${i + 1}`, 'Fake', i === 19 ? sparseWithSpy(13) : tiny()))), 'TOTAL_INTERVALS_HIGH', 'participants', null, null, () => assert.equal(resourceSpy.reads, 0));
accepted('C76 20 people each with 12 full-day intervals remains valid', D('2028-02-29', '60', Array.from({ length: 20 }, (_, i) => P(`p${i + 1}`, 'Fake', Array.from({ length: 12 }, (_, j) => I(`s${j + 1}`, '00:00', '24:00'))))), [W(0, 1440, 1440, 1380)]);
for (const [label, change, code] of [
  ['participants symbols/extra', d => { d.participants = sparseWithSpy(21); d.participants[Symbol('fake')] = true; d.participants.extra = true; }, 'PARTICIPANT_COUNT_HIGH'],
  ['interval symbols/extra', d => { d.participants[0].intervals = sparseWithSpy(241); d.participants[0].intervals[Symbol('fake')] = true; d.participants[0].intervals.extra = true; }, 'TOTAL_INTERVALS_HIGH'],
  ['maximum sparse participants', d => d.participants = sparseWithSpy(4294967295), 'PARTICIPANT_COUNT_HIGH'],
  ['maximum sparse intervals', d => d.participants[0].intervals = sparseWithSpy(4294967295), 'TOTAL_INTERVALS_HIGH'],
]) rejected(`B1 ${label} upper bound precedes key enumeration`, () => mutate(change), code, 'participants', null, null, () => assert.equal(resourceSpy.reads, 0));
rejected('B1 wrong array prototype precedes its excessive length', () => {
  const array = sparseWithSpy(21); Object.setPrototypeOf(array, null); return D('2028-02-29', '60', array);
}, 'WRONG_TYPE', 'participants', null, null, () => assert.equal(resourceSpy.reads, 0));
rejected('B1 full allowed budget still validates the last interval record', () => {
  const draft = D('2028-02-29', '24', Array.from({ length: 20 }, (_, i) => P(`p${i + 1}`, 'Fake', tiny())));
  Object.defineProperty(draft.participants[19].intervals[11], 'startRaw', { enumerable: true, get() { resourceSpy.reads++; return '00:22'; } });
  return draft;
}, 'ACCESSOR_PROPERTY', 'participants[19].intervals[11].startRaw', null, null, () => assert.equal(resourceSpy.reads, 0));

// Descriptor/type matrices: every record field and both array roles, without invoking accessors.
for (const [label, pick, path, keys] of [
  ['root', d => d, '$', ['dateRaw', 'timeBasisRaw', 'durationMinutesRaw', 'participants']],
  ['person', d => d.participants[0], 'participants[0]', ['id', 'nameRaw', 'intervals']],
  ['interval', d => d.participants[0].intervals[0], first, ['id', 'startRaw', 'endRaw']],
]) {
  for (const [kind, code, change] of [
    ['missing', 'MISSING_FIELD', (o, k) => delete o[k]],
    ['accessor', 'ACCESSOR_PROPERTY', (o, k) => Object.defineProperty(o, k, { get() { throw new Error('Getter invoked'); }, enumerable: true })],
    ['non-enumerable', 'NON_ENUMERABLE_PROPERTY', (o, k) => Object.defineProperty(o, k, { enumerable: false })],
    ['type', 'WRONG_TYPE', (o, k) => { o[k] = null; }],
  ]) for (const key of keys) rejected(`schema ${label}.${key} ${kind}`, () => mutate(d => change(pick(d), key)), code, kind === 'missing' ? path : path === '$' ? key : `${path}.${key}`);
  rejected(`schema ${label} symbol`, () => mutate(d => pick(d)[Symbol('fake')] = true), 'SYMBOL_KEY', path);
  rejected(`schema ${label} unknown`, () => mutate(d => pick(d)['FAKE_CANARY_UNKNOWN_KEY'] = true), 'UNKNOWN_FIELD', path);
  for (const prototype of [null, Array.prototype]) rejected(`schema ${label} prototype ${prototype === null ? 'null' : 'array'}`, () => mutate(d => Object.setPrototypeOf(pick(d), prototype)), 'ROOT_NOT_PLAIN_OBJECT', path);
}
for (const [label, pick, path] of [['participants', d => d.participants, 'participants'], ['intervals', d => d.participants[0].intervals, 'participants[0].intervals']]) {
  for (const [kind, code, change, suffix] of [
    ['symbol', 'SYMBOL_KEY', a => a[Symbol('fake')] = true, ''],
    ['extra', 'ARRAY_EXTRA_PROPERTY', a => a['01'] = true, ''],
    ['hole', 'ARRAY_NOT_DENSE', a => delete a[0], '[0]'],
    ['accessor', 'ACCESSOR_PROPERTY', a => Object.defineProperty(a, '0', { get() { throw new Error('Array getter invoked'); }, enumerable: true }), '[0]'],
    ['non-enumerable', 'NON_ENUMERABLE_PROPERTY', a => Object.defineProperty(a, '0', { enumerable: false }), '[0]'],
    ['prototype', 'WRONG_TYPE', a => Object.setPrototypeOf(a, null), ''],
  ]) rejected(`array ${label} ${kind}`, () => mutate(d => change(pick(d))), code, path + suffix);
}

for (const [key, pick, path, p, s] of [
  ['dateRaw', d => d, 'dateRaw', null, null], ['timeBasisRaw', d => d, 'timeBasisRaw', null, null], ['durationMinutesRaw', d => d, 'durationMinutesRaw', null, null],
  ['id', d => d.participants[0], 'participants[0].id', null, null], ['nameRaw', d => d.participants[0], 'participants[0].nameRaw', 'p1', null],
  ['id', d => d.participants[0].intervals[0], `${first}.id`, 'p1', null], ['startRaw', d => d.participants[0].intervals[0], `${first}.startRaw`, 'p1', 's1'], ['endRaw', d => d.participants[0].intervals[0], `${first}.endRaw`, 'p1', 's1'],
]) rejected(`raw 257 limit ${path}`, () => mutate(d => pick(d)[key] = 'X'.repeat(257)), 'RAW_TEXT_TOO_LONG', path, p, s);

for (const [key, pick, path, p] of [['timeBasisRaw', d => d, 'timeBasisRaw', null], ['nameRaw', d => d.participants[0], 'participants[0].nameRaw', 'p1']]) {
  for (const char of ['\u0000', '\u001f', '\u007f', '\u009f', '\t', '\r']) rejected(`control ${path} U+${char.charCodeAt(0).toString(16)}`, () => mutate(d => pick(d)[key] = char + 'A'), 'TEXT_CONTROL_CHARACTER', path, p);
  for (const text of ['\uDC00', 'A\uD800B', '\uD800\uD800']) rejected(`surrogate ${path} ${JSON.stringify(text)}`, () => mutate(d => pick(d)[key] = text), 'TEXT_UNPAIRED_SURROGATE', path, p);
}
for (const raw of ['', ' ', '+60', '-1', '1e2', ' 60', '60 ', '00001', '1\n']) rejected(`duration exact format ${JSON.stringify(raw)}`, D('2028-02-29', raw), 'DURATION_FORMAT', 'durationMinutesRaw');
for (const raw of ['', '2028-2-29', '２０２８-02-29', '2028-02-29 ', '10000-01-01']) rejected(`date exact format ${JSON.stringify(raw)}`, D(raw), 'DATE_FORMAT', 'dateRaw');
for (const raw of ['2023-02-29', '2100-02-29', '2028-00-01', '2028-13-01', '2028-01-00', '2028-04-31', '9999-12-32']) rejected(`date real ${raw}`, D(raw), 'DATE_NOT_REAL', 'dateRaw');
for (const [key, prefix] of [['startRaw', 'START'], ['endRaw', 'END']]) {
  for (const raw of ['', '9:00', '09:0', ' 09:00', '09:00 ', '０９:００']) rejected(`clock format ${key} ${JSON.stringify(raw)}`, () => mutate(d => d.participants[0].intervals[0][key] = raw), `${prefix}_TIME_FORMAT`, `${first}.${key}`, 'p1', 's1');
  for (const raw of ['25:00', '23:60', '99:99', '24:01']) rejected(`clock range ${key} ${raw}`, () => mutate(d => d.participants[0].intervals[0][key] = raw), `${prefix}_TIME_RANGE`, `${first}.${key}`, 'p1', 's1');
}
for (const [key, pick, path, code, p] of [['id', d => d.participants[0], 'participants[0].id', 'INVALID_PARTICIPANT_ID', null], ['id', d => d.participants[0].intervals[0], `${first}.id`, 'INVALID_INTERVAL_ID', 'p1']]) {
  for (const raw of ['', '1a', 'A', '_a', 'a b', 'a'.repeat(33), 'a\n']) rejected(`id grammar ${path} ${JSON.stringify(raw)}`, () => mutate(d => pick(d)[key] = raw), code, path, p);
  accepted(`id maximum ${path}`, () => mutate(d => pick(d)[key] = 'a'.repeat(32)), [W(600, 690, 90, 630)]);
}
accepted('name one codepoint and basis 60 supplementary codepoints', () => mutate(d => { d.participants[0].nameRaw = '🙂'; d.timeBasisRaw = '🙂'.repeat(60); }), [W(600, 690, 90, 630)]);
accepted('raw 256 units accepted when trimmed text within limits', () => mutate(d => { d.timeBasisRaw = ' '.repeat(255) + 'A'; d.participants[0].nameRaw = ' '.repeat(255) + 'A'; }), [W(600, 690, 90, 630)]);
accepted('Gregorian divisible by 400 is leap', D('2000-02-29'), [W(540, 720, 180, 660)]);
accepted('leading duration zeros normalize to 60', () => mutate(d => d.durationMinutesRaw = '0060'), [W(600, 690, 90, 630)]);
accepted('raw HTML and bidi are plain text', () => mutate(d => { d.participants[0].nameRaw = '<b>A</b>\u202E'; d.timeBasisRaw = '<img onerror=fake>'; }), [W(600, 690, 90, 630)]);

test('formatClock start/end, integer and type boundaries', () => {
  for (const [minute, boundary, expected] of [[0, 'start', '00:00'], [0, 'end', '00:00'], [1439, 'start', '23:59'], [1440, 'end', '24:00'], [1440, 'start', null], [-1, 'end', null], [1441, 'end', null], [1.5, 'start', null], ['60', 'start', null], [NaN, 'end', null], [Infinity, 'end', null], [null, 'end', null], [0, 'other', null], [0, undefined, null]]) assert.equal(formatClock(minute, boundary), expected);
});
test('normalized outputs are fresh, repeatable and input is unchanged', () => {
  const draft = base(); const original = structuredClone(draft);
  const freeze = o => { Object.freeze(o); for (const value of Object.values(o)) if (value && typeof value === 'object') freeze(value); };
  freeze(draft);
  const a = validateDraft(draft); const b = validateDraft(draft);
  assert.deepEqual(a, b); assert.notEqual(a.value, b.value); assert.notEqual(a.value.participants[0], draft.participants[0]);
  assert.deepEqual(calculateMeetingWindows(draft).value.windows, [W(600, 690, 90, 630)]);
  assert.deepEqual(draft, original);
});
test('permutation, contained interval and duplicate availability preserve intersection', () => {
  const draft = two([['11:00', '12:00'], ['09:00', '11:00'], ['09:30', '10:00']], [['10:00', '12:00'], ['10:00', '12:00']]);
  assert.deepEqual(calculateMeetingWindows(draft).value.windows, [W(600, 720, 120, 660)]);
  draft.participants.reverse(); draft.participants[1].intervals.reverse();
  assert.deepEqual(calculateMeetingWindows(draft).value.windows, [W(600, 720, 120, 660)]);
});
test('independent minute-membership oracle on bounded deterministic fixtures', () => {
  const clock = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  for (let seed = 0; seed < 30; seed++) {
    const raw = Array.from({ length: 2 + seed % 5 }, (_, p) => Array.from({ length: 1 + (seed + p) % 6 }, (_, i) => {
      const start = (seed * 37 + p * 17 + i * 101) % 1200;
      return [start, Math.min(1440, start + 1 + (seed * 53 + i * 79 + p * 97) % 240)];
    }));
    const duration = 1 + seed % 100;
    const expected = []; let begin = null;
    for (let minute = 0; minute <= 1440; minute++) {
      const available = minute < 1440 && raw.every(person => person.some(([a, b]) => a <= minute && minute < b));
      if (available && begin === null) begin = minute;
      if (!available && begin !== null) { if (minute - begin >= duration) expected.push(W(begin, minute, minute - begin, minute - duration)); begin = null; }
    }
    const draft = D('2028-02-29', String(duration), raw.map((intervals, p) => P(`p${p}`, 'Fake', intervals.map(([a, b], i) => I(`s${i}`, clock(a), clock(b))))));
    assert.deepEqual(calculateMeetingWindows(draft).value.windows, expected);
  }
});
test('empty Chinese report keeps its heading, no participant names or ids', () => {
  assert.equal(buildPlainTextReport(calculateMeetingWindows(empty()).value, 'zh-Hant'), '會議空檔交集\n日期：2028-02-29\n共同時間基準：UTC+08:00\n會議長度：60 分鐘\n參與者：2 人\n\n可用窗口：\n沒有足夠長的全員共同時段。');
  assert.equal(enReport.includes('Ada'), false);
});
test('all specified stable error codes exercised', () => {
  assert.deepEqual([...coveredCodes].sort(), ['ROOT_NOT_PLAIN_OBJECT', 'UNKNOWN_FIELD', 'MISSING_FIELD', 'SYMBOL_KEY', 'ACCESSOR_PROPERTY', 'NON_ENUMERABLE_PROPERTY', 'WRONG_TYPE', 'ARRAY_NOT_DENSE', 'ARRAY_EXTRA_PROPERTY', 'INVALID_PARTICIPANT_ID', 'DUPLICATE_PARTICIPANT_ID', 'INVALID_INTERVAL_ID', 'DUPLICATE_INTERVAL_ID', 'PARTICIPANT_COUNT_LOW', 'PARTICIPANT_COUNT_HIGH', 'TOTAL_INTERVALS_HIGH', 'INTERVAL_COUNT_LOW', 'INTERVAL_COUNT_HIGH', 'RAW_TEXT_TOO_LONG', 'TEXT_CONTROL_CHARACTER', 'TEXT_UNPAIRED_SURROGATE', 'NAME_EMPTY', 'NAME_TOO_MANY_CODEPOINTS', 'TIME_BASIS_EMPTY', 'TIME_BASIS_TOO_MANY_CODEPOINTS', 'DATE_FORMAT', 'DATE_NOT_REAL', 'DURATION_FORMAT', 'DURATION_RANGE', 'START_TIME_FORMAT', 'START_TIME_RANGE', 'END_TIME_FORMAT', 'END_TIME_RANGE', 'INTERVAL_START_NOT_BEFORE_END'].sort());
});
