import { WAIT_MS } from '../../../tools/wait.ts';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Turn } from '@microsoft/agent-host-protocol';
import {
  resetSdk, actions, claude, createHost, echo, emit, hello, machine, peer, settle,
} from './support/host.js';
import { fileSessions, memorySessions } from '../src/sessions/sessions.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { uriOf } from '../src/resources/resources.js';
import { chatUriFor, nonPtyShellTerminalOf } from '../src/host/channels.js';
import { createOutputs } from '../src/host/outputs.js';
import { buildNonPtyShellTerminalUri, parseNonPtyShellTerminalUri } from '../src/vscode/nonptyshellterminaluri.js';
import { URI } from '../src/vscode/uri.js';
import type { HostContext } from '../src/host/context.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { SpawnPty, TerminalOutputs } from '../src/types/terminals.js';
import type { WireTurn } from '../src/types/wire.js';
import type { Agent, Bag, HostOptions, Listed, Session, Start } from '@ahpd/sdk';

/*
 * A terminal a tool result names, after the terminal is gone.
 *
 * The protocol says a terminal that a call's content names stays subscribable
 * for as long as its chat lasts, and that a host may rebuild an exited one from
 * output it kept. So what this host's own terminals print is kept in the
 * session's folder when they exit, a backend keeps an output it has through
 * `Start.terminalOutputs`, and a subscribe that no live terminal answers is
 * answered from the file: after a client disposed the terminal, after a
 * backend released it, and after the host started again.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-retained-'));
  made.push(dir);
  return dir;
};

/** Where every case works: a real folder, because a shell starts in it. */
const DIR = tmpdir();

/** Every output a session's folder keeps, as the files hold them: its `terminals` folder, beside the chats' local turns. */
const keptIn = (store: SessionStore, id: string): Bag[] => {
  const session = store.attachmentsDir?.(id);
  const folder = session === undefined ? undefined : join(session, 'terminals');
  if (folder === undefined || !existsSync(folder)) return [];
  return readdirSync(folder, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(join(folder, name), 'utf8')) as Bag);
};

type Client = { handle(request: unknown): Promise<unknown> };

/** A channel's state, as a subscribe answers it. */
const stateOf = async (client: Client, channel: string): Promise<Bag> =>
  (await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Bag } }).snapshot.state;

/** A finished turn with one call, whose content names a terminal. */
/** A turn a chat ran, which a chat has before a move is made of it. */
const FIRST: Bag = { id: 't0', message: { text: 'first', origin: { kind: 'user' } }, state: 'complete', responseParts: [] };

const naming = (turnId: string, toolCallId: string, resource: string, result?: Bag, status = 'completed'): Bag => ({
  id: turnId,
  message: { text: 'run it', origin: { kind: 'user' } },
  state: 'complete',
  responseParts: [{
    kind: 'toolCall',
    toolCall: {
      toolCallId,
      toolName: 'terminal',
      displayName: 'Terminal',
      status,
      ...(status === 'completed' ? { success: true, pastTenseMessage: 'Ran it' } : {}),
      content: [{ type: 'terminal', resource, title: 'Terminal', isPty: false, ...(result === undefined ? {} : { result }) }],
    },
  }],
});

/**
 * A retained terminal link of a call in a chat, as VS Code builds one, for a
 * name no call of this host's minted: the host reads its chat and its call.
 */
const linkOf = (chat: string, toolCallId: string): string =>
  buildNonPtyShellTerminalUri('file:///kept', 'ahp-session:/elsewhere', chat, toolCallId);

/*
 * VS Code's retained terminal link: `agenthost-terminal://shell/<session
 * id>/<tool call id>`, the storage, the session, the chat and the call in a
 * JSON query, read back by the chat it names.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/nonPtyShellTerminalUri.ts#L17-L29
 */
