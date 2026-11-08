import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createTerminals } from '../src/host/terminals.js';
import { createShells } from '../src/host/shells.js';
import { DEFAULT_SHELL_COMMAND_TIMEOUT_MS, SHELL_COMMAND_MAX_OUTPUT_BYTES } from '../src/host/shellcommand.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { buildNonPtyShellTerminalUri } from '../src/vscode/nonptyshellterminaluri.js';
import type { HostContext } from '../src/host/context.js';
import type { Bag } from '../src/types/common.js';
import type { ComputerPort, Spawn } from '../src/types/computers.js';
import type { HeldShell, Shells } from '../src/types/shells.js';
import type { Screen, SpawnPty, SpawnScreen, Terminal } from '../src/types/terminals.js';

/*
 * The shells an agent's commands run in, and how one command ends.
 *
 * The manager is driven through the host's own open block, on the real
 * terminal store and a pseudoterminal that says only what a case tells it, so
 * what is checked is the road a tool call takes rather than a stand-in for it.
 * A marked command is one the store read OSC 133 from; an unmarked one is
 * every other shell, which ends at the reference's sentinel.
 */

const DIR = tmpdir();
const SESSION = 'echo:/shells';
const CHAT = 'ahp-chat:/shells-1';

/** A screen that keeps what it was fed, and answers only the two questions asked of it. */
interface FakeScreen {
  written: string;
  alt: boolean;
  paste: boolean;
  waiters: (() => void)[];
}

/** The store's screen port, with each screen a case can read. */
const fakeScreens = (): { screens: FakeScreen[]; spawn: SpawnScreen } => {
  const screens: FakeScreen[] = [];
  const spawn: SpawnScreen = () => {
    const kept: FakeScreen = { written: '', alt: false, paste: false, waiters: [] };
    screens.push(kept);
    const screen: Screen = {
      write: async (data) => {
        kept.written += data;
        if (data.includes('\u001b[?1049h')) {
          kept.alt = true;
          for (const settle of kept.waiters.splice(0)) settle();
        }
        if (data.includes('\u001b[?2004h')) kept.paste = true;
      },
      resize: () => {},
      isInAltBuffer: () => kept.alt,
      isBracketedPasteMode: () => kept.paste,
      whenAltBuffer: () => (kept.alt
        ? Promise.resolve()
        : new Promise((resolve) => { kept.waiters.push(resolve); })),
      dispose: () => {},
    };
    return screen;
  };
  return { screens, spawn };
};

/**
 * Some pseudoterminals that say whatever a test tells them.
 *
 * More than one, because a case that watches two shells at once writes to the
 * one it means rather than to whichever was started last.
 */
interface FakePty {
  spawn: SpawnPty;
  /** Write to the terminal started last. */
  say(data: string): void;
  /** Write to the `at`th terminal started, counting from zero. */
  sayAt(at: number, data: string): void;
  exit(exitCode?: number): void;
  /** Everything a client typed, in the order it was typed. */
  typed: string[];
  started: { shell: string; args: string[] | string; env: Record<string, string | undefined>; cwd?: string }[];
}

const fakePty = (): FakePty => {
  const listen: ((data: string) => void)[] = [];
  const ended: ((exit: { exitCode: number }) => void)[] = [];
  const typed: string[] = [];
  const started: FakePty['started'] = [];
  const spawn: SpawnPty = (shell, args, options) => {
    const at = started.length;
    started.push({ shell, args, env: options.env, ...(options.cwd === undefined ? {} : { cwd: options.cwd }) });
    return {
      onData: (to) => { listen[at] = to; },
      onExit: (to) => { ended[at] = to; },
      write: (data) => { typed.push(data); },
      resize: () => {},
      kill: () => {},
    };
  };
  return {
    spawn,
    say: (data) => listen[listen.length - 1]?.(data),
    sayAt: (at, data) => listen[at]?.(data),
    exit: (exitCode = 0) => ended[ended.length - 1]?.({ exitCode }),
    typed,
    started,
  };
};

