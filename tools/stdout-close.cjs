// Debug only: which way of closing a child's stdout ends the parent's stream while the child keeps running, one child at a time.
const { spawn } = require('node:child_process');
const variants = [
  ['end', "process.stdout.end(); setInterval(() => {}, 1000);"],
  ['closeSync', "require('node:fs').closeSync(1); setInterval(() => {}, 1000);"],
  ['handleAndFd', "process.stdout._handle.close(); try { require('node:fs').closeSync(1); } catch {} setInterval(() => {}, 1000);"],
];
const one = ([name, code]) => new Promise((done) => {
  const at = Date.now();
  const child = spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'pipe'] });
  let said = false;
  child.stdout.on('end', () => { said = true; console.log(`${name}: stdout ended after ${Date.now() - at} ms, child still running: ${child.exitCode === null}`); child.kill(); });
  child.stderr.on('data', (chunk) => { console.log(`${name} stderr: ${String(chunk).slice(0, 200)}`); });
  child.on('exit', () => { setTimeout(done, 200); });
  setTimeout(() => { if (!said) console.log(`${name}: no end in 5 s`); child.kill(); }, 5000);
});
(async () => { for (const variant of variants) await one(variant); })();
