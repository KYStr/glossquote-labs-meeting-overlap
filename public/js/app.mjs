import { calculateMeetingWindows, formatClock, buildPlainTextReport } from './core/meeting-overlap.mjs';
import { createMemory, invalidate, isDirty, transition, purgeMemory } from './state.mjs';
import { COPY, errorMessage } from './copy.mjs';

const locale = document.documentElement.lang === 'en' ? 'en' : 'zh-Hant';
const copy = COPY[locale];
let memory = createMemory(locale);
let pendingConfirmation = null;
const composing = new Set();
const fields = new Map();
const byId = id => document.getElementById(id);
const controls = byId('workspace-controls');
const participantArea = byId('participants');
const status = byId('status');

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function writeStatus(text) { if (status.textContent !== text) status.textContent = text; }
function clearErrors() {
  for (const field of fields.values()) {
    field.input.removeAttribute('aria-invalid');
    field.error.textContent = ''; field.error.hidden = true;
  }
}
function clearResult() {
  byId('result').replaceChildren(); byId('result').hidden = true;
  byId('report').value = ''; byId('report-region').hidden = true;
  byId('report-toggle').hidden = true;
  byId('report-toggle').setAttribute('aria-expanded', 'false');
  byId('report-toggle').textContent = copy.showReport;
}
function apply(action) {
  const next = transition(memory, action);
  if (next === memory) return false;
  memory = next;
  clearResult(); clearErrors(); writeStatus(copy.stale);
  return true;
}
function track(input, update) {
  input.addEventListener('compositionstart', () => composing.add(input));
  input.addEventListener('compositionend', () => composing.delete(input));
  input.addEventListener('input', () => update(input.value));
  input.addEventListener('change', () => update(input.value));
}
function bindRoot(path, id) {
  const input = byId(id);
  fields.set(path, { input, error: byId(`${id}-error`) });
  track(input, value => apply({ type: 'root', key: path, value }));
}
function makeField(id, labelText, path, value, update, { numeric = false, help = null, description = null } = {}) {
  const wrapper = node('div', undefined, 'field');
  const label = node('label', labelText); label.htmlFor = id;
  const input = node('input');
  input.type = 'text'; input.id = id; input.value = value;
  input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 256;
  if (numeric) input.inputMode = 'numeric';
  const error = node('p', '', 'field-error'); error.id = `${id}-error`; error.hidden = true;
  const descriptions = [error.id];
  wrapper.append(label, input);
  if (help) { const hint = node('p', help, 'help'); hint.id = `${id}-help`; wrapper.append(hint); descriptions.unshift(hint.id); }
  if (description) descriptions.unshift(description);
  input.setAttribute('aria-describedby', descriptions.join(' '));
  wrapper.append(error); fields.set(path, { input, error }); track(input, update);
  return wrapper;
}
function button(label, action, disabled = false) {
  const element = node('button', label); element.type = 'button'; element.disabled = disabled;
  element.addEventListener('click', () => { if (!composing.size && !pendingConfirmation) action(); });
  return element;
}
function renderParticipants() {
  for (const path of [...fields.keys()]) if (path.startsWith('participants')) fields.delete(path);
  const total = memory.draft.participants.reduce((sum, row) => sum + row.intervals.length, 0);
  const fragment = document.createDocumentFragment();
  memory.draft.participants.forEach((person, index) => {
    const path = `participants[${index}]`;
    const group = node('fieldset', undefined, 'participant');
    const legend = node('legend', copy.person(index + 1)); group.append(legend);
    const header = node('div', undefined, 'participant-head');
    header.append(makeField(`${person.id}-name`, copy.name, `${path}.nameRaw`, person.nameRaw, value => apply({ type: 'name', participantId: person.id, value }), { help: copy.nameHelp }));
    const removePerson = button(copy.removePerson(index + 1), () => {
      if (apply({ type: 'remove-person', participantId: person.id })) {
        renderParticipants();
        const target = memory.draft.participants[Math.min(index, memory.draft.participants.length - 1)];
        (target ? byId(`${target.id}-name`) : byId('add-participant')).focus();
      }
    }, memory.draft.participants.length <= 2);
    header.append(removePerson); group.append(header);
    person.intervals.forEach((interval, intervalIndex) => {
      const intervalPath = `${path}.intervals[${intervalIndex}]`;
      const row = node('div', undefined, 'interval');
      const heading = node('h3', copy.interval(intervalIndex + 1)); heading.id = `${person.id}-${interval.id}-heading`;
      row.setAttribute('role', 'group'); row.setAttribute('aria-labelledby', heading.id); row.append(heading);
      for (const [key, title] of [['startRaw', copy.start], ['endRaw', copy.end]]) row.append(makeField(`${person.id}-${interval.id}-${key}`, title, `${intervalPath}.${key}`, interval[key], value => apply({ type: 'interval', participantId: person.id, intervalId: interval.id, key, value }), { numeric: true, description: 'interval-help' }));
      // An interval ordering error belongs to its start field and stays adjacent.
      fields.set(intervalPath, fields.get(`${intervalPath}.startRaw`));
      row.append(button(copy.removeInterval(index + 1, intervalIndex + 1), () => {
        if (apply({ type: 'remove-interval', participantId: person.id, intervalId: interval.id })) {
          renderParticipants();
          const current = memory.draft.participants.find(item => item.id === person.id);
          const target = current.intervals[Math.min(intervalIndex, current.intervals.length - 1)];
          (target ? byId(`${person.id}-${target.id}-startRaw`) : byId(`${person.id}-add-interval`)).focus();
        }
      }, person.intervals.length <= 1));
      group.append(row);
    });
    const add = button(copy.addInterval, () => {
      const id = `s${memory.nextIntervalNumber}`;
      if (apply({ type: 'add-interval', participantId: person.id })) { renderParticipants(); byId(`${person.id}-${id}-startRaw`).focus(); }
    }, person.intervals.length >= 12 || total >= 240);
    add.id = `${person.id}-add-interval`; group.append(add); fragment.append(group);
  });
  participantArea.replaceChildren(fragment);
  byId('add-participant').disabled = memory.draft.participants.length >= 20 || total >= 240;
  byId('row-count').textContent = copy.rowCount(memory.draft.participants.length, total);
}
function readDraft() {
  return {
    dateRaw: byId('date').value, timeBasisRaw: byId('time-basis').value, durationMinutesRaw: byId('duration').value,
    participants: memory.draft.participants.map(person => ({
      id: person.id, nameRaw: byId(`${person.id}-name`).value,
      intervals: person.intervals.map(interval => ({ id: interval.id, startRaw: byId(`${person.id}-${interval.id}-startRaw`).value, endRaw: byId(`${person.id}-${interval.id}-endRaw`).value })),
    })),
  };
}
function renderResult() {
  const result = memory.result;
  const area = byId('result');
  const summary = node('dl', undefined, 'result-summary');
  for (const [label, value] of [[copy.date, result.date], [copy.basis, result.timeBasis], [copy.duration, copy.minutes(result.meetingDurationMinutes)], [copy.people, copy.peopleValue(result.participantCount)], [copy.count, copy.countValue(result.windows.length)]]) {
    const entry = node('div'); entry.append(node('dt', label), node('dd', value)); summary.append(entry);
  }
  area.replaceChildren(summary);
  if (result.windows.length) {
    const list = node('ol', undefined, 'windows');
    for (const window of result.windows) {
      const start = formatClock(window.startMinute, 'start'); const end = formatClock(window.endMinute, 'end'); const latest = formatClock(window.latestStartMinute, 'start');
      const item = node('li', undefined, 'window');
      item.append(node('h3', `${start}–${end}`), node('p', copy.available(window.durationMinutes)), node('p', copy.starts(start, latest)), node('p', copy.latest(latest), 'latest'));
      list.append(item);
    }
    area.append(list);
  }
  area.hidden = false;
  writeStatus(result.windows.length ? copy.found(result.windows.length) : copy.empty);
  byId('report-toggle').hidden = false;
}
function initialize() {
  memory = createMemory(locale, memory.generation);
  byId('date').value = ''; byId('time-basis').value = ''; byId('duration').value = '60';
  clearResult(); clearErrors(); renderParticipants();
  byId('confirmation').hidden = true; pendingConfirmation = null; composing.clear();
  controls.disabled = false; byId('result').parentElement.inert = false;
  byId('language-link').removeAttribute('aria-disabled');
  byId('initialization').hidden = true; writeStatus(copy.initial);
}
function purge() {
  for (const input of document.querySelectorAll('input, textarea')) input.value = '';
  memory = purgeMemory(memory);
  clearErrors(); clearResult(); participantArea.replaceChildren();
  for (const path of [...fields.keys()]) if (path.startsWith('participants')) fields.delete(path);
  byId('row-count').textContent = ''; byId('confirmation').hidden = true;
  byId('confirmation-title').textContent = ''; byId('confirmation-description').textContent = '';
  pendingConfirmation = null; composing.clear(); controls.disabled = true;
  writeStatus(copy.initial);
}
function showConfirmation(kind) {
  if (composing.size || pendingConfirmation) return;
  pendingConfirmation = { kind, origin: document.activeElement };
  byId('confirmation-title').textContent = kind === 'clear' ? copy.clearTitle : copy.languageTitle;
  byId('confirmation-description').textContent = kind === 'clear' ? copy.clearDescription : copy.languageDescription;
  byId('confirmation-accept').textContent = kind === 'clear' ? copy.clearAccept : copy.languageAccept;
  controls.disabled = true; byId('result').parentElement.inert = true;
  byId('language-link').setAttribute('aria-disabled', 'true');
  byId('confirmation').hidden = false; byId('confirmation-cancel').focus();
}
function cancelConfirmation() {
  if (!pendingConfirmation) return;
  const origin = pendingConfirmation.origin;
  pendingConfirmation = null; byId('confirmation').hidden = true;
  controls.disabled = false; byId('result').parentElement.inert = false;
  byId('language-link').removeAttribute('aria-disabled');
  if (origin?.isConnected) origin.focus();
}
function navigateLanguage() {
  purge();
  globalThis.location.assign(locale === 'zh-Hant' ? '/en/index.html' : '/index.html');
}