describe('the name a retained terminal has', () => {
  it('carries its chat and its call there and back, in VS Code\'s link', () => {
    const chat = chatUriFor('claude:/one');
    const uri = buildNonPtyShellTerminalUri('file:///kept', 'claude:/one', chat, 't1:command/2%');
    const parsed = URI.parse(uri);
    expect([parsed.scheme, parsed.authority, parsed.path]).toEqual(['agenthost-terminal', 'shell', '/one/t1:command/2%']);
    expect(JSON.parse(parsed.query)).toEqual({ storage: 'file:///kept', session: 'claude:/one', chat, toolCallId: 't1:command/2%' });
    expect(nonPtyShellTerminalOf(uri)).toEqual({ chat, toolCallId: 't1:command/2%' });
    // A peer chat is carried the same way.
    expect(nonPtyShellTerminalOf(linkOf('ahp-chat:/peer', 'toolu_1'))).toEqual({ chat: 'ahp-chat:/peer', toolCallId: 'toolu_1' });
  });

  it('reads any other name as nothing', () => {
    const query = (fields: Record<string, string>) => encodeURIComponent(JSON.stringify(fields));
    const whole = { storage: 'file:///kept', session: 'ahp-session:/one', chat: 'ahp-chat:/peer', toolCallId: 'toolu_1' };
    const { chat: _chat, ...chatless } = whole;
    for (const uri of [
      'ahp-terminal:/one',
      'agenthost-terminal:/one',
      'agenthost-terminal://shell/one/toolu_1',
      'agenthost-terminal://shell/one/toolu_1?not-json',
      `agenthost-terminal://shell/one/toolu_1?${query(chatless)}`,
      `agenthost-terminal://other/one/toolu_1?${query(whole)}`,
      `ahp-terminal://shell/one/toolu_1?${query(whole)}`,
    ]) expect(nonPtyShellTerminalOf(uri), uri).toBeUndefined();
  });
});

