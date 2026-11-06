import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetSdk, actions, createHost, echo, emit, hello, machine, peer, sdk, serving, sessionQueries, settle, wrote,
} from './support/host.js';
import { uriOf } from '../src/resources/resources.js';
import type { Agent, Bag, Session, Start } from '@ahpd/sdk';

/*
 * A chat truncated whole starts over.
 *
 * `chat/truncated` with no `turnId` clears the whole conversation, which as a
 * rewind is a cut before the first prompt, with no entry to name. A backend
 * that can delete its copy of the conversation forgets it instead, as the
 * reference's agent does: the backend stops, the conversation is deleted, and
 * a new one starts for the same chat with nothing to resume.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1141-L1168
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const DIR = tmpdir();
const LIVE = 'echo:/live';

/** What a case reads back from the backend, and what it sets on it. */
interface Seen {
  /** Every start the host handed the backend, in order. */
  starts: Start[];
  /** The stops and the deletes, in the order they happened. */
  steps: string[];
  /** A delete that fails, with this. */
  failing?: Error;
}

/**
 * The echo backend, whose stop takes a moment and which can delete.
 *
 * The stop is slow on purpose: a host that deleted without waiting for it would
 * delete while the backend still writes, and the order in `steps` says so.
 */
const backend = (seen: Seen, deletes = true): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    create: (start: Start): Session => {
      seen.starts.push(start);
      const session = base.create(start);
      return {
        ...session,
        close: async (reason) => {
          await new Promise((r) => { setTimeout(r, 20); });
          seen.steps.push(`stopped ${String(reason)}`);
          await session.close(reason);
        },
      };
    },
    ...(deletes ? {
      delete: async (id: string) => {
        seen.steps.push(`deleted ${id}`);
        if (seen.failing !== undefined) throw seen.failing;
      },
    } : {}),
  };
};

type Client = { handle(request: unknown): Promise<unknown> };

/** A host with one session whose chat has answered one turn, a client watching it, and the host's log. */
const answered = async (seen: Seen, deletes = true) => {
  const lines: string[] = [];
  const host = createHost({ path: DIR, agents: [backend(seen, deletes)], ...machine(), onEvent: (line) => { lines.push(line); } });
  const p = peer();
  p.request = async () => ({ trusted: true });
  const client: Client = host.accept(p);
  await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
  await client.handle({ method: 'createSession', params: { channel: LIVE, provider: 'echo', workingDirectories: [uriOf(DIR)] } });
  const chat = String(((await client.handle({ method: 'subscribe', params: { channel: LIVE } }) as { snapshot: { state: Bag } }).snapshot.state).defaultChat);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } } });
  await settle();
  return { client, p, chat, lines };
};

/** The ids of a chat's turns, as a subscribe answers them. */
const turnsOf = async (client: Client, chat: string): Promise<string[]> =>
  (((await client.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { state: Bag } }).snapshot.state.turns ?? []) as Bag[])
    .map((turn) => String(turn.id));

/** Truncate a chat with no turn, and let the host finish. */
const emptied = async (client: Client, chat: string): Promise<void> => {
  void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/truncated' } } });
  await settle(30);
};

