import { existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WAIT_MS } from '../../../tools/wait.ts';
import { posix } from '../../../tools/posix.ts';
import { pty } from '../../server/src/pty.js';
import { screen } from '../../server/src/screen.js';
import { shellIntegration } from '../../server/src/shellintegration.js';
import { uriOf } from '../src/resources/fileuri.js';
import { shellTools, SHELL_TOOL_NAMES } from '../src/tools/shell.js';
import { ROOT } from '../src/host.js';
import type { Grant } from '../src/types/users.js';
import type { Host, HostTool, SessionHostTool, ToolCall } from '../src/types/host.js';
import type { Pty, Screen, SpawnPty, SpawnScreen, TerminalStore } from '../src/types/terminals.js';
import {
  resetSdk, claude, createHost, fileResources, gitBranches, hello, hostTools, peer, sessionQueries, settle, shellTerminals,
} from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * The reference host's agent terminal tool, served by this host.
 *
 * VS Code's `copilotShellTools.ts` at `171e90619c` is what each case holds
 * this host to: the names and answers of the tools, a shell kept between
 * commands, the claim that names the call, and the ways a command ends.
 */

type Answer = { content: { text: string }[]; isError?: boolean };
type Handler = (input: unknown, extra?: unknown) => Promise<Answer>;
type Row = { resource: string; title: string; claim: Record<string, unknown>; lifecycle: { status: string } };

/** Every host a case opened, closed after it so no shell outlives the case. */
const opened: Host[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (host) => { await host.close(); }));
});

/** The name the session is claimed under: the one the client created it with. */
const HELD = 'ahp-session:/shell';

/**
 * A host with the switch on or off, one session in a folder of its own, and
 * the backend's view of its tools. `store` is the shells the host is handed,
 * and `null` is a host that has none.
 */
const hosted = async (on: boolean, store: TerminalStore | null = shellTerminals()) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-shell-')));
  const host = createHost({
    path: dir,
    agents: [claude({ paths: [dir] })],
    resources: fileResources(),
    directories: gitBranches(),
    ...(store !== null ? { terminals: store } : {}),
    tools: hostTools(),
  });
  opened.push(host);
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0'], { initialSubscriptions: [ROOT] }));
  if (on) {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { enableCustomTerminalTool: true } } },
    });
    await settle();
  }
  const uri = 'ahp-session:/shell';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(dir)] } });
  const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string; serverTools?: { name: string }[] } };
  }).snapshot.state;
  const options = (): Record<string, unknown> => sessionQueries().at(-1)?.options as Record<string, unknown>;
  let calls = 0;
  /** One call of a host tool, as the CLI makes it: by its handler, naming the call. */
  const call = async (name: string, input: Record<string, unknown> = {}, id = `call-${String(++calls)}`): Promise<Answer> => {
    const servers = options().mcpServers as Record<string, { tools: { name: string; handler: Handler }[] }>;
    const found = servers.ahp?.tools.find((one) => one.name === name);
    if (found === undefined) throw new Error(`no tool ${name}`);
    return await found.handler(input, { _meta: { 'claudecode/toolUseId': id } });
  };
  /** The root list, as a client reads it. */
  const terminals = async (): Promise<Row[]> => (await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as {
    snapshot: { state: { terminals?: Row[] } };
  }).snapshot.state.terminals ?? [];
  return {
    client, dir, uri, chatUri: state.defaultChat,
    names: (state.serverTools ?? []).map((one) => one.name),
    options, call, terminals,
  };
};

const text = (answer: Answer): string => answer.content.map((one) => one.text).join('');

/** The shell id an answer starts with. */
const shellIdOf = (answer: Answer): string => /^Shell ID: (\S+)\n/u.exec(text(answer))?.[1] ?? '';

/** Wait for something to become true, by the clock. */
const until = async (check: () => Promise<boolean> | boolean): Promise<void> => {
  for (const end = Date.now() + WAIT_MS; Date.now() < end;) {
    if (await check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 25); });
  }
  throw new Error('waited too long');
};