/** What a fake host keeps for a case to read back. */
interface Made {
  ctx: HostContext;
  shells: Shells;
  pty: FakePty;
  screens: FakeScreen[];
  /** Every action the host routed, in order. */
  actions: { channel: string; action: Bag }[];
  /** Every terminal that exited and was kept, by the call it answers. */
  kept: { chat: string; key: string; session: string }[];
}

/**
 * The host, without a socket.
 *
 * `createTerminals` is assigned onto it, so the shell manager opens through the
 * same block a `!` command does, and the store is the real one on a
 * pseudoterminal the case drives.
 */
const host = (over: { computers?: ComputerPort; sessions?: Map<string, unknown>; screen?: boolean } = {}): Made => {
  const pty = fakePty();
  const { screens, spawn } = fakeScreens();
  const store = shellTerminals({ pty: pty.spawn, ...(over.screen === false ? {} : { screen: spawn }) });
  const terminals = new Map<string, Terminal>();
  const actions: { channel: string; action: Bag }[] = [];
  const kept: { chat: string; key: string; session: string }[] = [];
  const ctx = {
    options: {
      path: DIR,
      agents: [],
      terminals: store,
      ...(over.computers === undefined ? {} : { computers: over.computers }),
    },
    terminals,
    sessions: over.sessions ?? new Map(),
    dispatch: (channel: string, action: Bag) => { actions.push({ channel, action }); },
    log: () => {},
    closed: false,
    fire: () => {},
    dirOfFile: () => undefined,
    refreshWatched: async () => {},
    keepExited: (chat: string, key: string, session: string) => { kept.push({ chat, key, session }); },
    // A session with no folder names its terminals under the session itself.
    nonPtyShellTerminalUri: (session: string, chat: string, key: string) => buildNonPtyShellTerminalUri(session, session, chat, key),
  } as unknown as HostContext;
  Object.assign(ctx, createTerminals(ctx));
  ctx.shells = createShells(ctx);
  const shells = ctx.shells.of(SESSION, CHAT);
  if (shells === undefined) throw new Error('no shells');
  return { ctx, shells, pty, screens, actions, kept };
};

/** Let the store and the manager work through a settled promise. */
const settle = (ms = 0): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The id the sentinel a shell echoed carries. */
const sentinelOf = (pty: FakePty): string => {
  for (const typed of [...pty.typed].reverse()) {
    const found = /COPILOT_SENTINEL_([0-9a-zA-Z]+)_EXIT_/u.exec(typed);
    if (found !== null) return String(found[1]);
  }
  throw new Error('no sentinel was written');
};

/**
 * A shell that has said its first prompt, so a new shell is not waited on.
 *
 * Plain text rather than a mark: a shell that has marked a boundary is one
 * whose commands end at their `D`, and most of these cases are about the
 * shells that do not.
 */
const awake = (made: Made, held: HeldShell): void => {
  made.pty.say('$ ');
  expect(held.shell.terminalUri).toBeTruthy();
};

/** The shell has marked a prompt, so its commands end at their `D` from here. */
const marking = (made: Made): void => {
  made.pty.say('\u001b]133;A\u0007');
};

