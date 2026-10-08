import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { claude } from '../src/claude.js';

afterEach(() => { vi.unstubAllEnvs(); });

it('reads only the signed-in email from the daemon user Claude CLI', async () => {
  const home = await mkdtemp(join(tmpdir(), 'ahpd-claude-account-'));
  const bin = join(home, '.local', 'bin');
  await mkdir(bin, { recursive: true });
  const executable = join(bin, 'claude');
  await writeFile(executable, '#!/bin/sh\nprintf \'%s\\n\' \'{"loggedIn":true,"email":"claude@example.com","token":"private"}\'\n');
  await chmod(executable, 0o700);
  vi.stubEnv('HOME', home);
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', '');
  vi.stubEnv('CLAUDE_CODE_USE_BEDROCK', '');
  vi.stubEnv('CLAUDE_CODE_USE_VERTEX', '');
  vi.stubEnv('CLAUDE_CODE_USE_FOUNDRY', '');
  const agent = claude({ paths: [home] });
  expect(await agent.accountIdentity?.()).toEqual({ status: 'verified', name: 'claude@example.com' });
  vi.stubEnv('ANTHROPIC_API_KEY', 'private-key');
  expect(await agent.accountIdentity?.()).toEqual({ status: 'unavailable' });
  vi.stubEnv('ANTHROPIC_API_KEY', '');
  vi.stubEnv('ANTHROPIC_BASE_URL', 'https://gateway.example');
  expect(await agent.accountIdentity?.()).toEqual({ status: 'unavailable' });
  vi.stubEnv('ANTHROPIC_BASE_URL', '');
  for (const mode of ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY']) {
    vi.stubEnv(mode, '1');
    expect(await agent.accountIdentity?.()).toEqual({ status: 'unavailable' });
    vi.stubEnv(mode, '');
  }
  expect(await claude({ paths: [home], preset: { env: { ANTHROPIC_API_KEY: 'private' } } }).accountIdentity?.()).toEqual({ status: 'unavailable' });
});
