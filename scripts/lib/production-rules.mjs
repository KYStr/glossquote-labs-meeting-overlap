const escape = value => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function parseHeaders(text) {
  const rules = [];
  let rule;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      if (!raw.startsWith('/') || /\s/.test(raw)) throw new Error('Invalid header path');
      rule = { pattern: raw, operations: [] }; rules.push(rule);
    } else {
      if (!rule) throw new Error('Header without path');
      const line = raw.trim();
      if (line.startsWith('! ')) {
        const name = line.slice(2).toLowerCase();
        if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Invalid header removal');
        rule.operations.push({ remove: true, name });
      } else {
        const match = /^([a-z0-9-]+): (.+)$/i.exec(line);
        if (!match) throw new Error('Invalid header assignment');
        rule.operations.push({ remove: false, name: match[1].toLowerCase(), value: match[2] });
      }
    }
  }
  return rules;
}
export function applyHeaders(rules, path) {
  const headers = {};
  for (const rule of rules) {
    if (!new RegExp('^' + rule.pattern.split('*').map(escape).join('.*') + '$').test(path)) continue;
    for (const op of rule.operations) {
      if (op.remove) delete headers[op.name];
      else headers[op.name] = headers[op.name] === undefined ? op.value : `${headers[op.name]}, ${op.value}`;
    }
  }
  return headers;
}
export function parseRobots(text) {
  const rules = [];
  let active = false;
  for (const raw of text.split(/\r?\n/)) {
    const match = /^([^:]+):\s*(.*)$/.exec(raw.split('#')[0].trim());
    if (!match) continue;
    const key = match[1].trim().toLowerCase(); const value = match[2].trim();
    if (key === 'user-agent') { active = value === '*'; continue; }
    if (active && ['allow', 'disallow'].includes(key) && value) {
      if (!value.startsWith('/')) throw new Error('Invalid robots path');
      rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  return rules;
}
export function robotsAllowed(rules, path) {
  let best = -1; let allow = true;
  for (const rule of rules) {
    const terminal = rule.pattern.endsWith('$');
    const pattern = terminal ? rule.pattern.slice(0, -1) : rule.pattern;
    if (!new RegExp('^' + pattern.split('*').map(escape).join('.*') + (terminal ? '$' : '')).test(path)) continue;
    const size = pattern.replaceAll('*', '').length;
    if (size > best || size === best && rule.allow) { best = size; allow = rule.allow; }
  }
  return allow;
}
