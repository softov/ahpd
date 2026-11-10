/*
 * install.ps1, run the way a person on Windows gets it.
 *
 * Every case makes a home folder of its own and puts stub `node`, `npm`, `bun`
 * and `ahpd` commands on the PATH. The stubs are `.cmd` files that write what
 * they were called with to a log, so a case reads which command the script
 * chose rather than downloading the package. The script is dot-sourced with
 * AHPD_INSTALL_NO_RUN=1 and Invoke-AhpdInstall is called, so the environment
 * twins are the ones `irm | iex` reads.
 *
 * The cases skip unless a PowerShell 7 is here and this is Windows: the script
 * writes the user PATH, and .NET has no user target outside Windows.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../install.ps1', import.meta.url));

/** The folder PowerShell 7 runs from, or undefined when there is none. */
function pwshFolder(): string | undefined {
  const probe = spawnSync('pwsh', ['-NoProfile', '-Command', '(Get-Process -Id $PID).Path'], {
    encoding: 'utf8',
  });
  return probe.status === 0 ? dirname(probe.stdout.trim()) : undefined;
}

const pwshAt = pwshFolder();
const pwshHere = pwshAt !== undefined;
const canRun = process.platform === 'win32' && pwshHere;

/*
 * What a case's PATH holds besides its own folders: PowerShell's folder, for
 * `pwsh`, and Windows' own, for the `cmd` the stubs run in.
 *
 * Not the PATH this run inherited. On a person's machine that holds their own
 * ahpd, Bun or Deno, and the script found the person's ahpd there in place of
 * a stub, or of none.
 */
const windowsFolder = process.env.SystemRoot ?? 'C:\\Windows';
const basePath = [pwshAt, join(windowsFolder, 'System32'), windowsFolder]
  .filter((one) => one !== undefined)
  .join(';');

/** The run's environment without its PATH, which a case names itself; Windows spells the key `Path`. */
const inherited = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));

function stub(box: Box, name: string, lines: string[]): void {
  writeFileSync(join(box.bin, `${name}.cmd`), `@echo off\r\n${lines.join('\r\n')}\r\n`);
}

interface Box {
  root: string;
  home: string;
  bin: string;
  folder: string;
  log: string;
  env: Record<string, string>;
}

function makeBox(options: { node?: string; ahpd?: boolean } = {}): Box {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-install-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const folder = join(root, 'npm-global');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(folder, { recursive: true });
  const log = join(root, 'calls.log');
  writeFileSync(log, '');

  const box: Box = {
    root,
    home,
    bin,
    folder,
    log,
    env: {
      USERPROFILE: home,
      HOME: home,
      XDG_CONFIG_HOME: join(root, 'config'),
      AHPD_TEST_LOG: log,
      PATH: `${bin};${basePath}`,
      AHPD_SCRIPT: script,
      AHPD_INSTALL_NO_RUN: '1',
      AHPD_VERSION: '',
      AHPD_PACKAGE: '',
      AHPD_RUNTIME: '',
      AHPD_YES: '',
      AHPD_NO_ONBOARD: '',
      AHPD_DRY_RUN: '',
      AHPD_VERBOSE: '',
      AHPD_HELP: '',
      AHPD_UNINSTALL: '',
      AHPD_PURGE: '',
      STUB_NODE_VERSION: options.node ?? '22.18.0',
      STUB_NPM_VERSION: '11.16.0',
      STUB_NPM_PREFIX: folder,
      STUB_NPM_VIEW_VERSION: '0.13.0',
      STUB_NPM_INSTALLED_FILE: join(root, 'installed-version'),
      STUB_NPM_INSTALL_EXIT: '0',
      STUB_AHPD_VERSION: '0.12.0',
      STUB_AHPD_VERSION_FILE: join(root, 'installed-version'),
      STUB_AHPD_RUNNING: '0',
      STUB_BUN_INSTALL: join(root, 'bun'),
    },
  };

  stub(box, 'node', [
    `if "%1"=="--version" echo v%STUB_NODE_VERSION%`,
    'exit /b 0',
  ]);
  stub(box, 'npm', [
    `echo npm %*>>"%AHPD_TEST_LOG%"`,
    'if "%1"=="--version" echo %STUB_NPM_VERSION%',
    'if "%1"=="prefix" echo %STUB_NPM_PREFIX%',
    'if "%1"=="config" echo %STUB_NPM_PREFIX%',
    'if "%1"=="view" echo %STUB_NPM_VIEW_VERSION%',
    'if "%1"=="install" goto install',
    'exit /b 0',
    ':install',
    'if not "%STUB_NPM_INSTALL_EXIT%"=="0" echo npm ERR! simulated failure & exit /b %STUB_NPM_INSTALL_EXIT%',
    '> "%STUB_NPM_INSTALLED_FILE%" echo %STUB_NPM_VIEW_VERSION%',
    'exit /b 0',
  ]);
  stub(box, 'bun', [
    `echo bun %*>>"%AHPD_TEST_LOG%"`,
    'if "%1"=="--version" echo 1.3.0',
    'exit /b 0',
  ]);
  if (options.ahpd === true) {
    writeAhpd(box);
  }
  return box;
}

