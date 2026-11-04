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
 * asking?". For a command, `canUseTool` is the one place this backend sits
 * between the CLI and a question; an approved command is allowed before
 * anything is held, so no client draws a confirmation. For a tool the
 * operator's rule names, a `PreToolUse` hook asks instead, in every mode, and
 * the question offers no "always" option.
 */

const sdk = vi.hoisted(() => ({
  frames: [] as Record<string, unknown>[],
  options: undefined as undefined | Record<string, unknown>,
  canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => sdk.frames,
  query: ({ options }: { options: Record<string, unknown> }) => ({
    async *[Symbol.asyncIterator]() {
      sdk.options = options;
      sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
      for (const frame of sdk.frames) yield frame;
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
    close: () => {},
  }),
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

/** The hook that asks for a tool the operator's rule names. */
const ruleHook = (options: Bag): Hook =>
  ((((options.hooks as Bag).PreToolUse as Bag[])[1] as Bag).hooks as Hook[])[0] as Hook;

/** The hook that puts the operator's environment in front of a command. */
const shellHook = (options: Bag): Hook =>
  ((((options.hooks as Bag).PreToolUse as Bag[])[0] as Bag).hooks as Hook[])[0] as Hook;

/** What the rule hook said, as the SDK reads it. */
const decisionOf = (answer: Bag): string | undefined =>
  str(bag(answer.hookSpecificOutput).permissionDecision);

/** What the rule hook gave as its reason. */
const reasonOf = (answer: Bag): string | undefined =>
  str(bag(answer.hookSpecificOutput).permissionDecisionReason);

/** One confirmation's ready action, as a client reads it. */
const readyOf = (sent: Bag[], id: string): Bag | undefined =>
  sent.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === id);

/** The read call the rule is asked about, under one id. */
const readCall = (id: string): Bag => ({
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_input: { file_path: '/tmp/one' },
  tool_use_id: id,
});

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

it('matches the line the model wrote, not the one the shell prefix made', async () => {
  const { asked, check } = approving(['make test']);
  const { canUseTool, options } = await sessionWith(check, {}, { SAY: 'b' });

  /*
   * What the CLI does first: the hook puts the operator's environment in
   * front of the command, and the rewritten input is what `canUseTool` is
   * handed. The rules are the owner's about the command, and the command is
   * the one the model wrote.
   */
  const hooked = await shellHook(options)({ hook_event_name: 'PreToolUse', tool_use_id: 'toolu_env', tool_input: { command: 'make test' } });
  const rewritten = bag(bag(hooked.hookSpecificOutput).updatedInput);
  expect(rewritten.command).toBe("export SAY='b'\nmake test");

  expect(await canUseTool('Bash', rewritten, { toolUseID: 'toolu_env' }))
    .toEqual({ behavior: 'allow', updatedInput: rewritten });
  expect(asked).toEqual([
    { kind: 'tool', line: 'Bash', shell: undefined, tool: undefined },
    { kind: 'shell', line: 'make test', shell: 'bash', tool: 'Bash' },
  ]);
});

/*
 * A command a person is asked about is shown as the model wrote it, its line
 * and its input, whatever the host puts in front of it to run, as the reference
 * asks about the command the model wrote; an approval runs it with the prefix.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L174
 */
it('asks about a command as the model wrote it, and runs it with the shell prefix', async () => {
  const { check } = approving([]);
  const { session, canUseTool, options, sent } = await sessionWith(check, {}, { SAY: 'b' });
  const hooked = await shellHook(options)({ hook_event_name: 'PreToolUse', tool_use_id: 'toolu_shown', tool_input: { command: 'make test' } });
  const rewritten = bag(bag(hooked.hookSpecificOutput).updatedInput);
  const asking = canUseTool('Bash', rewritten, { toolUseID: 'toolu_shown' });
  await settle();
  const ready = readyOf(sent, 'toolu_shown');
  const entry = sent.find((one) => one.type === 'session/inputNeededSet');
  expect(JSON.stringify([ready, entry])).toContain('make test');
  expect(JSON.stringify([ready, entry])).not.toContain('export');
  session.confirm('toolu_shown', true);
  expect(await asking).toEqual({ behavior: 'allow', updatedInput: rewritten });
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

it('still refuses a command the deny list names', async () => {
  const { check } = approving(['make test']);
  const { canUseTool } = await sessionWith(check, { permissions: { allow: [], deny: ['Bash'] } });

  // The rules are the window's answer about a command; a deny list is a
  // person's answer about the tool, and it wins.
  expect(await canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_denied_list' }))
    .toEqual({ behavior: 'deny', message: 'Bash is denied for this session' });
});

it('still answers a call the SDK has already cancelled', async () => {
  const { asked, check } = approving(['make test']);
  const { canUseTool } = await sessionWith(check);
  const signal = AbortSignal.abort();

  // An aborted call is not one to approve, so no question is put and no line
  // is read. The rule is still asked whether this tool is one it names.
  expect(await canUseTool('Bash', { command: 'make test' }, { toolUseID: 'toolu_aborted', signal }))
    .toEqual({ behavior: 'deny', message: 'Cancelled' });
  expect(asked).toEqual([{ kind: 'tool', line: 'Bash', shell: undefined, tool: undefined }]);
});

it.each(['default', 'acceptEdits', 'auto', 'bypassPermissions'])(
  'asks for a tool the rule names, in %s mode',
  async (permissionMode) => {
    const { asked, check } = naming(['Read']);
    const { session, options, sent } = await sessionWith(check, { permissionMode });

    const waiting = ruleHook(options)(readCall('toolu_read'));
    await settle();
    // The rule is read under the name the rule keys on, and the question is
    // on the chat whatever mode would otherwise have skipped it.
    expect(asked).toEqual([{ kind: 'tool', line: 'Read', shell: undefined, tool: undefined }]);
    expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
    // No "always" is offered, so the answer cannot be kept as a rule.
    expect(readyOf(sent, 'toolu_read')?.options).toBeUndefined();

    session.confirm('toolu_read', true);
    expect(decisionOf(await waiting)).toBe('allow');
  });

it('refuses a matched tool in dontAsk without a question', async () => {
  const { asked, check } = naming(['Read']);
  const { options, sent } = await sessionWith(check, { permissionMode: 'dontAsk' });

  const answer = await ruleHook(options)(readCall('toolu_read'));
  expect(decisionOf(answer)).toBe('deny');
  expect(reasonOf(answer)).toContain('dontAsk');
  expect(asked).toEqual([{ kind: 'tool', line: 'Read', shell: undefined, tool: undefined }]);
  // Refusing is this mode's answer, and the rule does not take it away.
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
});

it('asks once, and canUseTool does not put the question again', async () => {
  const { check } = naming(['Read']);
  const { session, canUseTool, options, sent } = await sessionWith(check);

  const waiting = ruleHook(options)(readCall('toolu_read'));
  await settle();
  session.confirm('toolu_read', true);
  expect(decisionOf(await waiting)).toBe('allow');

  // The CLI's own question, if it comes after the hook's, is answered from
  // what the person said rather than put a second time.
  expect(await canUseTool('Read', { file_path: '/tmp/one' }, { toolUseID: 'toolu_read' }))
    .toEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/one' } });
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('answers canUseTool with the person\'s refusal as well', async () => {
  const { check } = naming(['Read']);
  const { session, canUseTool, options } = await sessionWith(check);

  const waiting = ruleHook(options)(readCall('toolu_read'));
  await settle();
  session.confirm('toolu_read', false);
  const answer = await waiting;
  expect(decisionOf(answer)).toBe('deny');
  expect(reasonOf(answer)).toBe('The person declined this action');
  expect(await canUseTool('Read', { file_path: '/tmp/one' }, { toolUseID: 'toolu_read' }))
    .toEqual({ behavior: 'deny', message: 'The person declined this action' });
});

it('does not let an allow list answer for a matched tool', async () => {
  const { check } = naming(['Read']);
  const { canUseTool, sent } = await sessionWith(check, { permissions: { allow: ['Read'], deny: [] } });

  // No hook ran here, so this is the callback's own road: a matched tool asks
  // even though the session already said to stop asking about it.
  void canUseTool('Read', { file_path: '/tmp/one' }, { toolUseID: 'toolu_listed' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('runs a matched Bash command with the input sourceFirst wrote', async () => {
  const { check } = naming(['Bash']);
  const { session, canUseTool, options } = await sessionWith(check, {}, { SAY: 'b' });

  const hooked = await shellHook(options)({ hook_event_name: 'PreToolUse', tool_use_id: 'toolu_bash', tool_input: { command: 'make test' } });
  const rewritten = bag(bag(hooked.hookSpecificOutput).updatedInput);

  const waiting = ruleHook(options)({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'make test' }, tool_use_id: 'toolu_bash' });
  await settle();
  session.confirm('toolu_bash', true);
  expect(decisionOf(await waiting)).toBe('allow');

  // The answer the CLI gets keeps the hook's rewrite: the rule hook returns no
  // input of its own, so what `sourceFirst` wrote is what the command runs as.
  expect(await canUseTool('Bash', rewritten, { toolUseID: 'toolu_bash' }))
    .toEqual({ behavior: 'allow', updatedInput: rewritten });
});

it('names an MCP tool as <server>/<tool>, the name the rule matches', async () => {
  const { asked, check } = naming(['tracker/move']);
  const { session, options } = await sessionWith(check);

  const waiting = ruleHook(options)({ hook_event_name: 'PreToolUse', tool_name: 'mcp__tracker__move', tool_input: { id: 1 }, tool_use_id: 'toolu_mcp' });
  await settle();
  expect(asked).toEqual([{ kind: 'tool', line: 'tracker/move', shell: undefined, tool: undefined }]);
  session.confirm('toolu_mcp', false);
  expect(decisionOf(await waiting)).toBe('deny');
});

it('names a renamed MCP server as its config key, which the tool prefix does not spell', async () => {
  // A server's key and the prefix the CLI builds from it need not be the same
  // text, and the rule names the server by its key, which is what the hook is
  // told. The tool is what follows the prefix the CLI did build.
  const { asked, check } = naming(['my server/move']);
  const { session, options } = await sessionWith(check);

  const waiting = ruleHook(options)({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__my_server__move',
    tool_input: { id: 1 },
    tool_use_id: 'toolu_renamed',
    mcp_server: { name: 'my server', source: 'user' },
  });
  await settle();
  expect(asked).toEqual([{ kind: 'tool', line: 'my server/move', shell: undefined, tool: undefined }]);
  session.confirm('toolu_renamed', false);
  expect(decisionOf(await waiting)).toBe('deny');
});

it('splits a server name with __ at the prefix, not at the first __', async () => {
  // Read by the split alone, this call is server `my`, tool `server__move`; the
  // hook says the server is `my__server`, and the tool is what follows it.
  const { asked, check } = naming(['my__server/move']);
  const { session, options } = await sessionWith(check);

  const waiting = ruleHook(options)({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__my__server__move',
    tool_input: { id: 1 },
    tool_use_id: 'toolu_double',
    mcp_server: { name: 'my__server', source: 'sdk' },
  });
  await settle();
  expect(asked).toEqual([{ kind: 'tool', line: 'my__server/move', shell: undefined, tool: undefined }]);
  session.confirm('toolu_double', false);
  expect(decisionOf(await waiting)).toBe('deny');
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

it('asks a subagent\'s matched call on its own chat, by the agent id the hook is given', async () => {
  const { frames, agentId, write } = subagentCall();
  const { check } = naming(['Write']);
  const workers: { uri: string; actions: Bag[] }[] = [];
  const { session, options } = await sessionWith(check, {}, undefined, {
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
  const first = ruleHook(options)({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/one', content: 'one' },
    tool_use_id: write,
    agent_id: agentId,
  });
  await settle();
  expect(neededChats(session)).toContain(chat);
  session.confirm(write, false);
  expect(decisionOf(await first)).toBe('deny');

  // A call whose frame has not arrived is put on that same chat, because the
  // hook said which subagent it belongs to.
  const later = ruleHook(options)({
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: '/tmp/two', content: 'two' },
    tool_use_id: 'toolu_later',
    agent_id: agentId,
  });
  await settle();
  expect(neededChats(session)).toContain(chat);
  session.confirm('toolu_later', false);
  expect(decisionOf(await later)).toBe('deny');
});

it('returns at once for a tool the rule does not name', async () => {
  const { asked, check } = naming([]);
  const { options, sent } = await sessionWith(check);

  expect(await ruleHook(options)(readCall('toolu_read'))).toEqual({});
  expect(asked).toEqual([{ kind: 'tool', line: 'Read', shell: undefined, tool: undefined }]);
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
});

it('leaves AskUserQuestion to its own question', async () => {
  const { asked, check } = naming(['AskUserQuestion']);
  const { options } = await sessionWith(check);

  // Its answer is the tool's input: a confirmation here would settle the
  // question and then run the tool with nothing the person said.
  expect(await ruleHook(options)({
    hook_event_name: 'PreToolUse',
    tool_name: 'AskUserQuestion',
    tool_input: { questions: [] },
    tool_use_id: 'toolu_question',
  })).toEqual({});
  expect(asked).toEqual([]);
});