describe('a command typed into the conversation', () => {
  /**
   * A session on a store that keeps a folder, with its chat watched.
   *
   * Named the way the host holds it, as VS Code names one, so the chat a case
   * reads is the chat the host names a terminal under.
   */
  const shelled = async (over: Partial<HostOptions> = {}) => {
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine(), sessions: store, ...over });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const uri = 'claude:/banged';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude', workingDirectories: [uriOf(DIR)] } });
    const chatUri = String((await stateOf(client, uri)).defaultChat);
    await stateOf(client, chatUri);
    return { host, client, peer: p, store, chatUri };
  };

  /** Run one command as a turn, and answer the call that ran it. */
  const ran = async (client: Client, p: ReturnType<typeof peer>, chatUri: string, turnId: string, command: string) => {
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: `!${command}`, origin: { kind: 'user' } } } },
    });
    for (const until = Date.now() + WAIT_MS; Date.now() < until;) {
      await new Promise((r) => { setTimeout(r, 25); });
      if (actions(p, chatUri).some((e) => e.action.type === 'chat/turnComplete' && e.action.turnId === turnId)) break;
    }
    const done = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallComplete' && e.action.turnId === turnId)?.action;
    const content = (done?.result as { content: Bag[] } | undefined)?.content ?? [];
    return { toolCallId: String(done?.toolCallId), terminal: String(content.find((one) => one.type === 'terminal')?.resource) };
  };

  it('names its terminal after the call, and keeps what it printed with its exit code', async () => {
    const { client, peer: p, store, chatUri } = await shelled();
    const { toolCallId, terminal } = await ran(client, p, chatUri, 't1', 'echo kept-output; exit 3');
    // VS Code's link, naming the session, the chat the call is in and the call
    // itself: the chat and the call are what a subscribe after the terminal is
    // gone reads to find the output.
    expect(nonPtyShellTerminalOf(terminal)).toEqual({ chat: chatUri, toolCallId });
    expect(parseNonPtyShellTerminalUri(URI.parse(terminal))?.session.toString()).toBe('claude:/banged');
    const kept = keptIn(store, 'banged');
    expect(kept).toHaveLength(1);
    expect(String(kept[0]?.output)).toContain('kept-output');
    expect(kept[0]).toMatchObject({ exitCode: 3, isPty: false });
  });

  it('answers the live terminal while there is one, and rebuilds it exited once a client disposed it', async () => {
    const { client, peer: p, chatUri } = await shelled();
    const { toolCallId, terminal } = await ran(client, p, chatUri, 't1', 'echo rebuilt-output; exit 3');
    const live = await stateOf(client, terminal);
    // The store's own state, which says where it ran.
    expect(live.cwd).toBeDefined();

    await client.handle({ method: 'disposeTerminal', params: { channel: terminal } });
    const rebuilt = await stateOf(client, terminal);
    expect(rebuilt.cwd).toBeUndefined();
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: expect.stringContaining('rebuilt-output') }]);
    expect(rebuilt.lifecycle).toEqual({ status: 'exited', exitCode: 3 });
    expect(rebuilt.exitCode).toBeUndefined();
    expect(rebuilt.isPty).toBe(false);
    // Held by the chat and the call, as the live one was; the turn is not part
    // of a rebuilt claim, as it is not of the reference's.
    const claim = live.claim as Bag;
    expect(rebuilt.claim).toEqual({ kind: 'session', session: claim.session, chat: chatUri, toolCallId });
    expect(claim.toolCallId).toBe(toolCallId);
  });

  it('says a terminal ran under a pseudoterminal when it did', async () => {
    // A shell under a pty prints VT sequences, and a client reads `isPty` to
    // know to parse them. This one prints them as its prompt and exits on
    // the first line it is given.
    const printing: SpawnPty = () => {
      let data: ((text: string) => void) | undefined;
      let exit: ((ended: { exitCode: number }) => void) | undefined;
      setTimeout(() => { data?.('\u001b[1mbold\u001b[0m'); }, 20);
      return {
        onData: (listen) => { data = listen; },
        onExit: (listen) => { exit = listen; },
        write: () => { exit?.({ exitCode: 0 }); },
        resize: () => {},
        kill: () => {},
      };
    };
    const { client, peer: p, chatUri } = await shelled({ terminals: shellTerminals({ pty: printing }) });
    const { terminal } = await ran(client, p, chatUri, 't1', 'anything');
    const live = await stateOf(client, terminal);
    expect(live.isPty).toBe(true);
    await client.handle({ method: 'disposeTerminal', params: { channel: terminal } });
    const rebuilt = await stateOf(client, terminal);
    expect(rebuilt.isPty).toBe(true);
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: '\u001b[1mbold\u001b[0m' }]);
  });

  it('answers an address no call names as an unknown terminal', async () => {
    const { client, peer: p, chatUri } = await shelled();
    await ran(client, p, chatUri, 't1', 'echo one');
    await expect(stateOf(client, linkOf(chatUri, 'no-such-call'))).rejects.toThrow(/No agent for session/);
    await expect(stateOf(client, linkOf('ahp-chat:/gone', 'x'))).rejects.toThrow(/No agent for session/);
  });

  it('refuses a client\'s shell under a name it keeps for a call\'s terminal', async () => {
    const { client, chatUri } = await shelled();
    await expect(client.handle({
      method: 'createTerminal',
      params: { channel: linkOf(chatUri, 'mine'), cwd: uriOf(DIR) },
    })).rejects.toThrow(/keeps for the terminals a tool result names/);
  });

  it('takes the outputs of the turns a truncation drops, and keeps the rest', async () => {
    const { client, peer: p, store, chatUri } = await shelled();
    await ran(client, p, chatUri, 't0', 'echo kept-one');
    // A turn the agent ran, with the backend's own name for its end, so the
    // chat can be cut back to it.
    void client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'first' } } },
    });
    await settle();
    await emit({ type: 'user', session_id: 'sdk-1', uuid: 'prompt-1', message: { role: 'user', content: 'first' } });
    await emit({ type: 'assistant', uuid: 'reply-1', message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });
    await ran(client, p, chatUri, 't2', 'echo dropped-one');
    // The first line of each: a shell on pipes marks no command's end, so the
    // line it echoes after the command is in what it printed too.
    const printed = (): string[] => keptIn(store, 'banged').map((one) => String(one.output).split('\n')[0] ?? '');
    expect(printed().sort()).toEqual(['dropped-one', 'kept-one']);

    void client.handle({ method: 'dispatchAction', params: { channel: chatUri, action: { type: 'chat/truncated', turnId: 't1' } } });
    await settle();
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/truncated')).toBe(true);
    expect(printed()).toEqual(['kept-one']);
  });
});

/** What a case sets on the backend, and reads back from it. */
interface Knobs {
  /** Every start the host handed it, in order. */
  starts: Start[];
  /** Turns a chat holds beside the backend's own, by the chat's URI. */
  turns: Map<string, Bag[]>;
  /** What a transcript read answers, given the outputs the host handed it. */
  transcript?: (id: string, outputs: TerminalOutputs | undefined) => Bag[] | undefined;
  /** Each transcript read: the conversation, and the chat its outputs are named under. */
  reads: { id: string; chat: string | undefined }[];
  /** What a listing answers, for a host that has not run the session. */
  listed?: Listed[];
  /** A start this backend will not take, as a destination that refuses a chat. */
  refuses?: (start: Start) => boolean;
}