/*
 * `status` exits 0 only while the stub daemon runs, which is what the uninstall
 * reads to decide whether to stop it. `--version` prints the file the npm stub
 * writes when it "installs", so after an update the same command prints the new
 * version, as a real one would.
 */
function ahpdStub(): string[] {
  return [
    `echo ahpd %*>>"%AHPD_TEST_LOG%"`,
    'if "%1"=="--version" goto version',
    'if "%1"=="status" if "%STUB_AHPD_RUNNING%"=="1" exit /b 0',
    'if "%1"=="status" exit /b 1',
    'exit /b 0',
    ':version',
    'if exist "%STUB_AHPD_VERSION_FILE%" type "%STUB_AHPD_VERSION_FILE%"',
    'if not exist "%STUB_AHPD_VERSION_FILE%" echo %STUB_AHPD_VERSION%',
    'exit /b 0',
  ];
}

function writeAhpd(box: Box): void {
  stub(box, 'ahpd', ahpdStub());
}

/*
 * An ahpd the way npm leaves one on Windows: the shim sits in the prefix folder
 * itself, and node_modules is beside it, which is what the script reads as an
 * npm prefix. The shim prints `version` until the npm stub overwrites the file.
 */
function installAhpd(box: Box, version: string): string {
  mkdirSync(join(box.folder, 'node_modules', '@ahpd', 'server'), { recursive: true });
  const shim = join(box.folder, 'ahpd.cmd');
  writeFileSync(shim, `@echo off\r\n${ahpdStub().join('\r\n')}\r\n`);
  writeFileSync(box.env.STUB_AHPD_VERSION_FILE, `${version}\r\n`);
  return shim;
}

function withFolder(box: Box): string {
  return `${box.folder};${box.env.PATH}`;
}

