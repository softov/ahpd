---
title: Check daemon/41 on Windows
plans:
  - plans/daemon/41-a-terminal-under-bun-is-a-pseudoterminal/plan.md
---

# Check daemon/41 on Windows

daemon/41 is on main. Its cases pass on Linux against a stand-in of Bun.
This run checks the binding with a real Bun on Windows.
Bun 1.3.14 makes a ConPTY there, and Bun 1.3.13 makes no terminal on Windows.

## Set up

In PowerShell on Windows:

```powershell
git clone git@github.com:softov/ahpd.git $HOME\ahpd-check; cd $HOME\ahpd-check; pnpm install; pnpm build
foreach ($v in '1.3.14','1.3.13') {
  Invoke-WebRequest "https://github.com/oven-sh/bun/releases/download/bun-v$v/bun-windows-x64.zip" -OutFile "bun-$v.zip"
  Expand-Archive "bun-$v.zip" -DestinationPath "bun-$v" -Force
}
```

Save this script as `check.mjs` in `$HOME\ahpd-check`:

```js
const { pty } = await import('./packages/server/dist/pty.js');
const { pty: spawn } = await pty();
console.log(Bun.version, spawn === undefined ? 'pipes' : "Bun's own terminal");
if (spawn === undefined) process.exit(0);
const run = (file, args, options = {}) => new Promise((resolve) => {
  const term = spawn(file, args, { cols: 80, rows: 24, env: process.env, ...options });
  let out = '';
  term.onData((data) => { out += data; });
  term.onExit(({ exitCode }) => resolve({ out, exitCode }));
});
const cmd = process.env.ComSpec;
const line = await run(cmd, '/d /s /c "echo "a b" & exit 3"');
console.log('cmd.exe line:', line.exitCode, line.out.includes('"a b"'));
const argv = await run('powershell.exe', ['-NoProfile', '-Command', 'Write-Output "c d"; exit 4']);
console.log('PowerShell argv:', argv.exitCode, argv.out.includes('c d'));
const missing = await run(cmd, '/d /s /c "echo hi"', { cwd: 'C:\\not-there-at-all' });
console.log('missing folder:', missing.exitCode, JSON.stringify(missing.out.trim()));
const long = spawn(cmd, '/d /s /c "ping -t 127.0.0.1"', { cols: 80, rows: 24, env: process.env });
const ended = new Promise((resolve) => long.onExit(resolve));
setTimeout(() => long.kill(), 1000);
console.log('kill with no signal:', JSON.stringify(await ended));
```

## Bun 1.3.14: Bun's own terminal

1. Run `.\bun-1.3.14\bun-windows-x64\bun.exe check.mjs`.
2. Check that the first line ends with `Bun's own terminal`.
3. Check that `cmd.exe line:` shows `3 true`, so `cmd.exe` got its line as written.
4. Check that `PowerShell argv:` shows `4 true`.
5. Check that `missing folder:` shows `127` and Bun's error.
6. Check that `kill with no signal:` shows an exit, so the shell ended.

## Bun 1.3.13: pipes

1. Run `.\bun-1.3.13\bun-windows-x64\bun.exe check.mjs`.
2. Check that the line shows `1.3.13 pipes`.

## The daemon on Bun 1.3.14

1. Start the daemon with `.\bun-1.3.14\bun-windows-x64\bun.exe packages/server/dist/main.js`.
2. Open a terminal from a client, such as VS Code's agent host.
3. Check that the client draws the shell's prompt.
4. Run `ping -t 127.0.0.1`, and check that `^C` stops it.
5. Close the terminal, and check in Task Manager that its shell is gone.

## Reply

Write "pass" for each section, or what you saw.
