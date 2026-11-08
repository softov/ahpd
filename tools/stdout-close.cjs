// Debug only: which way of closing a child's stdout ends the parent's stream, while the child keeps running.
const { spawn } = require('node:child_process');
const variants = {
  end: "process.stdout.end(); setInterval(() => {}, 1000);",
  closeSync: "require('node:fs').closeSync(1); setInterval(() => {}, 1000);",
  handle: "process.stdout._handle.close(); setInterval(() => {}, 1000);",
  handleAndFd: "process.stdout._handle.close(); try { require('node:fs').closeSync(1); } catch {} setInterval(() => {}, 1000);",
  destroy: "process.stdout.destroy(); setInterval(() => {}, 1000);",
};
for (const [name, code] of Object.entries(variants)) {
  const at = Date.now();
  const child = spawn(process.execPath, ['-e', code], { stdio: ['pipe', 'pipe', 'pipe'] });
  let said = false;
  child.stdout.on('end', () => { said = true; console.log(`${name}: stdout ended after ${Date.now() - at} ms`); child.kill(); });
  child.stderr.on('data', (chunk) => { console.log(`${name} stderr: ${String(chunk).slice(0, 200)}`); });
  setTimeout(() => { if (!said) console.log(`${name}: no end in 5 s`); child.kill(); }, 5000);
}
