import React, { useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { NOVA, TASKLANG } from './languageConfig.js';
import { runNova, NovaError, compileLanguage, languageWords, COMMAND_ACTIONS } from './interpreter.js';

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#f5c451', fontWeight: '600' }, { tag: t.string, color: '#5eead4' },
  { tag: t.number, color: '#7dd3fc' }, { tag: t.comment, color: '#5b6b94', fontStyle: 'italic' }, { tag: t.variableName, color: '#e6ecff' },
]);
const editorTheme = EditorView.theme({
  '&': { backgroundColor: '#0b1430', color: '#e6ecff', fontSize: '14px' },
  '.cm-gutters': { backgroundColor: '#091024', color: '#4a5a86', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#13204a55' },
  '.cm-cursor': { borderLeftColor: '#f5c451' }, '&.cm-focused': { outline: '1px solid #22d3ee66' },
  '.cm-content, .cm-gutters': { fontFamily: "'JetBrains Mono', monospace" },
}, { dark: true });
// Syntax highlighting is built from the CURRENT language definition (its own keywords, comment symbol).
const makeExtensions = lang => {
  const kw = new Set(languageWords(lang));
  const mode = StreamLanguage.define({
    token(stream) {
      if (stream.eatSpace()) return null;
      if (lang.comment && stream.match(lang.comment)) { stream.skipToEnd(); return 'comment'; }
      if (stream.match(/^"[^"]*"?/)) return 'string';
      if (stream.match(/^\d+(\.\d+)?/)) return 'number';
      if (stream.match(/^[A-Za-z_]\w*/)) return kw.has(stream.current()) ? 'keyword' : 'variableName';
      stream.next(); return null;
    },
  });
  return [mode, syntaxHighlighting(highlight), editorTheme];
};

const STORE = 'codecraft.language.v2';
const loadLang = () => { try { return JSON.parse(localStorage.getItem(STORE)) || NOVA; } catch { return NOVA; } };

const Logo = () => (
  <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true">
    <path d="M20 2l16 9v18l-16 9L4 29V11z" fill="none" stroke="#f5c451" strokeWidth="2.5" />
    <path d="M16 14l-6 6 6 6M24 14l6 6-6 6" fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Code = ({ children }) => <pre className="snippet">{children}</pre>;

function Dashboard({ lang, go }) {
  return (
    <section className="hero">
      <div className="hero-logo"><Logo /> <span>CodeCraft</span></div>
      <h1>Invent your own language. Then run it.</h1>
      <p className="sub">Custom Programming Language Playground</p>
      <div className="lang-card">
        <div className="lang-name">{lang.name}<small>{lang.fileExtension}</small></div>
        <p>{lang.tagline}</p><p className="muted">{lang.purpose}</p>
        <div className="chips"><span>Your own keywords</span><span>Your own syntax</span><span>Live interpreter</span></div>
        <button className="btn gold" onClick={() => go('playground')}>Start Coding</button>
        <button className="btn ghost" onClick={() => go('definition')}>Edit language definition</button>
        <button className="btn ghost" onClick={() => go('guide')}>Read the syntax guide</button>
      </div>
    </section>
  );
}

const SAMPLES = { name: 'total', var: 'k', value: '10', values: '"Hello", total', prompt: '"Your answer: "', cond: 'total > 5', from: '1', to: '5', step: '2', params: 'a, b', args: '1, 2' };
const fill = raw => raw.replace(/\{(\w+)\}/g, (_, k) => SAMPLES[k] ?? k).replace(/[[\]]/g, '');
const KINDS = [
  ['declare', 'Variables', 'line', 'Creates a variable (or changes it when it already exists).'], ['assign', 'Changing a variable', 'line', 'Gives an existing variable a new value.'],
  ['input', 'Input', 'line', 'Pauses the program, shows the prompt in the console and stores what you type.'], ['output', 'Output', 'line', 'Prints values separated by spaces. Put {expressions} inside text to insert values.'],
  ['if', 'Conditions', 'if', 'Compare with == != < > <= >= and combine tests with the logic words.'], ['loop', 'Counting loop', 'block', 'Counts from the first number to the last (inclusive).'],
  ['while', 'Repeat while true', 'block', 'Repeats as long as the test is true.'], ['func', 'Function declaration', 'block', 'Defines reusable code. Functions can be called before they are defined.'],
  ['call', 'Function call', 'line', 'Runs a function. It can also be used inside expressions to get a result.'], ['return', 'Return a value', 'line', 'Sends a result back from a function.'],
];
function Guide({ lang }) {
  let err = null; try { compileLanguage(lang); } catch (e) { err = e.message; }
  if (err) return <section className="page"><h2>{lang.name} syntax guide</h2><p className="bad-box">Fix the language definition first: {err}</p></section>;
  const w = { else: 'else', end: 'end', ...lang.words }, st = lang.statements;
  const body = '\n  ...\n', make = (kind, raw) => kind === 'if' ? `${fill(raw)}${body}${w.else}${body}${w.end}` : kind === 'block' ? `${fill(raw)}${body}${w.end}` : fill(raw);
  return (
    <section className="page">
      <h2>{lang.name} syntax guide</h2>
      <div className="grid">
        {KINDS.filter(([k]) => (st[k] || '').trim()).map(([k, title, kind, desc]) => (
          <article className="card" key={k}><h3>{title}</h3><p className="muted">{desc}</p>
            <h4>Syntax</h4><Code>{st[k]}</Code><h4>Example</h4><Code>{make(kind, st[k])}</Code>
            {k === 'loop' && !st[k].includes('{var}') && <p className="muted">Inside the loop, <code>{lang.loopVariable || 'i'}</code> holds the current number.</p>}
          </article>
        ))}
        {(lang.commands || []).filter(c => c.template.trim()).length > 0 && (
          <article className="card"><h3>Special commands</h3>
            {lang.commands.filter(c => c.template.trim()).map((c, i) => <div key={i}><Code>{c.template}</Code><p className="muted">{COMMAND_ACTIONS.find(a => a[0] === c.action)?.[1]}</p></div>)}
          </article>
        )}
        <article className="card"><h3>Words and symbols</h3>
          <ul><li>Block ends with <code>{w.end}</code>, else-branch starts with <code>{w.else}</code></li><li>Logic: <code>{w.and}</code> <code>{w.or}</code> <code>{w.not}</code>, values <code>{w.true}</code> <code>{w.false}</code></li>
            <li>Comments start with <code>{lang.comment || '(none)'}</code></li><li>Operators: <code>+ - * / %</code> and <code>== != &lt; &gt; &lt;= &gt;=</code></li>
            <li>Types: number, text, bool, list <code>[1, 2]</code></li><li>Built-in functions: len, num, text, upper, lower, round, floor, sqrt, abs, max, min, push</li></ul>
        </article>
      </div>
    </section>
  );
}

const FIELDS = [
  ['declare', 'Variable declaration', 'required'], ['assign', 'Variable assignment', 'optional'], ['output', 'Output command', 'required'], ['input', 'Input command', 'optional'],
  ['if', 'Conditional (starts the block)', 'optional'], ['while', 'While loop', 'optional'], ['loop', 'Counting loop', 'optional'],
  ['func', 'Function declaration', 'optional'], ['call', 'Function call', 'optional'], ['return', 'Return statement', 'optional'],
];
const WORDS = [['end', 'Block-ending word'], ['else', 'Else word'], ['and', 'And'], ['or', 'Or'], ['not', 'Not'], ['true', 'True'], ['false', 'False']];
function Definition({ lang, setLang }) {
  const set = (k, v) => setLang({ ...lang, [k]: v });
  const setSt = (k, v) => setLang({ ...lang, statements: { ...lang.statements, [k]: v } });
  const setW = (k, v) => setLang({ ...lang, words: { ...lang.words, [k]: v } });
  const cmds = lang.commands || [], setCmd = (i, p) => set('commands', cmds.map((c, j) => j === i ? { ...c, ...p } : c));
  let status = null; try { compileLanguage(lang); } catch (e) { status = e.message; }
  return (
    <section className="page">
      <h2>Language definition</h2>
      <p className="muted">Define your own language here. The interpreter reads these rules, so the Playground runs whatever you define. Changes save automatically.</p>
      <div className={status ? 'bad-box' : 'ok-box'}>{status ? `✖ ${status}` : '✔ Definition is valid. Open the Playground and write a program in your language.'}</div>
      <div className="grid">
        <article className="card form"><h3>Identity</h3>
          <label>Language name<input value={lang.name} onChange={e => set('name', e.target.value)} /></label>
          <label>File extension<input value={lang.fileExtension || ''} onChange={e => set('fileExtension', e.target.value)} /></label>
          <label>Tagline<input value={lang.tagline || ''} onChange={e => set('tagline', e.target.value)} /></label>
          <label>Purpose<textarea rows={3} value={lang.purpose || ''} onChange={e => set('purpose', e.target.value)} /></label>
          <div className="row"><button className="btn ghost" onClick={() => setLang(NOVA)}>Reset to NOVA</button><button className="btn ghost" onClick={() => setLang(TASKLANG)}>Use TASKLANG sample</button></div>
        </article>
        <article className="card form"><h3>Statement syntax</h3>
          <p className="muted">Write each statement the way your team wants it. Words and symbols are literal. <code>{'{name}'}</code> identifier, <code>{'{value}'}</code> / <code>{'{cond}'}</code> expression, <code>{'{values}'}</code> / <code>{'{args}'}</code> comma list, <code>{'{params}'}</code> names, <code>[ … ]</code> optional. Leave optional rows blank to turn them off.</p>
          {FIELDS.map(([k, label, req]) => <label key={k}>{label} <small>({req})</small><input value={lang.statements[k] || ''} onChange={e => setSt(k, e.target.value)} spellCheck={false} /></label>)}
        </article>
        <article className="card form"><h3>Words and symbols</h3>
          {WORDS.map(([k, label]) => <label key={k}>{label}<input value={lang.words?.[k] ?? ''} onChange={e => setW(k, e.target.value)} spellCheck={false} /></label>)}
          <label>Comment symbol<input value={lang.comment ?? ''} onChange={e => set('comment', e.target.value)} /></label>
          <label>Loop variable name <small>(used when the loop syntax has no {'{var}'})</small><input value={lang.loopVariable || ''} onChange={e => set('loopVariable', e.target.value)} /></label>
          <label className="check"><input type="checkbox" checked={!!lang.parenCalls} onChange={e => set('parenCalls', e.target.checked)} /> Also allow calls like <code>name(arg, arg)</code></label>
        </article>
        <article className="card form"><h3>Special commands</h3>
          <p className="muted">Invent extra commands. Each starts with its own keyword.</p>
          {cmds.map((c, i) => (
            <div className="row cmd" key={i}>
              <input value={c.template} placeholder="shout {values}" onChange={e => setCmd(i, { template: e.target.value })} spellCheck={false} />
              <select value={c.action} onChange={e => setCmd(i, { action: e.target.value })}>{COMMAND_ACTIONS.map(([a, d]) => <option key={a} value={a}>{d}</option>)}</select>
              <button className="btn ghost sm" onClick={() => set('commands', cmds.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
          <button className="btn ghost" onClick={() => set('commands', [...cmds, { template: '', action: 'print-upper' }])}>+ Add command</button>
        </article>
      </div>
    </section>
  );
}

function Playground({ lang }) {
  const [code, setCode] = useState('');
  const [lines, setLines] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [mood, setMood] = useState(null);
  const [pending, setPending] = useState(null);
  const [answer, setAnswer] = useState('');
  const endRef = useRef(null);
  const extensions = useMemo(() => makeExtensions(lang), [lang]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [lines, pending]);
  const add = (type, text) => setLines(l => [...l, { type, text }]);

  async function run() {
    if (status === 'Running…') return;
    setLines([]); setMood(null); setStatus('Running…');
    try {
      await runNova(code, { print: s => add('out', s), setMood, input: p => new Promise(resolve => setPending({ prompt: p, resolve })) }, lang);
      setStatus('Finished successfully');
    } catch (e) {
      if (e instanceof NovaError) { add('err', `${e.kind}${e.line ? ` on line ${e.line}` : ''}: ${e.message}`); setStatus(e.kind); }
      else { add('err', `Internal error: ${e.message}`); setStatus('Internal error'); }
    }
  }
  function submit(ev) { ev.preventDefault(); add('in', pending.prompt + answer); pending.resolve(answer); setPending(null); setAnswer(''); }
  const cls = status.startsWith('Finished') ? 'ok' : status === 'Running…' ? 'run' : status === 'Ready' ? '' : 'bad';
  return (
    <section className="play">
      <div className="pane">
        <div className="bar">
          <span className="title">main{lang.fileExtension || '.code'}</span>
          <div className="tools">
            <button className="btn ghost" onClick={() => { setCode(''); setLines([]); setMood(null); setStatus('Ready'); }}>Clear Code</button>
            <button className="btn gold" onClick={run}>▶ Run Code</button>
          </div>
        </div>
        <CodeMirror value={code} height="460px" autoFocus theme="dark" extensions={extensions} onChange={setCode} basicSetup={{ lineNumbers: true, foldGutter: false }} />
      </div>
      <div className="pane">
        <div className="bar"><span className="title">Console</span><span className={`status ${cls}`}>{status}</span></div>
        <div className="term" style={{ '--tbg': mood?.bg, '--tfg': mood?.fg }}>
          {lines.length === 0 && !pending && <div className="dim">Output appears here. Press Run Code.</div>}
          {lines.map((l, i) => <div key={i} className={'ln ' + l.type}>{l.type === 'err' ? '✖ ' : l.type === 'in' ? '' : '› '}{l.text}</div>)}
          {pending && (
            <form onSubmit={submit} className="ask">
              <span className="ln prompt">{pending.prompt}</span>
              <input autoFocus value={answer} onChange={e => setAnswer(e.target.value)} aria-label="Program input" />
              <button className="btn gold sm" type="submit">Enter</button>
            </form>
          )}
          <div ref={endRef} />
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [view, setView] = useState('dashboard');
  const [lang, setLang] = useState(loadLang);
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(lang)); } catch { /* ignore */ } }, [lang]);
  const tabs = [['dashboard', 'Dashboard'], ['definition', 'Language Definition'], ['guide', 'Syntax Guide'], ['playground', 'Playground']];
  return (
    <>
      <header className="top">
        <button className="brand" onClick={() => setView('dashboard')}><Logo /> CodeCraft <em>{lang.name}</em></button>
        <nav>{tabs.map(([k, n]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{n}</button>)}</nav>
      </header>
      <main>
        {view === 'dashboard' && <Dashboard lang={lang} go={setView} />}
        {view === 'definition' && <Definition lang={lang} setLang={setLang} />}
        {view === 'guide' && <Guide lang={lang} />}
        {view === 'playground' && <Playground lang={lang} />}
      </main>
    </>
  );
}