describe('a chat truncated whole', () => {
  it('stops the backend, then deletes the conversation, then starts it with nothing to resume', async () => {
    const seen: Seen = { starts: [], steps: [] };
    const { client, p, chat } = await answered(seen);
    expect(await turnsOf(client, chat)).toEqual(['t1']);
    const starts = seen.starts.length;

    await emptied(client, chat);

    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(seen.steps).toEqual(['stopped stopping', 'deleted live']);
    expect(seen.starts.length).toBe(starts + 1);
    const fresh = seen.starts.at(-1);
    expect(fresh?.resume).toBeUndefined();
    expect(fresh?.seed ?? []).toEqual([]);
    expect(fresh?.chatUri).toBe(chat);
    expect(actions(p, chat).some((e) => e.action.type === 'chat/truncated')).toBe(true);
    expect(await turnsOf(client, chat)).toEqual([]);
  });

  it('runs a turn sent while it starts over on the new backend', async () => {
    const seen: Seen = { starts: [], steps: [] };
    const { client, chat } = await answered(seen);
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/truncated' } } });
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'again' } } } });
    await settle(30);
    expect(seen.steps).toEqual(['stopped stopping', 'deleted live']);
    expect(await turnsOf(client, chat)).toEqual(['t2']);
  });

  /*
   * A backend with no delete is a provider with no truncation of its own: the
   * truncation is said, every client empties the chat, and the backend keeps
   * the conversation it has, as the reference host does when its provider has
   * no `truncateChat`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1990
   */
  it('is said for a backend that cannot delete, which keeps its conversation, and nothing restarts', async () => {
    const seen: Seen = { starts: [], steps: [] };
    const { client, p, chat, lines } = await answered(seen, false);
    const starts = seen.starts.length;

    await emptied(client, chat);

    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(actions(p, chat).some((e) => e.action.type === 'chat/truncated')).toBe(true);
    expect(seen.steps).toEqual([]);
    expect(seen.starts.length).toBe(starts);
    expect(await turnsOf(client, chat)).toEqual([]);
    expect(lines.some((line) => line.includes('its backend cannot delete a conversation'))).toBe(true);
  });

  it('starts the Claude CLI again under the same id, once its transcript is gone', async () => {
    // A session a client named with a UUID, which the CLI writes its
    // conversation under, as the reference binds the fresh one to the same id.
    const id = '6f1c0d2e-8a4b-4c3d-9e5f-7a8b9c0d1e2f';
    const host = serving(DIR);
    const p = peer();
    const client: Client = host.accept(p);
    await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: `ahp-session:/${id}`, provider: 'claude' } });
    const chat = String(((await client.handle({ method: 'subscribe', params: { channel: `ahp-session:/${id}` } }) as { snapshot: { state: Bag } }).snapshot.state).defaultChat);
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    expect(sessionQueries().at(-1)?.options.sessionId).toBe(id);
    void client.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } } });
    await settle();
    await emit({ type: 'system', subtype: 'init', session_id: id });
    await emit({ type: 'assistant', uuid: 'reply-1', session_id: id, message: { id: 'm1', content: [{ type: 'text', text: 'one' }] } });
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, session_id: id });
    wrote(id, String(sessionQueries().at(-1)?.options.cwd));
    const before = sessionQueries().length;

    await emptied(client, chat);

    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(sdk.deleted).toEqual([id]);
    expect(sessionQueries().length).toBe(before + 1);
    const fresh = sessionQueries().at(-1);
    expect(fresh?.options.resume).toBeUndefined();
    expect(fresh?.options.sessionId).toBe(id);
    expect(await turnsOf(client, chat)).toEqual([]);
  });

  /*
   * The truncation is said before the backend stops, as the reference host
   * says it before its provider cuts anything. A delete that fails is logged,
   * and the backend comes back on the conversation it had under a chat that
   * keeps what the truncation left, as the reference's agent resumes the
   * transcript its failed delete left while the chat state stays cut; a client
   * that subscribes afterwards reads what the watching one was told.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1968-L1990
   */
  it('is said when the delete fails, logs why, and the backend comes back on the conversation it had', async () => {
    const seen: Seen = { starts: [], steps: [], failing: new Error('the store is read-only') };
    const { client, p, chat, lines } = await answered(seen);

    await emptied(client, chat);

    expect(actions(p).filter((e) => e.rejectionReason !== undefined)).toEqual([]);
    expect(actions(p, chat).some((e) => e.action.type === 'chat/truncated')).toBe(true);
    expect(seen.steps).toEqual(['stopped stopping', 'deleted live']);
    const back = seen.starts.at(-1);
    expect(back?.resume).toBe('live');
    expect(back?.seed).toEqual([]);
    expect(lines.some((line) => line.includes('kept its conversation: the store is read-only'))).toBe(true);
    expect(await turnsOf(client, chat)).toEqual([]);
  });
});
