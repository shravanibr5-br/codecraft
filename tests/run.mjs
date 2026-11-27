import { runNova, NovaError } from '../src/interpreter.js';
import { NOVA, TASKLANG } from '../src/languageConfig.js';
let pass = 0, fail = 0;
async function exec(code, def, inputs = [], maxSteps) {
  const out = []; const q = [...inputs];
  try { await runNova(code, { print: s => out.push(s), setMood: m => out.push('[mood ' + m.name + ']'), input: async p => { out.push('«' + p + '»'); return q.shift() ?? ''; }, maxSteps }, def); return { out: out.join('\n') }; }
  catch (e) { if (!(e instanceof NovaError)) throw e; return { out: out.join('\n'), err: `${e.kind}@${e.line}: ${e.message}` }; }
}
function check(name, got, want) { const ok = got === want; ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`}`); }
const run = async (n, code, def, want, inp) => { const r = await exec(code, def, inp); check(n, r.err || r.out, want); };
const err = async (n, code, def, want) => check(n, (await exec(code, def)).err, want);

// ---- the team's own language (the required example) ----
await run('TASKLANG required example', `task greet
age is 20

when age > 18
    show "Welcome"
else
    show "Not eligible"
done

count from 1 to 5
    show count
done
done
do greet`, TASKLANG, 'Welcome\n1\n2\n3\n4\n5');
await run('TASKLANG else branch', 'age is 10\nwhen age > 18\n show "Welcome"\nelse\n show "Not eligible"\ndone', TASKLANG, 'Not eligible');
await run('TASKLANG task with params + call expression', 'task add with a, b\n give a + b\ndone\nshow do add with 2, 3\ntotal is do add with 10, 20\nshow total', TASKLANG, '5\n30');
await run('TASKLANG special commands', 'x is 1\nbump x\nbump x\nshout "hi", x', TASKLANG, 'HI 3');
await run('TASKLANG input + comment', '// ask\nask n "Number? "\nshow n * 2', TASKLANG, '«Number? »\n42', ['21']);
await run('TASKLANG count step', 'count from 10 to 1 step -4\n show count\ndone', TASKLANG, '10\n6\n2');
await run('mood command changes console', 'mood happy\nshow "hi"\nmood calm\nmood Sad', TASKLANG, '[mood happy]\nhi\n[mood calm]\n[mood sad]');
await err('unknown mood', 'mood grumpy', TASKLANG, "Runtime Error@1: Unknown mood 'grumpy'. Try: happy, sad, calm, angry, excited, normal, red, green, blue, gold, cyan, purple, pink, orange, white");
// ---- a third language with totally different words ----
const PIRATE = { name: 'ARRR', comment: '--', loopVariable: 'k', parenCalls: false,
  statements: { declare: 'set {name} to {value}', assign: '', output: 'yell {values}', input: '', if: 'should {cond} aye', while: 'keep {cond} sailing', loop: 'sail {var} from {from} to {to}', func: 'plan {name}({params})', call: 'cast {name} [using {args}]', return: 'bring {value}' },
  words: { else: 'arr', end: 'avast', and: 'plus', or: 'or', not: 'nay', true: 'yes', false: 'no' }, commands: [{ template: 'stopnow', action: 'stop' }] };
