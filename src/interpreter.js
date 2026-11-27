// Configurable interpreter: the language is a DEFINITION (statement templates + words), not hardcoded keywords.
// Pipeline: compileLanguage(def) -> tokenize(src) -> Parser (driven by the compiled templates) -> async evaluator.
// No eval() / Function() anywhere.
export class NovaError extends Error {
  constructor(kind, message, line) { super(message); this.kind = kind; this.line = line; }
}
const syn = (m, l) => new NovaError('Syntax Error', m, l);
const rt = (m, l) => new NovaError('Runtime Error', m, l);
const defErr = m => new NovaError('Language Definition Error', m, null);
class StopSignal {}

export const COMMAND_ACTIONS = [
  ['print-upper', 'Print values in UPPERCASE (needs {values})'], ['increment', 'Add 1 to a variable (needs {name})'],
  ['decrement', 'Subtract 1 from a variable (needs {name})'], ['divider', 'Print a divider line'], ['stop', 'Stop the program'],
  ['console-color', 'Change the console colours to a mood or colour (needs {word}, e.g. happy, sad, calm, red)'],
];
export const MOODS = {
  happy: { fg: '#ffd84d', bg: '#2a2205' }, sad: { fg: '#7aa7ff', bg: '#07122e' }, calm: { fg: '#5eead4', bg: '#04201c' },
  angry: { fg: '#ff6b6b', bg: '#2a0a0a' }, excited: { fg: '#ff9bd2', bg: '#2a0a1d' }, normal: { fg: '#d8f7ff', bg: '#050a1a' },
  red: { fg: '#ff6b6b', bg: '#050a1a' }, green: { fg: '#4ade80', bg: '#050a1a' }, blue: { fg: '#7aa7ff', bg: '#050a1a' },
  gold: { fg: '#f5c451', bg: '#050a1a' }, cyan: { fg: '#22d3ee', bg: '#050a1a' }, purple: { fg: '#c4a1ff', bg: '#050a1a' },
  pink: { fg: '#ff9bd2', bg: '#050a1a' }, orange: { fg: '#fb923c', bg: '#050a1a' }, white: { fg: '#ffffff', bg: '#050a1a' },
};

// ---------- tokenizer (words are generic: the parser decides what is a keyword) ----------
export function tokenize(src, comment = '#') {
  const t = []; let i = 0, line = 1;
  const push = (type, value) => t.push({ type, value, line });
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { push('nl', '\n'); line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (comment && src.startsWith(comment, i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i; while (/[0-9]/.test(src[j] || '')) j++;
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] || '')) { j++; while (/[0-9]/.test(src[j] || '')) j++; }
      push('num', parseFloat(src.slice(i, j))); i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (/\w/.test(src[j] || '')) j++; push('word', src.slice(i, j)); i = j; continue; }
    if (c === '"') {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\n') throw syn('Text is missing its closing quote (")', line);
        if (src[j] === '\\') { const n = src[j + 1]; s += n === 'n' ? '\n' : n === 't' ? '\t' : n; j += 2; } else s += src[j++];
      }
      if (j >= src.length) throw syn('Text is missing its closing quote (")', line);
      push('str', s); i = j + 1; continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>='].includes(two)) { push('op', two); i += 2; continue; }
    if ('+-*/%<>='.includes(c)) { push('op', c); i++; continue; }
    if ('()[],'.includes(c)) { push('p', c); i++; continue; }
    throw syn(`Unexpected character '${c}'`, line);
  }
  push('nl', '\n'); push('eof', '');
  return t;
}

