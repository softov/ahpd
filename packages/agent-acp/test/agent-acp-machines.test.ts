import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Agent, ComputerPort, SessionMachine } from '@ahpd/sdk';
import { acpAgent, watchSession } from '../src/index.js';

/*
 * A catalogue read in the machines the sessions ran in.
 *
 * The host builds the machines of a backend's kept sessions and hands them to
 * `list`; the bridge spawns its own command in each through the port, and on
 * this host only for a session that ran here. The server behind each case is a
 * real subprocess: the scripted one in `test/fixtures/acp-server.mjs` for a
 * host, and one written for the case that needs a row of its own in a machine.
 * A host command that records every start and exits is a host spawn a case can
 * see even when the spawn was never supposed to happen.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

const made: string[] = [];

afterEach(() => {
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A fresh directory under the system temp root, kept for cleanup. */
const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-machines-'));
  made.push(path);
  return path;
};

/**
 * A host command that records its start and exits, so any spawn is visible.
 *
 * A backend whose command runs only in a machine must never reach it on this
 * host, and a listing that failed on this host must not try again at the next
 * one. Both are the absence of a line in the file this command appends.
 */
const hostStarts = (): { args: string[]; seen: () => string[] } => {
  const file = join(scratch(), 'host-starts.txt');
  return {
    args: ['-e', `require('node:fs').appendFileSync(${JSON.stringify(file)}, 'start\\n'); process.exit(3)`],
    seen: () => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean) : []),
  };
};

/** Every request one fixture server was sent, in order. */
const requests = (log: string): { method?: string }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { method?: string });
  }
  catch {
    return [];
  }
};

/**
 * A machine server that lists one session this host never has.
 *
 * The scripted fixture lists the same two rows wherever it runs, so a mixed
 * listing could not show which rows came from the machine. This one answers
 * the handshake and one `session/list`, and nothing else.
 */
function machineOnly(): string {
  const path = join(scratch(), 'machine-server.mjs');
  writeFileSync(path, [
    "import { createInterface } from 'node:readline';",
    'const send = (message) => { process.stdout.write(JSON.stringify(message) + "\\n"); };',
    'createInterface({ input: process.stdin }).on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  if (message.method === "initialize") {',
    '    send({ jsonrpc: "2.0", id: message.id, result: {',
    '      protocolVersion: 1,',
    '      agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },',
    '      authMethods: [],',
    '    } });',
    '    return;',
    '  }',
    '  if (message.method === "session/list") {',
    '    send({ jsonrpc: "2.0", id: message.id, result: { sessions: [',
    '      { sessionId: "box-1", cwd: "/tmp/box", title: "In a box" },',
    '    ] } });',
    '    return;',
    '  }',
    '  send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "no such method" } });',
    '});',
  ].join('\n'));
  return path;
}

/**
 * The backend under test, with its own request log and every line it logs.
 *
 * The provider is named for the case: what this process watched is held by
 * provider, and a case that watched a session would otherwise be watched by
 * every later case on the same name.
 */
function backend(provider: string, args: string[]): { agent: Agent; log: string; lines: string[] } {
  const log = join(scratch(), 'requests.jsonl');
  const lines: string[] = [];
  return {
    agent: acpAgent({
      command: process.execPath,
      args,
      env: { ACP_LOG: log },
      provider,
      log: (line) => { lines.push(line); },
    }),
    log,
    lines,
  };
}

/** One machine, with the folder its own request log is written to. */
const machineIn = (log: string, id = 'box'): { machine: SessionMachine; asked: { id: string; command: string; args: string[] | undefined }[] } => {
  const asked: { id: string; command: string; args: string[] | undefined }[] = [];
  const computers: ComputerPort = {
    how: async (askedId, spawn) => {
      asked.push({ id: askedId, command: spawn.command, args: spawn.args });
      return { command: process.execPath, args: [FIXTURE, '--replay'], env: { ACP_LOG: log } };
    },
  };
  return { machine: { id, computers }, asked };
};