describe('the agent terminal tool', () => {
  it('is not offered until the root config turns it on', async () => {
    const off = await hosted(false);
    expect(off.names.filter((name) => SHELL_TOOL_NAMES.includes(name))).toEqual([]);
    // Claude keeps its own shell while the host offers none.
    expect(off.options().disallowedTools).toBeUndefined();
    expect(off.options().toolAliases).toBeUndefined();
  });

  // The reference never turns the tool on under Windows, and neither does this host.
  it.skipIf(!posix)('offers the reference set, and Claude stands its own shell aside', async () => {
    const on = await hosted(true);
    expect(on.names.filter((name) => SHELL_TOOL_NAMES.includes(name))).toEqual([
      'bash', 'read_bash', 'write_bash', 'bash_shutdown', 'list_bash', 'powershell',
    ]);
    expect(on.options().disallowedTools).toEqual(['Bash']);
    expect(on.options().toolAliases).toEqual({ Bash: 'mcp__ahp__bash' });
  });

  it('is not offered by a host with no shells, whatever the switch says', async () => {
    const bare = await hosted(true, null);
    expect(bare.names.filter((name) => SHELL_TOOL_NAMES.includes(name))).toEqual([]);
    expect(bare.options().toolAliases).toBeUndefined();
  });

  // A shell on pipes reads its commands from a pipe, which a POSIX shell does.
  it.skipIf(!posix)('runs a command in a terminal the session holds, claimed by the call', async () => {
    const on = await hosted(true);
    const answer = await on.call('bash', { command: 'echo hello' }, 'tc-1');
    expect(answer.isError).toBeUndefined();
    expect(text(answer)).toMatch(/^Shell ID: \S+\nExit code: 0\nhello$/u);
    const rows = await on.terminals();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('Bash');
    expect(rows[0]?.claim).toMatchObject({ kind: 'session', session: HELD, toolCallId: 'tc-1' });
    expect(rows[0]?.claim.chat).toMatch(/^ahp-chat:/u);
  });

  it.skipIf(!posix)('keeps the shell, its folder and its variables between commands', async () => {
    const on = await hosted(true);
    const first = await on.call('bash', { command: 'cd / && export AHPD_SHELL_PROBE=kept' });
    const second = await on.call('bash', { command: 'pwd; echo "$AHPD_SHELL_PROBE"' });
    expect(shellIdOf(second)).toBe(shellIdOf(first));
    expect(text(second)).toMatch(/Exit code: 0\n\/\nkept$/u);
    expect(await on.terminals()).toHaveLength(1);
  });

  it.skipIf(!posix)('answers a failing command as a failure, with its code', async () => {
    const on = await hosted(true);
    const answer = await on.call('bash', { command: 'false' });
    expect(answer.isError).toBe(true);
    expect(text(answer)).toMatch(/^Shell ID: \S+\nExit code: 1\n$/u);
  });

  it.skipIf(!posix)('answers a command still running at the timeout with the output so far', async () => {
    const on = await hosted(true);
    const answer = await on.call('bash', { command: 'echo started; sleep 2', timeout: 300 });
    expect(answer.isError).toBe(true);
    expect(text(answer)).toMatch(/^Shell ID: \S+\nCommand timed out after 0s\. Partial output:\nstarted$/u);
    expect(text(await on.call('list_bash'))).toMatch(/^- \S+: bash \[running\]$/u);
  });

  it.skipIf(!posix)('goes on in the background when a client narrows the claim, and keeps that shell until the command ends', async () => {
    const on = await hosted(true);
    const running = on.call('bash', { command: 'sleep 1', timeout: 30_000 }, 'tc-long');
    await until(async () => (await on.terminals()).length === 1);
    const [row] = await on.terminals();
    // The claim without the call: the session and the chat keep the terminal.
    await on.client.handle({
      method: 'dispatchAction',
      params: {
        channel: row?.resource,
        action: { type: 'terminal/claimed', claim: { kind: 'session', session: row?.claim.session, chat: row?.claim.chat } },
      },
    });
    const answer = await running;
    expect(answer.isError).toBeUndefined();
    expect(text(answer)).toMatch(/^Shell ID: \S+\nThe user chose to continue this command in the background\. The terminal is still running\.$/u);
    const first = shellIdOf(answer);
    // Still held by its command, so the next one gets a shell of its own.
    const next = await on.call('bash', { command: 'echo again' });
    expect(shellIdOf(next)).not.toBe(first);
    expect(await on.terminals()).toHaveLength(2);
    // And given back once the command ends, which the sentinel after it says.
    await until(async () => text(await on.call('read_bash', { shell_id: first })).includes('_EXIT_0>>>'));
    expect(shellIdOf(await on.call('bash', { command: 'echo back' }))).toBe(first);
  });

  it.skipIf(!posix)('reads a shell, writes to it, and stops it', async () => {
    const on = await hosted(true);
    expect(text(await on.call('bash', { command: 'echo first' }))).toMatch(/first$/u);
    expect(text(await on.call('write_bash', { command: 'echo written\n' }))).toBe('Input sent to shell.');
    await until(async () => text(await on.call('read_bash')).includes('written'));
    expect(text(await on.call('bash_shutdown'))).toBe('Shell stopped.');
    expect(text(await on.call('list_bash'))).toBe('No active shells.');
    expect(await on.terminals()).toEqual([]);
    const missing = await on.call('read_bash');
    expect(missing.isError).toBe(true);
    expect(text(missing)).toBe('No active shell found.');
    const none = await on.call('bash_shutdown', { shell_id: 'nope' });
    expect(none.isError).toBe(true);
    expect(text(none)).toBe('Shell not found.');
  });

  it.skipIf(!posix)('points a model that reaches for the other shell at this one', async () => {
    const on = await hosted(true);
    const answer = await on.call('powershell', { command: 'Get-Location' });
    expect(answer.isError).toBe(true);
    expect(text(answer)).toMatch(/^This tool is disabled because the configured shell is \S+\. Use the `bash` tool instead\.$/u);
  });

  it.skipIf(!posix)('closes the session\'s shells with the session', async () => {
    const on = await hosted(true);
    await on.call('bash', { command: 'echo here' });
    expect(await on.terminals()).toHaveLength(1);
    await on.client.handle({ method: 'disposeSession', params: { channel: on.uri } });
    await settle();
    expect(await on.terminals()).toEqual([]);
  });
});

