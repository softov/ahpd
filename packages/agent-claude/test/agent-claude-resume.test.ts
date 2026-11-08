import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';

/*
 * Which conversation a session picks up, by what the SDK holds.
 *
 * The host resumes every chat it recorded by the id its conversation is under,
 * and the CLI writes a conversation only when its first message reaches it. A
 * chat nobody spoke to, or one whose CLI could not sign in, has an id with
 * nothing behind it, and the CLI ends at startup rather than resume it, and
 * refuses a new conversation under an id it holds a transcript for. So a
 * session asks the SDK's `getSessionInfo` as its first CLI starts, as VS Code's
 * Claude asks as it materializes a session: it resumes what the SDK holds,
 * wherever it was written, and starts any other under the id it was asked to
 * resume, on a clean transcript.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1720-L1736
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  // The SDK's read of one session, which answers the ids a case says it holds.
  getSessionInfo: async (id: string) => {
    sdk.asked.push(id);
    return sdk.held.includes(id) ? { sessionId: id } : undefined;
  },
  // The SDK's delete, as it deletes: the transcript of the id, which this
  // case's every project holds at most one of.
  deleteSession: async (id: string, options?: { dir?: string }) => {
    sdk.deleted.push([id, options?.dir]);
    const projects = join(home, 'config', 'projects');
    for (const project of readdirSync(projects)) rmSync(join(projects, project, `${id}.jsonl`), { force: true });
  },
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options.push(options);
    return {
      // A CLI that exits once the case lets it, which is when its cleanup settles.
      [Symbol.asyncDispose]: async () => { await sdk.exiting; },
      async *[Symbol.asyncIterator]() { /* nothing streamed */ },
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

const sdk = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  /** What the SDK was asked to delete, with the folder it was told. */
  deleted: [] as [string, string | undefined][],
  /** When a closed CLI has exited. */
  exiting: Promise.resolve() as Promise<void>,
  /** The ids `getSessionInfo` was asked about, and those it says it holds. */
  asked: [] as string[],
  held: [] as string[],
}));

const { claude } = await import('../src/claude.js');

const home = realpathSync(mkdtempSync(join(tmpdir(), 'ahpd-claude-resume-')));
const FOLDER = join(home, 'work');
const OTHER = join(home, 'elsewhere');
mkdirSync(FOLDER, { recursive: true });
mkdirSync(OTHER, { recursive: true });
const before = process.env.CLAUDE_CONFIG_DIR;
process.env.CLAUDE_CONFIG_DIR = join(home, 'config');
afterAll(() => {
  if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = before;
  rmSync(home, { recursive: true, force: true });
});

/** Where the CLI writes the transcript of `id` for a conversation of `folder`. */
const transcript = (id: string, folder: string): string => {
  const project = join(home, 'config', 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  return join(project, `${id}.jsonl`);
};

/** The transcript the CLI writes for a conversation of `folder`: its first entry, the prompt, as CLI 2.1.301 wrote it. */
const written = (id: string, folder: string): string => {
  const file = transcript(id, folder);
  writeFileSync(file, `${JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'f0829d44-61b9-476c-abb6-cb4427e28cb3', type: 'user',
    message: { role: 'user', content: 'hi' }, uuid: '6f79faf7-646d-4773-b101-06232d161be1',
    timestamp: '2026-10-29T22:14:15.249Z', permissionMode: 'auto', promptSource: 'sdk', turnOrigin: 'sdk',
    turnPosition: { promptIndex: 0, turnIndex: 1 }, userType: 'external', entrypoint: 'sdk-cli',
    cwd: folder, sessionId: id, version: '2.1.301', gitBranch: 'master',
  })}\n`);
  return file;
};

/**
 * A transcript the SDK's `getSessionInfo` finds no session in: lines CLI
 * 2.1.301 writes beside a conversation, the latch and the cost, none of them a
 * title, a prompt or a summary, which are what the SDK makes a session's row
 * from.
 * npm://@anthropic-ai/claude-agent-sdk@0.3.301 (sdk.mjs, the row `getSessionInfo` reads from a transcript's head and tail)
 */
const unheld = (id: string, folder: string): string => {
  const file = transcript(id, folder);
  writeFileSync(file, [
    { type: 'atis-latch', atis: '', sessionId: id },
    {
      type: 'cost-state', sessionId: id, totalCostUSD: 0, totalAPIDuration: 0, totalAPIDurationWithoutRetries: 0,
      totalToolDuration: 0, totalLinesAdded: 0, totalLinesRemoved: 0, totalDuration: 270, startTime: 1793243412780,
      modelUsage: {}, hasUnknownModelCost: false,
    },
  ].map((line) => `${JSON.stringify(line)}\n`).join(''));
  return file;
};

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((done) => { setImmediate(done); });
};