// ---------- language definition compiler ----------
// Template syntax: words/symbols are literals, {name} are slots, [ ... ] is an optional part.
// Slots: {name} {var} identifier | {params} identifiers | {values} {args} expression lists | any other {x} one expression.
export function compileTemplate(raw, label) {
  const toks = raw.match(/\{[^}]*\}|\[|\]|[A-Za-z_]\w*|\d+(?:\.\d+)?|==|!=|<=|>=|[^\s\w]/g) || [];
  let i = 0;
  const seq = close => {
    const items = [];
    while (i < toks.length) {
      const t = toks[i];
      if (t === ']') { if (!close) throw defErr(`${label}: unmatched ']' in "${raw}"`); return items; }
      i++;
      if (t === '[') { const inner = seq(true); if (toks[i] !== ']') throw defErr(`${label}: missing ']' in "${raw}"`); i++; if (!inner.length) throw defErr(`${label}: empty [ ] in "${raw}"`); items.push({ t: 'opt', items: inner }); }
      else if (t[0] === '{' && t.length > 1) { const name = t.slice(1, -1).trim(); if (!/^\w+$/.test(name)) throw defErr(`${label}: bad slot ${t} in "${raw}"`); items.push({ t: 'ph', name }); }
      else items.push({ t: 'lit', v: t });
    }
    if (close) throw defErr(`${label}: missing ']' in "${raw}"`);
    return items;
  };
  return { raw, items: seq(false) };
}
const slotNames = (items, s = new Set()) => { for (const i of items) { if (i.t === 'ph') s.add(i.name); if (i.t === 'opt') slotNames(i.items, s); } return s; };
const leadOf = items => items[0]?.t === 'lit' ? { lit: items[0].v, at: 0 } : items[0]?.t === 'ph' && ['name', 'var'].includes(items[0].name) && items[1]?.t === 'lit' ? { lit: items[1].v, at: 1 } : null;
const REQ = { declare: ['name', 'value'], assign: ['name', 'value'], input: ['name'], if: ['cond'], while: ['cond'], loop: ['from', 'to'], func: ['name'], call: ['name'] };
const LABELS = { declare: 'Variable declaration', assign: 'Variable assignment', output: 'Output command', input: 'Input command', if: 'Conditional', while: 'While loop', loop: 'Counting loop', func: 'Function declaration', call: 'Function call', return: 'Return statement' };

export function compileLanguage(def) {
  const st = def.statements || {};
  const w = { else: 'else', end: 'end', and: 'and', or: 'or', not: 'not', true: 'true', false: 'false', ...def.words };
  for (const [k, v] of Object.entries(w)) if (!/^\w+$/.test(v || '')) throw defErr(`The word for "${k}" must be one word (letters, digits, _). Got "${v || ''}"`);
  const T = {};
  for (const k of Object.keys(LABELS)) {
    const raw = (st[k] || '').trim(); if (!raw) continue;
    const tpl = T[k] = compileTemplate(raw, LABELS[k]); const names = slotNames(tpl.items);
    for (const n of REQ[k] || []) if (!names.has(n)) throw defErr(`${LABELS[k]} "${raw}" must contain {${n}}`);
    if (k === 'output' && !names.has('values') && !names.has('value')) throw defErr(`Output command "${raw}" must contain {values}`);
    if (k === 'call' ? tpl.items[0].t !== 'lit' : !leadOf(tpl.items)) throw defErr(`${LABELS[k]} "${raw}" must start with its own keyword${k === 'call' ? '' : ' (or "{name} keyword")'}`);
  }
  if (!T.declare) throw defErr('A variable declaration syntax is required, for example: {name} is {value}');
  if (!T.output) throw defErr('An output command is required, for example: show {values}');
  const cmds = (def.commands || []).filter(c => (c.template || '').trim()).map(c => {
    const tpl = compileTemplate(c.template.trim(), 'Special command'); const names = slotNames(tpl.items);
    if (!COMMAND_ACTIONS.some(a => a[0] === c.action)) throw defErr(`Special command "${c.template}" has no action`);
    if (!leadOf(tpl.items)) throw defErr(`Special command "${c.template}" must start with its own keyword`);
    if (['increment', 'decrement'].includes(c.action) && !names.has('name')) throw defErr(`Special command "${c.template}" needs {name}`);
    if (c.action === 'print-upper' && !names.has('values') && !names.has('value')) throw defErr(`Special command "${c.template}" needs {values}`);
    if (c.action === 'console-color' && !names.has('word') && !names.has('value')) throw defErr(`Special command "${c.template}" needs {word}`);
    return { ...tpl, action: c.action };
  });
  return { T, w, cmds, comment: def.comment ?? '#', loopVar: def.loopVariable || 'i', paren: !!def.parenCalls };
}
export function languageWords(def) {
  try {
    const L = compileLanguage(def), s = new Set(Object.values(L.w));
    const walk = items => items.forEach(i => { if (i.t === 'lit' && /^\w+$/.test(i.v)) s.add(i.v); if (i.t === 'opt') walk(i.items); });
    Object.values(L.T).forEach(t => walk(t.items)); L.cmds.forEach(c => walk(c.items)); return [...s];
  } catch { return []; }
}