describe('the agent terminal tool under a person\'s grants', () => {
  /** A call whose person holds only the grants given. */
  const asPerson = (grants: Grant[]): ToolCall => ({
    session: 'ahp-session:/s',
    chat: 'ahp-chat:/c',
    turn: () => 't1',
    person: () => 'user:guest',
    may: (grant: Grant) => grants.includes(grant),
    refusal: (grant: Grant) => `user:guest may not ${grant} here`,
    shells: () => { throw new Error('a refused call reaches no shell'); },
  } as unknown as ToolCall);
  const tools = new Map<string, SessionHostTool>(shellTools('/bin/bash').map((one) => [one.definition.name, one as SessionHostTool]));
  const ran = async (name: string, input: Record<string, unknown>, at: ToolCall): Promise<string> =>
    await Promise.resolve().then(() => tools.get(name)?.run(input, at) ?? '');

  it('refuses each tool the grant a client\'s own terminal action asks', async () => {
    const nobody = asPerson([]);
    await expect(ran('bash', { command: 'id' }, nobody)).rejects.toThrow('user:guest may not terminal:create here');
    await expect(ran('read_bash', {}, nobody)).rejects.toThrow('user:guest may not terminal:output here');
    await expect(ran('write_bash', { command: 'y' }, nobody)).rejects.toThrow('user:guest may not terminal:input here');
    await expect(ran('bash_shutdown', {}, nobody)).rejects.toThrow('user:guest may not terminal:dispose here');
  });
});