bindRoot('dateRaw', 'date'); bindRoot('timeBasisRaw', 'time-basis'); bindRoot('durationMinutesRaw', 'duration');
byId('add-participant').addEventListener('click', () => {
  if (composing.size || pendingConfirmation) return;
  const id = `p${memory.nextParticipantNumber}`;
  if (apply({ type: 'add-person' })) { renderParticipants(); byId(`${id}-name`).focus(); }
});
byId('calculate').addEventListener('click', () => {
  if (pendingConfirmation) return;
  if (composing.size) { writeStatus(copy.composing); return; }
  memory = { ...invalidate(memory), draft: readDraft() };
  clearResult(); clearErrors();
  const calculated = calculateMeetingWindows(memory.draft);
  if (calculated.ok) { memory.result = calculated.value; renderResult(); }
  else {
    const message = errorMessage(calculated.error.code, locale);
    const field = fields.get(calculated.error.path);
    if (field) { field.error.textContent = message; field.error.hidden = false; field.input.setAttribute('aria-invalid', 'true'); writeStatus(copy.error); field.input.focus(); }
    else { writeStatus(message); byId('clear').focus(); }
  }
});
byId('report-toggle').addEventListener('click', () => {
  if (!memory.result || pendingConfirmation) return;
  const show = byId('report-region').hidden;
  if (show) { memory.reportText = buildPlainTextReport(memory.result, locale); byId('report').value = memory.reportText; }
  else { memory.reportText = null; byId('report').value = ''; }
  byId('report-region').hidden = !show;
  byId('report-toggle').setAttribute('aria-expanded', String(show));
  byId('report-toggle').textContent = show ? copy.hideReport : copy.showReport;
});
byId('clear').addEventListener('click', () => showConfirmation('clear'));
byId('language-link').addEventListener('click', event => {
  event.preventDefault();
  if (pendingConfirmation || composing.size) return;
  // Read current controls before deciding, including any browser-restored values.
  memory.draft = readDraft();
  if (isDirty(memory)) showConfirmation('language'); else navigateLanguage();
});
byId('confirmation-cancel').addEventListener('click', cancelConfirmation);
byId('confirmation-accept').addEventListener('click', () => {
  if (!pendingConfirmation) return;
  if (pendingConfirmation.kind === 'language') navigateLanguage();
  else { purge(); initialize(); byId('date').focus(); }
});
byId('confirmation').addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); cancelConfirmation(); } });
globalThis.addEventListener('pagehide', purge);
globalThis.addEventListener('pageshow', event => { if (event.persisted === true) { purge(); initialize(); } });
initialize();