const knobs = (): Knobs => ({ starts: [], turns: new Map(), reads: [] });

/** The echo backend, with the knobs a case turns. */
const backend = (k: Knobs): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    list: async () => (k.listed === undefined ? await base.list?.() ?? [] : [...k.listed]),
    transcript: async (id, at, outputs) => {
      k.reads.push({ id, chat: outputs === undefined ? undefined : nonPtyShellTerminalOf(outputs.uri('probe'))?.chat });
      const own = k.transcript?.(id, outputs);
      return own === undefined ? await base.transcript?.(id, at) : own as WireTurn<Turn>[];
    },
    create: (start: Start): Session => {
      if (k.refuses?.(start) === true) throw new Error('this backend will not work there');
      k.starts.push(start);
      // A peer chat resumes under its own name, as the chats suite's does.
      const session = base.create(start.chatId === undefined ? start : { ...start, resume: start.chatId });
      return { ...session, allTurns: () => [...session.allTurns(), ...(k.turns.get(start.chatUri) ?? [])] };
    },
  };
};

// Named the way the host holds them, so a chat a case reads is the chat a
// start was handed.
const LIVE = 'echo:/live';
const TWO = 'echo:/two';
const PEER = 'ahp-chat:/3f0c6a52-9a43-4d0e-a2b1-6b1f7c1d5e10';
const TAIL = 'ahp-chat:/tail';

/** One row, as a backend lists it. */
const row = (id: string): Listed => ({
  id,
  title: 'Earlier',
  createdAt: '2026-10-27T00:00:00.000Z',
  modifiedAt: '2026-10-27T09:00:00.000Z',
  workingDirectories: [uriOf(DIR)],
});

/** A host on a store, with a client watching the root. */
const hostAt = async (k: Knobs, store: SessionStore) => {
  const host = createHost({ path: DIR, agents: [backend(k)], ...machine(), sessions: store });
  const p = peer();
  // A folder is untrusted until the window says otherwise, and the window
  // here is the client.
  p.request = async () => ({ trusted: true });
  const client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  return { host, client, p };
};

/** Moving chats on, as a VS Code window with its move setting on turns it on. */
const movesOn = async (client: Awaited<ReturnType<typeof hostAt>>['client']): Promise<void> => {
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-root://', action: { type: 'root/configChanged', config: { 'chatMoves.enabled': true } } },
  });
};

/** The start the host made for one chat, the latest of them. */
const startOf = (k: Knobs, chat: string): Start => {
  const start = k.starts.filter((one) => one.chatUri === chat).at(-1);
  if (start === undefined) throw new Error(`no start for ${chat}`);
  return start;
};

describe('a terminal a backend opens', () => {
  it('is named under its chat, keeps its output when it exits, and is rebuilt after its release', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client } = await hostAt(k, store);
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    const chat = String((await stateOf(client, LIVE)).defaultChat);
    const start = startOf(k, chat);

    const opened = start.terminals?.open({ cwd: DIR, command: 'echo from-the-backend; exit 4' });
    if (opened === undefined) throw new Error('no terminals on the start');
    expect(nonPtyShellTerminalOf(opened.uri)?.chat).toBe(chat);
    await opened.waitForExit();
    expect(keptIn(store, 'live')).toEqual([expect.objectContaining({ exitCode: 4, isPty: false })]);

    // An ACP call's content: the terminal, and nothing about how it ended.
    k.turns.set(chat, [naming('t1', 'call-1', opened.uri)]);
    opened.release();
    const rebuilt = await stateOf(client, opened.uri);
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: expect.stringContaining('from-the-backend') }]);
    // The code the file kept, since the call carries none.
    expect(rebuilt.lifecycle).toEqual({ status: 'exited', exitCode: 4 });
    expect(rebuilt.claim).toEqual({ kind: 'session', session: 'echo:/live', chat, toolCallId: 'call-1' });
  });

  it('keeps it in the session the chat moved to while it ran', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client } = await hostAt(k, store);
    await movesOn(client);
    for (const [session, chat] of [[LIVE, PEER], [TWO, TAIL]] as const) {
      await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
      await client.handle({ method: 'createChat', params: { channel: session, chat } });
    }
    await settle();
    k.turns.set(PEER, [FIRST]);
    // Waiting on its input, so it ends after the move rather than before it.
    // The shell is PowerShell on Windows, which has no `read`.
    const command = process.platform === 'win32' ? '$line = [Console]::In.ReadLine(); echo "late $line"' : 'read line; echo "late $line"';
    const opened = startOf(k, PEER).terminals?.open({ cwd: DIR, command });
    if (opened === undefined) throw new Error('no terminals on the start');
    await client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } });
    await settle(20);
    opened.write(process.platform === 'win32' ? 'one\r\n' : 'one\n');
    await opened.waitForExit();
    expect(keptIn(store, 'live')).toEqual([]);
    expect(keptIn(store, 'two').map((one) => String(one.output).trim())).toEqual(['late one']);
  });
});