/** The `query()` options the first send of a session in `FOLDER` that `create` built from these start fields started its CLI with. */
const started = async (start: Record<string, unknown>): Promise<Record<string, unknown>> => {
  sdk.options = [];
  claude({ paths: [FOLDER] }).create({
    uri: 'ahp-session:/resume',
    chatUri: 'ahp-chat:/resume',
    workingDirectory: FOLDER,
    settings: {},
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
    ...start,
  }).sendMessage('t1', 'hello');
  await settle();
  const one = sdk.options.at(0);
  if (one === undefined) throw new Error('no query was built');
  return one;
};

const NEVER = '0a0a0a0a-1111-4111-8111-000000000001';
const HERE = '0a0a0a0a-1111-4111-8111-000000000002';
const THERE = '0a0a0a0a-1111-4111-8111-000000000003';
const PEER = '0a0a0a0a-1111-4111-8111-000000000004';
const FORKED = '0a0a0a0a-1111-4111-8111-000000000005';
const LEFT = '5433a783-2e55-4412-9afc-6b77ac92ac7b';
const OWN = '0a0a0a0a-1111-4111-8111-000000000006';
const KEPT = '0a0a0a0a-1111-4111-8111-000000000007';
const LONG = '0a0a0a0a-1111-4111-8111-000000000008';
const EXITING = '0a0a0a0a-1111-4111-8111-000000000009';
const VIA_SDK = '0a0a0a0a-1111-4111-8111-00000000000a';
const HELD = '0a0a0a0a-1111-4111-8111-00000000000b';
const OVERTAKEN = '0a0a0a0a-1111-4111-8111-00000000000c';

it('starts a conversation the SDK does not hold under the id it was asked to resume', async () => {
  sdk.held = [];
  const options = await started({ resume: NEVER });
  expect(options).not.toHaveProperty('resume');
  expect(options).toMatchObject({ sessionId: NEVER });
});

it('keeps a chat\'s own id for a conversation the SDK does not hold', async () => {
  sdk.held = [];
  const options = await started({ chatId: PEER, resume: PEER });
  expect(options).not.toHaveProperty('resume');
  expect(options).toMatchObject({ sessionId: PEER });
});

it('carries no fork point beside a conversation it starts, and starts it under the chat\'s own id', async () => {
  sdk.held = [];
  const options = await started({ chatId: FORKED, resume: NEVER, forkAt: 'entry', rewindAt: 'entry' });
  expect(options).not.toHaveProperty('resume');
  expect(options).not.toHaveProperty('forkSession');
  expect(options).not.toHaveProperty('resumeSessionAt');
  expect(options).toMatchObject({ sessionId: FORKED });
});

it('resumes a conversation the SDK holds, written under the folder\'s own project', async () => {
  written(HERE, FOLDER);
  sdk.held = [HERE];
  const options = await started({ resume: HERE });
  expect(options).toMatchObject({ resume: HERE });
  expect(options).not.toHaveProperty('sessionId');
});

it('resumes a conversation the SDK holds, written under another folder\'s project, which its resume finds', async () => {
  written(THERE, OTHER);
  sdk.held = [THERE];
  const options = await started({ resume: THERE, forkAt: 'entry' });
  expect(options).toMatchObject({ resume: THERE, forkSession: true, resumeSessionAt: 'entry' });
});

/*
 * A transcript the SDK holds no session in goes through the SDK's own delete,
 * as VS Code's Claude deletes one before it starts a conversation over.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1148-L1160
 */
it('starts a conversation whose transcript the SDK holds no session in under its id, on a transcript the SDK cleared', async () => {
  const file = unheld(LEFT, FOLDER);
  sdk.deleted = [];
  sdk.held = [];
  const options = await started({ resume: LEFT });
  expect(options).not.toHaveProperty('resume');
  expect(options).toMatchObject({ sessionId: LEFT });
  expect(sdk.deleted).toEqual([[LEFT, FOLDER]]);
  expect(existsSync(file)).toBe(false);
});

it('has the SDK clear a transcript it holds no session in under the id a session starts its own under', async () => {
  const file = unheld(OWN, FOLDER);
  sdk.deleted = [];
  sdk.held = [];
  const options = await started({ uri: `ahp-session:/${OWN}` });
  expect(options).toMatchObject({ sessionId: OWN });
  expect(sdk.deleted).toEqual([[OWN, FOLDER]]);
  expect(existsSync(file)).toBe(false);
});

/*
 * The SDK is asked whether the conversation is written as the first CLI
 * starts, as VS Code's Claude asks before it materializes one: what the SDK
 * holds is resumed, and the rest start under their own ids.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L1720-L1736
 */
