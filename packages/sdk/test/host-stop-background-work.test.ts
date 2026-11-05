/*
 * The window's stop button on a background task.
 *
 * The backend reported the task and the host drew its row; this is the other
 * direction. The request names a chat and an id, the host finds the record and
 * calls what the backend gave it, and every answer a client cannot act on
 * differently is the same `false`.
 */

import { describe, expect, it } from 'vitest';
import { echo } from '../../../examples/echo/agent.js';
import { call, can, directory, hello, host, peer, root } from './users-gate-helpers.js';
import { settle } from './support/host.js';
import type { Agent, BackgroundTask, Start } from '../src/types/index.js';
import type { Grant } from '../src/types/users.js';

/** One shell task, stoppable unless the case says otherwise. */
const shell = (over: Partial<BackgroundTask> = {}): BackgroundTask => ({
  id: 'shell:1',
  kind: 'shell',
  label: 'the tests',
  startedAt: '2026-10-23T10:00:00.000Z',
  command: 'pnpm test',
  ...over,
});

/** What a session calls its chat, read rather than assumed. */
const chatOfSession = async (
  client: ReturnType<ReturnType<typeof host>['accept']>, uri: string,
): Promise<string> => (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
  snapshot: { state: { defaultChat: string } };
}).snapshot.state.defaultChat;

/**
 * A host with one session, the `Start` its backend was handed, and a count of
 * the stops the backend was asked for.
 *
 * A host with no user directory, which is the ordinary install and the one
 * where the gate refuses nothing. The two cases that need a grant are written
 * on `guarded` below.
 */
async function opened() {
  let start: Start | undefined;
  let stops = 0;
  let answer = true;
  const base = echo({ path: root, pace: 0 });
  const agent: Agent = {
    ...base,
    create: (given) => {
      start = given;
      return base.create(given);
    },
  };
  const made = host({ agents: [agent] });
  const client = made.accept(peer());
  await hello(client);
  const uri = 'ahp-session:/live';
  await call(client, 'createSession', { channel: uri, provider: 'echo' });
  const chat = await chatOfSession(client, uri);
  const seam = () => start?.backgroundTasks as NonNullable<Start['backgroundTasks']>;
  return {
    client,
    chat,
    seam,
    stops: () => stops,
    answering: (next: boolean) => { answer = next; },
    /** A task whose stop the host now holds a record for. `stoppable` false drops the verb. */
    report: (over: Partial<BackgroundTask> = {}, stoppable = true) => {
      seam().set(chat, shell({
        ...(stoppable ? { stop: async () => { stops += 1; return answer; } } : {}),
        ...over,
      }));
    },
  };
}

/**
 * The same, with a user directory beside it.
 *
 * One connection opens the session and holds the grants for that; another is
 * made per case with exactly the grants that case is about. `session:write`
 * covers every `chat:*` write, so a role that may not cancel carries neither.
 */
async function guarded() {
  let start: Start | undefined;
  let stops = 0;
  const base = echo({ path: root, pace: 0 });
  const agent: Agent = {
    ...base,
    create: (given) => {
      start = given;
      return base.create(given);
    },
  };
  const made = host({ agents: [agent], users: directory({}) });
  const opener = made.accept(peer(), { id: 'o', roles: ['r'], can: can(['session:read', 'session:write']) });
  await hello(opener);
  const uri = 'ahp-session:/live';
  await call(opener, 'createSession', { channel: uri, provider: 'echo' });
  const chat = await chatOfSession(opener, uri);
  return {
    chat,
    /** One connection, with exactly these grants. */
    as: (id: string, granted: Grant[]) => made.accept(peer(), { id, roles: ['r'], can: can(granted) }),
    report: () => {
      const seam = start?.backgroundTasks as NonNullable<Start['backgroundTasks']>;
      seam.set(chat, shell({ stop: async () => { stops += 1; return true; } }));
    },
    stops: () => stops,
  };
}

describe('vscode/stopBackgroundWork', () => {
  it('calls the stop once and answers true when it stopped the work', async () => {
    const { client, chat, report, stops } = await opened();
    report();
    await settle();

    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: 'shell:1' }))
      .toEqual({ result: { stopped: true } });
    expect(stops()).toBe(1);
  });

  it('answers false when the backend says it stopped nothing', async () => {
    const { client, chat, report, stops, answering } = await opened();
    report();
    answering(false);
    await settle();

    // And it ran all the same: the answer comes from the stop and is not read
    // off whether the verb was called.
    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: 'shell:1' }))
      .toEqual({ result: { stopped: false } });
    expect(stops()).toBe(1);
  });

  /*
   * VS Code lets its runtime's rejection through, failing the request.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L3444
   */
  it('fails the request when the stop rejects, as VS Code\'s', async () => {
    const { client, chat, seam, report } = await opened();
    report();
    seam().set(chat, shell({ stop: async () => { throw new Error('the harness is gone'); } }));
    await settle();

    // Thrown as it is, which the wire answers as an internal error.
    const answer = await call(client, 'vscode/stopBackgroundWork', { chat, id: 'shell:1' });
    expect(answer).not.toHaveProperty('result');
    expect(answer).toMatchObject({ message: 'the harness is gone' });
  });

  it('answers false for an unknown chat, an unknown id and a task with nothing to stop', async () => {
    const { client, chat, report, stops } = await opened();
    report();
    report({ id: 'subagent:1', kind: 'subagent', chat }, false);
    await settle();

    expect(await call(client, 'vscode/stopBackgroundWork', { chat: 'ahp-chat:/nobody', id: 'shell:1' }))
      .toEqual({ result: { stopped: false } });
    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: 'shell:unknown' }))
      .toEqual({ result: { stopped: false } });
    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: 'subagent:1' }))
      .toEqual({ result: { stopped: false } });
    expect(stops()).toBe(0);
  });

  it('refuses an empty id, or something that is not a chat, in VS Code\'s words', async () => {
    const { client, chat } = await opened();

    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: '' }))
      .toMatchObject({ code: -32602, message: 'id must be a non-empty string' });
    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: '  ' }))
      .toMatchObject({ code: -32602, message: 'id must be a non-empty string' });
    expect(await call(client, 'vscode/stopBackgroundWork', { chat: 'not a uri', id: 'shell:1' }))
      .toMatchObject({ code: -32602, message: 'chat must be a valid URI string' });
    expect(await call(client, 'vscode/stopBackgroundWork', { chat: 'ahp-session:/live', id: 'shell:1' }))
      .toMatchObject({ code: -32602, message: 'chat must be an Agent Host chat URI' });
    // Absent is refused as well, and not read as an empty string.
    expect(await call(client, 'vscode/stopBackgroundWork', { chat })).toMatchObject({ code: -32602 });
  });

  it('is refused a client that may send and may not cancel', async () => {
    const { chat, as, report, stops } = await guarded();
    report();
    await settle();

    const client = as('m', ['session:read', 'chat:send']);
    await hello(client, 'm');
    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: 'shell:1' }))
      .toMatchObject({ code: -32009, message: 'm may not chat:cancel here' });
    // Refused at the boundary, so the handler never ran.
    expect(stops()).toBe(0);
  });

  it('is answered by a client that holds chat:cancel', async () => {
    const { chat, as, report, stops } = await guarded();
    report();
    await settle();

    const client = as('c', ['session:read', 'chat:cancel']);
    await hello(client, 'c');
    expect(await call(client, 'vscode/stopBackgroundWork', { chat, id: 'shell:1' }))
      .toEqual({ result: { stopped: true } });
    expect(stops()).toBe(1);
  });
});