// ---------- parser ----------
const ORDER = ['declare', 'assign', 'output', 'input', 'if', 'while', 'loop', 'func', 'return'];
class Parser {
  constructor(tokens, L) {
    this.t = tokens; this.p = 0; this.L = L;
    this.tpls = [...ORDER.filter(k => L.T[k]).map(k => ({ kind: k, tpl: L.T[k] })), ...L.cmds.map(c => ({ kind: 'cmd', tpl: c }))].map(x => ({ ...x, lead: leadOf(x.tpl.items) }));
  }
  get cur() { return this.t[this.p]; }
  is(type, val) { return this.cur.type === type && (val === undefined || this.cur.value === val); }
  desc() { const c = this.cur; return c.type === 'nl' ? 'end of line' : c.type === 'eof' ? 'end of program' : `'${c.value}'`; }
  eat(type, val, msg) { if (this.is(type, val)) return this.t[this.p++]; throw syn(msg || `Expected '${val}' but found ${this.desc()}`, this.cur.line); }
  skipNl() { while (this.is('nl')) this.p++; }
  endStmt() { if (!this.is('nl') && !this.is('eof')) throw syn(`Unexpected ${this.desc()} — expected end of line`, this.cur.line); }
  reserved(w) { return w === this.L.w.else || w === this.L.w.end; }
  program() { const b = []; for (;;) { this.skipNl(); if (this.is('eof')) return b; b.push(this.stmt()); } }
  block(stops, start) {
    const b = [];
    for (;;) {
      this.skipNl();
      if (this.is('eof')) throw syn(`Missing '${this.L.w.end}' — the block that starts here was never closed`, start);
      if (this.cur.type === 'word' && stops.includes(this.cur.value)) return b;
      b.push(this.stmt());
    }
  }
  // ---- template matching ----
  ph(name) {
    if (name === 'params') return this.list(() => this.ident('a parameter name'));
    if (name === 'args' || name === 'values') return this.list(() => this.expr());
    if (name === 'word') return this.ident('a word (for example happy)');
    if (name === 'name' || name === 'var') return this.ident(name === 'var' ? 'a variable name' : 'a name');
    return this.expr();
  }
  ident(what) { const c = this.cur; if (c.type !== 'word' || this.reserved(c.value)) throw syn(`Expected ${what} but found ${this.desc()}`, c.line); this.p++; return c.value; }
  stopper() { const c = this.cur; return c.type === 'nl' || c.type === 'eof' || (c.type === 'p' && c.value === ')'); }
  list(item) { const a = []; if (this.stopper()) return a; a.push(item()); while (this.is('p', ',')) { this.p++; a.push(item()); } return a; }
  m(items, caps) {
    for (const it of items) {
      if (it.t === 'lit') {
        const c = this.cur;
        if (c.type === 'nl' || c.type === 'eof' || c.type === 'str' || String(c.value) !== it.v) throw syn(`Expected '${it.v}' but found ${this.desc()}`, c.line);
        this.p++;
      } else if (it.t === 'ph') caps[it.name] = this.ph(it.name);
      else {
        const f = it.items[0], c = this.cur;
        const present = f.t === 'lit' ? c.type !== 'nl' && c.type !== 'eof' && c.type !== 'str' && String(c.value) === f.v : !this.stopper();
        if (present) this.m(it.items, caps);
      }
    }
  }
  mh(tpl, caps) { // match with a hint that shows the team's own syntax
    try { this.m(tpl.items, caps); } catch (e) {
      if (e instanceof NovaError && e.kind === 'Syntax Error' && !e.hint) { e.hint = true; e.message += ` — this command should look like: ${tpl.raw}`; }
      throw e;
    }
  }
  hit({ lead }) {
    if (!lead) return false;
    const c = this.t[this.p + lead.at];
    if (!c || c.type === 'str' || c.type === 'nl' || c.type === 'eof' || String(c.value) !== lead.lit) return false;
    return lead.at === 0 || (this.cur.type === 'word' && !this.reserved(this.cur.value));
  }
  closeBlock() { this.eat('word', this.L.w.end, `Expected '${this.L.w.end}' to close the block`); this.endStmt(); }
  ifNode(tpl, caps, line) {
    const w = this.L.w; this.endStmt();
    const body = this.block([w.else, w.end], line); let alt = null;
    if (this.is('word', w.else)) {
      this.p++; const f = tpl.items[0];
      if (f.t === 'lit' && this.cur.type === 'word' && this.cur.value === f.v) { const l2 = this.cur.line, c2 = {}; this.mh(tpl, c2); return { k: 'if', c: caps.cond, body, alt: [this.ifNode(tpl, c2, l2)], line }; }
      this.endStmt(); alt = this.block([w.end], line);
    }
    this.closeBlock();
    return { k: 'if', c: caps.cond, body, alt, line };
  }
  stmt() {
    const c = this.cur, line = c.line, w = this.L.w;
    if (c.type === 'word' && this.reserved(c.value)) throw syn(`Unexpected '${c.value}' — there is no open block to ${c.value === w.end ? 'close' : 'continue'}`, line);
    for (const x of this.tpls) {
      if (!this.hit(x)) continue;
      const caps = {}; this.mh(x.tpl, caps);
      switch (x.kind) {
        case 'declare': this.endStmt(); return { k: 'let', n: caps.name, e: caps.value, upd: !this.L.T.assign, line };
        case 'assign': this.endStmt(); return { k: 'set', n: caps.name, e: caps.value, line };
        case 'output': this.endStmt(); return { k: 'say', a: caps.values || [caps.value], line };
        case 'input': this.endStmt(); return { k: 'ask', n: caps.name, pr: caps.prompt || null, line };
        case 'return': this.endStmt(); return { k: 'return', e: caps.value || null, line };
        case 'cmd': this.endStmt(); return { k: 'cmd', action: x.tpl.action, caps, line };
        case 'if': return this.ifNode(x.tpl, caps, line);
        default: {
          this.endStmt(); const body = this.block([w.end], line); this.closeBlock();
          if (x.kind === 'while') return { k: 'while', c: caps.cond, body, line };
          if (x.kind === 'loop') return { k: 'repeat', n: caps.var || this.L.loopVar, from: caps.from, to: caps.to, step: caps.step || null, body, line };
          return { k: 'func', name: caps.name, params: caps.params || [], body, line };
        }
      }
    }
    if (c.type !== 'word') throw syn(`Unexpected ${this.desc()} — a line must start with a command`, line);
    const e = this.expr();
    if (e.k !== 'call') throw syn(`'${c.value}' is not a command in this language. Check the Language Definition for the commands your team created`, line);
    this.endStmt(); return { k: 'expr', e, line };
  }
  // ---- expressions ----
  bin(next, test) {
    let l = next.call(this);
    while (test(this.cur)) { const { value: op, line } = this.cur; this.p++; l = { k: 'bin', op, l, r: next.call(this), line }; }
    return l;
  }
  wordIs(t, v) { return t.type === 'word' && t.value === v; }
  expr() { return this.bin(this.and, t => this.wordIs(t, this.L.w.or) && (t.value = 'or', true)); }
  and() { return this.bin(this.not, t => this.wordIs(t, this.L.w.and) && (t.value = 'and', true)); }
  not() { if (this.wordIs(this.cur, this.L.w.not)) { const line = this.cur.line; this.p++; return { k: 'not', e: this.not(), line }; } return this.cmp(); }
  cmp() { return this.bin(this.add, t => t.type === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(t.value)); }
  add() { return this.bin(this.mul, t => t.type === 'op' && (t.value === '+' || t.value === '-')); }
  mul() { return this.bin(this.unary, t => t.type === 'op' && ['*', '/', '%'].includes(t.value)); }
  unary() { if (this.is('op', '-')) { const line = this.cur.line; this.p++; return { k: 'neg', e: this.unary(), line }; } return this.postfix(); }
  postfix() {
    let n = this.primary();
    for (;;) {
      const line = this.cur.line;
      if (this.is('p', '(') && this.L.paren && n.k === 'var') {
        this.p++; const args = this.list(() => this.expr());
        this.eat('p', ')', "Expected ')' to close the function call"); n = { k: 'call', name: n.n, args, line };
      } else if (this.is('p', '[')) {
        this.p++; const i = this.expr(); this.eat('p', ']', "Expected ']'"); n = { k: 'index', o: n, i, line };
      } else return n;
    }
  }
  primary() {
    const c = this.cur, line = c.line, L = this.L;
    if (c.type === 'num') { this.p++; return { k: 'lit', v: c.value, line }; }
    if (c.type === 'str') { this.p++; return strNode(c.value, line, L); }
    if (c.type === 'word') {
      if (c.value === L.w.true || c.value === L.w.false) { this.p++; return { k: 'lit', v: c.value === L.w.true, line }; }
      if (this.reserved(c.value)) throw syn(`Unexpected '${c.value}' inside an expression`, line);
      if (L.T.call && c.value === L.T.call.items[0].v) { const caps = {}; this.mh(L.T.call, caps); return { k: 'call', name: caps.name, args: caps.args || [], line }; }
      this.p++; return { k: 'var', n: c.value, line };
    }
    if (this.is('p', '(')) { this.p++; const e = this.expr(); this.eat('p', ')', "Expected ')'"); return e; }
    if (this.is('p', '[')) {
      this.p++; const items = [];
      if (!this.is('p', ']')) { items.push(this.expr()); while (this.is('p', ',')) { this.p++; items.push(this.expr()); } }
      this.eat('p', ']', "Expected ']' to close the list"); return { k: 'list', items, line };
    }
    throw syn(`Expected a value but found ${this.desc()}`, line);
  }
}