describe('an output a backend keeps', () => {
  /** A session on a store that keeps a folder, and the start of its chat. */
  const kept = async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { host, client } = await hostAt(k, store);
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    const chat = String((await stateOf(client, LIVE)).defaultChat);
    const outputs = startOf(k, chat).terminalOutputs;
    if (outputs === undefined) throw new Error('no outputs on the start');
    return { k, store, host, client, chat, outputs };
  };

  it('is kept, says it is, and is what a subscribe to its name answers', async () => {
    const { k, client, chat, outputs } = await kept();
    expect(outputs.has('toolu_big')).toBe(false);
    expect(outputs.keep('toolu_big', 'all of it', 0)).toBe(true);
    expect(outputs.has('toolu_big')).toBe(true);
    expect(nonPtyShellTerminalOf(outputs.uri('toolu_big'))).toEqual({ chat, toolCallId: 'toolu_big' });

    // A call that sent a preview and said there was more.
    k.turns.set(chat, [naming('t1', 'toolu_big', outputs.uri('toolu_big'), { truncated: true, preview: 'all', exitCode: 0 })]);
    const rebuilt = await stateOf(client, outputs.uri('toolu_big'));
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: 'all of it' }]);
    expect(rebuilt.lifecycle).toEqual({ status: 'exited', exitCode: 0 });
    expect(rebuilt.isPty).toBe(false);
    expect(rebuilt.title).toBe('Terminal');
  });

  it('takes the call\'s own exit code over the one kept with the output', async () => {
    const { k, client, chat, outputs } = await kept();
    outputs.keep('toolu_code', 'out', 1);
    k.turns.set(chat, [naming('t1', 'toolu_code', outputs.uri('toolu_code'), { exitCode: 2 })]);
    expect((await stateOf(client, outputs.uri('toolu_code'))).lifecycle).toEqual({ status: 'exited', exitCode: 2 });
  });

  /*
   * A rebuilt terminal is VS Code's five fields, the exit code in its
   * lifecycle alone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L273-L284
   */
  it('rebuilds a terminal with VS Code\'s five fields', async () => {
    const { k, client, chat, outputs } = await kept();
    outputs.keep('toolu_five', 'out', 0);
    k.turns.set(chat, [naming('t1', 'toolu_five', outputs.uri('toolu_five'), { exitCode: 0 })]);
    expect(Object.keys(await stateOf(client, outputs.uri('toolu_five'))).sort()).toEqual(['claim', 'content', 'isPty', 'lifecycle', 'title']);
  });

  it('is not kept over 10 MB, counted in bytes', async () => {
    const { outputs } = await kept();
    expect(outputs.keep('huge', 'x'.repeat(10 * 1024 * 1024 + 1))).toBe(false);
    // Five million characters, ten million and two bytes.
    expect(outputs.keep('wide', 'é'.repeat(5 * 1024 * 1024 + 1))).toBe(false);
    expect(outputs.has('huge')).toBe(false);
    expect(outputs.has('wide')).toBe(false);
    expect(outputs.keep('edge', 'x'.repeat(10 * 1024 * 1024))).toBe(true);
  });

  it('rebuilds a call that has only its preview, and not one that said there was more', async () => {
    const { k, client, chat, outputs } = await kept();
    k.turns.set(chat, [
      naming('t1', 'small', outputs.uri('small'), { preview: 'only the preview', exitCode: 0 }),
      naming('t2', 'cut', outputs.uri('cut'), { truncated: true, preview: 'the start' }),
      naming('t3', 'bare', outputs.uri('bare')),
    ]);
    expect((await stateOf(client, outputs.uri('small'))).content).toEqual([{ type: 'unclassified', value: 'only the preview' }]);
    await expect(stateOf(client, outputs.uri('cut'))).rejects.toThrow(/No agent for session/);
    await expect(stateOf(client, outputs.uri('bare'))).rejects.toThrow(/No agent for session/);
  });

  it('is found by the call that names it, however the call spelt the key', async () => {
    const { k, client, chat, outputs } = await kept();
    outputs.keep('t1:command', 'spelt', 0);
    const canonical = outputs.uri('t1:command');
    expect(canonical).toContain('%3A');
    k.turns.set(chat, [naming('t1', 't1:command', canonical.replace('%3A', '%3a'))]);
    expect((await stateOf(client, canonical)).content).toEqual([{ type: 'unclassified', value: 'spelt' }]);
  });

  it('is read only from a file this version wrote', async () => {
    const { k, store, client, chat, outputs } = await kept();
    outputs.keep('toolu_old', 'as kept', 0);
    const folder = String(store.attachmentsDir?.('live'));
    const [name] = readdirSync(folder, { recursive: true, encoding: 'utf8' }).filter((one) => one.endsWith('.json'));
    writeFileSync(join(folder, String(name)), JSON.stringify({ version: 2, output: 'from another version' }));
    k.turns.set(chat, [
      naming('t1', 'toolu_old', outputs.uri('toolu_old'), { preview: 'the preview' }),
    ]);
    expect((await stateOf(client, outputs.uri('toolu_old'))).content).toEqual([{ type: 'unclassified', value: 'the preview' }]);
  });

  it('is not rebuilt for a call a client never saw finish', async () => {
    const { k, client, chat, outputs } = await kept();
    outputs.keep('stopped', 'never shown', 0);
    k.turns.set(chat, [naming('t1', 'stopped', outputs.uri('stopped'), undefined, 'cancelled')]);
    await expect(stateOf(client, outputs.uri('stopped'))).rejects.toThrow(/No agent for session/);
  });

  it('goes with its chat when a client disposes the chat', async () => {
    const { k, store, client, chat, outputs } = await kept();
    await client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    const peers = startOf(k, PEER).terminalOutputs;
    peers?.keep('toolu_peer', 'the peer\'s', 0);
    outputs.keep('toolu_first', 'the first\'s', 0);
    k.turns.set(PEER, [naming('t1', 'toolu_peer', String(peers?.uri('toolu_peer')), { preview: 'the peer\'s' })]);
    k.turns.set(chat, [naming('t1', 'toolu_first', outputs.uri('toolu_first'), { preview: 'the first\'s' })]);
    expect(keptIn(store, 'live')).toHaveLength(2);

    await client.handle({ method: 'disposeChat', params: { channel: PEER } });
    expect(keptIn(store, 'live').map((one) => one.output)).toEqual(['the first\'s']);
    await expect(stateOf(client, String(peers?.uri('toolu_peer')))).rejects.toThrow(/No agent for session/);
  });

  it('goes with its session', async () => {
    const { store, client, outputs } = await kept();
    outputs.keep('toolu_1', 'gone with it', 0);
    expect(keptIn(store, 'live')).toHaveLength(1);
    await client.handle({ method: 'disposeSession', params: { channel: LIVE } });
    expect(existsSync(String(store.attachmentsDir?.('live')))).toBe(false);
  });

  it('moves with its chat to another session', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client } = await hostAt(k, store);
    await movesOn(client);
    for (const [session, chat] of [[LIVE, PEER], [TWO, TAIL]] as const) {
      await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
      await client.handle({ method: 'createChat', params: { channel: session, chat } });
    }
    await settle();
    const outputs = startOf(k, PEER).terminalOutputs;
    outputs?.keep('toolu_1', 'moving', 0);
    k.turns.set(PEER, [naming('t1', 'toolu_1', String(outputs?.uri('toolu_1')))]);

    await client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } });
    await settle(20);
    expect(keptIn(store, 'live')).toEqual([]);
    expect(keptIn(store, 'two').map((one) => one.output)).toEqual(['moving']);
    const rebuilt = await stateOf(client, String(outputs?.uri('toolu_1')));
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: 'moving' }]);
    expect((rebuilt.claim as Bag).session).toBe('echo:/two');
  });

  /*
   * A move starts nothing: the chat's runtime goes on until its next turn
   * boundary relaunches it under the destination, as VS Code moves only
   * ownership, so a destination whose backend would not start the chat does
   * not refuse the move, and the outputs go with the chat.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L374
   */
  it('goes with its chat on a move to a session whose backend would not start it yet', async () => {
    const k = knobs();
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const { client } = await hostAt(k, store);
    await movesOn(client);
    for (const [session, chat] of [[LIVE, PEER], [TWO, TAIL]] as const) {
      await client.handle({ method: 'createSession', params: { channel: session, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
      await client.handle({ method: 'createChat', params: { channel: session, chat } });
    }
    await settle();
    k.turns.set(PEER, [FIRST]);
    startOf(k, PEER).terminalOutputs?.keep('toolu_1', 'goes', 0);
    k.refuses = (start) => start.chatUri === PEER && start.uri === TWO;

    await client.handle({ method: 'moveChat', params: { channel: PEER, destination: { kind: 'session', session: TWO } } });
    await settle(20);
    expect(keptIn(store, 'live')).toEqual([]);
    expect(keptIn(store, 'two').map((one) => one.output)).toEqual(['goes']);
  });

  it('is not offered where the store keeps no folder', async () => {
    const k = knobs();
    // The store a host is given when nothing names one, which keeps no folders.
    const { client } = await hostAt(k, memorySessions());
    await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo' } });
    const chat = String((await stateOf(client, LIVE)).defaultChat);
    expect(startOf(k, chat).terminalOutputs).toBeUndefined();
  });
});

describe('a host started again on the same store', () => {
  it('rebuilds a terminal the backend\'s transcript names, from what was kept', async () => {
    const dir = join(temp(), 'sessions');
    const first = knobs();
    const before = await hostAt(first, fileSessions({ dir }));
    await before.client.handle({ method: 'createSession', params: { channel: 'echo:/kept', provider: 'echo' } });
    const chat = String((await stateOf(before.client, 'echo:/kept')).defaultChat);
    const outputs = startOf(first, chat).terminalOutputs;
    expect(outputs?.keep('toolu_1', 'before the restart', 0)).toBe(true);
    const address = String(outputs?.uri('toolu_1'));
    await before.host.close();

    // The transcript holds what the model was sent; the backend names the
    // output it kept on the call it reads back.
    const second = knobs();
    second.listed = [row('kept')];
    second.transcript = (id, given) => (id === 'kept' && given?.has('toolu_1') === true
      ? [naming('t1', 'toolu_1', given.uri('toolu_1'), { truncated: true, preview: 'before', exitCode: 0 })]
      : undefined);
    const after = await hostAt(second, fileSessions({ dir }));
    const rebuilt = await stateOf(after.client, address);
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: 'before the restart' }]);
    expect(rebuilt.claim).toEqual({ kind: 'session', session: 'echo:/kept', chat, toolCallId: 'toolu_1' });
    expect(second.reads).toContainEqual({ id: 'kept', chat });
    await after.host.close();
  });

  it('rebuilds a peer chat\'s terminal from that chat\'s own transcript', async () => {
    const dir = join(temp(), 'sessions');
    const first = knobs();
    const before = await hostAt(first, fileSessions({ dir }));
    await before.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
    await before.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    const outputs = startOf(first, PEER).terminalOutputs;
    expect(outputs?.keep('toolu_peer', 'the peer\'s, kept', 0)).toBe(true);
    const address = String(outputs?.uri('toolu_peer'));
    await before.host.close();

    const second = knobs();
    second.listed = [row('live')];
    // The peer's conversation is its own, under the id the chat named.
    const peerId = PEER.slice('ahp-chat:/'.length);
    second.transcript = (id, given) => (id === peerId && given?.has('toolu_peer') === true
      ? [naming('t1', 'toolu_peer', given.uri('toolu_peer'), { truncated: true, preview: 'the peer\'s' })]
      : []);
    const after = await hostAt(second, fileSessions({ dir }));
    const rebuilt = await stateOf(after.client, address);
    expect(rebuilt.content).toEqual([{ type: 'unclassified', value: 'the peer\'s, kept' }]);
    expect(rebuilt.claim).toEqual({ kind: 'session', session: LIVE, chat: PEER, toolCallId: 'toolu_peer' });
    await after.host.close();
  });

  it('answers nothing for a peer chat a client closed, though its transcript still names the call', async () => {
    const dir = join(temp(), 'sessions');
    const first = knobs();
    const before = await hostAt(first, fileSessions({ dir }));
    await before.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
    await before.client.handle({ method: 'createChat', params: { channel: LIVE, chat: PEER } });
    await settle();
    const address = String(startOf(first, PEER).terminalOutputs?.uri('toolu_peer'));
    await before.client.handle({ method: 'disposeChat', params: { channel: PEER } });
    await before.host.close();

    // Closed and not deleted, so the backend still holds the peer's
    // conversation, and that conversation still holds the call and its preview.
    const second = knobs();
    second.listed = [row('live')];
    second.transcript = (id, given) => (id === PEER.slice('ahp-chat:/'.length)
      ? [naming('t1', 'toolu_peer', String(given?.uri('toolu_peer')), { preview: 'the peer\'s' })]
      : []);
    const after = await hostAt(second, fileSessions({ dir }));
    await expect(stateOf(after.client, address)).rejects.toThrow(/No agent for session/);
    await after.host.close();
  });

  it('hands each transcript read the outputs of the chat it reads', async () => {
    const dir = join(temp(), 'sessions');
    const first = knobs();
    const before = await hostAt(first, fileSessions({ dir }));
    await before.client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
    const own = String((await stateOf(before.client, LIVE)).defaultChat);
    for (const chat of [PEER, TAIL]) await before.client.handle({ method: 'createChat', params: { channel: LIVE, chat } });
    await settle();
    await before.host.close();

    const second = knobs();
    second.listed = [row('live')];
    // A conversation with nothing in it, which is a conversation all the same.
    second.transcript = () => [];
    const after = await hostAt(second, fileSessions({ dir }));
    await stateOf(after.client, PEER);
    await stateOf(after.client, TAIL);
    // A turn wakes the session, and every chat of it is read again.
    void after.client.handle({
      method: 'dispatchAction',
      params: { channel: TAIL, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'wake up' } } },
    });
    for (let i = 0; i < 200 && second.starts.length < 3; i += 1) await settle(1);
    // Woken as its first chat, with the peers beside it.
    expect(second.starts.map((one) => one.chatUri)).toEqual([own, PEER, TAIL]);

    // The session's own conversation is its first chat's; each peer's is its own.
    const byId = new Map([['live', own], [PEER.slice('ahp-chat:/'.length), PEER], ['tail', TAIL]]);
    expect(second.reads.length).toBeGreaterThan(3);
    for (const read of second.reads) expect(read.chat, read.id).toBe(byId.get(read.id));
    expect(new Set(second.reads.map((read) => read.chat))).toEqual(new Set([own, PEER, TAIL]));
    await after.host.close();
  });
});

describe('the outputs of turns that are dropped', () => {
  it('are only the chat\'s own: a fork names the outputs of the chat it was made from', () => {
    const store = fileSessions({ dir: join(temp(), 'sessions') });
    const outputs = createOutputs({ kept: store, log: () => {}, byChat: new Map() } as unknown as HostContext);
    const source = outputs.outputsFor('echo:/live', PEER);
    const fork = outputs.outputsFor('echo:/live', TAIL);
    source?.keep('toolu_1', 'the source\'s', 0);
    // A key the fork has an output of its own under, too.
    fork?.keep('toolu_1', 'the fork\'s first', 0);
    fork?.keep('toolu_2', 'the fork\'s second', 0);
    // The fork's dropped turns: one call copied from its source, one its own.
    outputs.forgetTurnOutputs('echo:/live', TAIL, [
      naming('t1', 'toolu_1', String(source?.uri('toolu_1'))),
      naming('t2', 'toolu_2', String(fork?.uri('toolu_2'))),
    ]);
    expect(source?.has('toolu_1')).toBe(true);
    expect(fork?.has('toolu_1')).toBe(true);
    expect(fork?.has('toolu_2')).toBe(false);
  });
});
