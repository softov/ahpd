import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { connectAcp } from '../src/connection.js';
import { acpAgent } from '../src/agent.js';

const fixture = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

it.each([
  ['--auth-account', { kind: 'account', account: { email: 'codex@example.com' }, label: 'ChatGPT' }],
  ['--auth-key', { kind: 'api_key', label: 'API key' }],
])('receives agent-owned %s status from the configured ACP process', async (flag, expected) => {
  let heard: (value: unknown) => void = () => {};
  const status = new Promise<unknown>((resolve) => { heard = resolve; });
  const connection = connectAcp({
    command: process.execPath,
    args: [fixture, flag],
    handlers: { update: () => {} },
    authStatus: heard,
  });
  try {
    await connection.initialize();
    expect(await status).toEqual(expected);
  } finally {
    await connection.close();
  }
});

it('uses the selected directory and declines missing or overridden credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ahpd-codex-account-'));
  const command = join(root, 'codex-acp');
  await symlink(process.execPath, command);
  const one = join(root, 'one');
  const two = join(root, 'two');
  await mkdir(one);
  await mkdir(two);
  const agent = acpAgent({ command, args: [fixture, '--auth-project'], provider: 'codex' });
  expect(await agent.accountIdentity?.()).toEqual({ status: 'unavailable' });
  expect(await agent.accountIdentity?.(one)).toEqual({ status: 'verified', name: 'one@example.com' });
  expect(await agent.accountIdentity?.(two)).toEqual({ status: 'verified', name: 'two@example.com' });
  const overridden = acpAgent({ command, args: [fixture, '--auth-project'], provider: 'codex', authenticate: { methodId: 'api-key' } });
  expect(await overridden.accountIdentity?.(one)).toEqual({ status: 'unavailable' });
  const machineOverride = acpAgent({ command, args: [fixture, '--auth-project'], provider: 'codex', authenticateInMachine: { methodId: 'api-key' } });
  expect(await machineOverride.accountIdentity?.(one)).toEqual({ status: 'unavailable' });
  const key = acpAgent({ command, args: [fixture, '--auth-key'], provider: 'codex' });
  expect(await key.accountIdentity?.(one)).toEqual({ status: 'unavailable' });
});
