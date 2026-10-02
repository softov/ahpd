import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Bag, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../src/index.js';
import type { AcpOptions } from '../src/types.js';

/*
 * A server that has to be signed in first.
 *
 * ACP servers such as Codex with only a key and Cursor refuse `session/new`
 * until `authenticate` has named one of the methods their handshake listed.
 * The bridge never picks that method itself - a wrong guess signs a person in
 * as whoever the guess was - so the spec names it and the bridge either sends
 * it, or fails the turn with the refusal it was given.
 *
 * The server is the real subprocess (`test/fixtures/acp-server.mjs`): a
 * `--signin` one offers `api-key` and answers `auth_required` to every session
 * until it is sent, and a `--signin-fails` one offers the same method and
 * refuses the sign-in itself.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** The subprocess's work finishing, up to a point. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

const started: Session[] = [];

afterEach(async () => {
  for (const session of started.splice(0)) await session.close();
});

/** A session of the fixture, with every action it emits kept. */
function talking(flags: string[], options: Partial<AcpOptions> = {}): { session: Session; actions: Bag[] } {
  const actions: Bag[] = [];
  const agent = acpAgent({ command: process.execPath, args: [FIXTURE, ...flags], provider: 'acp-signin', ...options });
  const opening: Start = {
    uri: 'ahp-session:/signin',
    chatUri: 'ahp-chat:/signin',
    settings: {},
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action); },
  };
  const session = agent.create(opening);
  started.push(session);
  return { session, actions };
}

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});

/** The error on the `chat/error` that ended a turn, once one has. */
const errored = (actions: Bag[]): Bag | undefined => {
  const part = actions.find((action) => action.type === 'chat/error')?.part;
  return bag(part).error as Bag | undefined;
};

/** One turn, run to its end. */
async function turn(session: Session, actions: Bag[], turnId: string, text: string): Promise<void> {
  session.begin(turnId, text);
  await until(() => actions.some((action) => action.type === 'chat/turnComplete'
    || action.type === 'chat/turnCancelled'
    || action.type === 'chat/error'));
}

it('signs in with the method the spec named, and the session runs', async () => {
  const { session, actions } = talking(['--signin'], { authenticate: { methodId: 'api-key' } });
  await turn(session, actions, 't1', 'hi');

  expect(actions.map((action) => action.type)).toContain('chat/turnComplete');
  expect(actions.some((action) => action.type === 'chat/error')).toBe(false);
});

it('refuses a session from a server nobody signed in, naming the methods it offers', async () => {
  const { session, actions } = talking(['--signin']);
  await turn(session, actions, 't1', 'hi');

  // The refusal is the protocol's own rather than a generic failure, and it
  // carries the handshake's methods: the spec is what names one, and this is
  // the sentence that says which.
  expect(errored(actions)?.errorType).toBe('authRequired');
  expect(String(errored(actions)?.message)).toContain('api-key');
  expect(actions.some((action) => action.type === 'chat/turnComplete')).toBe(false);
});

it('refuses a method the server did not offer, and says which it did', async () => {
  const { session, actions } = talking(['--signin'], { authenticate: { methodId: 'oauth' } });
  await turn(session, actions, 't1', 'hi');

  // The bridge does not send a guess, and it does not open a session on a
  // server that refused one: the sentence is what a person corrects the
  // configuration with.
  expect(String(errored(actions)?.message)).toMatch(/^acp-signin offers api-key, not oauth/);
});

it('fails the turn with what the server said when it refuses the sign-in', async () => {
  const { session, actions } = talking(['--signin-fails'], { authenticate: { methodId: 'api-key' } });
  await turn(session, actions, 't1', 'hi');

  // The refusal came from `authenticate` and carries the same code the
  // protocol's `auth_required` does, so a code alone cannot tell the two
  // apart. It is not a request for a sign-in: nobody is being asked to set an
  // option they have already set.
  expect(errored(actions)?.errorType).toBe('turnFailed');
  expect(String(errored(actions)?.message)).toMatch(/^acp-signin: sign-in with api-key failed: That API key was rejected/);
  expect(actions.some((action) => action.type === 'chat/turnComplete')).toBe(false);
});

it('names the sign-in a turn refused as authRequired, with the methods to use', async () => {
  const { session, actions } = talking(['--signin'], { authenticate: { methodId: 'api-key' } });
  await turn(session, actions, 't1', 'reauth now');

  // A prompt refused on open grounds ends as the protocol's own error rather
  // than a generic failure, and the sentence carries the handshake's methods
  // because a client is not sent back to the server for them.
  expect(errored(actions)?.errorType).toBe('authRequired');
  expect(String(errored(actions)?.message)).toContain('api-key');
  expect(String(errored(actions)?.message)).toContain('authenticate');
});
