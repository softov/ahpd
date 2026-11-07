import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { bag, str } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';

/*
 * The question the CLI raises about a call, put to the host.
 *
 * `canUseTool` is the one place this backend sits between the CLI and a
 * question, and every question it raises is the host's to decide, its chain
 * reading the owner's rules and the operator's on it, as VS Code's Claude
 * agent raises a pending confirmation for its host's chain.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L147-L180
 */

const sdk = vi.hoisted(() => ({
  frames: [] as Record<string, unknown>[],
  options: undefined as undefined | Record<string, unknown>,
  canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => sdk.frames,
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    let close = (): void => {};
    const closed = new Promise<void>((resolve) => { close = resolve; });
    return {
      async *[Symbol.asyncIterator]() {
        sdk.options = options;
        sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
        // The frames answer the turn's prompt, as a CLI's do, and the CLI stays
        // open until it is closed.
        await prompt[Symbol.asyncIterator]().next();
        for (const frame of sdk.frames) yield frame;
        await closed;
      },
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
      close,
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The frames a session reads, and how it reaches a subagent's chat. */
interface Replay {
  frames?: Record<string, unknown>[];
  subagent?: NonNullable<Parameters<typeof createSession>[0]['subagent']>;
}

/** A session in a running turn, and what it said on the wire. */
async function sessionWith(settings: Bag = {}, replay: Replay = {}): Promise<{
  session: ReturnType<typeof createSession>;
  canUseTool: NonNullable<typeof sdk.canUseTool>;
  options: Bag;
  sent: Bag[];
}> {
  sdk.frames = replay.frames ?? [];
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/questions',
    chatUri: 'ahp-chat:/questions',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-questions-')),
    emit: (_channel, action) => { sent.push(action as Bag); },
    settings,
    ...(replay.subagent === undefined ? {} : { subagent: replay.subagent }),
  });
  await settle();
  // A turn running, as the CLI asks about a call and speaks only inside one.
  session.sendMessage('t1', 'go');
  await settle();
  return { session, canUseTool: sdk.canUseTool!, options: sdk.options!, sent };
}

/** A `PreToolUse` hook, as the SDK calls it. */
type Hook = (input: Bag, toolUseID?: string, options?: { signal: AbortSignal }) => Promise<Bag>;

/** What the hooks registered for `Bash` put in place of a command, or nothing when none puts anything. */
const rewrites = async (options: Bag, command: string): Promise<unknown> => {
  const said: unknown[] = [];
  const entries = ((options.hooks as Bag).PreToolUse as Bag[] | undefined) ?? [];
  for (const entry of entries.filter((one) => one.matcher === 'Bash')) {
    for (const hook of entry.hooks as Hook[]) {
      const answer = await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_rewritten', tool_input: { command } });
      const rewritten = bag(bag(answer.hookSpecificOutput).updatedInput).command;
      if (rewritten !== undefined) said.push(rewritten);
    }
  }
  return said.at(-1);
};

/** One confirmation's ready action, as a client reads it. */
const readyOf = (sent: Bag[], id: string): Bag | undefined =>
  sent.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === id);

/** A client's shell init script in force, which the CLI runs from its session environment file. */
const SCRIPTED = { shellInitScripts: [{ shell: 'bash', script: 'export SAY=b\n' }] };

/*
 * A command is put to the host as the model wrote it, its line and its input,
 * as the reference asks about the command the model wrote, so the owner's
 * rules read that line; and an approval runs it as written.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L174
 */
it('puts a command to the host as the model wrote it, and runs it as written, with a client\'s script in force', async () => {
  const { session, canUseTool, options, sent } = await sessionWith(SCRIPTED);
  expect(await rewrites(options, 'make test')).toBeUndefined();
  const asking = canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_shown' });
  await settle();
  const ready = readyOf(sent, 'toolu_shown');
  expect(ready).toMatchObject({ permissionKind: 'shell', shellCommand: 'make test', shellLanguage: 'bash' });
  const entry = sent.find((one) => one.type === 'session/inputNeededSet');
  expect(JSON.stringify([ready, entry])).toContain('make test');
  expect(JSON.stringify([ready, entry])).not.toContain('ahpd-shell-init');
  session.confirm('toolu_shown', true);
  expect(await asking).toEqual({ behavior: 'allow', updatedInput: { command: 'make test' } });
});

/*
 * A deny list is a person's answer about the tool: the call is the host's to
 * answer, whose chain refuses it, and the CLI is answered the refusal in VS
 * Code's words.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDenial.ts#L6-L10
 */
it('puts a command the deny list names to the host, and answers the CLI its refusal', async () => {
  const { canUseTool, session, sent } = await sessionWith({ permissions: { allow: [], deny: ['Bash'] } });

  const answered = canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_denied_list' });
  await settle();
  expect(sent.filter((one) => one.type === 'chat/toolCallReady').map((one) => one.toolCallId)).toEqual(['toolu_denied_list']);
  expect(session.confirm('toolu_denied_list', false)).toBe(true);
  expect(await answered).toEqual({ behavior: 'deny', message: 'User declined' });
});

/*
 * An aborted call is not one to put to anybody, and it is refused in VS
 * Code's words.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L102-L104
 */
it('still answers a call the SDK has already cancelled', async () => {
  const { canUseTool, sent } = await sessionWith();
  const signal = AbortSignal.abort();

  expect(await canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_aborted', signal }))
    .toEqual({ behavior: 'deny', message: 'SDK aborted the tool request' });
  expect(readyOf(sent, 'toolu_aborted')).toBeUndefined();
});

/** The captured subagent turn, cut where its permission ask was recorded. */
const subagentCall = (): { frames: Record<string, unknown>[]; agentId: string; write: string } => {
  const lines = readFileSync(new URL('./fixtures/claude-subagent-ask.jsonl', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const at = lines.findIndex((one) => one.type === 'canUseTool');
  const about = bag(bag(lines[at]).options);
  return { frames: lines.slice(0, at), agentId: str(about.agentID) as string, write: str(about.toolUseID) as string };
};

/** The chats the session says a question is waiting on. */
const neededChats = (session: ReturnType<typeof createSession>): string[] =>
  ((session.sessionState().inputNeeded as Bag[]) ?? []).map((one) => str(one.chat) ?? '');

it('asks a subagent\'s call on its own chat, by the agent id the CLI gives', async () => {
  const { frames, agentId, write } = subagentCall();
  const workers: { uri: string; actions: Bag[] }[] = [];
  const { session, canUseTool } = await sessionWith({}, {
    frames,
    subagent: (id) => {
      const held = { uri: `ahp-chat://subagent/${id}`, actions: [] as Bag[] };
      workers.push(held);
      return {
        uri: held.uri,
        turnId: `wturn-${id}`,
        emit: (action: Bag) => { held.actions.push(action); },
        end: () => {},
      };
    },
  });
  const worker = workers[0];
  expect(worker).toBeDefined();
  const chat = (worker as { uri: string }).uri;

  // The call whose frame already arrived is joined by its own id.
  const first = canUseTool('Write', { file_path: '/tmp/one', content: 'one' }, { toolUseID: write, agentID: agentId });
  await settle();
  expect(neededChats(session)).toContain(chat);
  session.confirm(write, false);
  expect(await first).toEqual({ behavior: 'deny', message: 'User declined' });

  // A call whose frame has not arrived is put on that same chat, because the
  // CLI said which subagent it belongs to.
  const later = canUseTool('Write', { file_path: '/tmp/two', content: 'two' }, { toolUseID: 'toolu_later', agentID: agentId });
  await settle();
  expect(neededChats(session)).toContain(chat);
  session.confirm('toolu_later', false);
  expect(await later).toEqual({ behavior: 'deny', message: 'User declined' });
});
