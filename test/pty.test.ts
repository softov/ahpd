import { describe, expect, it } from 'vitest';
import { shellTerminals } from '../packages/server/src/terminals.js';
import type { Pty, SpawnPty } from '../packages/server/src/types/terminals.js';

/*
 * A shell that says where it is and what it ran.
 *
 * Under pipes there is no shell integration: nothing knows where one command's
 * output ends and the next begins, and `isPty: false` says so. Under a
 * pseudoterminal the shell prints its own OSC 133 marks and the boundaries
 * become facts. The binding is handed in, so this drives a fake one rather
 * than needing native code to have been built.
 */

/** A pseudoterminal that says whatever a test tells it to. */
function fakePty(): { spawn: SpawnPty; say: (data: string) => void; typed: string[] } {
  let listen: ((data: string) => void) | undefined;
  const typed: string[] = [];
  const spawn: SpawnPty = (): Pty => ({
    onData: (to) => { listen = to; },
    onExit: () => {},
    write: (data) => { typed.push(data); },
    resize: () => {},
    kill: () => {},
  });
  return { spawn, say: (data) => listen?.(data), typed };
}

const opened = (pty?: SpawnPty) => {
  const seen: Record<string, unknown>[] = [];
  const store = shellTerminals(pty === undefined ? {} : { pty });
  const terminal = store.create({
    uri: 'ahp-terminal:/one',
    cwd: '/tmp',
    claim: { kind: 'user' },
    emit: (_channel: string, action: Record<string, unknown>) => { seen.push(action); },
  } as never);
  return { terminal, seen };
};

/** An OSC sequence, the way a shell integration script writes one. */
const osc = (body: string) => `\u001b]${body}\u0007`;

describe('a shell under a pseudoterminal', () => {
  it('says it is one, and that command detection works', () => {
    const { spawn } = fakePty();
    const { terminal, seen } = opened(spawn);
    const state = terminal.state() as { isPty?: boolean; supportsCommandDetection?: boolean };
    expect(state.isPty).toBe(true);
    // A client MUST check this before relying on command boundaries, so it is
    // announced as well as reported.
    expect(state.supportsCommandDetection).toBe(true);
    expect(seen.some((one) => one.type === 'terminal/commandDetectionAvailable')).toBe(true);
  });

  it('reads the command boundaries the shell prints', () => {
    const { spawn, say } = fakePty();
    const { terminal, seen } = opened(spawn);
    // OSC 133: `A` before the prompt, `C` where the output starts, `D;<code>`
    // when it finished. They arrive mixed into the output.
    say(osc('133;A'));
    terminal.write('ls -la');
    say(osc('133;C') + 'total 8');
    say(osc('133;D;0'));
    const ran = seen.find((one) => one.type === 'terminal/commandExecuted') as
      { commandLine?: string; commandId?: string } | undefined;
    const done = seen.find((one) => one.type === 'terminal/commandFinished') as
      { commandId?: string; exitCode?: number } | undefined;
    expect(ran?.commandLine).toBe('ls -la');
    expect(done?.exitCode).toBe(0);
    // The pair is correlated by a stable id, which is what the protocol says
    // that field is for.
    expect(done?.commandId).toBe(ran?.commandId);
  });

  it('follows the shell into another directory', () => {
    const { spawn, say } = fakePty();
    const { seen } = opened(spawn);
    say(osc('7;file://box/tmp/elsewhere'));
    const moved = seen.find((one) => one.type === 'terminal/cwdChanged') as { cwd?: string } | undefined;
    // The host part of the URI is dropped: the path is on this machine, and
    // that is what a client opens.
    expect(moved?.cwd).toBe('file:///tmp/elsewhere');
  });

  it('still passes the bytes through, because a client is drawing them', () => {
    const { spawn, say } = fakePty();
    const { seen } = opened(spawn);
    say(osc('133;C') + 'hello');
    const data = seen.filter((one) => one.type === 'terminal/data').map((one) => String(one.data));
    expect(data.join('')).toContain('hello');
    // A reader, not a filter: the marks reach the client too, which is drawing
    // a terminal and parses them itself.
    expect(data.join('')).toContain('133;C');
  });

  it('is not one when no binding was given', () => {
    const { terminal, seen } = opened();
    const state = terminal.state() as { isPty?: boolean; supportsCommandDetection?: boolean };
    expect(state.isPty).toBe(false);
    expect(state.supportsCommandDetection).toBe(false);
    expect(seen.some((one) => one.type === 'terminal/commandDetectionAvailable')).toBe(false);
    terminal.close();
  });
});

it('signals nothing when the shell never started, rather than its own process group', () => {
  /*
   * `close` used to reach `process.kill(-(child?.pid ?? 0), 'SIGKILL')`. A
   * spawn that failed leaves no pid, so that is `kill(0)` - every process in
   * the caller's group, which is the host, the tests, and the shell that
   * started them. It reads as the process being killed from outside.
   */
  const store = shellTerminals({});
  const terminal = store.create({
    uri: 'ahp-terminal:/gone',
    cwd: '/tmp',
    shell: '/nonexistent/shell',
    claim: { kind: 'user' },
    emit: () => {},
  } as never);
  expect(() => { terminal.close(); }).not.toThrow();
});
