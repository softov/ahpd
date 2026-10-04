import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { createFileStore } from '@cofold/store-file';
import type { ModelAdapter, Policy } from '@cofold/agents';
import type { Agent, Bag } from '@ahpd/sdk';
import { cofoldAgent } from '../src/index.js';

/*
 * Deleting a cofold session.
 *
 * cofold's store has a delete of its own, so the question is not what a delete
 * looks like but which of the store's refusals means the session is gone and
 * which means it is still there: a host that answers the second as the first
 * would tell a client a session was deleted while its transcript is readable.
 */

const until = async (check: () => boolean, ms = 4000): Promise<void> => {
  const limit = Date.now() + ms;
  while (!check()) {
    if (Date.now() > limit) throw new Error('timed out waiting');
    await new Promise((r) => { setTimeout(r, 0); });
  }
};

/** A directory a store and a workspace can both live under. */
const place = (): { root: string; sweep: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-cofold-delete-'));
  return { root: join(dir, 'store'), sweep: join(dir, 'work') };
};

const allowAll = (): Partial<Policy> => ({ decide: () => ({ behavior: 'allow' }) });

/** One backend over a file store, with a model scripted. */
const backend = (root: string, model: ModelAdapter): Agent =>
  cofoldAgent({ adapter: model, store: root, policy: allowAll() });

/** Run one session to its end and close it, leaving the record on disk. */
const spoken = async (agent: Agent, id: string, workingDirectory: string): Promise<void> => {
  const notes: Bag[] = [];
  const session = agent.create({
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: agent.defaults(),
    workingDirectory,
    schema: () => agent.schema(),
    emit: (_channel, action) => { notes.push(action); },
  });
  session.begin('t1', `say ${id}`);
  await until(() => notes.some((one) => one.type === 'chat/turnComplete' || one.type === 'chat/turnCancelled'));
  session.close();
};

it('removes the session, so the next listing does not offer it', async () => {
  const { root, sweep } = place();
  const agent = backend(root, createFakeModel({ script: [{ text: 'hi' }, { text: 'hi' }], stream: true }));
  await spoken(agent, 'one', sweep);
  await spoken(agent, 'two', sweep);
  // Newest first, as the store lists them.
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['two', 'one']);

  await agent.delete?.('one', undefined);

  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['two']);
  // And there is nothing left to read, which is the half a listing cannot show.
  expect(await agent.transcript?.('one')).toBeUndefined();
});

it('is on the agent, over the same store a second backend reads', async () => {
  // The store is the only copy, so a delete that did not reach it would show
  // up in a fresh backend over the same directory - which is what a restart is.
  const { root, sweep } = place();
  const model = createFakeModel({ script: [{ text: 'hi' }], stream: true });
  await spoken(backend(root, model), 'one', sweep);

  const restarted = cofoldAgent({ adapter: model, store: root, policy: allowAll() });
  expect(restarted.delete).toBeTypeOf('function');
  await restarted.delete?.('one', sweep);

  expect(await restarted.list?.()).toEqual([]);
});

it('counts a session the store does not have as deleted', async () => {
  const { root } = place();
  const agent = backend(root, createFakeModel({ script: [], stream: true }));

  // A row this daemon only listed for a project cofold has no store for, and
  // then the same row deleted twice.
  await expect(agent.delete?.('never', undefined)).resolves.toBeUndefined();
  await expect(agent.delete?.('never', undefined)).resolves.toBeUndefined();
});

it('raises a store that will not let go of the record, rather than calling it deleted', async () => {
  // A run still writing holds the claim, and the store refuses while it does.
  // That is not a session which is already gone: the record is there, and
  // answering the request as done would tell the client otherwise.
  const { root, sweep } = place();
  const store = createFileStore({ root });
  await store.sessions.create({ sessionId: 'busy', agentId: 'a', workspace: sweep });
  await store.runs.create({
    runId: 'run-1',
    sessionId: 'busy',
    agentId: 'a',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    usage: { inputTokens: 0, outputTokens: 0 },
    steps: 0,
    denials: [],
  });
  expect(await store.sessions.claimWriter({ sessionId: 'busy', runId: 'run-1' })).toBe(true);

  const agent = backend(root, createFakeModel({ script: [], stream: true }));

  await expect(agent.delete?.('busy', sweep)).rejects.toThrow();
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['busy']);

  // Once the run is done the claim stops blocking, and the delete goes through.
  await store.runs.update({ sessionId: 'busy', runId: 'run-1', status: 'completed' });
  await expect(agent.delete?.('busy', sweep)).resolves.toBeUndefined();
  expect(await agent.list?.()).toEqual([]);
});