/*
 * A backend reports a background task, and the host draws the row.
 *
 * The backend is the only thing that sees its harness's tasks; the host is the
 * only thing that knows what a chat row says. So what is checked here is the
 * seam between them: the action a live client receives, the snapshot a late one
 * opens, and the reports the host declines to take twice.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { actions, createHost, echo, hello, peer, settle } from './support/host.js';
import type { Agent, BackgroundTask, Start } from '@ahpd/sdk';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'ahpd-background-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

/** One task, with a command, a shell makes of it. */
const task = (over: Partial<BackgroundTask> = {}): BackgroundTask => ({
  id: 'shell:1',
  kind: 'shell',
  label: 'the tests',
  startedAt: '2026-10-23T10:00:00.000Z',
  command: 'pnpm test',
  ...over,
});

/**
 * A host with one session, and the `Start` its backend was handed.
 *
 * `echo` because it is the whole of `Agent` and `Session` with no harness in
 * the way: what is under test is the host's half, and a real backend's own
 * idea of a task would only be a second thing to keep true.
 */
async function opened() {
  const said: string[] = [];
  let start: Start | undefined;
  const base = echo({ path: dir, pace: 0 });
  const agent: Agent = {
    ...base,
    create: (given) => {
      start = given;
      return base.create(given);
    },
  };
  const host = createHost({ path: dir, agents: [agent], onEvent: (line: string) => { said.push(line); } });
  const p = peer();
  const client = host.accept(p);
  await client.handle(hello(['0.9.0']));
  const uri = 'ahp-session:/live';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const first = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  // Read, not assumed: what a session calls its chat is the host's to say.
  const chatUri = first.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return {
    host,
    client,
    p,
    uri,
    chatUri,
    said,
    /** What the backend was handed. */
    seam: () => start?.backgroundTasks as NonNullable<Start['backgroundTasks']>,
    /** The rest of `Start`, for the subagent factory and the emitter. */
    given: () => start as Start,
  };
}

/** The background actions a peer was told about, on any channel. */
const workActions = (p: ReturnType<typeof peer>) =>
  actions(p).filter((one) => String(one.action.type).startsWith('chat/backgroundWork'));

/** A second client, subscribed to a chat after everything already happened. */
async function lateSubscriber(host: ReturnType<typeof createHost>, channel: string) {
  const late = host.accept(peer());
  await late.handle(hello(['0.9.0'], { clientId: 'late' }));
  return await late.handle({ method: 'subscribe', params: { channel } }) as {
    snapshot: { state: { backgroundWork?: Record<string, unknown>[] } };
  };
}

