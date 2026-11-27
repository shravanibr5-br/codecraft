// A language DEFINITION. Teams edit this in the app ("Language Definition" tab) or here to set the starting language.
// Statement templates: words/symbols are literal, {slots} are filled by the program, [ ... ] is optional.
//   {name} {var}: identifier   {params}: identifiers   {values} {args}: comma lists   other {x}: one expression
export const NOVA = {
  name: 'NOVA', fileExtension: '.nova',
  tagline: 'Readable programs, written like plain sentences.',
  purpose: 'NOVA is a beginner-friendly language where every statement starts with a verb. Blocks close with the word end, so there are no braces or semicolons to track.',
  comment: '#', loopVariable: 'i', parenCalls: true,
  statements: {
    declare: 'let {name} = {value}', assign: '{name} = {value}', output: 'say {values}', input: 'ask {name} [{prompt}]',
    if: 'if {cond} then', while: 'while {cond}', loop: 'repeat {var} from {from} to {to} [step {step}]',
    func: 'func {name}({params})', call: '', return: 'return [{value}]',
  },
  words: { else: 'else', end: 'end', and: 'and', or: 'or', not: 'not', true: 'true', false: 'false' },
  commands: [],
};

// A second, completely different language to show that nothing is hardcoded.
export const TASKLANG = {
  name: 'TASKLANG', fileExtension: '.task',
  tagline: 'Give tasks names, then do them.',
  purpose: 'TASKLANG programs are lists of tasks. Values are stated with "is", blocks close with done, and a task runs when you say do.',
  comment: '//', loopVariable: 'count', parenCalls: false,
  statements: {
    declare: '{name} is {value}', assign: '', output: 'show {values}', input: 'ask {name} [{prompt}]',
    if: 'when {cond}', while: '', loop: 'count from {from} to {to} [step {step}]',
    func: 'task {name} [with {params}]', call: 'do {name} [with {args}]', return: 'give [{value}]',
  },
  words: { else: 'else', end: 'done', and: 'and', or: 'or', not: 'not', true: 'true', false: 'false' },
  commands: [{ template: 'shout {values}', action: 'print-upper' }, { template: 'bump {name}', action: 'increment' }, { template: 'mood {word}', action: 'console-color' }],
};
export const language = NOVA; // default starting language