function strNode(s, line, L) {
  if (!/\{[^}]*\}/.test(s)) return { k: 'lit', v: s, line };
  const parts = []; const re = /\{([^}]*)\}/g; let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) parts.push(s.slice(last, m.index));
    let e;
    try {
      const p = new Parser(tokenize(m[1], '').map(t => ({ ...t, line })), L);
      if (p.is('nl')) throw syn('Empty {} inside text', line);
      e = p.expr(); if (!p.is('nl')) throw syn(`Invalid expression inside {${m[1]}}`, line);
    } catch (err) { if (err instanceof NovaError) throw syn(err.message, line); throw err; }
    parts.push(e); last = re.lastIndex;
  }
  if (last < s.length) parts.push(s.slice(last));
  return { k: 'interp', parts, line };
}

export const typeOf = v => v === null ? 'nothing' : Array.isArray(v) ? 'list' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'text' : 'number';
export function fmt(v, quote = false) {
  if (v === null) return 'nothing';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(10)));
  if (typeof v === 'string') return quote ? `"${v}"` : v;
  if (Array.isArray(v)) return '[' + v.map(x => fmt(x, true)).join(', ') + ']';
  return String(v);
}
const truthy = v => !(v === false || v === null || v === 0 || v === '');
const N = (x, n) => { if (typeof x !== 'number') throw new Error(`${n}() needs a number but got ${typeOf(x)}`); return x; };
const S = (x, n) => { if (typeof x !== 'string') throw new Error(`${n}() needs text but got ${typeOf(x)}`); return x; };
const BUILTINS = {
  len: x => { if (typeof x === 'string' || Array.isArray(x)) return x.length; throw new Error('len() needs text or a list'); },
  num: x => { const n = parseFloat(x); if (Number.isNaN(n)) throw new Error(`num() cannot convert ${fmt(x, true)} to a number`); return n; },
  text: x => fmt(x), upper: x => S(x, 'upper').toUpperCase(), lower: x => S(x, 'lower').toLowerCase(),
  round: x => Math.round(N(x, 'round')), floor: x => Math.floor(N(x, 'floor')), abs: x => Math.abs(N(x, 'abs')),
  sqrt: x => { if (N(x, 'sqrt') < 0) throw new Error('sqrt() of a negative number'); return Math.sqrt(x); },
  max: (...a) => Math.max(...a.map(x => N(x, 'max'))), min: (...a) => Math.min(...a.map(x => N(x, 'min'))),
  push: (l, v) => { if (!Array.isArray(l)) throw new Error('push() needs a list first'); l.push(v); return l; },
};

