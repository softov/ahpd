import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A session opened again on the model it was left on.
 *
 * The stored setting is read before the CLI has said anything, and the query is
 * the only thing the CLI takes a model from at startup - so a restored session
 * that reported its model but started its first query without it would show a
 * picker saying one thing and run on another.
 *
 * Whether it is taken at all is the host's question, answered by what the
 * variant offers: a stored id another variant's endpoint does not serve must
 * not reach a CLI that would refuse it.
 */

const sdk = vi.hoisted(() => ({
  /** Every model each query was built with, in the order the queries started. */
  built: [] as (string | undefined)[],
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { options: { model?: string } }) => {
    sdk.built.push(given.options.model);
    return {
      async *[Symbol.asyncIterator]() { /* a CLI that stays up and says nothing */ await new Promise(() => {}); },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {},
    };
  },
}));

const { createSession } = await import('../src/session.js');

const OFFERED = [{ id: 'opus', name: 'Opus' }, { id: 'sonnet', name: 'Sonnet' }];

/** A session opened with what a restored one is handed, and what it says. */
async function opened(settings: Record<string, unknown>, seedModels: { id: string; name: string }[] | 'none' = OFFERED) {
  sdk.built = [];
  const session = createSession({
    uri: 'ahp-session:/model',
    chatUri: 'ahp-chat:/model',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-restored-')),
    settings,
    ...(seedModels === 'none' ? {} : { seedModels }),
    emit: () => {},
  });
  await new Promise((done) => { setTimeout(done, 20); });
  const state = session.sessionState();
  const config = state.config as Bag | undefined;
  return { session, model: (state._meta as Bag | undefined)?.model, values: config?.values as Bag };
}

it('reopens on the model it was stored on, and says so before anybody has asked', async () => {
  const { model, values } = await opened({ model: 'opus' });
  expect(model).toBe('opus');
  expect(values.model).toBe('opus');
  // And the CLI was given it at startup, which is the half a client cannot see.
  expect(sdk.built).toEqual(['opus']);
});

it('leaves the model empty for a session stored on one the variant does not offer', async () => {
  const { model, values } = await opened({ model: 'fable-9' });
  expect(model).toBeUndefined();
  // The stored value is still the config key in force, which is what it was
  // stored as. What is empty is the model the session runs, and that is what
  // a picker draws.
  expect(values.model).toBe('fable-9');
  // Not even asked of the CLI: an id this variant cannot serve is not one to hand over.
  expect(sdk.built).toEqual([undefined]);
});

it('leaves the model empty for `default`, which names no model at all', async () => {
  const { model } = await opened({ model: 'default' });
  expect(model).toBeUndefined();
  expect(sdk.built).toEqual([undefined]);
});

it('leaves the model empty when nothing was stored, and when nothing was offered', async () => {
  expect((await opened({})).model).toBeUndefined();
  // A host that seeds no models cannot vouch for a stored one, and a session
  // with a seed and no list is a host that never asked.
  expect((await opened({ model: 'opus' }, [])).model).toBeUndefined();
  expect((await opened({ model: 'opus' }, 'none')).model).toBeUndefined();
});

it('leaves the model empty when what was stored is not a name', async () => {
  const { model } = await opened({ model: { id: 'opus' } });
  expect(model).toBeUndefined();
  expect(sdk.built).toEqual([undefined]);
});

it('lets a message name another model, as it did before', async () => {
  const { session } = await opened({ model: 'opus' });
  session.begin('t1', 'first', { id: 'sonnet' });
  await new Promise((done) => { setTimeout(done, 20); });
  expect((session.sessionState()._meta as Bag | undefined)?.model).toBe('sonnet');
});
