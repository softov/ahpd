import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { bag, str } from '@ahpd/sdk';
import type { Bag, Start } from '@ahpd/sdk';

/*
 * A shell command the owner's rules already allow, and a tool the operator's
 * rule makes ask every time.
 *
 * `Start.getAutoApproval` is the host's answer to "does this run without
 * asking?", and `canUseTool` is the one place this backend sits between the
 * CLI and a question. An approved command is allowed before anything is held,
 * so no client draws a confirmation. A tool the operator's rule names asks
 * every time the CLI asks about it, with no "always" option, as VS Code's host
 * applies its rules to the confirmations a provider raises; a mode in which
 * the CLI runs a call without asking puts no question.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1698
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

/** What the check is asked, in one line each. */
type Asked = { kind: string; line: string; shell: string | undefined; tool: string | undefined }[];

/** The host's answer to "does this run without asking?", in one line each. */
type Check = NonNullable<Start['getAutoApproval']>;

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The frames a session reads, and how it reaches a subagent's chat. */
interface Replay {
  frames?: Record<string, unknown>[];
  subagent?: NonNullable<Parameters<typeof createSession>[0]['subagent']>;
}

/** A session with the owner's check, and what it said on the wire. */
async function sessionWith(check?: Check, settings: Bag = {}, shellEnv?: Record<string, string>, replay: Replay = {}): Promise<{
  session: ReturnType<typeof createSession>;
  canUseTool: NonNullable<typeof sdk.canUseTool>;
  options: Bag;
  sent: Bag[];
}> {
  sdk.frames = replay.frames ?? [];
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/autoapprove',
    chatUri: 'ahp-chat:/autoapprove',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-autoapprove-')),
    emit: (_channel, action) => { sent.push(action as Bag); },
    settings,
    ...(check === undefined ? {} : { getAutoApproval: check }),
    ...(shellEnv === undefined ? {} : { shellEnv }),
    ...(replay.subagent === undefined ? {} : { subagent: replay.subagent }),
  });
  await settle();
  // A turn running, as the CLI asks about a call and speaks only inside one.
  session.sendMessage('t1', 'go');
  await settle();
  return { session, canUseTool: sdk.canUseTool!, options: sdk.options!, sent };
}

/** The commands a session's check approves, and what it was asked. */
const approving = (approved: string[]): { asked: Asked; check: Check } => {
  const asked: Asked = [];
  return {
    asked,
    check: (kind, line, shell, tool) => {
      asked.push({ kind, line, shell, tool });
      return kind === 'shell' && approved.includes(line) ? 'not-needed' as NonNullable<ReturnType<Check>> : undefined;
    },
  };
};

/**
 * A check that names these tools, and approves these command lines.
 *
 * The operator's rule names tools; the owner's terminal rules approve lines.
 * One fake answers both, so a test reads which question was put and in what
 * order.
 */
const naming = (tools: string[], approved: string[] = []): { asked: Asked; check: Check } => {
  const asked: Asked = [];
  return {
    asked,
    check: (kind, line, shell, tool) => {
      asked.push({ kind, line, shell, tool });
      if (kind === 'tool') return tools.includes(line) ? 'ask' as NonNullable<ReturnType<Check>> : undefined;
      return approved.includes(line) ? 'not-needed' as NonNullable<ReturnType<Check>> : undefined;
    },
  };
};

/** A `PreToolUse` hook, as the SDK calls it. */
type Hook = (input: Bag, toolUseID?: string, options?: { signal: AbortSignal }) => Promise<Bag>;

/** The `PreToolUse` entries a query names, none where it names none. */
const preToolUse = (options: Bag): Bag[] => ((options.hooks as Bag).PreToolUse as Bag[] | undefined) ?? [];