function writeDeno(box: Box): void {
  stub(box, 'deno', [
    'if "%1"=="--version" echo 2.0.0',
    'exit /b 0',
  ]);
}

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(box: Box, extra: Record<string, string> = {}): Result {
  const result = spawnSync('pwsh', ['-NoProfile', '-Command', '. $env:AHPD_SCRIPT; Invoke-AhpdInstall'], {
    env: { ...inherited(), ...box.env, ...extra },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runFile(box: Box, args: string[], extra: Record<string, string> = {}): Result {
  const result = spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], {
    // The gate would otherwise skip the run the case is asking for.
    env: { ...inherited(), ...box.env, AHPD_INSTALL_NO_RUN: '0', ...extra },
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function calls(box: Box): string[] {
  if (!existsSync(box.log)) {
    return [];
  }
  return readFileSync(box.log, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line !== '');
}

function userPath(): string {
  const result = spawnSync(
    'pwsh',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path', 'User')"],
    { encoding: 'utf8' },
  );
  return (result.stdout ?? '').trim();
}

function countEntry(value: string, folder: string): number {
  const target = folder.replace(/\\+$/, '').toLowerCase();
  return value
    .split(';')
    .map((entry) => entry.trim().replace(/\\+$/, '').toLowerCase())
    .filter((entry) => entry === target).length;
}

// The script is for Windows, but its syntax is the same everywhere, so a
// machine with a PowerShell parses it even when the cases below cannot run.
describe.skipIf(!pwshHere)('install.ps1 syntax', () => {
  it('parses', () => {
    const command =
      '$tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($env:AHPD_SCRIPT, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }';
    const result = spawnSync('pwsh', ['-NoProfile', '-Command', command], {
      env: { ...process.env, AHPD_SCRIPT: script },
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
  });
});

describe.skipIf(!canRun)('install.ps1', () => {
  // The cases write the real user PATH, because that is the step under test.
  // The runner's own value goes back at the end, so a failure leaves no
  // temporary folder behind on a machine that runs this suite by hand.
  let originalUserPath = '';

  beforeAll(() => {
    originalUserPath = userPath();
  });

  afterAll(() => {
    spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-Command',
        "[Environment]::SetEnvironmentVariable('Path', $env:AHPD_ORIGINAL_USER_PATH, 'User')",
      ],
      { env: { ...process.env, AHPD_ORIGINAL_USER_PATH: originalUserPath }, encoding: 'utf8' },
    );
  });

  it('prints one runtime line each for Node, Bun and Deno, in that order', () => {
    const box = makeBox();
    writeDeno(box);

    const result = run(box, { AHPD_NO_ONBOARD: '1' });

    expect(result.code).toBe(0);
    const lines = result.stdout.split(/\r?\n/);
    const node = lines.indexOf('Node v22.18.0 (runs ahpd)');
    const bun = lines.indexOf('Bun 1.3.0 (runs ahpd)');
    const deno = lines.indexOf('Deno 2.0.0 (runs ahpd; each plugin it loads needs an npm: spec)');
    expect(node).toBeGreaterThanOrEqual(0);
    expect(bun).toBeGreaterThan(node);
    expect(deno).toBeGreaterThan(bun);
  });

  it('says a runtime it did not find is not found', () => {
    const box = makeBox();

    const result = run(box, { AHPD_NO_ONBOARD: '1' });

    expect(result.stdout).toContain('Deno not found');
  });

  it('says Node below 22.18 is too old, and names the floor', () => {
    const box = makeBox({ node: '22.17.0' });

    const result = run(box, { AHPD_NO_ONBOARD: '1' });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('Node v22.17.0 (ahpd does not run on it; it needs Node 22.18 or newer)');
  });

  it('prints the runtime lines under -DryRun', () => {
    const box = makeBox();
    writeDeno(box);

    const result = run(box, { AHPD_DRY_RUN: '1', AHPD_NO_ONBOARD: '1' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Node v22.18.0 (runs ahpd)');
    expect(result.stdout).toContain('Bun 1.3.0 (runs ahpd)');
    expect(result.stdout).toContain('Deno 2.0.0 (runs ahpd; each plugin it loads needs an npm: spec)');
  });

  it('installs the package and adds the npm folder to the user PATH once', () => {
    const box = makeBox();

    const result = run(box, { AHPD_NO_ONBOARD: '1' });

    expect(result.code).toBe(0);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.folder} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
    expect(countEntry(userPath(), box.folder)).toBe(1);
  });

  it('updates the ahpd it finds, in the folder that holds it', () => {
    const box = makeBox();
    run(box, { AHPD_NO_ONBOARD: '1' });
    installAhpd(box, '0.12.0');

    const result = run(box, { AHPD_NO_ONBOARD: '1', AHPD_YES: '1', PATH: withFolder(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.folder}.`);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.folder} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
    expect(calls(box)).toContain('ahpd plugin update all');
    expect(result.stdout).toContain('ahpd restart');
    expect(countEntry(userPath(), box.folder)).toBe(1);
  });

  it('stops when the ahpd it finds is already the target version', () => {
    const box = makeBox();
    installAhpd(box, '0.13.0');

    const result = run(box, { AHPD_NO_ONBOARD: '1', AHPD_YES: '1', PATH: withFolder(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `ahpd 0.13.0 is installed at ${box.folder}, already at 0.13.0. Nothing to update.`,
    );
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  it('stops and names the folder when the ahpd is not in an npm prefix', () => {
    const box = makeBox({ ahpd: true });

    const result = run(box, { AHPD_NO_ONBOARD: '1', AHPD_YES: '1' });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(`${box.bin}\\ahpd.cmd`);
    expect(`${result.stdout}${result.stderr}`).toContain('not a folder npm installed it in');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  it('stops without a terminal when the answer is not -Yes', () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = run(box, { AHPD_NO_ONBOARD: '1', PATH: withFolder(box) });

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.folder}.`);
    expect(`${result.stdout}${result.stderr}`).toContain('Update it to 0.13.0?');
    expect(`${result.stdout}${result.stderr}`).toContain('-Yes');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  it('fails when npm fails, even though an ahpd is installed', () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = run(box, {
      AHPD_NO_ONBOARD: '1',
      AHPD_YES: '1',
      PATH: withFolder(box),
      STUB_NPM_INSTALL_EXIT: '7',
    });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('npm install failed with exit code 7');
    expect(`${result.stdout}${result.stderr}`).not.toContain('carrying on');
  });

  it('fails when the ahpd on the PATH still prints the old version', () => {
    const box = makeBox();
    const shim = installAhpd(box, '0.12.0');

    const result = run(box, {
      AHPD_NO_ONBOARD: '1',
      AHPD_YES: '1',
      PATH: withFolder(box),
      // The install writes its version somewhere else: the command on the PATH
      // is the second ahpd that stayed at the old version.
      STUB_NPM_INSTALLED_FILE: join(box.root, 'another-version'),
    });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(shim);
    expect(`${result.stdout}${result.stderr}`).toContain('0.13.0');
  });

  it('prints the question and the folder under -DryRun', () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = run(box, {
      AHPD_NO_ONBOARD: '1',
      AHPD_DRY_RUN: '1',
      PATH: withFolder(box),
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.folder}.`);
    expect(result.stdout).toContain('Update it to 0.13.0?');
    expect(result.stdout).toContain(`would run: npm install -g --prefix ${box.folder}`);
  });

  it('throws on an unknown runtime instead of exiting the session', () => {
    const box = makeBox();

    const result = run(box, { AHPD_RUNTIME: 'deno' });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Unknown runtime: deno');
  });

  it('throws on an unknown -Runtime flag too', () => {
    const box = makeBox();

    const result = runFile(box, ['-Runtime', 'deno']);

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Unknown runtime: deno');
  });

  it('skips ahpd configure when AHPD_NO_ONBOARD is set', () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = run(box, { AHPD_NO_ONBOARD: '1', AHPD_YES: '1', PATH: withFolder(box) });

    expect(result.code).toBe(0);
    expect(calls(box)).not.toContain('ahpd configure');
  });

  it('takes -Yes as the answer to the question', () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = runFile(box, ['-Yes'], { AHPD_NO_ONBOARD: '1', PATH: withFolder(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.folder}.`);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.folder} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
  });

  it('changes nothing under -DryRun', () => {
    const box = makeBox();
    const before = countEntry(userPath(), box.folder);

    const result = run(box, { AHPD_DRY_RUN: '1', AHPD_NO_ONBOARD: '1' });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would run: npm install');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
    expect(countEntry(userPath(), box.folder)).toBe(before);
  });

  it('installs with bun under -Runtime bun', () => {
    const box = makeBox();
    const bunHome = join(box.root, 'bun');
    mkdirSync(join(bunHome, 'bin'), { recursive: true });

    const result = run(box, { AHPD_RUNTIME: 'bun', AHPD_NO_ONBOARD: '1', BUN_INSTALL: bunHome });

    expect(result.code).toBe(0);
    expect(calls(box)).toContain('bun add -g @ahpd/server');
    expect(countEntry(userPath(), join(bunHome, 'bin'))).toBe(1);
  });

  it('removes the package and the PATH entry under -Uninstall', () => {
    const box = makeBox();
    run(box, { AHPD_NO_ONBOARD: '1' });
    expect(countEntry(userPath(), box.folder)).toBe(1);
    writeAhpd(box);

    const result = run(box, { AHPD_UNINSTALL: '1' });

    expect(result.code).toBe(0);
    expect(calls(box)).toContain('npm uninstall -g @ahpd/server');
    expect(countEntry(userPath(), box.folder)).toBe(0);
  });

  it('stops the daemon before removing the package', () => {
    const box = makeBox({ ahpd: true });

    const result = run(box, { AHPD_UNINSTALL: '1', STUB_AHPD_RUNNING: '1' });

    expect(result.code).toBe(0);
    const lines = calls(box);
    const stopped = lines.indexOf('ahpd stop');
    const removed = lines.indexOf('npm uninstall -g @ahpd/server');
    expect(stopped).toBeGreaterThanOrEqual(0);
    expect(removed).toBeGreaterThan(stopped);
  });

  it('keeps the configuration without -Purge and removes it with -Purge', () => {
    const kept = makeBox({ ahpd: true });
    const keptDir = join(kept.root, 'config', 'ahpd');
    mkdirSync(keptDir, { recursive: true });
    writeFileSync(join(keptDir, 'config.json'), '{}');
    const keptRun = run(kept, { AHPD_UNINSTALL: '1' });
    expect(keptRun.code).toBe(0);
    expect(existsSync(join(keptDir, 'config.json'))).toBe(true);

    const purged = makeBox({ ahpd: true });
    const purgedDir = join(purged.root, 'config', 'ahpd');
    mkdirSync(purgedDir, { recursive: true });
    writeFileSync(join(purgedDir, 'config.json'), '{}');
    const purgedRun = run(purged, { AHPD_UNINSTALL: '1', AHPD_PURGE: '1' });
    expect(purgedRun.code).toBe(0);
    expect(existsSync(purgedDir)).toBe(false);
  });

  it('throws for -Purge without -Uninstall', () => {
    const box = makeBox();

    const result = run(box, { AHPD_PURGE: '1' });

    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain('Purge needs Uninstall');
  });

  it('removes nothing under -DryRun', () => {
    const box = makeBox({ ahpd: true });
    run(box, { AHPD_NO_ONBOARD: '1' });
    const dir = join(box.root, 'config', 'ahpd');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'config.json'), '{}');
    const before = countEntry(userPath(), box.folder);

    const result = run(box, {
      AHPD_UNINSTALL: '1',
      AHPD_PURGE: '1',
      AHPD_DRY_RUN: '1',
      STUB_AHPD_RUNNING: '1',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would run: npm uninstall');
    expect(calls(box)).not.toContain('npm uninstall -g @ahpd/server');
    expect(countEntry(userPath(), box.folder)).toBe(before);
    expect(existsSync(join(dir, 'config.json'))).toBe(true);
  });
});