/**
 * One machine whose port says what it is doing, and keeps every spawn.
 *
 * A stopped, suspended or gone machine must not be spawned in, which the empty
 * list of asked spawns shows. The rows it would have listed are the watched
 * ones, because no server listed at all.
 */
const machineSaying = (state: 'running' | 'stopped' | 'suspended' | undefined, id = 'box'): { machine: SessionMachine; asked: string[] } => {
  const asked: string[] = [];
  const log = join(scratch(), 'machine.jsonl');
  const computers: ComputerPort = {
    state: async () => state,
    how: async (askedId) => {
      asked.push(askedId);
      return { command: process.execPath, args: [FIXTURE, '--replay'], env: { ACP_LOG: log } };
    },
  };
  return { machine: { id, computers }, asked };
};

/** One running machine whose command exits before it speaks, as a broken one does. */
const machineFailing = (id = 'box'): { machine: SessionMachine; asked: string[] } => {
  const asked: string[] = [];
  const computers: ComputerPort = {
    state: async () => 'running',
    how: async (askedId) => {
      asked.push(askedId);
      return { command: process.execPath, args: ['-e', 'process.exit(3)'] };
    },
  };
  return { machine: { id, computers }, asked };
};

it('lists in the machine its sessions ran in, and spawns nothing on this host', async () => {
  const starts = hostStarts();
  const machineLog = join(scratch(), 'machine.jsonl');
  const { machine, asked } = machineIn(machineLog);
  const { agent } = backend('acp-machine-only', starts.args);

  const rows = await agent.list?.([machine], false);

  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  // The machine was handed the backend's own command, and not this host.
  expect(asked).toEqual([{ id: 'box', command: process.execPath, args: starts.args }]);
  expect(starts.seen()).toEqual([]);
  expect(requests(machineLog).map((one) => one.method)).toEqual(['initialize', 'session/list']);
});

it('lists on this host for an agent with no kept session, as it always did', async () => {
  const { agent, log } = backend('acp-host-only', [FIXTURE]);
  // What the host hands a backend it kept no session for: no machine at all,
  // and the listing of this host.
  const rows = await agent.list?.(undefined, true);

  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);
});

it('lists both the machine and this host for an agent with sessions in both', async () => {
  const script = machineOnly();
  const { agent, log } = backend('acp-mixed', [FIXTURE]);
  const computers: ComputerPort = {
    how: async () => ({ command: process.execPath, args: [script] }),
  };

  const rows = await agent.list?.([{ id: 'box', computers }], true);

  // The row of the machine and the rows of this host, and no row twice.
  expect(rows?.map((one) => one.id)).toEqual(['box-1', 'listed-1', 'listed-2']);
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);
});

it('answers the watched rows after a host listing fails, with one line, until its record changes', async () => {
  const provider = 'acp-fallback';
  watchSession({ provider, id: 'kept', cwd: '/tmp', additional: [], title: 'Kept' });
  const starts = hostStarts();
  const { agent, lines } = backend(provider, starts.args);

  expect((await agent.list?.(undefined, true))?.map((one) => one.id)).toEqual(['kept']);
  // The failure says nothing about a server that may exist only in a machine,
  // so it is one line, and the read answers what this process watched.
  expect(lines.filter((line) => line.startsWith(`${provider}: session/list failed:`))).toHaveLength(1);
  expect(starts.seen()).toHaveLength(1);

  // The same record is not spawned again while it answers.
  expect((await agent.list?.(undefined, true))?.map((one) => one.id)).toEqual(['kept']);
  expect(lines.filter((line) => line.startsWith(`${provider}: session/list failed:`))).toHaveLength(1);
  expect(starts.seen()).toHaveLength(1);

  // A new record is a new command, so the read is tried again.
  const second = backend(provider, starts.args);
  expect((await second.agent.list?.(undefined, true))?.map((one) => one.id)).toEqual(['kept']);
  expect(second.lines.filter((line) => line.startsWith(`${provider}: session/list failed:`))).toHaveLength(1);
  expect(starts.seen()).toHaveLength(2);
});

