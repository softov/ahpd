/*
 * A scripted ACP server for the tests.
 *
 * It is a real subprocess speaking newline-delimited JSON-RPC 2.0 on its
 * stdin and stdout, so the bridge under test spawns a program and completes a
 * genuine handshake rather than talking to a mock. Everything it does is
 * driven by the requests that arrive; it never sleeps on a timer.
 *
 * The prompt text chooses the script, so one server covers every case a turn
 * needs:
 *
 * - text containing `think` emits a thought chunk before the answer;
 * - text containing `tool` opens a tool call with its input and completes it;
 * - text containing `read` asks the client for a file and says what it got;
 * - text containing `write` asks it to write one and says it did;
 * - text containing `term` opens a terminal, waits for it, reads it, releases it;
 * - text containing `ask` asks for permission on a destructive call and reports
 *   which option came back;
 * - text containing `wait` emits one chunk and then holds the prompt open
 *   until `session/cancel` arrives, answering `cancelled` only then;
 * - anything else streams two message chunks before ending.
 *
 * The port scripts are real requests *to* the client - `fs/read_text_file`,
 * `fs/write_text_file`, `terminal/*`, `session/request_permission` - awaited
 * on their answers, which is what makes them a test of the client half rather
 * than of this server.
 *
 * Beside the prompt scripts it answers the session lifecycle a catalogue and a
 * config want: `session/list`, `session/load`, `session/set_mode` and
 * `session/set_config_option`, with the modes and the model option a real
 * server names on `session/new`.
 *
 * When `ACP_LOG` names a file, every request and notification that arrives is
 * appended to it as one JSON line, so a test can prove what the bridge actually
 * asked for - including the `clientCapabilities` it advertised - rather than
 * inferring it from state the bridge keeps.
 */

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

/** The file every request is recorded in, when a test named one. */
const LOG = process.env.ACP_LOG;

/** The session id this server names; one process serves one conversation. */
let session = 'acp-session-1';

/** Where the conversation works, as `session/new` was told. */
let cwd = '/tmp';

/**
 * The id a new session is given.
 *
 * The pid is part of it because every bridge session spawns its own server, so
 * a counter alone would name every conversation `acp-session-1` and a
 * process-wide catalogue would run them together.
 */
let opened = 0;
const nextSession = () => {
  opened += 1;
  session = `acp-session-${process.pid}-${opened}`;
  return session;
};

/** The modes this server offers, with the one currently in force. */
let mode = 'ask';
const modes = () => ({
  currentModeId: mode,
  availableModes: [
    { id: 'ask', name: 'Ask' },
    { id: 'code', name: 'Code' },
  ],
});

/** The model this server currently serves. */
let model = 'fast';

/** The session config options, which is where ACP keeps a model choice. */
const configOptions = () => [{
  type: 'select',
  id: 'model',
  name: 'Model',
  category: 'model',
  currentValue: model,
  options: [
    { value: 'fast', name: 'Fast' },
    { value: 'thorough', name: 'Thorough' },
  ],
}];

/** The sessions `session/list` reports, one titled and one not. */
const LISTED = [
  { sessionId: 'listed-1', cwd: '/tmp/one', title: 'One', updatedAt: '2026-01-01T00:00:00.000Z' },
  { sessionId: 'listed-2', cwd: '/tmp/two', additionalDirectories: ['/tmp/two-b'] },
];

const write = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

const respond = (id, result) => {
  write({ jsonrpc: '2.0', id, result });
};

const notify = (update) => {
  write({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: session, update } });
};

/**
 * The requests this server has sent and is waiting on, by id.
 *
 * A port script is a real client call, so it is written as a JSON-RPC request
 * of this server's own and awaited on the answer rather than answered here.
 */
const waiting = new Map();
let asked = 0;

/** Ask the client something, and await what it answered. */
const ask = (method, params) =>
  new Promise((resolve, reject) => {
    asked += 1;
    const id = `s${asked}`;
    waiting.set(id, { resolve, reject });
    write({ jsonrpc: '2.0', id, method, params });
  });

/** The prompt's text, out of the content blocks the client sent. */
const textOf = (params) => {
  const blocks = Array.isArray(params?.prompt) ? params.prompt : [];
  return blocks
    .map((block) => (block !== null && block.type === 'text' ? String(block.text ?? '') : ''))
    .join('');
};

/**
 * The updates one prompt earns, in order.
 *
 * The thought chunk comes first for a prompt that asks for one, so a test can
 * assert that reasoning reaches the client as its own action rather than as
 * prose.
 */
const scriptFor = (text) => {
  const updates = [];

  if (text.includes('think')) {
    updates.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing it up' } });
  }

  if (text.includes('tool')) {
    updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'looking' } });
    updates.push({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-1',
      title: 'Read a file',
      name: 'read_file',
      kind: 'read',
      status: 'in_progress',
      rawInput: { path: '/tmp/a.txt' },
    });
    updates.push({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'file body' } }],
    });
    return updates;
  }

  if (text.includes('wait')) {
    updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'waiting' } });
    return updates;
  }

  updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
  updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' there' } });
  return updates;
};

/** The prompt this server is holding open, waiting for a cancel. */
let pending = undefined;

/** Whether the command catalogue has already gone out; it is sent once. */
let commandsSent = false;

/**
 * One prompt's whole answer, port scripts included.
 *
 * Async because a port script is a request of this server's own: the updates go
 * out, then whatever the client was asked for is awaited, and only then does
 * the prompt settle. A prompt that reaches for a port is not also given the
 * plain script, so a test reads exactly what it asked for.
 */
