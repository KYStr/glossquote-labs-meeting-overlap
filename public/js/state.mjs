export function createMemory(locale, generation = 0) {
  return {
    draft: {
      dateRaw: '', timeBasisRaw: '', durationMinutesRaw: '60',
      participants: [
        { id: 'p1', nameRaw: '', intervals: [{ id: 's1', startRaw: '', endRaw: '' }] },
        { id: 'p2', nameRaw: '', intervals: [{ id: 's2', startRaw: '', endRaw: '' }] },
      ],
    },
    result: null, reportText: null, locale, generation,
    nextParticipantNumber: 3, nextIntervalNumber: 3,
  };
}
export function invalidate(memory) {
  return { ...memory, result: null, reportText: null, generation: memory.generation + 1 };
}
export function isDirty(memory) {
  const draft = memory.draft;
  return memory.result !== null || draft.dateRaw !== '' || draft.timeBasisRaw !== '' || draft.durationMinutesRaw !== '60'
    || draft.participants.length !== 2 || draft.participants.some(person => person.nameRaw !== '' || person.intervals.length !== 1 || person.intervals.some(interval => interval.startRaw !== '' || interval.endRaw !== ''));
}
export function transition(memory, action) {
  const draft = memory.draft;
  const index = draft.participants.findIndex(person => person.id === action.participantId);
  const person = draft.participants[index];
  const total = draft.participants.reduce((sum, row) => sum + row.intervals.length, 0);
  let participants;
  if (action.type === 'root' && ['dateRaw', 'timeBasisRaw', 'durationMinutesRaw'].includes(action.key)) {
    return { ...invalidate(memory), draft: { ...draft, [action.key]: action.value } };
  }
  if (action.type === 'add-person' && draft.participants.length < 20 && total < 240) {
    participants = [...draft.participants, { id: `p${memory.nextParticipantNumber}`, nameRaw: '', intervals: [{ id: `s${memory.nextIntervalNumber}`, startRaw: '', endRaw: '' }] }];
    return { ...invalidate(memory), draft: { ...draft, participants }, nextParticipantNumber: memory.nextParticipantNumber + 1, nextIntervalNumber: memory.nextIntervalNumber + 1 };
  }
  if (action.type === 'remove-person' && person && draft.participants.length > 2) participants = draft.participants.filter(row => row.id !== person.id);
  if (action.type === 'name' && person) participants = draft.participants.map(row => row === person ? { ...row, nameRaw: action.value } : row);
  if (action.type === 'add-interval' && person && person.intervals.length < 12 && total < 240) {
    participants = draft.participants.map(row => row === person ? { ...row, intervals: [...row.intervals, { id: `s${memory.nextIntervalNumber}`, startRaw: '', endRaw: '' }] } : row);
    return { ...invalidate(memory), draft: { ...draft, participants }, nextIntervalNumber: memory.nextIntervalNumber + 1 };
  }
  if (action.type === 'remove-interval' && person && person.intervals.length > 1 && person.intervals.some(interval => interval.id === action.intervalId)) participants = draft.participants.map(row => row === person ? { ...row, intervals: row.intervals.filter(interval => interval.id !== action.intervalId) } : row);
  if (action.type === 'interval' && person && ['startRaw', 'endRaw'].includes(action.key) && person.intervals.some(interval => interval.id === action.intervalId)) participants = draft.participants.map(row => row === person ? { ...row, intervals: row.intervals.map(interval => interval.id === action.intervalId ? { ...interval, [action.key]: action.value } : interval) } : row);
  return participants ? { ...invalidate(memory), draft: { ...draft, participants } } : memory;
}
export function purgeMemory(memory) {
  // Scrub old references as well as the current owner before releasing them.
  memory.draft.dateRaw = ''; memory.draft.timeBasisRaw = ''; memory.draft.durationMinutesRaw = '';
  for (const person of memory.draft.participants) {
    person.nameRaw = '';
    for (const interval of person.intervals) { interval.startRaw = ''; interval.endRaw = ''; }
    person.intervals.length = 0;
  }
  memory.draft.participants.length = 0;
  if (memory.result) { memory.result.date = ''; memory.result.timeBasis = ''; memory.result.windows.length = 0; }
  memory.result = null; memory.reportText = null;
  return { ...memory, result: null, reportText: null, generation: memory.generation + 1, nextParticipantNumber: 3, nextIntervalNumber: 3 };
}
