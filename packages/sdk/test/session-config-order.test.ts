import { beforeEach, expect, it, vi } from 'vitest';
import type { HostOptions } from '../src/types/host.js';
import type { Worktrees } from '../src/types/worktrees.js';
import { hello, peer, resetSdk, serving } from './support/host.js';
import { join } from 'node:path';
import { WORK, WORK_URI } from './support/work.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * The order a session's settings come in.
 *
 * A client draws the form in the order the properties arrive, so the order is
 * the form. The reference host composes it as isolation, then the agent's own
 * settings, then the branch and the worktree keys; the computer a session runs
 * on leads with isolation. The same order is reported on a running session,
 * whose schema comes from the other fold and is drawn as the chips above the
 * box.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11018-L11034
 */

/** This host's keys after the agent's, in the order the reference host adds them. */
const TAIL = [
  'branch', 'worktreeBranchPrefix', 'worktreeIncludeFiles', 'worktreeSymlinkFolders',
  'worktreeCreateNewBranch', 'worktreeBranchTrack',
];

/** A repository the form can read, without git: nothing here makes a tree. */
const repository = (): Worktrees => ({
  repository: async () => join(WORK, 'project'),
  branches: async () => ['main', 'release'],
  create: async () => {},
  dirty: async () => false,
  remove: async () => {},
});

/** What the computer plugin registers: the machine a session runs in. */
const COMPUTER = { computer: { type: 'string', title: 'Computer', sessionMutable: false } };

/** The keys a new session form offers, in the order it draws them. */
const form = async (over: Partial<HostOptions> = {}): Promise<string[]> => {
  const client = serving(WORK, [], over).accept(peer());
  await client.handle(hello(['0.9.0']));
  const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
    schema: { properties: Record<string, unknown> };
  };
  return Object.keys(cfg.schema.properties);
};

it('composes the new session form as the reference host does: the computer and isolation, the agent\'s settings, then the branch and worktree keys', async () => {
  const keys = await form({ worktrees: repository(), sessionConfig: COMPUTER });
  expect(keys.slice(0, 2)).toEqual(['computer', 'isolation']);
  expect(keys.slice(-TAIL.length)).toEqual(TAIL);
  // The agent's own settings sit between, in the order it declared them.
  expect(keys.slice(2, -TAIL.length)).toContain('permissionMode');
});

it('starts with isolation on a host that serves no computer plugin', async () => {
  const keys = await form({ worktrees: repository() });
  expect(keys[0]).toBe('isolation');
  expect(keys.slice(-TAIL.length)).toEqual(TAIL);
});

it('reports a running session in the same order', async () => {
  const client = serving(WORK, [], { worktrees: repository(), sessionConfig: COMPUTER }).accept(peer());
  await client.handle(hello(['0.9.0']));
  // A folder given, because isolation is what a session in a repository is
  // offered: a session with none has no isolation to show.
  const uri = 'ahp-session:/ordered';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'claude', workingDirectories: [`${WORK_URI}/project`] },
  });
  const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, unknown> } } } };
  }).snapshot.state;
  const keys = Object.keys(state.config.schema.properties);
  expect(keys.slice(0, 2)).toEqual(['computer', 'isolation']);
  expect(keys.slice(-TAIL.length)).toEqual(TAIL);
  expect(keys.slice(2, -TAIL.length)).toContain('permissionMode');
});