class Ret { constructor(v) { this.v = v; } }

class Interp {
  constructor(host) { this.h = host; this.steps = 0; this.max = host.maxSteps || 300000; this.funcs = new Map(); this.depth = 0; this.global = { vars: new Map(), parent: null }; }
  find(env, n) { for (let e = env; e; e = e.parent) if (e.vars.has(n)) return e; return null; }
  scope(parent) { return { vars: new Map(), parent }; }
  async tick(line) {
    if (++this.steps > this.max) throw rt('Stopped: the program ran too long (possible infinite loop)', line);
    if (this.steps % 2000 === 0) await new Promise(r => setTimeout(r, 0));
  }
  async block(list, env) { for (const s of list) await this.exec(s, env); }
  async exec(s, env) {
    await this.tick(s.line);
    switch (s.k) {
      case 'let': { const v = await this.ev(s.e, env); if (s.upd) (this.find(env, s.n) || env).vars.set(s.n, v); else env.vars.set(s.n, v); break; }
      case 'set': {
        const v = await this.ev(s.e, env), sc = this.find(env, s.n);
        if (!sc) throw rt(`Variable '${s.n}' is not declared. Use 'let ${s.n} = ...' first`, s.line);
        sc.vars.set(s.n, v); break;
      }
      case 'say': { const out = []; for (const a of s.a) out.push(fmt(await this.ev(a, env))); this.h.print(out.join(' ')); break; }
      case 'ask': {
        const p = s.pr ? fmt(await this.ev(s.pr, env)) : '';
        const raw = String(await this.h.input(p)), txt = raw.trim();
        (this.find(env, s.n) || env).vars.set(s.n, /^-?\d+(\.\d+)?$/.test(txt) ? parseFloat(txt) : raw); break;
      }
      case 'if': {
        if (truthy(await this.ev(s.c, env))) await this.block(s.body, this.scope(env));
        else if (s.alt) await this.block(s.alt, this.scope(env));
        break;
      }
      case 'repeat': {
        const a = await this.ev(s.from, env), b = await this.ev(s.to, env), st = s.step ? await this.ev(s.step, env) : 1;
        if ([a, b, st].some(x => typeof x !== 'number')) throw rt("'repeat' needs numbers for from, to and step", s.line);
        if (st === 0) throw rt("'step' cannot be 0", s.line);
        const lp = this.scope(env);
        for (let i = a; st > 0 ? i <= b : i >= b; i += st) { await this.tick(s.line); lp.vars.set(s.n, i); await this.block(s.body, this.scope(lp)); }
        break;
      }
      case 'while': while (truthy(await this.ev(s.c, env))) { await this.tick(s.line); await this.block(s.body, this.scope(env)); } break;
      case 'func': this.funcs.set(s.name, s); break;
      case 'return': if (this.depth === 0) throw rt("'return' can only be used inside a function", s.line); throw new Ret(s.e ? await this.ev(s.e, env) : null);
      case 'cmd': {
        const a = s.action, c = s.caps;
        if (a === 'print-upper') { const o = []; for (const x of (c.values || [c.value])) o.push(fmt(await this.ev(x, env))); this.h.print(o.join(' ').toUpperCase()); }
        else if (a === 'increment' || a === 'decrement') {
          const sc = this.find(env, c.name); if (!sc) throw rt(`Variable '${c.name}' is not defined`, s.line);
          const v = sc.vars.get(c.name); if (typeof v !== 'number') throw rt(`'${c.name}' must be a number`, s.line);
          sc.vars.set(c.name, v + (a === 'increment' ? 1 : -1));
        } else if (a === 'divider') this.h.print('------------------------------');
        else if (a === 'stop') throw new StopSignal();
        else if (a === 'console-color') {
          const key = c.word ?? fmt(await this.ev(c.value, env)), m = MOODS[String(key).toLowerCase()];
          if (!m) throw rt(`Unknown mood '${key}'. Try: ${Object.keys(MOODS).join(', ')}`, s.line);
          this.h.setMood?.({ name: String(key).toLowerCase(), ...m });
        }
        break;
      }
      case 'expr': await this.ev(s.e, env); break;
    }
  }
  async ev(n, env) {
    switch (n.k) {
      case 'lit': return n.v;
      case 'interp': { let s = ''; for (const p of n.parts) s += typeof p === 'string' ? p : fmt(await this.ev(p, env)); return s; }
      case 'var': { const sc = this.find(env, n.n); if (!sc) throw rt(`Variable '${n.n}' is not defined`, n.line); return sc.vars.get(n.n); }
      case 'list': { const a = []; for (const e of n.items) a.push(await this.ev(e, env)); return a; }
      case 'not': return !truthy(await this.ev(n.e, env));
      case 'neg': { const v = await this.ev(n.e, env); if (typeof v !== 'number') throw rt(`Cannot negate ${typeOf(v)}`, n.line); return -v; }
      case 'index': {
        const o = await this.ev(n.o, env), i = await this.ev(n.i, env);
        if (!Array.isArray(o) && typeof o !== 'string') throw rt(`Cannot use [ ] on ${typeOf(o)}`, n.line);
        if (!Number.isInteger(i) || i < 0 || i >= o.length) throw rt(`Index ${fmt(i)} is out of range (length ${o.length})`, n.line);
        return o[i];
      }
      case 'call': return this.call(n, env);
      case 'bin': return this.binary(n, env);
    }
  }
  async binary(n, env) {
    if (n.op === 'and') return truthy(await this.ev(n.l, env)) && truthy(await this.ev(n.r, env));
    if (n.op === 'or') return truthy(await this.ev(n.l, env)) || truthy(await this.ev(n.r, env));
    const a = await this.ev(n.l, env), b = await this.ev(n.r, env), op = n.op;
    if (op === '==') return a === b;
    if (op === '!=') return a !== b;
    if (op === '+') {
      if (typeof a === 'number' && typeof b === 'number') return a + b;
      if (typeof a === 'string' || typeof b === 'string') return fmt(a) + fmt(b);
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      throw rt(`Cannot add ${typeOf(a)} and ${typeOf(b)}`, n.line);
    }
    if (['<', '>', '<=', '>='].includes(op)) {
      if (typeOf(a) !== typeOf(b) || !['number', 'text'].includes(typeOf(a))) throw rt(`Cannot compare ${typeOf(a)} with ${typeOf(b)} using ${op}`, n.line);
      return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    }
    if (typeof a !== 'number' || typeof b !== 'number') throw rt(`'${op}' needs two numbers but got ${typeOf(a)} and ${typeOf(b)}`, n.line);
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (b === 0) throw rt('Division by zero', n.line);
    return op === '/' ? a / b : a % b;
  }
  async call(n, env) {
    const args = []; for (const a of n.args) args.push(await this.ev(a, env));
    const f = this.funcs.get(n.name);
    if (f) {
      if (args.length !== f.params.length) throw rt(`Function '${n.name}' expects ${f.params.length} argument(s) but got ${args.length}`, n.line);
      if (this.depth >= 150) throw rt('Too many nested calls (infinite recursion?)', n.line);
      const fe = this.scope(this.global); f.params.forEach((p, i) => fe.vars.set(p, args[i]));
      this.depth++;
      try { await this.block(f.body, fe); } catch (e) { if (e instanceof Ret) return e.v; throw e; } finally { this.depth--; }
      return null;
    }
    if (BUILTINS[n.name]) { try { return BUILTINS[n.name](...args); } catch (e) { throw rt(e.message, n.line); } }
    throw rt(`Unknown function '${n.name}'`, n.line);
  }
}

// host = { print(text), input(promptText) -> Promise<string>, maxSteps? }; def = language definition
export async function runNova(source, host, def) {
  const L = compileLanguage(def);
  const ast = new Parser(tokenize(source, L.comment), L).program();
  const it = new Interp(host);
  for (const s of ast) if (s.k === 'func') it.funcs.set(s.name, s); // functions can be used before they are defined
  try { await it.block(ast, it.global); } catch (e) { if (!(e instanceof StopSignal)) throw e; }
}
