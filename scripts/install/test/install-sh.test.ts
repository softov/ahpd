/*
 * install.sh, run the way a person gets it.
 *
 * Every case makes a home folder of its own and puts stub `node`, `npm`, `bun`
 * and `ahpd` commands on the PATH. The stubs write what they were called with
 * to a log, so a case can read which command the script chose: an install is a
 * line in that log, not a real package download. The script is sourced with
 * AHPD_INSTALL_NO_RUN=1 and its `main` is called with the flags, so the flags
 * and every step are the same ones a person runs.
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { posix } from '../../../tools/posix';

const script = fileURLToPath(new URL('../install.sh', import.meta.url));
const MARKER = '# added by the ahpd install script';

interface Box {
  root: string;
  home: string;
  bin: string;
  prefix: string;
  log: string;
  env: Record<string, string>;
}

interface Result {
  code: number | null;
  stdout: string;
  stderr: string;
}

function stub(box: Box, name: string, body: string): void {
  const path = join(box.bin, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  chmodSync(path, 0o755);
}

function writeNode(box: Box, version: string): void {
  stub(box, 'node', `printf 'node %s\\n' "$*" >> "$AHPD_TEST_LOG"\nprintf 'v${version}\\n'`);
}

function writeNpm(box: Box): void {
  stub(
    box,
    'npm',
    [
      `printf 'npm %s\\n' "$*" >> "$AHPD_TEST_LOG"`,
      'case "$1" in',
      '  --version) printf \'%s\\n\' "$STUB_NPM_VERSION" ;;',
      '  prefix) printf \'%s\\n\' "$STUB_NPM_PREFIX" ;;',
      '  config) printf \'%s\\n\' "$STUB_NPM_PREFIX" ;;',
      '  view) printf \'%s\\n\' "$STUB_NPM_VIEW_VERSION" ;;',
      '  install)',
      '    if [ "${STUB_NPM_INSTALL_EXIT:-0}" -ne 0 ]; then',
      '      printf \'npm ERR! simulated failure\\n\'',
      '      exit "$STUB_NPM_INSTALL_EXIT"',
      '    fi',
      '    last=\'\'',
      '    for a in "$@"; do last="$a"; done',
      '    case "${last##*@}" in',
      '      [0-9]*) printf \'%s\\n\' "${last##*@}" > "$STUB_NPM_INSTALLED_FILE" ;;',
      '      *) printf \'%s\\n\' "$STUB_NPM_VIEW_VERSION" > "$STUB_NPM_INSTALLED_FILE" ;;',
      '    esac',
      '    ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'),
  );
}

function writeBun(box: Box): void {
  stub(
    box,
    'bun',
    [
      `printf 'bun %s\\n' "$*" >> "$AHPD_TEST_LOG"`,
      'case "$*" in',
      '  --version) printf \'1.3.0\\n\' ;;',
      '  *) exit 0 ;;',
      'esac',
    ].join('\n'),
  );
}

function writeDeno(box: Box, version: string): void {
  stub(box, 'deno', `printf '${version}\\n'`);
}

/*
 * `status --json` exits 0 only while the stub daemon runs, which is what the
 * uninstall reads to decide whether to stop it; a running daemon's record also
 * carries `service`, which is what it reads to decide whether to remove one.
 *
 * `--version` prints the file the npm stub writes when it "installs", so after
 * an update the same command prints the new version, as a real one would.
 */
function ahpdStub(): string {
  return [
    `printf 'ahpd %s\\n' "$*" >> "$AHPD_TEST_LOG"`,
    'case "$*" in',
    '  --version)',
    '    if [ -n "${STUB_AHPD_VERSION_FILE:-}" ] && [ -f "$STUB_AHPD_VERSION_FILE" ]; then',
    '      cat "$STUB_AHPD_VERSION_FILE"',
    '    else',
    '      printf \'%s\\n\' "${STUB_AHPD_VERSION:-0.12.0}"',
    '    fi',
    '    ;;',
    '  "status --json")',
    '    if [ "${STUB_AHPD_RUNNING:-0}" = 1 ]; then',
    '      printf \'{"pid":1,"url":"ws://127.0.0.1:1","paths":[],"service":"systemd"}\\n\'',
    '      exit 0',
    '    fi',
    '    printf \'{"running":false}\\n\'',
    '    exit 1',
    '    ;;',
    '  *) exit 0 ;;',
    'esac',
  ].join('\n');
}