await run('Pirate factorial + loops', `-- factorial
plan fact(n)
  should n <= 1 aye
    bring 1
  avast
  bring n * cast fact using n - 1
avast
yell cast fact using 5
sail j from 1 to 3
  yell j
avast
set n to 2
keep n < 5 sailing
  set n to n + 2
avast
yell n, yes plus nay no
stopnow
yell "not reached"`, PIRATE, '120\n1\n2\n3\n6 true');
// ---- NOVA still works through its definition ----
await run('NOVA hello', 'say "Hello, World!"', NOVA, 'Hello, World!');
await run('NOVA variables', 'let name = "Nova"\nlet age = 3\nlet pi = 3.14\nlet active = true\nsay "Language: {name}, age {age}"\nsay pi, active', NOVA, 'Language: Nova, age 3\n3.14 true');
await run('NOVA add', 'let a = 12\nlet b = 30\nlet sum = a + b\nsay "{a} + {b} = {sum}"', NOVA, '12 + 30 = 42');
await run('NOVA even/odd', 'let n = 7\nif n % 2 == 0 then\n say "even"\nelse\n say "{n} is odd"\nend', NOVA, '7 is odd');
await run('NOVA largest of three', 'let a = 14\nlet b = 52\nlet c = 31\nlet largest = a\nif b > largest then\n largest = b\nend\nif c > largest then\n largest = c\nend\nsay "Largest is {largest}"', NOVA, 'Largest is 52');
await run('NOVA 1 to 10', 'repeat i from 1 to 10\n say i\nend', NOVA, '1\n2\n3\n4\n5\n6\n7\n8\n9\n10');
await run('NOVA sum 1..10', 'let total = 0\nrepeat i from 1 to 10\n total = total + i\nend\nsay "Sum: {total}"', NOVA, 'Sum: 55');
await run('NOVA else if', 'let t = 25\nif t > 30 then\n say "Hot"\nelse if t > 20 then\n say "Warm"\nelse\n say "Cool"\nend', NOVA, 'Warm');
await run('NOVA recursion + paren calls', 'func fact(n)\n if n <= 1 then\n  return 1\n end\n return n * fact(n - 1)\nend\nsay fact(10)', NOVA, '3628800');
await run('NOVA while + lists', 'let xs = [3, 9]\npush(xs, 1)\nlet n = 2\nwhile n > 0\n n = n - 1\nend\nsay xs, len(xs), n', NOVA, '[3, 9, 1] 3 0');
await run('NOVA input + function', 'func greet(who)\n return "Hello, " + who + "!"\nend\nask name "Name? "\nsay greet(name)', NOVA, '«Name? »\nHello, Ada!', ['Ada']);
// ---- errors follow the TEAM'S language rules, with line numbers ----
await err('NOVA keywords are not TASKLANG commands', 'say "hi"', TASKLANG, "Syntax Error@1: 'say' is not a command in this language. Check the Language Definition for the commands your team created");
await err('missing "to" shows own syntax', 'age is 1\ncount from 1 5\ndone', TASKLANG, "Syntax Error@2: Expected 'to' but found '5' — this command should look like: count from {from} to {to} [step {step}]");
await err('missing done', 'age is 3\nwhen age > 1\n show age', TASKLANG, "Syntax Error@2: Missing 'done' — the block that starts here was never closed");
await err('stray done', 'show 1\ndone', TASKLANG, "Syntax Error@2: Unexpected 'done' — there is no open block to close");
await err('missing value', 'x is', TASKLANG, "Syntax Error@1: Expected a value but found end of line — this command should look like: {name} is {value}");
await err('undefined variable', 'show 1\n\nshow missing', TASKLANG, "Runtime Error@3: Variable 'missing' is not defined");
await err('unknown task', 'do nothing', TASKLANG, "Runtime Error@1: Unknown function 'nothing'");
await err('division by zero', 'a is 1\nshow a / 0', TASKLANG, 'Runtime Error@2: Division by zero');
await err('infinite loop guard', 'while true\n let a = 1\nend', { ...NOVA }, undefined === 0 ? '' : 'Runtime Error@2: Stopped: the program ran too long (possible infinite loop)'.replace('@2', '@2'));
// ---- invalid definitions are reported clearly ----
await err('definition: missing output', 'x', { ...TASKLANG, statements: { ...TASKLANG.statements, output: '' } }, 'Language Definition Error@null: An output command is required, for example: show {values}');
await err('definition: declare needs {value}', 'x', { ...TASKLANG, statements: { ...TASKLANG.statements, declare: '{name} is' } }, 'Language Definition Error@null: Variable declaration "{name} is" must contain {value}');
await err('definition: bad end word', 'x', { ...TASKLANG, words: { ...TASKLANG.words, end: 'the end' } }, 'Language Definition Error@null: The word for "end" must be one word (letters, digits, _). Got "the end"');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
