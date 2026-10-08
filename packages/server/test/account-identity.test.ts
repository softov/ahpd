import { expect, it } from 'vitest';
import type { Agent } from '@ahpd/sdk';
import { accountProvider } from '../src/commands/run.js';

const agent = (provider: string, accountIdentity?: Agent['accountIdentity']): Agent =>
  ({ provider, accountIdentity }) as Agent;

it('returns only the verified account for the named daemon provider', async () => {
  const provider = accountProvider([
    agent('claude', async () => ({ status: 'verified', name: 'claude@example.com' })),
    agent('codex', async () => ({ status: 'verified', name: 'codex@example.com' })),
  ]);
  expect(JSON.parse((await provider.read('ahpd-account://claude')).data)).toEqual({ status: 'verified', name: 'claude@example.com' });
  expect(JSON.parse((await provider.read('ahpd-account://codex')).data)).toEqual({ status: 'verified', name: 'codex@example.com' });
  expect(JSON.parse((await provider.read('ahpd-account://other')).data)).toEqual({ status: 'unavailable' });
  expect(await provider.authorize?.('ahpd-account://codex', undefined)).toBe(true);
  expect(await provider.authorize?.('ahpd-account://codex/other', undefined)).toBe(false);
});

it('redacts unsupported and unsafe identity values', async () => {
  const provider = accountProvider([
    agent('missing'),
    agent('bad', async () => ({ status: 'verified', name: 'Bearer secret\n@example.com' })),
    agent('failed', async () => { throw new Error('token: private'); }),
  ]);
  for (const name of ['missing', 'bad', 'failed']) {
    const answer = (await provider.read(`ahpd-account://${name}`)).data;
    expect(answer).toBe('{"status":"unavailable"}');
    expect(answer).not.toContain('secret');
    expect(answer).not.toContain('private');
  }
});

it('passes the selected directory to the provider and rejects ambiguous URIs', async () => {
  let received: string | undefined;
  const provider = accountProvider([agent('codex', async (directory) => {
    received = directory;
    return directory === '/repo/one' ? { status: 'verified', name: 'one@example.com' } : { status: 'unavailable' };
  })]);
  expect(JSON.parse((await provider.read('ahpd-account://codex?cwd=%2Frepo%2Fone')).data)).toEqual({ status: 'verified', name: 'one@example.com' });
  expect(received).toBe('/repo/one');
  expect(JSON.parse((await provider.read('ahpd-account://codex?cwd=%2Frepo%2Ftwo')).data)).toEqual({ status: 'unavailable' });
  expect(await provider.authorize?.('ahpd-account://codex?cwd=a&cwd=b', undefined)).toBe(false);
});
