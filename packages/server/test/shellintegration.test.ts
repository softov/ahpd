/*
 * VS Code's shell integration, as the daemon hands it to the store.
 *
 * The injection is VS Code's own, fitted to this package: for each shell it
 * knows, the arguments that make the shell read one of the scripts at this
 * package's root, and the variables the script reads. A shell it does not
 * know is left exactly as it was.
 *
 * The last two cases run one for real: a bash given the integration marks the
 * command it runs, and the store reads the code from the mark. The first needs
 * `node-pty` to have been built, and skips when it has not; the second needs
 * Bun, and skips everywhere else.
 */

import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runtime, shellTerminals } from '@ahpd/sdk';
import type { SpawnPty } from '@ahpd/sdk';
import { getShellIntegrationInjection, shellIntegrationOf } from '../src/shellintegration.js';

/** The port as the daemon builds it under its default `zshFolder`. */
const shellIntegration = shellIntegrationOf('owned');
import { pty } from '../src/pty.js';

/** The folder the scripts are in: this package's root, from `test` and from `dist` alike. */
const scripts = fileURLToPath(new URL('../shellintegration', import.meta.url));

const nonce = 'the-terminal-nonce';

/** A Linux machine, so the injection's answers are the same on every runner. */
const linux = { platform: 'linux', windowsBuild: () => 0 };

/** What a shell is started with on Linux, or a failure saying why it is not. */
const injectionOf = (shell: string, args: string[] = []) => getShellIntegrationInjection(shell, args, nonce, {}, linux);

