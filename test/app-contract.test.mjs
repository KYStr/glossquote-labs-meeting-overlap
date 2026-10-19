import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createMemory, transition, invalidate, isDirty, purgeMemory } from '../public/js/state.mjs';
import { COPY, errorMessage } from '../public/js/copy.mjs';

test('initial state is exact, fresh and empty in both languages', () => {
  for (const locale of ['zh-Hant', 'en']) {
    const state = createMemory(locale);
    assert.deepEqual(state, {
      draft: { dateRaw: '', timeBasisRaw: '', durationMinutesRaw: '60', participants: [
        { id: 'p1', nameRaw: '', intervals: [{ id: 's1', startRaw: '', endRaw: '' }] },
        { id: 'p2', nameRaw: '', intervals: [{ id: 's2', startRaw: '', endRaw: '' }] },
      ] }, result: null, reportText: null, locale, generation: 0, nextParticipantNumber: 3, nextIntervalNumber: 3,
    });
    assert.equal(isDirty(state), false); assert.notEqual(state.draft, createMemory(locale).draft);
  }
});
test('every field and structural edit invalidates result and report immediately', () => {
  for (const action of [
    { type: 'root', key: 'dateRaw', value: '2028-02-29' }, { type: 'root', key: 'timeBasisRaw', value: 'Fake basis' }, { type: 'root', key: 'durationMinutesRaw', value: '0060' },
    { type: 'name', participantId: 'p1', value: 'Fake' }, { type: 'interval', participantId: 'p1', intervalId: 's1', key: 'startRaw', value: '09:00' }, { type: 'interval', participantId: 'p1', intervalId: 's1', key: 'endRaw', value: '12:00' },
    { type: 'add-person' }, { type: 'remove-person', participantId: 'p3' }, { type: 'add-interval', participantId: 'p1' }, { type: 'remove-interval', participantId: 'p1', intervalId: 's3' },
  ]) {
    let state = createMemory('en');
    if (action.type === 'remove-person') state = transition(state, { type: 'add-person' });
    if (action.type === 'remove-interval') state = transition(state, { type: 'add-interval', participantId: 'p1' });
    state = { ...state, result: { fake: true }, reportText: 'FAKE_REPORT' };
    const result = transition(state, action);
    assert.equal(result.result, null); assert.equal(result.reportText, null); assert.equal(result.generation, state.generation + 1);
  }
});
test('stable ids are not reused and count boundaries are enforced in state', () => {
  let state = createMemory('en');
  assert.equal(transition(state, { type: 'remove-person', participantId: 'p1' }), state);
  assert.equal(transition(state, { type: 'remove-interval', participantId: 'p1', intervalId: 's1' }), state);
  state = transition(state, { type: 'add-person' });
  state = transition(state, { type: 'remove-person', participantId: 'p3' });
  state = transition(state, { type: 'add-person' });
  assert.equal(state.draft.participants[2].id, 'p4');
  assert.equal(state.draft.participants[2].intervals[0].id, 's4');
  while (state.draft.participants.length < 20) state = transition(state, { type: 'add-person' });
  assert.equal(transition(state, { type: 'add-person' }), state);
  for (const person of state.draft.participants) for (let i = 1; i < 12; i++) state = transition(state, { type: 'add-interval', participantId: person.id });
  assert.equal(state.draft.participants.reduce((n, p) => n + p.intervals.length, 0), 240);
  assert.equal(transition(state, { type: 'add-interval', participantId: 'p1' }), state);
});
test('dirty detection covers raw whitespace, nondefault length, structure, and result', () => {
  for (const action of [{ type: 'root', key: 'dateRaw', value: ' ' }, { type: 'root', key: 'timeBasisRaw', value: ' ' }, { type: 'root', key: 'durationMinutesRaw', value: '0060' }, { type: 'root', key: 'durationMinutesRaw', value: '' }, { type: 'name', participantId: 'p1', value: ' ' }, { type: 'interval', participantId: 'p1', intervalId: 's1', key: 'endRaw', value: ' ' }, { type: 'add-person' }, { type: 'add-interval', participantId: 'p1' }]) assert.equal(isDirty(transition(createMemory('en'), action)), true);
  assert.equal(isDirty({ ...createMemory('en'), result: { windows: [] } }), true);
});
test('purge clears previous draft/result references and advances generation; reset restores counters', () => {
  let state = transition(createMemory('en'), { type: 'name', participantId: 'p1', value: 'FAKE_NAME' });
  state.result = { date: '2028-02-29', timeBasis: 'FAKE_BASIS', windows: [{ startMinute: 600 }] }; state.reportText = 'FAKE_REPORT';
  const draft = state.draft; const result = state.result;
  const purged = purgeMemory(state);
  assert.deepEqual(draft, { dateRaw: '', timeBasisRaw: '', durationMinutesRaw: '', participants: [] });
  assert.equal(result.date, ''); assert.equal(result.timeBasis, ''); assert.deepEqual(result.windows, []);
  assert.equal(purged.result, null); assert.equal(purged.reportText, null); assert.equal(purged.generation, 2);
  const reset = createMemory('en', purged.generation);
  assert.equal(reset.nextParticipantNumber, 3); assert.equal(reset.nextIntervalNumber, 3); assert.equal(reset.draft.durationMinutesRaw, '60');
});
test('invalidation leaves original draft intact', () => {
  const state = createMemory('en'); const next = invalidate(state);
  assert.equal(next.draft, state.draft); assert.equal(next.generation, 1); assert.equal(state.generation, 0);
});
test('all stable error codes have explicit nonempty copy in both languages', async () => {
  const technical = await readFile(new URL('../TECHNICAL.md', import.meta.url), 'utf8');
  const lines = technical.split('\n').filter(line => /^- (?:結構|識別字|數量|文字及日期|數值與區間)：/.test(line));
  const codes = lines.join('\n').match(/\b[A-Z][A-Z_]+\b/g);
  assert.equal(codes.length, 34);
  for (const code of codes) for (const locale of ['zh-Hant', 'en']) { const message = errorMessage(code, locale); assert.ok(message.length > 10); if (code !== 'ROOT_NOT_PLAIN_OBJECT') assert.notEqual(message, errorMessage('unknown', locale)); }
});