describe('the agent terminal tool under a pseudoterminal', () => {
  /**
   * A screen that reads the two modes the tool asks about.
   *
   * Writes are parsed as they arrive, so `whenSettled` is not needed and a
   * case never waits on a queue. It is the store's port, so what a case checks
   * is what the terminal would have shown.
   */
  const fakeScreen = (): SpawnScreen => () => {
    let alt = false;
    let paste = false;
    const waiting: (() => void)[] = [];
    const screen: Screen = {
      write: async (data) => {
        if (data.includes('\u001b[?1049h')) {
          alt = true;
          for (const settle of waiting.splice(0)) settle();
        }
        if (data.includes('\u001b[?1049l')) alt = false;
        if (data.includes('\u001b[?2004h')) paste = true;
        if (data.includes('\u001b[?2004l')) paste = false;
      },
      resize: () => {},
      isInAltBuffer: () => alt,
      isBracketedPasteMode: () => paste,
      whenAltBuffer: () => (alt ? Promise.resolve() : new Promise((resolve) => { waiting.push(resolve); })),
      dispose: () => {},
    };
    return screen;
  };

  /** A store under a pseudoterminal that says only what a case tells it. */
  const storeOf = (spawn: SpawnPty): TerminalStore => shellTerminals({ pty: spawn, screen: fakeScreen() });

  /**
   * A pseudoterminal playing a shell.
   *
   * It echoes what is typed, as a line discipline does, then runs the line:
   * `echo` prints its argument, `false` fails, `vim` opens the alternate
   * screen and takes every line after it, and the sentinel's own line prints
   * the sentinel with the last code. With `marks` it marks each command in
   * OSC 133, with `paste` its prompt turns bracketed paste on, and with
   * `flood` it says that many characters before its first prompt. With
   * `late` its first prompt comes that many milliseconds after it starts,
   * and with `dies` it exits with code 1 before saying anything. With `busy`
   * a command somebody typed is running when the shell starts, and ends with
   * code 7 when the first line is written. The switches reach the shell's
   * headless terminal as a real shell's would.
   */
  const fakeShell = (options: { marks?: boolean; paste?: boolean; flood?: number; late?: number; dies?: boolean; busy?: boolean } = {}): {
    spawn: SpawnPty;
    typed: string[];
    envs: Record<string, string | undefined>[];
  } => {
    const typed: string[] = [];
    const envs: Record<string, string | undefined>[] = [];
    const spawn: SpawnPty = (_file, _args, started) => {
      envs.push(started.env);
      let listen: ((data: string) => void) | undefined;
      let exit: ((exit: { exitCode: number }) => void) | undefined;
      let last = 0;
      let vim = false;
      let busy = options.busy === true;
      const say = (data: string): void => { listen?.(data); };
      const prompt = (): void => { say(`${options.marks === true ? '\x1b]133;A\x07' : ''}$ ${options.paste === true ? '\x1b[?2004h' : ''}`); };
      const opened = options.marks === true ? '\x1b]133;C\x07' : '';
      const closed = (code: number): string => (options.marks === true ? `\x1b]133;D;${String(code)}\x07` : '');
      const pty: Pty = {
        onData: (to) => {
          listen = to;
          if (options.dies === true) return;
          if (options.flood !== undefined) say('x'.repeat(options.flood));
          if (options.late === undefined) prompt();
          else setTimeout(prompt, options.late);
          if (busy) say(`sleep 9\r\n${opened}`);
        },
        onExit: (to) => {
          exit = to;
          if (options.dies === true) setTimeout(() => { exit?.({ exitCode: 1 }); }, 0);
        },
        write: (data) => {
          typed.push(data);
          if (vim) return;
          if (busy) {
            busy = false;
            say(`${closed(7)}`);
            prompt();
          }
          say(data.replace(/\r/gu, '\r\n'));
          const line = data.replace('\x1b[200~', '').replace('\x1b[201~', '').trim();
          const sentinel = /^echo "(<<<COPILOT_SENTINEL_[0-9a-f]+_EXIT_)\$\?>>>"$/u.exec(line);
          if (sentinel !== null) {
            say(`${opened}${sentinel[1] ?? ''}${String(last)}>>>\r\n${closed(0)}`);
            last = 0;
          }
          else if (line === 'vim') {
            vim = true;
            say(`${opened}\x1b[?1049h`);
            return;
          }
          else if (line === 'false') {
            last = 1;
            say(`${opened}${closed(1)}`);
          }
          else {
            last = 0;
            say(`${opened}${line.replace(/^echo /u, '')}\r\n${closed(0)}`);
          }
          prompt();
        },
        resize: () => {},
        kill: () => { exit?.({ exitCode: 0 }); },
      };
      return pty;
    };
    return { spawn, typed, envs };
  };

  it('opens a shell with the variables the reference gives a tool\'s terminal', async () => {
    const fake = fakeShell();
    const on = await hosted(true, storeOf(fake.spawn));
    await on.call('bash', { command: 'echo hi' });
    // `preventShellHistory`, which the scripts read, and `nonInteractive`.
    expect(fake.envs[0]).toMatchObject({
      VSCODE_PREVENT_SHELL_HISTORY: '1',
      LC_ALL: 'C.UTF-8',
      PAGER: '',
      GIT_PAGER: '',
      GH_PAGER: '',
      GIT_TERMINAL_PROMPT: '0',
      DEBIAN_FRONTEND: 'noninteractive',
    });
  });

  it('ends each line with a carriage return and reads the sentinel past its own echo', async () => {
    const fake = fakeShell();
    const on = await hosted(true, storeOf(fake.spawn));
    const answer = await on.call('bash', { command: 'echo hi' });
    expect(text(answer)).toMatch(/^Shell ID: \S+\nExit code: 0\n/u);
    expect(text(answer)).toContain('hi');
    expect(fake.typed).toHaveLength(2);
    expect(fake.typed[0]).toBe(' echo hi\r');
    expect(fake.typed[1]).toMatch(/^echo "<<<COPILOT_SENTINEL_[0-9a-f]+_EXIT_\$\?>>>"\r$/u);
  });

  it('ends a command at the shell\'s own mark once the shell has marked its prompt', async () => {
    const fake = fakeShell({ marks: true });
    const on = await hosted(true, storeOf(fake.spawn));
    const first = await on.call('bash', { command: 'echo one' });
    expect(text(first)).toMatch(/^Shell ID: \S+\nExit code: 0\none$/u);
    // No sentinel after it: the mark is the end.
    expect(fake.typed).toHaveLength(1);
    const failed = await on.call('bash', { command: 'false' });
    expect(failed.isError).toBe(true);
    expect(text(failed)).toMatch(/^Shell ID: \S+\nExit code: 1\n$/u);
    expect(fake.typed).toHaveLength(2);
  });

  it('ends a command at its own mark rather than at the end of one already running', async () => {
    const fake = fakeShell({ marks: true, busy: true });
    const on = await hosted(true, storeOf(fake.spawn));
    const first = await on.call('bash', { command: 'echo one' });
    expect(text(first)).toMatch(/^Shell ID: \S+\nExit code: 0\none$/u);
  });

  it('gives a new shell time to say something before its first command', async () => {
    const fake = fakeShell({ marks: true, late: 200 });
    const on = await hosted(true, storeOf(fake.spawn));
    const first = await on.call('bash', { command: 'echo one' });
    expect(text(first)).toMatch(/^Shell ID: \S+\nExit code: 0\none$/u);
    expect(fake.typed).toHaveLength(1);
  });

  it('answers a shell that exited before its first command at once', async () => {
    const fake = fakeShell({ dies: true });
    const on = await hosted(true, storeOf(fake.spawn));
    const answer = await on.call('bash', { command: 'echo one', timeout: 30_000 });
    expect(answer.isError).toBe(true);
    expect(text(answer)).toMatch(/^Shell ID: \S+\nShell exited with code 1\n/u);
  });

  it('pastes a command of several lines where the shell turned bracketed paste on', async () => {
    const pasting = fakeShell({ paste: true });
    const on = await hosted(true, storeOf(pasting.spawn));
    await on.call('bash', { command: 'echo one\necho two' });
    expect(pasting.typed[0]).toBe('\x1b[200~ echo one\recho two\x1b[201~\r');

    const typing = fakeShell();
    const plain = await hosted(true, storeOf(typing.spawn));
    await plain.call('bash', { command: 'echo one\necho two' });
    expect(typing.typed[0]).toBe(' echo one\recho two\r');
  });

  /*
   * A terminal keeps its last 200,000 characters and, once full, drops one for
   * each it takes, so the place a command began is read back from the end.
   */
  it('reads a command\'s output once the terminal has dropped what came before it', async () => {
    const fake = fakeShell({ flood: 250_000 });
    const on = await hosted(true, storeOf(fake.spawn));
    const first = await on.call('bash', { command: 'echo first' });
    expect(text(first)).toMatch(/^Shell ID: \S+\nExit code: 0\n/u);
    expect(text(first)).toContain('first');
    expect(text(first)).not.toContain('xxx');
    const second = await on.call('bash', { command: 'echo second' });
    expect(text(second)).toMatch(/^Shell ID: \S+\nExit code: 0\n/u);
    expect(text(second)).toContain('second');
    expect(text(second)).not.toContain('first');
  });

  it('answers a command that opens the alternate screen, and keeps its shell', async () => {
    const fake = fakeShell();
    const on = await hosted(true, storeOf(fake.spawn));
    const answer = await on.call('bash', { command: 'vim' });
    expect(answer.isError).toBe(true);
    expect(text(answer)).toBe(`Shell ID: ${shellIdOf(answer)}\nThe command opened the alternate buffer and is still running in the terminal. It likely launched an interactive terminal UI. Use write_bash/write_powershell to interact with it, or shutdown the shell to stop it.`);
    const next = await on.call('bash', { command: 'echo other' });
    expect(shellIdOf(next)).not.toBe(shellIdOf(answer));
  });
});