describe('a session\'s shells', () => {
  it('gives a call a shell, and gives the next call the same one once it is idle', async () => {
    const made = host();
    const first = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    first.release();
    const second = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-2' });
    expect(second.shell.id).toBe(first.shell.id);
    expect(second.shell.terminalUri).toBe(first.shell.terminalUri);
    // One shell was started: the second call reused it.
    expect(made.pty.started).toHaveLength(1);
  });

  it('keeps each chat\'s shells apart, and starts each in its own chat\'s directory', async () => {
    const other = 'ahp-chat:/shells-2';
    const there = (path: string) => ({ workingDirectories: () => [`file://${path}`] });
    const sessions = new Map<string, unknown>([[SESSION, {
      defaultChat: CHAT,
      chats: new Map([[CHAT, there('/work/one')], [other, there('/work/two')]]),
      config: {},
    }]]);
    const made = host({ sessions });
    const first = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    first.release();
    const theirs = made.ctx.shells.of(SESSION, other);
    if (theirs === undefined) throw new Error('no shells');
    const second = await theirs.acquire({ chat: other, toolCallId: 'call-2' });
    // The first chat's idle shell is not handed to the second chat.
    expect(second.shell.id).not.toBe(first.shell.id);
    expect(theirs.list().map((one) => one.id)).toEqual([second.shell.id]);
    expect(made.pty.started.map((one) => one.cwd)).toEqual(['/work/one', '/work/two']);
  });

  it('gives two calls at once two shells', async () => {
    const made = host();
    const first = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    const second = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-2' });
    expect(second.shell.id).not.toBe(first.shell.id);
    expect(second.shell.terminalUri).not.toBe(first.shell.terminalUri);
    expect(made.pty.started).toHaveLength(2);
    // And neither is offered while both are held.
    const third = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-3' });
    expect(third.shell.id).not.toBe(first.shell.id);
    expect(third.shell.id).not.toBe(second.shell.id);
  });

  it('drops an exited shell, and the next call opens a new one', async () => {
    const made = host();
    const first = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    made.pty.exit(0);
    expect(first.shell.terminalUri).toBeTruthy();
    expect(made.shells.lifecycle(first.shell).status).toBe('exited');
    first.release();
    const second = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-2' });
    expect(second.shell.id).not.toBe(first.shell.id);
    expect(made.pty.started).toHaveLength(2);
  });

  it('shows the shell on the call that took it, and on the one that takes it again', async () => {
    const made = host();
    const seen: string[] = [];
    const first = await made.shells.acquire({
      chat: CHAT,
      toolCallId: 'call-1',
      opened: (terminal) => { seen.push(terminal.uri); },
    });
    expect(seen).toEqual([first.shell.terminalUri]);
    first.release();
    const second = await made.shells.acquire({
      chat: CHAT,
      toolCallId: 'call-2',
      opened: (terminal) => { seen.push(terminal.uri); },
    });
    expect(second.shell.id).toBe(first.shell.id);
    expect(seen).toEqual([first.shell.terminalUri, first.shell.terminalUri]);
  });
});