it('asks the SDK whether a conversation is written as its first CLI starts', async () => {
  sdk.asked = [];
  sdk.held = [];
  const fresh = await started({ resume: VIA_SDK });
  expect(sdk.asked).toEqual([VIA_SDK]);
  expect(fresh).not.toHaveProperty('resume');
  expect(fresh).toMatchObject({ sessionId: VIA_SDK });

  written(HELD, FOLDER);
  sdk.held = [HELD];
  const resumed = await started({ resume: HELD });
  expect(resumed).toMatchObject({ resume: HELD });
  expect(resumed).not.toHaveProperty('sessionId');
});

/*
 * The CLI that could write the transcript has exited before it is cleared, as
 * VS Code's Claude shuts the live query down before it deletes, so nothing
 * writes it back under the new conversation.
 */
it('clears a transcript only once the CLI of a closed session of the same conversation has exited', async () => {
  const agent = claude({ paths: [FOLDER] });
  const start = {
    uri: `ahp-session:/${EXITING}`,
    chatUri: `ahp-chat:/${EXITING}`,
    workingDirectory: FOLDER,
    settings: {},
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
  };
  let exit: () => void = () => {};
  sdk.exiting = new Promise<void>((done) => { exit = done; });
  sdk.held = [];
  const first = agent.create(start);
  first.sendMessage('t1', 'hello');
  await settle();
  const closed = first.close();
  const file = unheld(EXITING, FOLDER);
  sdk.deleted = [];
  agent.create(start).sendMessage('t1', 'again');
  await settle();
  expect(sdk.deleted).toEqual([]);
  exit();
  await closed;
  await settle();
  expect(sdk.deleted).toEqual([[EXITING, FOLDER]]);
  expect(existsSync(file)).toBe(false);
  sdk.exiting = Promise.resolve();
});

/*
 * A start the session's close overtook while it waited for the CLI before it
 * to exit clears nothing: the start that runs the conversation clears it.
 */
it('clears nothing for a start its session\'s close overtook', async () => {
  let exit: () => void = () => {};
  sdk.exiting = new Promise<void>((done) => { exit = done; });
  sdk.held = [];
  const session = claude({ paths: [FOLDER] }).create({
    uri: `ahp-session:/${OVERTAKEN}`,
    chatUri: `ahp-chat:/${OVERTAKEN}`,
    workingDirectory: FOLDER,
    settings: {},
    clientToolTimeoutMs: 0,
    schema: () => ({ type: 'object', properties: {} }),
    emit: () => {},
  });
  // The CLI the first send starts ends at once, and the one started after it
  // waits for it to exit.
  session.sendMessage('t1', 'hello');
  await settle();
  const closed = session.close();
  const file = unheld(OVERTAKEN, FOLDER);
  sdk.deleted = [];
  exit();
  await closed;
  await settle();
  expect(sdk.deleted).toEqual([]);
  expect(existsSync(file)).toBe(true);
  sdk.exiting = Promise.resolve();
});

/*
 * A path whose project name is longer than 200 characters: the CLI cuts the
 * name there and adds the whole path's hash, and that folder is the one cleared.
 * https://code.claude.com/docs/en/sessions#where-transcripts-are-stored
 */
it('clears a transcript the SDK holds no session in, in the folder the CLI names for a long path', async () => {
  const top = '/tmp/ahpd-claude-long-name';
  const long = join(top, 'a'.repeat(120), 'b'.repeat(120));
  mkdirSync(long, { recursive: true });
  sdk.held = [];
  try {
    // The CLI's name for that path, its hash as CLI 2.1.301 computes it, of the
    // real path, which on Windows starts with a drive.
    const real = realpathSync(long);
    let hash = 0;
    for (let at = 0; at < real.length; at++) hash = ((hash << 5) - hash + real.charCodeAt(at)) | 0;
    if (real === long) expect(Math.abs(hash).toString(36)).toBe('nkqd48');
    const project = join(home, 'config', 'projects', `${real.replace(/[^A-Za-z0-9]/g, '-').slice(0, 200)}-${Math.abs(hash).toString(36)}`);
    mkdirSync(project, { recursive: true });
    const file = join(project, `${LONG}.jsonl`);
    writeFileSync(file, `${JSON.stringify({ type: 'atis-latch', atis: '', sessionId: LONG })}\n`);
    const options = await started({ uri: `ahp-session:/${LONG}`, workingDirectory: long });
    expect(options).toMatchObject({ sessionId: LONG });
    expect(existsSync(file)).toBe(false);
  }
  finally { rmSync(top, { recursive: true, force: true }); }
});

it('keeps a conversation the SDK holds, asked of it, under the id a session starts a new one under', async () => {
  const file = written(KEPT, FOLDER);
  sdk.asked = [];
  sdk.held = [KEPT];
  const options = await started({ chatId: KEPT });
  expect(options).toMatchObject({ sessionId: KEPT });
  expect(sdk.asked).toContain(KEPT);
  expect(existsSync(file)).toBe(true);
});