describe('the injection a shell is given', () => {
  it('starts bash, fish, pwsh and zsh with the script VS Code ships for each', () => {
    expect(injectionOf('/bin/bash')).toMatchObject({
      type: 'injection',
      newArgs: ['--init-file', `${scripts}/shellIntegration-bash.sh`],
      envMixin: { VSCODE_INJECTION: '1', VSCODE_NONCE: nonce },
    });
    expect(injectionOf('/usr/bin/fish')).toMatchObject({
      newArgs: ['--init-command', `source "${scripts}/shellIntegration.fish"`],
    });
    expect(injectionOf('/usr/bin/pwsh')).toMatchObject({
      newArgs: ['-noexit', '-command', `. "${scripts}/shellIntegration.ps1"`],
    });
    expect(injectionOf('/bin/zsh')).toMatchObject({ newArgs: ['-i'] });
  });

  it('points zsh at a folder of its own, holding the four startup files', () => {
    const asked = injectionOf('/bin/zsh');
    if (asked.type !== 'injection') throw new Error(`zsh was refused: ${asked.reason}`);
    // zsh reads its startup files from `$ZDOTDIR`, so the four stand in for
    // the person's own in a folder of their own, which the script sources them
    // from. They are copied by the port, before the shell starts.
    expect(asked.envMixin?.ZDOTDIR).toBeTypeOf('string');
    expect(asked.filesToCopy?.map((file) => file.dest.replace(asked.envMixin?.ZDOTDIR ?? '', '').replace(/^[\\/]/u, ''))).toEqual([
      '.zshrc', '.zprofile', '.zshenv', '.zlogin',
    ]);
    expect(asked.filesToCopy?.every((file) => file.source.startsWith(scripts))).toBe(true);
  });

  it('leaves a shell it does not know as it was', () => {
    // `sh` and `cmd` take no injection: VS Code has no script for either, and
    // a shell that does not read one is one that marks nothing.
    expect(injectionOf('/bin/sh')).toEqual({ type: 'failure', reason: 'UnsupportedShell' });
    expect(injectionOf('/bin/cmd.exe')).toEqual({ type: 'failure', reason: 'UnsupportedShell' });
    expect(shellIntegration('/bin/sh', [], {}, nonce)).toBeUndefined();
    expect(shellIntegration('/bin/cmd.exe', [], {}, nonce)).toBeUndefined();
  });

  it.skipIf(process.platform === 'win32')('refuses a zsh folder that is a symlink, and writes nothing where it points', () => {
    // The folder's name is known in advance, in a temporary folder others can
    // write: one planted as a symlink must not take the startup files.
    const shared = mkdtempSync(join(tmpdir(), 'ahpd-zsh-shared-'));
    const target = mkdtempSync(join(tmpdir(), 'ahpd-zsh-target-'));
    symlinkSync(target, join(shared, `${userInfo().username}-ahpd-zsh`));
    const was = process.env.TMPDIR;
    process.env.TMPDIR = shared;
    try {
      expect(injectionOf('/bin/zsh')).toEqual({ type: 'failure', reason: 'FailedToCreateTmpDir' });
      expect(shellIntegration('/bin/zsh', [], {}, nonce)).toBeUndefined();
      expect(readdirSync(target)).toEqual([]);
    }
    finally {
      if (was === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = was;
      rmSync(shared, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  // zshFolder asFound: VS Code chmods the folder at the name as it finds it
  // (src/vs/platform/terminal/node/terminalEnvironment.ts L219-L250 at 6b68d3fe).
  it.skipIf(process.platform === 'win32')('takes a zsh folder as it finds it under zshFolder asFound', () => {
    const shared = mkdtempSync(join(tmpdir(), 'ahpd-zsh-shared-'));
    const target = mkdtempSync(join(tmpdir(), 'ahpd-zsh-target-'));
    const folder = join(shared, `${userInfo().username}-ahpd-zsh`);
    symlinkSync(target, folder);
    const was = process.env.TMPDIR;
    process.env.TMPDIR = shared;
    try {
      const asked = getShellIntegrationInjection('/bin/zsh', [], nonce, {}, { platform: 'linux', windowsBuild: () => 0 }, 'asFound');
      expect(asked).toMatchObject({ type: 'injection', envMixin: { ZDOTDIR: join(realpathSync(shared), `${userInfo().username}-ahpd-zsh`) } });
    }
    finally {
      if (was === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = was;
      rmSync(shared, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('follows VS Code\'s rules on Windows: pwsh, powershell and bash only, from build 18309', () => {
    const windows = (build: number) => ({ platform: 'win32', windowsBuild: () => build });
    expect(getShellIntegrationInjection('C:\\Program Files\\PowerShell\\7\\pwsh.exe', [], nonce, {}, windows(22631)))
      .toMatchObject({ type: 'injection' });
    expect(getShellIntegrationInjection('C:\\Windows\\System32\\cmd.exe', [], nonce, {}, windows(22631)))
      .toEqual({ type: 'failure', reason: 'UnsupportedShell' });
    expect(getShellIntegrationInjection('C:\\Program Files\\PowerShell\\7\\pwsh.exe', [], nonce, {}, windows(17763)))
      .toEqual({ type: 'failure', reason: 'UnsupportedWindowsBuild' });
  });

  // The port starts nothing, but it copies zsh's files, which a Windows runner
  // has no zsh to read.
  it.skipIf(process.platform === 'win32')('copies the files zsh reads before it answers', () => {
    const answer = shellIntegration('/bin/zsh', [], {}, nonce);
    expect(answer?.newArgs).toEqual(['-i']);
    const folder = answer?.envMixin?.ZDOTDIR ?? '';
    expect(existsSync(join(folder, '.zshrc'))).toBe(true);
    expect(existsSync(join(folder, '.zshenv'))).toBe(true);
  });

  // VS Code's agent host asks with no environment, so a ZDOTDIR the shell
  // would be given is not the one its own files are read from.
  it.skipIf(process.platform === 'win32')('reads a person\'s zsh files from the home folder, as VS Code\'s agent host does', () => {
    const answer = shellIntegration('/bin/zsh', [], { ZDOTDIR: '/somewhere/else' }, nonce);
    expect(answer?.envMixin?.USER_ZDOTDIR).toBe(homedir());
  });
});

describe('a real shell given the integration', () => {
  /** One terminal, and every action it sent its client. */
  const opened = (spawn: SpawnPty) => {
    const seen: Record<string, unknown>[] = [];
    const terminal = shellTerminals({ pty: spawn, shellIntegration }).create({
      uri: 'ahp-terminal:/integration',
      cwd: tmpdir(),
      shell: '/bin/bash',
      claim: { kind: 'user' },
      emit: (_channel: string, action: Record<string, unknown>) => { seen.push(action); },
    } as never);
    return { terminal, seen };
  };

  /** Wait for `what`, for a few seconds, and answer whether it came. */
  const until = async (what: () => boolean): Promise<boolean> => {
    for (let tries = 0; tries < 60; tries += 1) {
      if (what()) return true;
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    return what();
  };

  /** Type one command, and answer what its `terminal/commandFinished` said. */
  const finishedWith = async (spawn: SpawnPty, line: string) => {
    const { terminal, seen } = opened(spawn);
    const done = () => seen.filter((one) => one.type === 'terminal/commandFinished');
    terminal.write(`${line}\n`);
    const arrived = await until(() => done().length > 0);
    // The shell is a process; leaving it running would outlive the case.
    terminal.close();
    return { arrived, last: done().at(-1) };
  };

  // `/bin/bash` is not there on Windows.
  it.skipIf(process.platform === 'win32')('reads the code a command exited with from the mark bash writes', async (context) => {
    const { pty: spawn } = await pty();
    if (spawn === undefined) { context.skip(); return; }
    // Another bash, so the code is a command's: `exit 3` on its own would end
    // the shell, and `exit` reports the shell's own code, not a command's.
    // A bare `(exit 3)` is not enough: the script writes the code only for a
    // command it can name, and a compound it cannot name gets a plain `D`.
    const { arrived, last } = await finishedWith(spawn, 'bash -c "exit 3"');
    expect(arrived).toBe(true);
    expect(last).toMatchObject({ exitCode: 3 });
  });

  it('does the same under Bun\'s own terminal, where there is one', async (context) => {
    if (runtime() !== 'bun') { context.skip(); return; }
    const { pty: spawn } = await pty();
    if (spawn === undefined) { context.skip(); return; }
    const { arrived, last } = await finishedWith(spawn, 'bash -c "exit 3"');
    expect(arrived).toBe(true);
    expect(last).toMatchObject({ exitCode: 3 });
  });
});