it('does not spawn in a stopped machine, and says so once over two listings', async () => {
  const provider = 'acp-machine-stopped';
  watchSession({ provider, id: 'kept-stopped', cwd: '/tmp', additional: [], title: 'Kept' });
  const { machine, asked } = machineSaying('stopped');
  const { agent, lines } = backend(provider, [FIXTURE]);

  expect((await agent.list?.([machine], false))?.map((one) => one.id)).toEqual(['kept-stopped']);
  expect((await agent.list?.([machine], false))?.map((one) => one.id)).toEqual(['kept-stopped']);

  // Nothing was spawned in the machine, and its sessions are the watched row.
  expect(asked).toEqual([]);
  expect(lines.filter((line) => line === `${provider}: computer://box is stopped, so its sessions come from the watched rows`)).toHaveLength(1);
});

it('does not spawn in a machine that is gone, and says so once over two listings', async () => {
  const provider = 'acp-machine-gone';
  watchSession({ provider, id: 'kept-gone', cwd: '/tmp', additional: [], title: 'Kept' });
  const { machine, asked } = machineSaying(undefined);
  const { agent, lines } = backend(provider, [FIXTURE]);

  expect((await agent.list?.([machine], false))?.map((one) => one.id)).toEqual(['kept-gone']);
  expect((await agent.list?.([machine], false))?.map((one) => one.id)).toEqual(['kept-gone']);

  expect(asked).toEqual([]);
  expect(lines.filter((line) => line === `${provider}: computer://box is gone, so its sessions come from the watched rows`)).toHaveLength(1);
});

it('spawns in a machine whose port cannot say its state, as it always did', async () => {
  const log = join(scratch(), 'machine.jsonl');
  const { machine, asked } = machineIn(log);

  const rows = await backend('acp-machine-no-state', [FIXTURE]).agent.list?.([machine], false);

  // A port with no `state` to read is spawned in, and its rows are the answer.
  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(asked).toHaveLength(1);
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);
});

it('says once that a running machine failed to list, and tries again at the next listing', async () => {
  const provider = 'acp-machine-failing';
  watchSession({ provider, id: 'kept-failing', cwd: '/tmp', additional: [], title: 'Kept' });
  const { machine, asked } = machineFailing();
  const { agent, lines } = backend(provider, [FIXTURE]);

  expect((await agent.list?.([machine], false))?.map((one) => one.id)).toEqual(['kept-failing']);
  expect((await agent.list?.([machine], false))?.map((one) => one.id)).toEqual(['kept-failing']);

  // The failure is said once for the record, and the machine is still asked.
  expect(asked).toHaveLength(2);
  expect(lines.filter((line) => line.startsWith(`${provider}: computer://box: session/list failed:`))).toHaveLength(1);
});

it('loads a session the machine listed from that machine, and spawns nothing on this host', async () => {
  const starts = hostStarts();
  const machineLog = join(scratch(), 'machine.jsonl');
  const { machine } = machineIn(machineLog);
  const { agent } = backend('acp-machine-load', starts.args);

  await agent.list?.([machine], false);
  const turns = await agent.transcript?.('listed-1');

  // The conversation is the machine server's store, so the replay reached it,
  // and the host command was never started.
  expect(turns?.map((one) => one.message.text)).toEqual(['what did we decide?', 'and the slow one?']);
  expect(requests(machineLog).some((one) => one.method === 'session/load')).toBe(true);
  expect(starts.seen()).toEqual([]);
});

it('finds a session the machine listed by listing in that machine, and spawns nothing on this host', async () => {
  const starts = hostStarts();
  const machineLog = join(scratch(), 'machine.jsonl');
  const { machine } = machineIn(machineLog);
  const log = join(scratch(), 'requests.jsonl');
  const agent = acpAgent({
    command: process.execPath,
    args: starts.args,
    env: { ACP_LOG: log },
    provider: 'acp-machine-find',
    // No settled listing answers the find, so the read reaches the machine.
    findFreshMs: 0,
  });

  await agent.list?.([machine], false);
  const found = await agent.find?.('listed-2');

  expect(found?.id).toBe('listed-2');
  expect(requests(machineLog).filter((one) => one.method === 'session/list')).toHaveLength(2);
  expect(starts.seen()).toEqual([]);
});
