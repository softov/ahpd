import { expect, it } from 'vitest';
import type { ModelAdapter } from '@facio/agents';
import { facioSession } from '../packages/agent-facio/src/index.js';
import type { Start } from '../packages/sdk/src/types/agent.js';

/*
 * A cut this backend cannot make, refused.
 *
 * A fork that silently continued would append to the conversation it was meant
 * to preserve, and a rewind that did nothing would keep the turns it was asked
 * to drop. Both are refused by name until facio can cut a history; the cases
 * that assert a real fork and rewind arrive with task 02 of plan 04, once the
 * proposed decision about the cut is settled.
 */

const stub = { id: 'stub', modelId: 'stub', features: {} } as unknown as ModelAdapter;

const start = (cut: { forkAt?: string; rewindAt?: string }): Start => ({
  uri: 'ahp-session:/cut',
  chatUri: 'ahp-chat:/cut',
  cwd: '/tmp',
  settings: {},
  emit: () => {},
  ...cut,
}) as unknown as Start;

it('refuses a fork rather than continuing the original', () => {
  expect(() => facioSession({ adapter: stub, memory: true }, start({ forkAt: 'm1' })))
    .toThrow(/cannot cut a conversation/);
});

it('refuses a rewind rather than keeping the turns it was asked to drop', () => {
  expect(() => facioSession({ adapter: stub, memory: true }, start({ rewindAt: 'm2' })))
    .toThrow(/cannot cut a conversation/);
});

it('still opens a session when neither was asked', () => {
  const session = facioSession({ adapter: stub, memory: true }, start({}));
  expect(session.uri).toBe('ahp-session:/cut');
});