const promptScript = async (id, params) => {
  const text = textOf(params);
  if (!commandsSent) {
    commandsSent = true;
    notify({
      sessionUpdate: 'available_commands_update',
      availableCommands: [{ name: 'plan', description: 'Draft a plan' }],
    });
  }
  const reaches = ['read', 'write', 'term', 'ask'].some((one) => text.includes(one));
  if (!reaches) for (const update of scriptFor(text)) notify(update);
  if (text.includes('wait')) {
    // Held open, and answered only by the cancel below: a test that sees this
    // turn end at all has proven the notification reached the server.
    pending = id;
    return;
  }

  if (text.includes('read')) {
    const answer = await ask('fs/read_text_file', { sessionId: session, path: `${cwd}/note.txt` });
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `read=${String(answer?.content ?? '')}` },
    });
  }

  if (text.includes('write')) {
    await ask('fs/write_text_file', {
      sessionId: session, path: `${cwd}/written.txt`, content: 'written by the server',
    });
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'wrote it' } });
  }

  if (text.includes('term')) {
    const created = await ask('terminal/create', {
      sessionId: session, command: 'echo', args: ['hello from the shell'], cwd,
    });
    const terminalId = String(created?.terminalId ?? '');
    const exited = await ask('terminal/wait_for_exit', { sessionId: session, terminalId });
    const output = await ask('terminal/output', { sessionId: session, terminalId });
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `term=${String(output?.output ?? '').trim()}|exit=${String(exited?.exitCode)}`,
      },
    });
    await ask('terminal/release', { sessionId: session, terminalId });
  }

  if (text.includes('ask')) {
    const toolCall = {
      toolCallId: 'call-perm',
      title: 'Remove a file',
      name: 'remove_file',
      kind: 'delete',
      status: 'in_progress',
      rawInput: { path: `${cwd}/gone.txt` },
    };
    notify({ sessionUpdate: 'tool_call', ...toolCall });
    const answer = await ask('session/request_permission', {
      sessionId: session,
      toolCall,
      options: [
        { optionId: 'yes-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'yes-always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'no-once', name: 'Reject once', kind: 'reject_once' },
      ],
    });
    const chosen = answer?.outcome?.outcome === 'selected' ? String(answer.outcome.optionId) : 'cancelled';
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-perm',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: `answer=${chosen}` } }],
    });
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `perm=${chosen}` } });
  }

  respond(id, { stopReason: 'end_turn' });
};

/**
 * One prompt, with a failed port request said out loud.
 *
 * A client that refused a file or a shell answers with a JSON-RPC error, and a
 * script awaiting it would otherwise reject into nothing and leave the prompt
 * hanging - which a test can only read as a timeout. The reason is put in the
 * stream instead, so the failure is the thing under test rather than silence.
 */
const respondPrompt = async (id, params) => {
  try {
    await promptScript(id, params);
  }
  catch (why) {
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: `error=${why instanceof Error ? why.message : String(why)}` },
    });
    respond(id, { stopReason: 'end_turn' });
  }
};

const onLine = (line) => {
  if (line.trim() === '') return;
  let message;
  try {
    message = JSON.parse(line);
  }
  catch {
    return;
  }

  if (LOG !== undefined) appendFileSync(LOG, `${JSON.stringify({ method: message.method, params: message.params })}\n`);

  /*
   * The answer to something this server asked, which has an id and no method.
   *
   * Handled before the switch, because a response is not a request and would
   * otherwise fall into the default and be told the method is unknown.
   */
  if (message.method === undefined && message.id !== undefined) {
    const held = waiting.get(message.id);
    if (held === undefined) return;
    waiting.delete(message.id);
    if (message.error !== undefined) held.reject(new Error(String(message.error.message ?? 'the request failed')));
    else held.resolve(message.result);
    return;
  }

  switch (message.method) {
    case 'initialize':
      respond(message.id, {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          sessionCapabilities: { list: {}, resume: {} },
        },
        authMethods: [],
      });
      return;

    case 'session/new': {
      const id = nextSession();
      if (typeof message.params?.cwd === 'string' && message.params.cwd !== '') cwd = message.params.cwd;
      respond(message.id, { sessionId: id, modes: modes(), configOptions: configOptions() });
      return;
    }

    case 'session/load': {
      // The loaded id is the one the request named, so every update after it
      // belongs to the conversation the client asked to continue.
      session = String(message.params?.sessionId ?? nextSession());
      if (typeof message.params?.cwd === 'string' && message.params.cwd !== '') cwd = message.params.cwd;
      respond(message.id, { modes: modes(), configOptions: configOptions() });
      return;
    }

    case 'session/list':
      respond(message.id, { sessions: LISTED });
      return;

    case 'session/set_mode':
      mode = String(message.params?.modeId ?? mode);
      respond(message.id, {});
      notify({ sessionUpdate: 'current_mode_update', currentModeId: mode });
      return;

    case 'session/set_config_option':
      model = String(message.params?.value ?? model);
      respond(message.id, { configOptions: configOptions() });
      notify({ sessionUpdate: 'config_option_update', configOptions: configOptions() });
      return;

    case 'session/prompt':
      // Not awaited: a port script answers over later lines, and the reader
      // must stay free to deliver them.
      void respondPrompt(message.id, message.params);
      return;

    case 'session/cancel':
      if (pending !== undefined) {
        const id = pending;
        pending = undefined;
        respond(id, { stopReason: 'cancelled' });
      }
      return;

    default:
      if (message.id !== undefined) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
      }
  }
};

createInterface({ input: process.stdin }).on('line', onLine);