function writeAhpd(box: Box): void {
  stub(box, 'ahpd', ahpdStub());
}

/*
 * An ahpd the way npm leaves one: <prefix>/bin/ahpd is a link into
 * <prefix>/lib/node_modules/<package>, which is the folder the script reads the
 * prefix from. The file the stub prints starts at `version`, and the npm stub
 * overwrites it with the version it installed.
 */
function installAhpd(box: Box, version: string): string {
  const folder = join(box.prefix, 'lib', 'node_modules', '@ahpd', 'server', 'dist');
  mkdirSync(folder, { recursive: true });
  const real = join(folder, 'main.js');
  writeFileSync(real, `#!/bin/sh\n${ahpdStub()}\n`, { mode: 0o755 });
  chmodSync(real, 0o755);
  const link = join(box.prefix, 'bin', 'ahpd');
  symlinkSync(real, link);
  writeFileSync(box.env.STUB_AHPD_VERSION_FILE, `${version}\n`);
  return link;
}

function withPrefix(box: Box): string {
  return `${box.prefix}/bin:${box.env.PATH}`;
}

function makeBox(options: { node?: string; ahpd?: boolean } = {}): Box {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-install-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const prefix = join(root, 'prefix');
  mkdirSync(home, { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  const log = join(root, 'calls.log');
  writeFileSync(log, '');

  const box: Box = {
    root,
    home,
    bin,
    prefix,
    log,
    env: {
      HOME: home,
      USERPROFILE: home,
      SHELL: '/bin/bash',
      PATH: `${bin}:/usr/bin:/bin`,
      AHPD_TEST_LOG: log,
      NVM_DIR: join(home, '.nvm'),
      XDG_CONFIG_HOME: '',
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
      STUB_NPM_PREFIX: prefix,
      STUB_NPM_VIEW_VERSION: '0.13.0',
      STUB_NPM_INSTALLED_FILE: join(root, 'installed-version'),
      STUB_NPM_INSTALL_EXIT: '0',
      STUB_AHPD_VERSION: '0.12.0',
      STUB_AHPD_VERSION_FILE: join(root, 'installed-version'),
      STUB_AHPD_RUNNING: '0',
    },
  };

  writeNode(box, options.node ?? '22.18.0');
  writeNpm(box);
  writeBun(box);
  if (options.ahpd === true) {
    writeAhpd(box);
  }
  return box;
}

function run(box: Box, args: string[], extra: Record<string, string> = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', 'source "$1"; shift; main "$@"', 'ahpd-install', script, ...args], {
      env: { ...process.env, ...box.env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/*
 * The question is read from /dev/tty, so a case that answers it needs a
 * terminal. util-linux's `script` gives the run a pty, and what is written to
 * its stdin arrives as the typed answer.
 */
const ptyScript = '/usr/bin/script';
const canUsePty = process.platform === 'linux' && existsSync(ptyScript);

function runTty(
  box: Box,
  args: string[],
  answer: string,
  extra: Record<string, string> = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const command = `bash -c "source '${script}'; main ${args.join(' ')}"`;
    const child = spawn(ptyScript, ['-qec', command, '/dev/null'], {
      env: { ...process.env, ...box.env, ...extra },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    // The prompt is up once the script has read it; a moment later the answer
    // is in the pty and the read returns it.
    setTimeout(() => {
      child.stdin.write(`${answer}\n`);
      child.stdin.end();
    }, 200);
  });
}

function calls(box: Box): string[] {
  return readFileSync(box.log, 'utf8')
    .split('\n')
    .filter((line) => line !== '');
}

function rcFile(box: Box): string {
  return join(box.home, '.bashrc');
}

function rcLines(box: Box): string[] {
  if (!existsSync(rcFile(box))) {
    return [];
  }
  return readFileSync(rcFile(box), 'utf8').split('\n');
}

function exportsIn(box: Box): string[] {
  return rcLines(box).filter((line) => line.startsWith('export PATH='));
}

function linesOf(box: Box, name: string): string[] {
  const file = join(box.home, name);
  if (!existsSync(file)) {
    return [];
  }
  return readFileSync(file, 'utf8').split('\n');
}

function exportsOf(box: Box, name: string): string[] {
  return linesOf(box, name).filter((line) => line.startsWith('export PATH='));
}

function configDir(box: Box): string {
  return join(box.home, '.config', 'ahpd');
}

describe.skipIf(!posix)('install.sh', () => {
  it('prints one runtime line each for Node, Bun and Deno, in that order', async () => {
    const box = makeBox();
    writeDeno(box, '2.0.0');
    const result = await run(box, ['--no-onboard']);

    expect(result.code).toBe(0);
    const lines = result.stdout.split('\n');
    const node = lines.indexOf('Node v22.18.0 (runs ahpd)');
    const bun = lines.indexOf('Bun 1.3.0 (runs ahpd)');
    const deno = lines.indexOf('Deno 2.0.0 (runs ahpd; each plugin it loads needs an npm: spec)');
    expect(node).toBeGreaterThanOrEqual(0);
    expect(bun).toBeGreaterThan(node);
    expect(deno).toBeGreaterThan(bun);
  });

  it('says a runtime it did not find is not found', async () => {
    const box = makeBox();
    const result = await run(box, ['--no-onboard']);

    expect(result.stdout).toContain('Deno not found');
  });

  it('says Node below 22.18 is too old, and names the floor', async () => {
    const box = makeBox({ node: '22.17.0' });
    const result = await run(box, ['--no-onboard']);

    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('Node v22.17.0 (ahpd does not run on it; it needs Node 22.18 or newer)');
  });

  it('prints the runtime lines under --dry-run', async () => {
    const box = makeBox();
    writeDeno(box, '2.0.0');
    const result = await run(box, ['--dry-run', '--no-onboard']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Node v22.18.0 (runs ahpd)');
    expect(result.stdout).toContain('Bun 1.3.0 (runs ahpd)');
    expect(result.stdout).toContain('Deno 2.0.0 (runs ahpd; each plugin it loads needs an npm: spec)');
  });

  it('installs the package into the writable npm prefix and adds the PATH line once', async () => {
    const box = makeBox();
    const result = await run(box, ['--no-onboard']);

    expect(result.code).toBe(0);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.prefix} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
    expect(exportsIn(box)).toEqual([`export PATH="${box.prefix}/bin:$PATH"`]);
    expect(rcLines(box).filter((line) => line === MARKER)).toHaveLength(1);
    expect(result.stdout).toContain('Next: ahpd service install');
  });

  it('reads the package, version and flags from the AHPD_* variables', async () => {
    const box = makeBox();
    const result = await run(box, [], {
      AHPD_VERSION: '0.12.0',
      AHPD_NO_ONBOARD: '1',
    });

    expect(result.code).toBe(0);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.prefix} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server@0.12.0`,
    );
  });

  it('updates the ahpd it finds, in the prefix that holds it', async () => {
    const box = makeBox();
    await run(box, ['--no-onboard']);
    installAhpd(box, '0.12.0');

    const result = await run(box, ['--no-onboard', '--yes'], { PATH: withPrefix(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.prefix}.`);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.prefix} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
    expect(calls(box)).toContain('ahpd plugin update all');
    expect(result.stdout).toContain('ahpd restart');
    expect(exportsIn(box)).toHaveLength(1);
    expect(rcLines(box).filter((line) => line === MARKER)).toHaveLength(1);
  });

  it('stops when the ahpd it finds is already the target version', async () => {
    const box = makeBox();
    installAhpd(box, '0.13.0');

    const result = await run(box, ['--no-onboard', '--yes'], { PATH: withPrefix(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `ahpd 0.13.0 is installed at ${box.prefix}, already at 0.13.0. Nothing to update.`,
    );
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  /*
   * A login shell that skips ~/.bashrc, as `sudo -iu <user>` runs, has no PATH
   * line, so the ahpd of the first install is only in the prefix's bin folder.
   */
  it('stops when the ahpd in the chosen prefix, not on the PATH, is already the target version', async () => {
    const box = makeBox();
    installAhpd(box, '0.13.0');

    const result = await run(box, ['--no-onboard', '--yes']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      `ahpd 0.13.0 is installed at ${box.prefix}, already at 0.13.0. Nothing to update.`,
    );
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
    expect(result.stdout).not.toContain('ahpd restart');
  });

  it('updates the ahpd in the chosen prefix, not on the PATH, and says to restart', async () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = await run(box, ['--no-onboard', '--yes']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.prefix}.`);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.prefix} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
    expect(calls(box)).toContain('ahpd plugin update all');
    expect(result.stdout).toContain('ahpd restart');
  });

  it('stops and names the folder when the ahpd is not in an npm prefix', async () => {
    const box = makeBox();
    writeAhpd(box);

    const result = await run(box, ['--no-onboard', '--yes']);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`${box.bin}/ahpd`);
    expect(result.stderr).toContain('not a folder npm installed it in');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  it('stops when the prefix that holds the ahpd is not writable', async () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');
    chmodSync(box.prefix, 0o555);

    let result: Result;
    try {
      result = await run(box, ['--no-onboard', '--yes'], { PATH: withPrefix(box) });
    } finally {
      // The folder has to be removable again once the case is done.
      chmodSync(box.prefix, 0o755);
    }

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(box.prefix);
    expect(result.stderr).toContain('not writable');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  it('stops without a terminal when the answer is not --yes', async () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = await run(box, ['--no-onboard'], { PATH: withPrefix(box) });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.prefix}.`);
    expect(result.stderr).toContain('Update it to 0.13.0?');
    expect(result.stderr).toContain('--yes');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });

  it('fails when npm fails, even though an ahpd is installed', async () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = await run(box, ['--no-onboard', '--yes'], {
      PATH: withPrefix(box),
      STUB_NPM_INSTALL_EXIT: '7',
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('npm install failed with exit code 7');
    expect(result.stderr).not.toContain('carrying on');
  });

  it('fails when the ahpd on the PATH still prints the old version', async () => {
    const box = makeBox();
    const link = installAhpd(box, '0.12.0');

    const result = await run(box, ['--no-onboard', '--yes'], {
      PATH: withPrefix(box),
      // The install writes its version somewhere else: the command on the PATH
      // is the second ahpd that stayed at the old version.
      STUB_NPM_INSTALLED_FILE: join(box.root, 'another-version'),
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(link);
    expect(result.stderr).toContain('0.13.0');
  });

  it('prints the question and the folder under --dry-run', async () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = await run(box, ['--dry-run', '--no-onboard'], { PATH: withPrefix(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.prefix}.`);
    expect(result.stderr).toContain('Update it to 0.13.0?');
    expect(result.stdout).toContain(`install -g --prefix ${box.prefix}`);
  });

  it('exits 2 for an unknown flag and an unknown runtime', async () => {
    const unknownFlag = await run(makeBox(), ['--nope']);
    expect(unknownFlag.code).toBe(2);

    const unknownRuntime = await run(makeBox(), ['--runtime', 'deno']);
    expect(unknownRuntime.code).toBe(2);
  });

  it('stops without a terminal when Node is older than 22.18 and prints the nvm command', async () => {
    const box = makeBox({ node: '20.19.0' });
    const result = await run(box, ['--no-onboard']);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('nvm install 22');
    expect(calls(box)).not.toContain(
      `npm install -g --prefix ${box.prefix} --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
  });

  it('uses ~/.npm-global when the global prefix is not writable, and changes no npm setting', async () => {
    const box = makeBox();
    const readonly = join(box.root, 'readonly');
    mkdirSync(readonly);
    chmodSync(readonly, 0o555);

    const result = await run(box, ['--no-onboard'], { STUB_NPM_PREFIX: readonly });

    expect(result.code).toBe(0);
    expect(calls(box).some((line) => line.startsWith('npm config set'))).toBe(false);
    expect(calls(box)).toContain(
      `npm install -g --prefix ${box.home}/.npm-global --no-fund --no-audit --allow-scripts=node-pty @ahpd/server`,
    );
    expect(exportsIn(box)).toEqual([`export PATH="${box.home}/.npm-global/bin:$PATH"`]);
  });

  it('writes the PATH line into ~/.profile as well, which a login shell and a desktop session read', async () => {
    const box = makeBox();
    const readonly = join(box.root, 'readonly');
    mkdirSync(readonly);
    chmodSync(readonly, 0o555);

    const result = await run(box, ['--no-onboard'], { STUB_NPM_PREFIX: readonly });

    expect(result.code).toBe(0);
    const line = `export PATH="${box.home}/.npm-global/bin:$PATH"`;
    expect(exportsIn(box)).toEqual([line]);
    expect(exportsOf(box, '.profile')).toEqual([line]);
    expect(linesOf(box, '.profile').filter((entry) => entry === MARKER)).toHaveLength(1);
    expect(result.stdout).toContain('Desktop apps find ahpd from your next login.');
  });

  it('writes the login line into ~/.bash_profile when it exists, since bash then skips ~/.profile', async () => {
    const box = makeBox();
    writeFileSync(join(box.home, '.bash_profile'), '# my own line\n');

    const result = await run(box, ['--no-onboard']);

    expect(result.code).toBe(0);
    expect(exportsOf(box, '.bash_profile')).toEqual([`export PATH="${box.prefix}/bin:$PATH"`]);
    expect(linesOf(box, '.bash_profile')).toContain('# my own line');
    expect(existsSync(join(box.home, '.profile'))).toBe(false);
  });

  it('writes ~/.zshrc and ~/.zprofile under zsh', async () => {
    const box = makeBox();

    const result = await run(box, ['--no-onboard'], { SHELL: '/bin/zsh' });

    expect(result.code).toBe(0);
    const line = `export PATH="${box.prefix}/bin:$PATH"`;
    expect(exportsOf(box, '.zshrc')).toEqual([line]);
    expect(exportsOf(box, '.zprofile')).toEqual([line]);
    expect(existsSync(rcFile(box))).toBe(false);
    expect(existsSync(join(box.home, '.profile'))).toBe(false);
  });

  it('adds the login line when an update finds its PATH line in ~/.bashrc only', async () => {
    const box = makeBox();
    const line = `export PATH="${box.prefix}/bin:$PATH"`;
    writeFileSync(rcFile(box), `\n${MARKER}\n${line}\n`);

    const result = await run(box, ['--no-onboard'], { PATH: withPrefix(box) });

    expect(result.code).toBe(0);
    expect(exportsIn(box)).toEqual([line]);
    expect(exportsOf(box, '.profile')).toEqual([line]);
  });

  it('writes no PATH line when the bin folder is on the PATH and no file has its marker', async () => {
    const box = makeBox();

    const result = await run(box, ['--no-onboard'], { PATH: withPrefix(box) });

    expect(result.code).toBe(0);
    expect(existsSync(rcFile(box))).toBe(false);
    expect(existsSync(join(box.home, '.profile'))).toBe(false);
  });

  it('passes --allow-scripts only from npm 11.16', async () => {
    const old = makeBox();
    await run(old, ['--no-onboard'], { STUB_NPM_VERSION: '11.15.0' });
    const oldInstall = calls(old).find((line) => line.startsWith('npm install '));
    expect(oldInstall).not.toContain('--allow-scripts');

    const fresh = makeBox();
    await run(fresh, ['--no-onboard'], { STUB_NPM_VERSION: '11.16.0' });
    const freshInstall = calls(fresh).find((line) => line.startsWith('npm install '));
    expect(freshInstall).toContain('--allow-scripts=node-pty');
  });

  it('changes no file under --dry-run', async () => {
    const box = makeBox();
    const result = await run(box, ['--dry-run', '--no-onboard']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would run:');
    expect(existsSync(rcFile(box))).toBe(false);
    expect(existsSync(join(box.home, '.profile'))).toBe(false);
    expect(calls(box).some((line) => line.includes(' install '))).toBe(false);
  });

  it('installs with bun and puts the Bun bin folder on the PATH', async () => {
    const box = makeBox();
    const bunHome = join(box.root, 'bun');
    mkdirSync(join(bunHome, 'bin'), { recursive: true });

    const result = await run(box, ['--runtime', 'bun', '--no-onboard'], { BUN_INSTALL: bunHome });

    expect(result.code).toBe(0);
    expect(calls(box)).toContain('bun add -g @ahpd/server');
    expect(exportsIn(box)).toEqual([`export PATH="${bunHome}/bin:$PATH"`]);
  });
});

describe.skipIf(!canUsePty)('install.sh at a terminal', () => {
  it('asks before it updates an installed ahpd, and a no stops the update', async () => {
    const box = makeBox();
    installAhpd(box, '0.12.0');

    const result = await runTty(box, ['--no-onboard'], 'n', { PATH: withPrefix(box) });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain(`ahpd 0.12.0 is installed at ${box.prefix}.`);
    expect(result.stdout).toContain('Update it to 0.13.0?');
    expect(result.stdout).toContain('Left ahpd 0.12.0');
    expect(calls(box).some((line) => line.startsWith('npm install '))).toBe(false);
  });
});

describe.skipIf(!posix)('install.sh --uninstall', () => {
  it('removes the PATH line it wrote and leaves the npm prefix and npmrc alone', async () => {
    const box = makeBox();
    writeFileSync(rcFile(box), '# my own line\nexport FOO=bar\n');
    writeFileSync(join(box.home, '.npmrc'), 'prefix=/somewhere\n');
    await run(box, ['--no-onboard']);
    writeAhpd(box);

    const result = await run(box, ['--uninstall']);

    expect(result.code).toBe(0);
    expect(calls(box)).toContain('npm uninstall -g @ahpd/server');
    expect(exportsIn(box)).toEqual([]);
    expect(rcLines(box)).not.toContain(MARKER);
    expect(rcLines(box)).toContain('# my own line');
    expect(rcLines(box)).toContain('export FOO=bar');
    expect(readFileSync(join(box.home, '.npmrc'), 'utf8')).toBe('prefix=/somewhere\n');
  });

  it('keeps a linked rc file a link, with its mode, when it removes the PATH line', async () => {
    const box = makeBox();
    const target = join(box.home, 'dotfiles-bashrc');
    writeFileSync(target, '# my own line\n');
    chmodSync(target, 0o600);
    symlinkSync(target, rcFile(box));
    await run(box, ['--no-onboard']);
    writeAhpd(box);

    const result = await run(box, ['--uninstall']);

    expect(result.code).toBe(0);
    expect(lstatSync(rcFile(box)).isSymbolicLink()).toBe(true);
    expect(statSync(target).mode & 0o777).toBe(0o600);
    expect(readFileSync(target, 'utf8')).not.toContain(MARKER);
    expect(readFileSync(target, 'utf8')).toContain('# my own line');
  });

  it('removes the PATH lines that an install under another shell wrote', async () => {
    const box = makeBox();
    writeFileSync(join(box.home, '.profile'), '# my own line\n');
    await run(box, ['--no-onboard']);
    writeAhpd(box);
    expect(exportsOf(box, '.profile')).toHaveLength(1);

    const result = await run(box, ['--uninstall'], { SHELL: '/bin/zsh' });

    expect(result.code).toBe(0);
    expect(rcLines(box)).not.toContain(MARKER);
    expect(exportsIn(box)).toEqual([]);
    expect(linesOf(box, '.profile')).not.toContain(MARKER);
    expect(exportsOf(box, '.profile')).toEqual([]);
    expect(linesOf(box, '.profile')).toContain('# my own line');
  });

  it('removes the package from the prefix that holds the ahpd it finds', async () => {
    const box = makeBox();
    installAhpd(box, '0.13.0');
    const readonly = join(box.root, 'readonly');
    mkdirSync(readonly);

    const result = await run(box, ['--uninstall'], { PATH: withPrefix(box), STUB_NPM_PREFIX: readonly });

    expect(result.code).toBe(0);
    expect(calls(box)).toContain(`npm uninstall -g --prefix ${box.prefix} @ahpd/server`);
  });

  it('prints the uninstall with its prefix under --dry-run and runs nothing', async () => {
    const box = makeBox();
    installAhpd(box, '0.13.0');

    const result = await run(box, ['--uninstall', '--dry-run'], { PATH: withPrefix(box) });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`/npm uninstall -g --prefix ${box.prefix} @ahpd/server`);
    expect(calls(box).some((line) => line.startsWith('npm uninstall'))).toBe(false);
  });

  it('removes the service, then stops the daemon, then the package', async () => {
    const box = makeBox({ ahpd: true });
    const service = join(configDir(box), '..', 'systemd', 'user', 'ahpd.service');
    mkdirSync(join(configDir(box), '..', 'systemd', 'user'), { recursive: true });
    writeFileSync(service, '[Unit]\n');
    const result = await run(box, ['--uninstall'], { STUB_AHPD_RUNNING: '1' });

    expect(result.code).toBe(0);
    const lines = calls(box);
    const removed = lines.indexOf('ahpd service uninstall');
    const stopped = lines.indexOf('ahpd stop');
    const uninstalled = lines.indexOf('npm uninstall -g @ahpd/server');
    expect(removed).toBeGreaterThanOrEqual(0);
    expect(stopped).toBeGreaterThan(removed);
    expect(uninstalled).toBeGreaterThan(stopped);
  });

  it('keeps the configuration without --purge and removes it with --purge', async () => {
    const kept = makeBox({ ahpd: true });
    mkdirSync(configDir(kept), { recursive: true });
    writeFileSync(join(configDir(kept), 'config.json'), '{}\n');
    const keptRun = await run(kept, ['--uninstall']);
    expect(keptRun.code).toBe(0);
    expect(existsSync(join(configDir(kept), 'config.json'))).toBe(true);

    const purged = makeBox({ ahpd: true });
    mkdirSync(configDir(purged), { recursive: true });
    writeFileSync(join(configDir(purged), 'config.json'), '{}\n');
    const purgedRun = await run(purged, ['--uninstall', '--purge']);
    expect(purgedRun.code).toBe(0);
    expect(existsSync(configDir(purged))).toBe(false);
  });

  it('exits 2 for --purge without --uninstall', async () => {
    const result = await run(makeBox(), ['--purge']);
    expect(result.code).toBe(2);
  });

  it('removes nothing under --dry-run', async () => {
    const box = makeBox({ ahpd: true });
    writeFileSync(rcFile(box), `${MARKER}\nexport PATH="/x:$PATH"\n`);
    mkdirSync(configDir(box), { recursive: true });
    writeFileSync(join(configDir(box), 'config.json'), '{}\n');

    const result = await run(box, ['--uninstall', '--purge', '--dry-run']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('would remove');
    expect(readFileSync(rcFile(box), 'utf8')).toContain(MARKER);
    expect(existsSync(join(configDir(box), 'config.json'))).toBe(true);
    expect(calls(box)).not.toContain('npm uninstall -g @ahpd/server');
  });
});