describe('running a command', () => {
  it('ends a marked command at its D mark and reads that command\'s part', async () => {
    const made = host();
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    marking(made);
    const running = made.shells.run(held.shell, 'echo marked', DEFAULT_SHELL_COMMAND_TIMEOUT_MS);
    await settle();
    made.pty.say('\u001b]133;C\u0007');
    made.pty.say('marked output\r\n');
    made.pty.say('\u001b]133;D;7\u0007');
    await expect(running).resolves.toEqual({ status: 'completed', exitCode: 7, output: 'marked output' });
  });

  it('ends an unmarked command at its sentinel, and leaves the sentinel out', async () => {
    const made = host();
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    const running = made.shells.run(held.shell, 'echo sentinel', DEFAULT_SHELL_COMMAND_TIMEOUT_MS);
    await settle();
    const id = sentinelOf(made.pty);
    made.pty.say('unmarked output\r\n');
    made.pty.say(`<<<COPILOT_SENTINEL_${id}_EXIT_0>>>\r\n`);
    const result = await running;
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('unmarked output');
    expect(result.output).not.toContain('COPILOT_SENTINEL');
  });

  it('hands back the output so far when the command times out', async () => {
    const made = host();
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    const running = made.shells.run(held.shell, 'sleep forever', 30);
    await settle();
    made.pty.say('part of it\r\n');
    await settle(60);
    const result = await running;
    expect(result.status).toBe('timeout');
    expect(result.output).toContain('part of it');
  });

  it('ends a full-screen program at the alternate screen, and keeps the shell busy', async () => {
    const made = host();
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    marking(made);
    const running = made.shells.run(held.shell, 'vim', DEFAULT_SHELL_COMMAND_TIMEOUT_MS);
    await settle();
    made.pty.say('\u001b]133;C\u0007');
    made.pty.say('\u001b[?1049h');
    const result = await running;
    expect(result.status).toBe('altBuffer');
    // The command outlived the call: the shell is held until it ends, so the
    // next call is given a shell of its own.
    made.shells.hold(held.shell);
    const next = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-2' });
    expect(next.shell.id).not.toBe(held.shell.id);
    // Leaving the screen and the shell saying the command is over lets it go.
    // The first terminal, because the second call's shell claimed the last
    // listener when it was opened.
    made.pty.sayAt(0, '\u001b[?1049l');
    made.pty.sayAt(0, '\u001b]133;D;0\u0007');
    await settle();
    const again = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-3' });
    expect(again.shell.id).toBe(held.shell.id);
  });

  it('runs a command to its own end without a screen, rather than ending it on a buffer it cannot see', async () => {
    // A store with no screen port answers `whenAltBuffer` at once, because
    // there is no buffer for it to enter. That is not a command on the
    // alternate screen, so the command goes on to its sentinel.
    const made = host({ screen: false });
    expect(made.screens).toEqual([]);
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    const running = made.shells.run(held.shell, 'echo one', DEFAULT_SHELL_COMMAND_TIMEOUT_MS);
    await settle();
    made.pty.say('one\r\n');
    made.pty.say(`<<<COPILOT_SENTINEL_${sentinelOf(made.pty)}_EXIT_0>>>\r\n`);
    const result = await running;
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe('one');
  });

  it('keeps the last 60 KB of an output over the cap', async () => {
    const made = host();
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    marking(made);
    const text = `${'A'.repeat(50_000)}${'B'.repeat(50_000)}`;
    const running = made.shells.run(held.shell, 'big', DEFAULT_SHELL_COMMAND_TIMEOUT_MS);
    await settle();
    made.pty.say('\u001b]133;C\u0007');
    made.pty.say(text);
    made.pty.say('\u001b]133;D;0\u0007');
    const result = await running;
    expect(result.output).toHaveLength(SHELL_COMMAND_MAX_OUTPUT_BYTES);
    expect(result.output).toBe(text.slice(-SHELL_COMMAND_MAX_OUTPUT_BYTES));
  });

  it('keeps what a shell printed when it exits', async () => {
    const made = host();
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    awake(made, held);
    const running = made.shells.run(held.shell, 'exit 3', DEFAULT_SHELL_COMMAND_TIMEOUT_MS);
    await settle();
    made.pty.say('before the end\r\n');
    made.pty.exit(3);
    const result = await running;
    expect(result.status).toBe('shellExited');
    expect(result.exitCode).toBe(3);
    expect(result.output).toContain('before the end');
    // A shell a call claimed is kept for it when it exits.
    await settle();
    expect(made.kept).toEqual([{ chat: CHAT, key: expect.any(String), session: SESSION }]);
  });
});

describe('a session in a machine', () => {
  it('opens its shell through computers.how', async () => {
    const asked: { id: string; command: string }[] = [];
    const how = async (id: string, options: { command: string }): Promise<Spawn> => {
      asked.push({ id, command: options.command });
      return { command: 'docker', args: ['exec', '-it', id, options.command], env: { FROM: 'machine' }, cwd: DIR };
    };
    const computers: ComputerPort = { how };
    const sessions = new Map<string, unknown>([[
      SESSION,
      { chats: new Map(), defaultChat: CHAT, config: { computer: 'computer://box' } },
    ]]);
    const made = host({ computers, sessions });
    const held = await made.shells.acquire({ chat: CHAT, toolCallId: 'call-1' });
    expect(asked).toEqual([{ id: 'box', command: made.shells.executable() }]);
    // What `how` answered is what the terminal ran: the host's own shell
    // starts the descriptor, as it starts a terminal a backend opens in a
    // machine, and the machine's variables arrive with it.
    const started = made.pty.started.at(-1);
    const line = (started?.args as string[]).join(' ');
    expect(line).toContain('docker');
    expect(line).toContain('exec');
    expect(line).toContain(made.shells.executable());
    expect(started?.env.FROM).toBe('machine');
    expect(held.shell.terminalUri).toBeTruthy();
  });
});
