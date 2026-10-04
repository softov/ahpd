import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost, hello, machine, peer, resetSdk, settle } from './support/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Listed } from '@ahpd/sdk';

/*
 * Asking the backends at once.
 *
 * A listing read one backend after another is the sum of every backend's cost:
 * three stores that each take a second to read cost three seconds, and a host
 * with a Claude, an OpenRouter variant and a build variant of the same CLI paid
 * for the same `~/.claude/projects` three times over. `Promise.all` over the
 * agents is the whole of it, and the fold is kept in load order rather than in
 * the order the answers arrived - the order decides whose row an id is, and
 * changing it would move a conversation to another endpoint.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

const PATH = '/home/softov';

/** How many `list` calls were in flight at once, and how many there have been. */
const counting = () => ({ running: 0, highest: 0, calls: 0 });

/** One row, as a backend answers it. */
const row = (id: string, modified: number): Listed => ({
  id,
  title: `A row for ${id}`,
  createdAt: '2026-09-27T00:00:00.000Z',
  modifiedAt: new Date(modified).toISOString(),
  workingDirectories: [`file://${PATH}`],
});

/** A backend whose `list` takes `wait` milliseconds and counts its overlap. */
const slow = (provider: string, wait: number, rows: Listed[], together: ReturnType<typeof counting>): Agent => ({
  ...echo({ path: PATH }),
  provider,
  displayName: provider,
  directories: () => [PATH],
  list: async () => {
    together.calls += 1;
    together.running += 1;
    together.highest = Math.max(together.highest, together.running);
    await new Promise((done) => { setTimeout(done, wait); });
    together.running -= 1;
    return rows;
  },
});

/** Ticks until this is true, or long enough that it plainly is not. */
const until = async (wanted: () => boolean): Promise<void> => {
  for (let i = 0; i < 400 && !wanted(); i++) await settle(2);
};

/**
 * A host over these backends, with the listing `createHost` starts itself
 * already finished, so what is measured below is the client's.
 */
const started = async (agents: Agent[], together: ReturnType<typeof counting>) => {
  const host = createHost({ path: PATH, agents, ...machine() });
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0']));
  await until(() => together.running === 0 && together.calls >= agents.length);
  together.highest = 0;
  return client;
};

const listed = async (client: { handle(request: unknown): Promise<unknown> }) =>
  await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
    items: { resource: string; title: string }[];
  };

describe('the backends are asked at once', () => {
  it('runs every backend\'s list together, and waits for one pass of them', async () => {
    const together = counting();
    const client = await started(['one', 'two', 'three']
      .map((provider) => slow(provider, 60, [], together)), together);

    const at = Date.now();
    await listed(client);
    const took = Date.now() - at;

    // The point of the change, said the only way it can be said: all three at
    // the same time rather than all three in turn.
    expect(together.highest).toBe(3);
    // Read one after another this is 180 ms. Read together it is one read's
    // worth of waiting, with room for a loaded machine in the bound.
    expect(took).toBeLessThan(150);
  });

  it('folds the answers in load order, not in the order they answered', async () => {
    const together = counting();
    // The first one loaded is the slowest, so the order the answers arrive in
    // is the reverse of the order the agents were given in. Nothing is sorted
    // back into place afterwards.
    const client = await started([
      slow('first-loaded', 60, [row('shared', 1)], together),
      slow('second-loaded', 0, [row('shared', 2)], together),
    ], together);

    const answer = await listed(client);
    // One row, under the first backend's name - which is the answer a host
    // gave when it asked the backends in turn, and is what stops the same
    // sessions listing under a different provider on a machine where the
    // faster store happened to be configured second.
    expect(answer.items.map((one) => one.resource)).toEqual(['first-loaded:/shared']);
  });
});