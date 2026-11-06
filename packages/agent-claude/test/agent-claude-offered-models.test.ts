import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * The models a Claude agent offers, only where a credential is set up.
 *
 * VS Code's Claude agent publishes no models where the account the SDK
 * reports is set up for nothing: the CLI lists the models it knows whatever
 * signs it in. A session here signs in with a login the record names, a key
 * of the variant's own, or the CLI's own account, so the models are offered
 * where any of them is set up, and none where none is.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1002-L1021
 */

const sdk = vi.hoisted(() => ({ account: {} as Record<string, unknown> }));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  query: () => ({
    initializationResult: async () => ({ account: sdk.account, models: [{ value: 'sonnet', displayName: 'Sonnet' }] }),
    mcpServerStatus: async () => [],
    reloadSkills: async () => ({ skills: [] }),
    reloadPlugins: async () => ({ plugins: [] }),
    close: () => {},
  }),
}));

// The personal folder a probe reads and its watch watches, one of the case's own.
const home = mkdtempSync(join(tmpdir(), 'ahpd-offered-'));
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = join(home, 'config');
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

const { claude } = await import('../src/claude.js');
const { OpenLogins } = await import('../src/logins.js');
type Logins = InstanceType<typeof OpenLogins>;

/** No sign-in at all, as the CLI reports one: no token, no key, Anthropic's own API. */
const NOBODY = { tokenSource: 'none', apiProvider: 'firstParty' };

/** The agent of a record with these values, over these open logins. */
const agentOf = (values: Bag, logins?: Logins) => claude({
  paths: [home],
  presetOf: () => values,
  ...(logins === undefined ? {} : { logins: { open: logins, owner: () => 'host' as const } }),
});

/** The model ids a record with these values offers, the CLI reporting `account`. */
const offered = async (account: Record<string, unknown>, values: Bag = {}, logins?: Logins): Promise<string[]> => {
  sdk.account = account;
  return ((await agentOf(values, logins).probe?.())?.models ?? []).map((one) => one.id);
};

it('offers the CLI\'s models where its own account is set up, and none where it is not', async () => {
  // A claude.ai sign-in, a token, a key and a provider of its own.
  expect(await offered({ email: 'softov@brbyte.com', subscriptionType: 'Claude Max', apiProvider: 'firstParty' })).toEqual(['sonnet']);
  expect(await offered({ tokenSource: 'CLAUDE_CODE_OAUTH_TOKEN', apiProvider: 'firstParty' })).toEqual(['sonnet']);
  expect(await offered({ apiKeySource: 'ANTHROPIC_API_KEY', apiProvider: 'firstParty' })).toEqual(['sonnet']);
  expect(await offered({ apiProvider: 'bedrock' })).toEqual(['sonnet']);
  expect(await offered(NOBODY)).toEqual([]);
});

it('offers a record\'s models where its own environment holds a key, the CLI holding no account', async () => {
  expect(await offered(NOBODY, { env: { ANTHROPIC_AUTH_TOKEN: 'sk-router' } })).toEqual(['sonnet']);
  expect(await offered(NOBODY, { env: { CLAUDE_CODE_USE_BEDROCK: '1' } })).toEqual(['sonnet']);
  // Its own model list, with nothing to sign in with, is offered no more than the CLI's.
  expect(await offered(NOBODY, { models: [{ id: 'claude-sonnet-5' }] })).toEqual([]);
});

it('offers a record\'s models while a login it names is open, and asks for a probe as one opens and stops', async () => {
  const logins = new OpenLogins();
  const values = { logins: ['work'] };
  expect(await offered(NOBODY, values, logins)).toEqual([]);
  let asked = 0;
  const stop = agentOf(values, logins).probeChanged?.(() => { asked += 1; });
  try {
    const close = logins.opened({ id: 'work', adapter: 'claude-login', owner: 'host', config: { token: 'token-work' } });
    expect(asked).toBe(1);
    expect(await offered(NOBODY, values, logins)).toEqual(['sonnet']);
    // A login the record does not name moves nothing.
    logins.opened({ id: 'personal', adapter: 'claude-login', owner: 'host', config: { token: 'token-personal' } });
    expect(asked).toBe(1);
    close();
    expect(asked).toBe(2);
    expect(await offered(NOBODY, values, logins)).toEqual([]);
  }
  finally { stop?.(); }
});