/*
 * The agent terminal tool in a real shell under a real pseudoterminal.
 *
 * `node-pty`, loaded the way the daemon loads it, so a runtime it cannot run
 * under skips these cases rather than dying. Each shell starts in a home of
 * its own, so what it reads as it starts is the system's and the
 * integration's alone.
 */
const { pty: realPty } = await pty();

/** A shell program by its name, from the folders a system keeps them in. */
const installed = (name: string): string | undefined => ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
  .map((folder) => join(folder, name))
  .find((path) => existsSync(path));

describe('the agent terminal tool in a real shell', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  /** Each shell, and a command whose output says the script kept its commands out of the history. */
  const shells = [
    { name: 'zsh', history: 'setopt | grep -x histignorespace', kept: 'histignorespace' },
    { name: 'bash', history: 'echo "$HISTCONTROL"', kept: 'ignorespace' },
  ];

  /** A host whose shells are `shell`, under a real pseudoterminal, in a home with nothing in it. */
  const hostedIn = async (shell: string) => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-home-')));
    vi.stubEnv('SHELL', shell);
    vi.stubEnv('HOME', home);
    vi.stubEnv('ZDOTDIR', home);
    // The daemon's own integration and screen, which is what makes a real
    // shell's marks and alternate buffer readable.
    return await hosted(true, shellTerminals(realPty === undefined ? {} : { pty: realPty, shellIntegration, screen }));
  };

  for (const { name, history, kept } of shells) {
    const shell = installed(name);
    // A POSIX shell, under `node-pty` where it loads.
    it.skipIf(!posix || realPty === undefined || shell === undefined)(`answers a ${name} command with its output alone, and the code of the shell's own D`, async () => {
      const on = await hostedIn(shell ?? '');
      const echoed = await on.call('bash', { command: 'echo by-hand' });
      // Neither the command's echo nor a prompt, nor zsh's end-of-line mark.
      expect(text(echoed)).toBe(`Shell ID: ${shellIdOf(echoed)}\nExit code: 0\nby-hand`);
      const failed = await on.call('bash', { command: 'sh -c \'exit 3\'' });
      expect(failed.isError).toBe(true);
      expect(text(failed)).toBe(`Shell ID: ${shellIdOf(failed)}\nExit code: 3\n`);
      // The script read `VSCODE_PREVENT_SHELL_HISTORY`.
      expect(text(await on.call('bash', { command: history }))).toBe(`Shell ID: ${shellIdOf(echoed)}\nExit code: 0\n${kept}`);
      // Each ended at the shell's own mark, with no sentinel typed after it.
      expect(text(await on.call('read_bash'))).not.toContain('COPILOT_SENTINEL');
    });
  }

  const zsh = installed('zsh');
  // zsh, under `node-pty` where it loads.
  it.skipIf(!posix || realPty === undefined || zsh === undefined)('gives an agent\'s zsh the reference\'s fixups', async () => {
    const on = await hostedIn(zsh ?? '');
    // A `!` in double quotes is not a history event, and `#` starts a comment.
    const answer = await on.call('bash', { command: 'echo "a!b" # a note' });
    expect(text(answer)).toBe(`Shell ID: ${shellIdOf(answer)}\nExit code: 0\na!b`);
  });
});
