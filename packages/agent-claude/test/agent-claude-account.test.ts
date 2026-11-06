import { expect, it, vi } from 'vitest';

/*
 * The account the Claude probe reports.
 *
 * `initializationResult()` answers an `account` on every CLI, whether or not
 * one is signed in, so the probe is asked with each shape that answer takes -
 * a subscription, an API key, a provider the CLI does not sign in to, and no
 * answer at all - and what it offers is read back.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  query: () => ({
    initializationResult: async () => sdk.init,
    mcpServerStatus: async () => [],
    reloadSkills: async () => ({ skills: [] }),
    reloadPlugins: async () => ({ plugins: [] }),
    close: () => {},
  }),
}));

const sdk = vi.hoisted(() => ({ init: {} as Record<string, unknown> }));

const { probe } = await import('../src/probe.js');

/** What the probe offers when the CLI answers the given account, if any. */
const offeredWith = async (account: unknown) => {
  sdk.init = account === undefined ? {} : { account };
  return probe('/tmp/ahpd-account');
};

it('reports the email and the plan of a signed-in subscription', async () => {
  const before = Date.now();
  const account = (await offeredWith({
    email: 'softov@brbyte.com',
    organization: 'brbyte',
    subscriptionType: 'max',
    apiKeySource: 'none',
    apiProvider: 'firstParty',
  })).account;
  expect(account).toEqual({
    status: 'signedIn',
    email: 'softov@brbyte.com',
    planType: 'max',
    observedAt: expect.any(Number),
  });
  // The time is the probe's own, so a client can tell how old the answer is.
  expect(account?.observedAt).toBeGreaterThanOrEqual(before);
});

it('says unavailable for an API key, and names no email', async () => {
  // A key is not an account, so the state says so and the fields stay out of
  // it: an email answered beside the key is not published as one.
  const account = (await offeredWith({ email: 'softov@brbyte.com', apiKeySource: 'ANTHROPIC_API_KEY' })).account;
  expect(account).toEqual({ status: 'unavailable', observedAt: expect.any(Number) });
});

it('says unavailable for a provider the CLI does not sign in to', async () => {
  // A preset pointed at Bedrock or a gateway authenticates elsewhere, so the
  // CLI has no account of its own to report, signed in or not.
  expect((await offeredWith({ apiProvider: 'bedrock', apiKeySource: 'none' })).account?.status).toBe('unavailable');
  expect((await offeredWith({ apiProvider: 'gateway', apiKeySource: 'none' })).account?.status).toBe('unavailable');
});

it('says signed out for a CLI that holds no sign-in', async () => {
  expect((await offeredWith({ apiKeySource: 'none', tokenSource: 'none' })).account).toEqual({
    status: 'signedOut',
    observedAt: expect.any(Number),
  });
});

it('offers no account at all when the CLI answered none', async () => {
  // Nothing read is not the same as a CLI reporting that it has no sign-in,
  // and the value is left out rather than guessed at.
  expect(await offeredWith(undefined)).not.toHaveProperty('account');
});