// Deliberately small offline DOM test double. It executes actual app handlers but
// cannot establish browser layout, native focus, IME, AT, networking or BFCache.
class Element {
  constructor(tag, doc) { this.tagName = tag; this.owner = doc; this.children = []; this.attrs = {}; this.listeners = new Map(); this.value = ''; this.hidden = false; this.disabled = false; this._text = ''; }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(text) { this.replaceChildren(); this._text = String(text); }
  get id() { return this.attrs.id; } set id(value) { this.attrs.id = value; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  removeAttribute(key) { delete this.attrs[key]; }
  getAttribute(key) { return this.attrs[key]; }
  append(...children) { for (const child of children) { if (child.tagName === '#fragment') this.append(...[...child.children]); else { child.parentElement = this; this.children.push(child); } } }
  replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; this.append(...children); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(callback); }
  fire(type, extra = {}) { const event = { target: this, preventDefault() {}, ...extra }; for (const callback of this.listeners.get(type) ?? []) callback(event); }
  focus() { this.owner.activeElement = this; }
  get isConnected() { return this === this.owner.root || Boolean(this.parentElement?.isConnected); }
}
class OfflineDocument {
  constructor(locale) { this.documentElement = { lang: locale }; this.root = new Element('body', this); this.activeElement = this.root; }
  createElement(tag) { return new Element(tag, this); }
  createDocumentFragment() { return new Element('#fragment', this); }
  all() { const output = []; const visit = node => { output.push(node); node.children.forEach(visit); }; visit(this.root); return output; }
  getElementById(id) { return this.all().find(element => element.id === id); }
  querySelectorAll(selector) { const tags = selector.split(',').map(tag => tag.trim()); return this.all().filter(element => tags.includes(element.tagName)); }
}
async function harness(locale, run) {
  const doc = new OfflineDocument(locale);
  const html = await readFile(new URL(locale === 'en' ? '../public/en/index.html' : '../public/index.html', import.meta.url), 'utf8');
  const controls = doc.createElement('fieldset'); controls.id = 'workspace-controls'; doc.root.append(controls);
  const resultSection = doc.createElement('section'); doc.root.append(resultSection);
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\s+[^>]*?id="([^"]+)"[^>]*>/g)) {
    const [, tag, id] = match; if (id === 'workspace-controls') continue;
    const element = doc.createElement(tag); element.id = id;
    if (['date', 'time-basis', 'duration', 'participants', 'calculate', 'clear', 'add-participant'].includes(id)) controls.append(element);
    else if (['result', 'report', 'report-region', 'report-toggle', 'status'].includes(id)) resultSection.append(element);
    else doc.root.append(element);
  }
  const old = { document: globalThis.document, addEventListener: globalThis.addEventListener, location: globalThis.location };
  const events = new Map(); const navigation = [];
  globalThis.document = doc;
  globalThis.addEventListener = (name, callback) => events.set(name, callback);
  globalThis.location = { assign: path => navigation.push(path) };
  try { await import(`../public/js/app.mjs?harness=${locale}`); await run(doc, events, navigation); }
  finally { for (const key of Object.keys(old)) if (old[key] === undefined) delete globalThis[key]; else globalThis[key] = old[key]; }
}
function fill(doc) {
  const values = { date: '2028-02-29', 'time-basis': ' UTC+08:00 ', duration: '60', 'p1-name': 'Ada', 'p2-name': 'Bo', 'p1-s1-startRaw': '09:00', 'p1-s1-endRaw': '12:00', 'p2-s2-startRaw': '10:00', 'p2-s2-endRaw': '11:30' };
  for (const [id, value] of Object.entries(values)) { const input = doc.getElementById(id); input.value = value; input.fire('input'); }
}
for (const locale of ['zh-Hant', 'en']) test(`offline app handlers ${locale}: calculation, invalidation, confirmations, composition and lifecycle`, async () => harness(locale, (doc, events, navigation) => {
  const get = id => { const found = doc.getElementById(id); assert.ok(found, id); return found; };
  const click = id => { get(id).focus(); get(id).fire('click'); };
  const inputs = () => doc.querySelectorAll('input, textarea').map(input => [input.id, input.value]);
  assert.equal(get('workspace-controls').disabled, false); assert.equal(get('duration').value, '60'); assert.equal(get('date').value, '');
  assert.equal(get('p1-name').value, ''); assert.equal(get('p2-s2-startRaw').value, '');
  fill(doc); click('calculate');
  assert.match(get('result').textContent, /10:00–11:30/); assert.match(get('result').textContent, /10:30/);
  click('report-toggle'); assert.match(get('report').value, /2028-02-29/); assert.match(get('report').value, /UTC\+08:00/);
  const savedInputs = inputs(); const savedResult = get('result').textContent; const savedReport = get('report').value;
  click('clear'); assert.equal(get('confirmation').hidden, false); click('confirmation-cancel');
  assert.deepEqual(inputs(), savedInputs); assert.equal(get('result').textContent, savedResult); assert.equal(get('report').value, savedReport); assert.equal(doc.activeElement.id, 'clear');
  click('language-link'); click('confirmation-cancel');
  assert.deepEqual(inputs(), savedInputs); assert.equal(get('result').textContent, savedResult); assert.deepEqual(navigation, []); assert.equal(doc.activeElement.id, 'language-link');
  get('p2-s2-endRaw').value = '11:00'; get('p2-s2-endRaw').fire('input');
  assert.equal(get('result').hidden, true); assert.equal(get('result').textContent, ''); assert.equal(get('report').value, ''); assert.equal(get('report-region').hidden, true);
  click('calculate'); assert.match(get('result').textContent, /10:00–11:00/);
  get('date').value = '2023-02-29'; get('date').fire('input'); click('calculate');
  assert.equal(get('date').getAttribute('aria-invalid'), 'true'); assert.equal(get('date-error').hidden, false); assert.equal(doc.activeElement.id, 'date');
  get('p1-name').fire('compositionstart'); get('p1-name').value = '中文'; get('p1-name').fire('input'); get('p1-name').focus(); get('calculate').fire('click');
  assert.equal(doc.activeElement.id, 'p1-name'); assert.equal(get('p1-name').value, '中文'); get('p1-name').fire('compositionend');
  get('date').value = '2028-02-29'; get('date').fire('input'); click('calculate');
  click('add-participant'); assert.equal(doc.activeElement.id, 'p3-name'); assert.equal(get('p3-name').value, '');
  const removeP3 = doc.all().find(e => e.tagName === 'button' && e.textContent === COPY[locale].removePerson(3)); removeP3.fire('click');
  assert.equal(doc.activeElement.id, 'p2-name'); assert.equal(doc.getElementById('p3-name'), undefined);
  click('p1-add-interval'); assert.equal(doc.activeElement.id, 'p1-s4-startRaw');
  const removeFirst = doc.all().find(e => e.tagName === 'button' && e.textContent === COPY[locale].removeInterval(1, 1)); removeFirst.fire('click');
  assert.equal(doc.activeElement.id, 'p1-s4-startRaw');
  click('clear'); click('confirmation-accept');
  assert.equal(get('date').value, ''); assert.equal(get('duration').value, '60'); assert.equal(get('p1-s1-startRaw').value, ''); assert.equal(doc.activeElement.id, 'date');
  fill(doc); click('calculate'); click('report-toggle'); events.get('pagehide')({});
  assert.ok(inputs().every(([, value]) => value === '')); assert.equal(get('participants').textContent, ''); assert.equal(get('result').textContent, ''); assert.equal(get('report').value, '');
  events.get('pageshow')({ persisted: true });
  assert.equal(get('duration').value, '60'); assert.equal(get('p1-name').value, ''); assert.equal(get('p2-s2-startRaw').value, '');
  get('duration').value = '0060'; get('duration').fire('change'); click('language-link');
  assert.equal(get('confirmation').hidden, false); click('confirmation-accept');
  assert.deepEqual(navigation, [locale === 'en' ? '/index.html' : '/en/index.html']); assert.ok(inputs().every(([, value]) => value === ''));
}));