/** What the hooks registered for `Bash` put in place of a command, or nothing when none puts anything. */
const rewrites = async (options: Bag, command: string): Promise<unknown> => {
  const said: unknown[] = [];
  for (const entry of preToolUse(options).filter((one) => one.matcher === 'Bash')) {
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

it('runs a command the owner\'s rules allow, without asking', async () => {
  const { asked, check } = approving(['make test']);
  const { canUseTool, sent } = await sessionWith(check);

  expect(await canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_allowed' }))
    .toEqual({ behavior: 'allow', updatedInput: { command: 'make test' } });
  // The rule is read for the tool too, and it names no tool; then the line is
  // read for bash, which is the one shell the CLI's tool is.
  expect(asked).toEqual([
    { kind: 'tool', line: 'Bash', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'make test', shell: 'bash', tool: 'Bash' },
  ]);
  // Nothing was drawn: a call nobody was asked about is not a question that
  // was answered, and a client is not left holding a confirmation for it.
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
  expect(sent.filter((one) => one.type === 'chat/toolCallReady')).toEqual([]);
});

/** A client's shell init script in force, which the CLI runs from its session environment file. */
const SCRIPTED = { shellInitScripts: [{ shell: 'bash', script: 'export SAY=b\n' }] };

it('matches the line the model wrote, with a client\'s script in force', async () => {
  const { asked, check } = approving(['make test']);
  const { canUseTool, options } = await sessionWith(check, SCRIPTED);

  // Nothing is put in front of the command: the call the CLI asks about, and
  // runs, is the one the model wrote.
  expect(await rewrites(options, 'make test')).toBeUndefined();
  expect(await canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_env' }))
    .toEqual({ behavior: 'allow', updatedInput: { command: 'make test' } });
  expect(asked).toEqual([
    { kind: 'tool', line: 'Bash', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'make test', shell: 'bash', tool: 'Bash' },
  ]);
});

/*
 * A command a person is asked about is shown as the model wrote it, its line
 * and its input, as the reference asks about the command the model wrote, and
 * an approval runs it as written.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L174
 */
it('asks about a command as the model wrote it, and runs it as written, with a client\'s script in force', async () => {
  const { check } = approving([]);
  const { session, canUseTool, options, sent } = await sessionWith(check, SCRIPTED);
  expect(await rewrites(options, 'make test')).toBeUndefined();
  const asking = canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_shown' });
  await settle();
  const ready = readyOf(sent, 'toolu_shown');
  const entry = sent.find((one) => one.type === 'session/inputNeededSet');
  expect(JSON.stringify([ready, entry])).toContain('make test');
  expect(JSON.stringify([ready, entry])).not.toContain('ahpd-shell-init');
  session.confirm('toolu_shown', true);
  expect(await asking).toEqual({ behavior: 'allow', updatedInput: { command: 'make test' } });
});

it('asks for a command no rule matches', async () => {
  const { check } = approving([]);
  const { canUseTool, sent } = await sessionWith(check);

  // Nothing settles it, so the question is held and never awaited: what the
  // test reads is the entry it put on the chat.
  void canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_unmatched' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('asks for a command a rule denies', async () => {
  // A deny and a line no rule could read are the same answer here: the host
  // says nothing about a call that is not an approval, and it asks.
  const { check } = approving([]);
  const { canUseTool, sent } = await sessionWith(check);

  void canUseTool('Bash', { command: 'rm -rf /' }, { toolUseID: 'toolu_denied' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('asks when the host offers no check at all', async () => {
  const { canUseTool, sent } = await sessionWith();

  void canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_no_check' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('asks the check about every tool, and about a command\'s line', async () => {
  const { asked, check } = approving(['anything']);
  const { canUseTool, sent } = await sessionWith(check);

  void canUseTool('Read', { file_path: '/tmp/one' }, { toolUseID: 'toolu_read' });
  await settle();
  // A tool that is not a shell has no line to match, so the check is asked
  // its one question: is this tool named by the rule?
  expect(asked).toEqual([{ kind: 'tool', line: 'Read', shell: undefined, tool: undefined }]);
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('puts a command the deny list names to the host, and answers the CLI its refusal', async () => {
  const { check } = approving(['make test']);
  const { canUseTool, session, sent } = await sessionWith(check, { permissions: { allow: [], deny: ['Bash'] } });

  // The rules are the window's answer about a command; a deny list is a
  // person's answer about the tool, and it wins: the call is the host's to
  // answer, whose chain refuses it, in VS Code's words.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDenial.ts#L6-L10
  const answered = canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_denied_list' });
  await settle();
  expect(sent.filter((one) => one.type === 'chat/toolCallReady').map((one) => one.toolCallId)).toEqual(['toolu_denied_list']);
  expect(session.confirm('toolu_denied_list', false)).toBe(true);
  expect(await answered).toEqual({ behavior: 'deny', message: 'User declined' });
});

it('still answers a call the SDK has already cancelled', async () => {
  const { asked, check } = approving(['make test']);
  const { canUseTool } = await sessionWith(check);
  const signal = AbortSignal.abort();

  // An aborted call is not one to approve, so no question is put and no line
  // is read, and it is refused in VS Code's words. The rule is still asked
  // whether this tool is one it names.
  // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L102-L104
  expect(await canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_aborted', signal }))
    .toEqual({ behavior: 'deny', message: 'SDK aborted the tool request' });
  expect(asked).toEqual([{ kind: 'tool', line: 'Bash', shell: undefined, tool: undefined }]);
});

it('asks for a tool the rule names when the CLI asks about it, offering no "always"', async () => {
  const { asked, check } = naming(['Read']);
  const { session, canUseTool, sent } = await sessionWith(check, { permissionMode: 'acceptEdits' });

  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Read' }], behavior: 'allow', destination: 'session' }];
  const answer = canUseTool('Read', { file_path: '/tmp/one' }, { toolUseID: 'toolu_read', suggestions });
  await settle();
  // The rule is read under the name the rule keys on, and the question is on the chat.
  expect(asked).toEqual([{ kind: 'tool', line: 'Read', shell: undefined, tool: undefined }]);
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
  // No "always" is offered, so the answer cannot be kept as a rule.
  expect(readyOf(sent, 'toolu_read')?.options).toBeUndefined();

  session.confirm('toolu_read', true);
  expect(await answer).toEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/one' } });
});

it.each(['auto', 'bypassPermissions'])(
  'puts no question for a tool the rule names in %s mode, where the CLI asks about nothing',
  async (permissionMode) => {
    const { check } = naming(['Read']);
    const { options, sent } = await sessionWith(check, { permissionMode });

    // Whatever runs before the CLI decides a call, run on a call to the tool.
    for (const entry of preToolUse(options).filter((one) => one.matcher === undefined || one.matcher === 'Read')) {
      for (const hook of entry.hooks as Hook[]) {
        void hook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/tmp/one' }, tool_use_id: 'toolu_read' }, 'toolu_read', { signal: new AbortController().signal });
      }
    }
    await settle();
    expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
  });

it('does not let an allow list answer for a matched tool', async () => {
  const { check } = naming(['Read']);
  const { canUseTool, sent } = await sessionWith(check, { permissions: { allow: ['Read'], deny: [] } });

  // A matched tool asks even though the session already said to stop asking about it.
  void canUseTool('Read', { file_path: '/tmp/one' }, { toolUseID: 'toolu_listed' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('runs a matched Bash command as the model wrote it, with a client\'s script in force', async () => {
  const { check } = naming(['Bash']);
  const { session, canUseTool, options } = await sessionWith(check, SCRIPTED);
  expect(await rewrites(options, 'make test')).toBeUndefined();

  const answer = canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_bash' });
  await settle();
  session.confirm('toolu_bash', true);
  expect(await answer).toEqual({ behavior: 'allow', updatedInput: { command: 'make test' } });
});

it('names an MCP tool as <server>/<tool>, the name the rule matches', async () => {
  const { asked, check } = naming(['tracker/move']);
  const { session, canUseTool } = await sessionWith(check);

  const answer = canUseTool('mcp__tracker__move', { id: 1 }, { toolUseID: 'toolu_mcp' });
  await settle();
  expect(asked).toEqual([{ kind: 'tool', line: 'tracker/move', shell: undefined, tool: undefined }]);
  session.confirm('toolu_mcp', false);
  expect(await answer).toEqual({ behavior: 'deny', message: 'User declined' });
});

it('names a renamed MCP server as its config key, which the tool prefix does not spell', async () => {
  // A server's key and the prefix the CLI builds from it need not be the same
  // text, and the rule names the server by its key, which is the SDK's
  // `mcpServer` on the question. The tool is what follows the prefix the CLI
  // did build.
  const { asked, check } = naming(['my server/move']);
  const { session, canUseTool } = await sessionWith(check);

  const answer = canUseTool('mcp__my_server__move', { id: 1 }, { toolUseID: 'toolu_renamed', mcpServer: { name: 'my server', source: 'user' } });
  await settle();
  expect(asked).toEqual([{ kind: 'tool', line: 'my server/move', shell: undefined, tool: undefined }]);
  session.confirm('toolu_renamed', false);
  expect(await answer).toEqual({ behavior: 'deny', message: 'User declined' });
});

it('splits a server name with __ at the prefix, not at the first __', async () => {
  // Read by the split alone, this call is server `my`, tool `server__move`; the
  // SDK says the server is `my__server`, and the tool is what follows it.
  const { asked, check } = naming(['my__server/move']);
  const { session, canUseTool } = await sessionWith(check);

  const answer = canUseTool('mcp__my__server__move', { id: 1 }, { toolUseID: 'toolu_double', mcpServer: { name: 'my__server', source: 'sdk' } });
  await settle();
  expect(asked).toEqual([{ kind: 'tool', line: 'my__server/move', shell: undefined, tool: undefined }]);
  session.confirm('toolu_double', false);
  expect(await answer).toEqual({ behavior: 'deny', message: 'User declined' });
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

it('asks a subagent\'s matched call on its own chat, by the agent id the CLI gives', async () => {
  const { frames, agentId, write } = subagentCall();
  const { check } = naming(['Write']);
  const workers: { uri: string; actions: Bag[] }[] = [];
  const { session, canUseTool } = await sessionWith(check, {}, undefined, {
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

it('puts AskUserQuestion as its own question when the rule names it', async () => {
  const { check } = naming(['AskUserQuestion']);
  const { canUseTool, sent } = await sessionWith(check);

  // Its answer is the tool's input: a confirmation would settle the question
  // and then run the tool with nothing the person said.
  void canUseTool('AskUserQuestion', {
    questions: [{ question: 'Which one?', header: 'Pick', options: [{ label: 'A', description: 'The first' }, { label: 'B', description: 'The second' }], multiSelect: false }],
  }, { toolUseID: 'toolu_question' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet').map((one) => bag(one.request).kind)).toEqual(['chatInput']);
});