describe('a task a backend reports', () => {
  it('is drawn for the client watching, and for the one that comes after', async () => {
    const { host, p, chatUri, seam } = await opened();
    seam().set(chatUri, task());
    await settle();

    const sent = workActions(p);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe(chatUri);
    expect(sent[0]?.action).toMatchObject({
      type: 'chat/backgroundWorkSet',
      work: { kind: 'shell', id: 'shell:1', label: 'the tests', command: 'pnpm test' },
    });

    // Not from the action: a client that was not there reads the snapshot.
    const opened_ = await lateSubscriber(host, chatUri);
    expect(opened_.snapshot.state.backgroundWork).toEqual([
      expect.objectContaining({ kind: 'shell', id: 'shell:1', command: 'pnpm test' }),
    ]);
  });

  it('carries the stop flag exactly when the backend can stop the task', async () => {
    const { p, chatUri, seam } = await opened();
    seam().set(chatUri, task({ id: 'shell:1', stop: async () => true }));
    seam().set(chatUri, task({ id: 'shell:2' }));
    await settle();

    const rows = workActions(p).map((one) => one.action.work as Record<string, unknown>);
    // Presence, not the answer: the flag says the backend has something to
    // call, and a task that has already ended still answers `false` when a
    // client presses the button it was shown.
    expect(rows[0]?._meta).toEqual({ 'vscode.stopBackgroundWork': true });
    expect(rows[1]?._meta).toBeUndefined();
  });

  it('sends nothing for the one report that says what the last one did', async () => {
    const { p, chatUri, seam } = await opened();
    seam().set(chatUri, task());
    seam().set(chatUri, task());
    await settle();
    // Compared by value: a poll that re-reads the same task is the ordinary
    // case, and an action per poll is the whole turn's traffic for nothing.
    expect(workActions(p)).toHaveLength(1);
  });

  it('reaches a late subscriber of a worker chat, on the worker chat', async () => {
    const { host, chatUri, seam, given } = await opened();
    const worker = given().subagent?.('call-1', { title: 'A worker', prompt: 'go' });
    if (!worker) throw new Error('the host offered no subagent seam');
    // Somebody watching the worker, which is what a live action needs: a chat
    // sends to its own subscribers and no others.
    const watching = peer();
    const watcher = host.accept(watching);
    await watcher.handle(hello(['0.9.0'], { clientId: 'watcher' }));
    await watcher.handle({ method: 'subscribe', params: { channel: worker.uri } });

    seam().set(worker.uri, task({ id: 'subagent:1', kind: 'subagent', chat: worker.uri, stop: async () => true }));
    await settle();

    const sent = workActions(watching).find((one) => one.channel === worker.uri);
    expect(sent?.action).toMatchObject({
      type: 'chat/backgroundWorkSet',
      work: { kind: 'subagent', id: 'subagent:1', chat: worker.uri },
    });
    // A worker has no `Session`, so what its subscriber reads is the state the
    // host folded from what the backend said - a row sent round `absorb` lands
    // there, and a row that skipped it does not.
    const opened_ = await lateSubscriber(host, worker.uri);
    expect(opened_.snapshot.state.backgroundWork).toEqual([
      expect.objectContaining({ kind: 'subagent', id: 'subagent:1', chat: worker.uri }),
    ]);
    // And the lead chat does not carry another chat's task.
    const lead = await lateSubscriber(host, chatUri);
    expect(lead.snapshot.state.backgroundWork).toBeUndefined();
  });

  it('is removed once, and an id the host never had is a no-op', async () => {
    const { p, chatUri, seam } = await opened();
    seam().set(chatUri, task());
    seam().remove(chatUri, 'shell:1');
    seam().remove(chatUri, 'shell:nothing');
    await settle();

    const removed = workActions(p).filter((one) => one.action.type === 'chat/backgroundWorkRemoved');
    expect(removed).toHaveLength(1);
    expect(removed[0]?.action).toMatchObject({ id: 'shell:1' });
  });

  it('sends nothing when the session that reported it closes', async () => {
    const { client, p, uri, chatUri, seam } = await opened();
    seam().set(chatUri, task());
    await settle();
    expect(workActions(p)).toHaveLength(1);

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    await settle();
    // The rows go with the chat. Sending removals to a chat nobody holds would
    // be traffic in answer to a channel that no longer exists.
    expect(workActions(p)).toHaveLength(1);
  });

  /*
   * A backend's own background action is this host's action, said as it came,
   * as VS Code's host says what its agent reports.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L901-L912
   */
  it('says a background action a backend emitted as it came', async () => {
    const { p, seam, given } = await opened();
    expect(seam()).toBeDefined();
    const work = { kind: 'shell', id: 'drawn-by-the-backend', label: 'x', startedAt: task().startedAt, command: 'x' };
    given().emit('chat', { type: 'chat/backgroundWorkSet', work });
    await settle();

    expect(workActions(p).map((one) => [one.action, one.origin])).toEqual([[{ type: 'chat/backgroundWorkSet', work }, undefined]]);
  });

  /*
   * A chat's action said on the session's channel, which holds no chat, is
   * not said, as VS Code's host refuses to emit one there.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2942-L2945
   */
  it('says nothing of a chat\'s action a backend put on its session\'s channel, as VS Code\'s host', async () => {
    const { p, uri, given } = await opened();
    const work = { kind: 'shell', id: 'astray', label: 'x', startedAt: task().startedAt, command: 'x' };
    given().emit('session', { type: 'chat/backgroundWorkSet', work } as never);
    await settle();
    expect(workActions(p).filter((one) => one.channel === uri)).toEqual([]);
  });
});
