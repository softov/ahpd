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
 * - text containing `ponder` thinks, calls a tool, thinks again in two chunks
 *   and answers in two, which is a turn whose parts interleave;
 * - text containing `blank` thinks, writes a message that is one space, calls
 *   a tool, thinks again and answers in chunks that start with whitespace;
 * - text containing `tool` opens a tool call with its input and completes it;
 * - text containing `client` reports one call per `client=<name>` /
 *   `ctitle=<title>` pair, so a call a client's tool is reported under a name,
 *   a title alone, or both; it reports them `pending` and never runs them when
 *   the text also says `cstatus=pending`, and announces and finishes one in a
 *   single update when it says `cdone`;
 * - text containing `read` asks the client for a file and says what it got;
 * - text containing `write` asks it to write one and says it did;
 * - text containing `term` opens a terminal, waits for it, reads it, releases it;
 * - text containing `ask` asks for permission on a destructive call and reports
 *   which option came back;
 * - text containing `hold` asks for permission on a call it is still holding,
 *   which is `pending`, and reports which option came back; `ctool=<name>` gives
 *   that call the programmatic name it asks about, as an agent that reached a
 *   tool of the host's MCP server would;
 * - text containing `mrep=` or `mreq=` is the two halves of a client tool call:
 *   `mrep=<id>=<tool>=<json|->` reports one to the client, with `-` for a call
 *   reported with no arguments at all, and `mreq=<tool>=<json>=<id|->` makes it
 *   over HTTP on the host's own MCP server, with `<id>` as the call the request
 *   names in its `_meta` or `-` for none. Every report goes out
 *   before the first request, with a file read between them so that the reports
 *   are on the session before anything is paired, and each request's MCP result
 *   is said as one `mcp=<url-encoded JSON>` chunk, so a test can read exactly
 *   what the agent was told. The rows the reports opened are completed once the
 *   requests are answered, which is the order an agent works in;
 * - text containing `jump` sends the update that ends a call as the first word
 *   about it, so the bridge never hears a `tool_call` for it at all;
 * - text containing `paint` opens a shell, really writes a file beside the
 *   session and ends a call with that shell and that file as its content;
 * - text containing `away` ends a call with a diff of a path outside the
 *   session's directories, which is written nowhere;
 * - text containing `plan` sends two `plan` updates, the second with the first's
 *   entries moved on;
 * - text containing `name` sends a `session_info_update` naming the session;
 * - text containing `shift` moves the mode and the model by itself, saying so
 *   with a `current_mode_update` and a `config_option_update`;
 * - text containing `reauth` answers the prompt with the protocol's
 *   `auth_required`, which is what a server whose sign-in went stale says;
 * - text containing `spend` sends two `usage_update`s carrying a session cost
 *   that rises, and answers with per-turn counts when the text also says
 *   `tokens`;
 * - text containing `window` sends a `usage_update` that carries the context and
 *   no cost at all;
 * - text containing `wait` emits one chunk and then holds the prompt open
 *   until `session/cancel` arrives, answering `cancelled` only then;
 * - text containing `fail` streams the plain answer and then answers the
 *   prompt with a JSON-RPC error;
 * - text containing `die` streams the plain answer and then exits with code 3,
 *   leaving the prompt unanswered;
 * - text containing `stop=<reason>` answers the prompt with that stop reason
 *   rather than `end_turn`, so a turn that stopped early can be told apart from
 *   one that finished;
 * - text containing `blocks` reports the content blocks the prompt arrived in,
 *   as `blocks=text|image|resource` with each block's text or its URI, so a
 *   test can read exactly what a client sent;
 * - text containing `chatter` says one line on stderr and answers normally, so
 *   a test can read that a healthy server's noise never reaches a client;
 * - text containing `noisy` says two lines on stderr and then exits with code
 *   4, so a test can read what a failing server left behind;
 * - anything else streams two message chunks before ending.
 *
 * The port scripts are real requests *to* the client - `fs/read_text_file`,
 * `fs/write_text_file`, `terminal/*`, `session/request_permission` - awaited
 * on their answers, which is what makes them a test of the client half rather
 * than of this server.
 *
 * Beside the prompt scripts it answers the session lifecycle a catalogue and a
 * config want: `session/list`, `session/load`, `session/set_mode`,
 * `session/set_config_option` and `session/set_model`, with the modes and the
 * config options a real server names on `session/new`: a model, a select and a
 * boolean of its own.
 *
 * `--legacy` makes it a server from before config options: `session/new` names
 * its models in a `models` list beside the session rather than as an option, so
 * the model is set by `session/set_model`.
 *
 * `--modes` adds a `mode` option to the config options, which is the newer
 * account of the same thing the legacy modes carry: a client sets the mode
 * through `session/set_config_option` rather than `session/set_mode`.
 *
 * Two flags take one capability away: `--no-load` makes the handshake stop
 * advertising `loadSession`, which is a server that cannot reopen a
 * conversation, and `--no-close` stops it advertising `session/close`.
 *
 * `--no-delete` stops the handshake advertising `sessionCapabilities.delete`,
 * which is a server that keeps every conversation it has been given, and
 * `--delete-fails` keeps the capability but answers every `session/delete` with
 * an error of its own, which is a server that admits to the request and cannot
 * carry it out.
 *
 * `--prompt-caps` advertises `promptCapabilities.image` and `embeddedContext`,
 * the two a client must ask for before it may send an image or an embedded
 * file in a prompt, and `--extra-dirs` advertises
 * `sessionCapabilities.additionalDirectories`. A server started without them
 * advertises neither, which is what a prompt and a session have to survive.
 *
 * `--pages` makes `session/list` answer in two pages, the first with a
 * `nextCursor`, which is what a server whose catalogue does not fit in one
 * answer looks like.
 *
 * `--no-http-mcp` stops the handshake advertising that it takes an MCP server
 * over HTTP, which is what makes a client leave those out of the list it hands
 * the server on `session/new`.
 *
 * `--signin` makes it a server that has to be signed in first: the handshake
 * offers the `api-key` method and `session/new` answers `auth_required` until
 * `authenticate` has named it.
 *
 * `--signin-fails` is a server that offers the same method and refuses the
 * sign-in itself, which is a different thing: `authenticate` answers with an
 * error of its own and the session is never reached.
 *
 * `--grandchild=<file>` starts a process of this server's own at startup and
 * writes its pid into that file, which is how a test reads what a close left
 * running.
 *
 * `--replay` makes `session/load` replay two earlier turns before it answers,
 * the way a server reads a conversation back: each turn's `user_message_chunk`
 * and then what the agent said for it.
 *
 * When `ACP_LOG` names a file, every request and notification that arrives is
 * appended to it as one JSON line, so a test can prove what the bridge actually
 * asked for - including the `clientCapabilities` it advertised - rather than
 * inferring it from state the bridge keeps. Each line carries this process's
 * pid, because a catalogue read spawns a server of its own that logs to the
 * same file.
 */

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
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

/** How hard this server thinks, and whether it reports what it did. */
let thinking = 'off';
let telemetry = false;

/**
 * The session config options, which is where ACP keeps a model choice.
 *
 * A model option and two of its own: a select and a boolean, neither of which
 * is the model or a mode, so a client draws each as a control of its own. A
 * `--modes` server names the mode as an option of its own as well, which is the
 * newer account of what the legacy modes carry.
 */
const configOptions = () => [
  {
    type: 'select',
    id: 'model',
    name: 'Model',
    category: 'model',
    currentValue: model,
    options: [
      { value: 'fast', name: 'Fast' },
      { value: 'thorough', name: 'Thorough' },
    ],
  },
  ...(process.argv.includes('--modes')
    ? [{
        type: 'select',
        id: 'mode',
        name: 'Mode',
        category: 'mode',
        currentValue: mode,
        options: [
          { value: 'ask', name: 'Ask' },
          { value: 'code', name: 'Code' },
        ],
      }]
    : []),
  {
    type: 'select',
    id: 'thinking',
    name: 'Thinking',
    category: 'thought_level',
    currentValue: thinking,
    options: [
      { value: 'off', name: 'Off' },
      { value: 'deep', name: 'Deep' },
    ],
  },
  { type: 'boolean', id: 'telemetry', name: 'Telemetry', currentValue: telemetry },
];

/**
 * The models a `--legacy` server names, which is how it named them before the
 * config options: a list beside the session rather than an option of its own.
 */
const listed = () => ({
  currentModelId: model,
  availableModels: [
    { modelId: 'fast', name: 'Fast' },
    { modelId: 'thorough', name: 'Thorough' },
  ],
});

/** The sessions `session/list` reports, one titled and one not. */
const LISTED = [
  { sessionId: 'listed-1', cwd: '/tmp/one', title: 'One', updatedAt: '2026-01-01T00:00:00.000Z' },
  { sessionId: 'listed-2', cwd: '/tmp/two', additionalDirectories: ['/tmp/two-b'] },
];

/**
 * The same two sessions as two pages, for a server whose catalogue does not fit
 * in one answer.
 *
 * The first answer carries a cursor and the second does not, which is what tells
 * a client that asked for the first one to come back for the rest. A bridge
 * that reads one page reports a catalogue of one session rather than a failure,
 * so this is the only way a test can see the difference.
 */
const paged = (cursor) => (cursor === undefined || cursor === null
  ? { sessions: LISTED.slice(0, 1), nextCursor: 'page-2' }
  : { sessions: LISTED.slice(1) });

/** The host's own MCP server, as `session/new` named it, once there is one. */
let hostTools;

/**
 * The host's own tools out of the servers a session was opened with.
 *
 * By the name the bridge gives it, because the list also holds whatever else
 * the deployment configured: what a script here reaches for is the host's.
 */
const named = (servers) => (Array.isArray(servers) ? servers : []).find((one) => one?.name === 'ahp');

/** How many requests this server has made on that MCP server. */
let called = 0;

/**
 * One `tools/call` on the host's own MCP server, awaited.
 *
 * A real HTTP request on the endpoint the session was handed, because that is
 * how an ACP agent reaches a tool of the host's: the server named at
 * `session/new` is the only way a client's tool is offered to it at all.
 */
const mcpCall = async (name, args, meta) => {
  called += 1;
  // The header as the session was told to present it: ACP carries an HTTP
  // server's headers as a list of names and values, which is where the token
  // the endpoint minted for this session is.
  const auth = (Array.isArray(hostTools.headers) ? hostTools.headers : [])
    .find((one) => String(one?.name ?? '').toLowerCase() === 'authorization');
  const response = await fetch(hostTools.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: String(auth?.value ?? '') },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: called,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        ...(meta === undefined ? {} : { _meta: { 'claudecode/toolUseId': meta } }),
      },
    }),
  });
  return await response.json();
};

/**
 * One `<marker>=<a>=<b>=<rest>` token, split on its first `n` equals signs.
 *
 * The last field is everything that is left, because the JSON a script names as
 * a call's arguments is the last thing in the token and may hold an `=` itself.
 */
const fields = (token, n) => {
  const out = [];
  let rest = token;
  for (let i = 0; i < n; i++) {
    const at = rest.indexOf('=');
    out.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  return [...out, rest];
};

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
 * What the session has cost so far, which every `usage_update` reports whole.
 *
 * ACP counts a cost for the session rather than for a turn, and the figure
 * starts above zero on purpose: a client that had nothing to count from can
 * only tell what a turn spent by subtracting what the session had spent before
 * it began, and a fixture whose books start at nought cannot prove it did. The
 * charges are quarters as well, so a difference is a difference and not an
 * artefact of what a tenth of a dollar is in binary.
 */
let spent = 1;

/** One `usage_update`, with `cost` risen by what this call was charged. */
const charge = (amount) => {
  spent += amount;
  return {
    sessionUpdate: 'usage_update',
    // The context window, which is not usage: a bridge that read these as
    // tokens spent would report what the model is holding rather than what it
    // was charged for.
    used: 4200,
    size: 200000,
    cost: { amount: spent, currency: 'USD' },
  };
};

/**
 * The counts a prompt response carries, for a prompt that asked for them.
 *
 * Marked unstable in the protocol and optional in practice, so a test has to be
 * able to have a response without them as well as one with.
 */
const countedFor = (text) => (text.includes('tokens')
  ? {
      usage: {
        totalTokens: 1530,
        inputTokens: 1000,
        outputTokens: 400,
        thoughtTokens: 80,
        cachedReadTokens: 40,
        cachedWriteTokens: 10,
      },
    }
  : {});

/**
 * The stop reason a prompt asks this server to end it with.
 *
 * `stop=<reason>` anywhere in the prompt text, which covers every reason the
 * protocol names and any a later version adds - a fixture with one keyword per
 * reason would need editing for each one, and what a test is checking is that
 * the bridge ends a turn the way the reason it was handed says to. A prompt
 * that names none is `end_turn`, which is what this server does anyway.
 */
const stopReasonOf = (text) => {
  const asked = /stop=([a-z_]+)/.exec(text);
  return asked === null ? 'end_turn' : asked[1];
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

  /** A directory listed and its result, the call the interleaved scripts make. */
  const listing = [
    {
      sessionUpdate: 'tool_call',
      toolCallId: 'call-2',
      title: 'List a directory',
      name: 'list_dir',
      kind: 'read',
      status: 'in_progress',
      rawInput: { path: '/tmp' },
    },
    {
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-2',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'a.txt' } }],
    },
  ];
  const thought = (said) => ({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: said } });
  const message = (said) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: said } });

  if (text.includes('ponder')) {
    updates.push(thought('first thought'), ...listing, thought('second '), thought('thought'));
    updates.push(message('the '), message('answer'));
    return updates;
  }

  if (text.includes('blank')) {
    updates.push(thought('first thought'), message(' '), ...listing, thought('second thought'));
    updates.push(message(' '), message('\n'), message('the answer'));
    return updates;
  }

  if (text.includes('think')) {
    updates.push({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'weighing it up' } });
  }

  /*
   * A call the agent reports the way it reports a tool of the host's MCP
   * server: `client=<name>` names it, `ctitle=<title>` gives it a title alone,
   * and one call is reported per pair of them in the order they were written.
   * The title spelling is separate because an agent that names no `name` is
   * the whole reason a title is read at all.
   */
  if (text.includes('client')) {
    const names = [...text.matchAll(/client=(\S+)/g)].map((one) => one[1]);
    const titles = [...text.matchAll(/ctitle=(\S+)/g)].map((one) => one[1]);
    // A call the agent is still holding: said, and never started or finished.
    const held = text.includes('cstatus=pending');
    // A call the agent announced and finished in one update, so nobody is left
    // holding anything to run.
    const whole = text.includes('cdone');
    const count = Math.max(names.length, titles.length);
    for (let i = 0; i < count; i++) {
      const toolCallId = `call-client-${i + 1}`;
      updates.push({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: titles[i] ?? 'A client tool',
        ...(names[i] === undefined ? {} : { name: names[i] }),
        kind: 'other',
        status: held ? 'pending' : whole ? 'completed' : 'in_progress',
        rawInput: { path: '/a.txt' },
        ...(whole ? { content: [{ type: 'content', content: { type: 'text', text: 'the client did it' } }] } : {}),
      });
      if (held || whole) continue;
      updates.push({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'the client did it' } }],
      });
    }
    updates.push(message('the client answered'));
    return updates;
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

  if (text.includes('spend')) {
    updates.push(charge(0.25), charge(0.5));
  }

  if (text.includes('window')) {
    // A usage update with no cost, which the protocol allows: all a server can
    // say here is how full its context is.
    updates.push({ sessionUpdate: 'usage_update', used: 4200, size: 200000 });
    return updates;
  }

  updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } });
  updates.push({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' there' } });
  return updates;
};

/** The choices a permission offers, in the order the protocol puts them. */
const PERMISSION = [
  { optionId: 'yes-once', name: 'Allow once', kind: 'allow_once' },
  { optionId: 'yes-always', name: 'Always allow', kind: 'allow_always' },
  { optionId: 'no-once', name: 'Reject once', kind: 'reject_once' },
];

/** The prompt this server is holding open, waiting for a cancel. */
let pending = undefined;

/** Whether a `--signin` server has been signed in, and so will open a session. */
let signedIn = false;

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
  const reaches = [
    'read', 'write', 'term', 'ask', 'hold', 'jump', 'paint', 'away', 'plan', 'name', 'shift', 'reauth', 'mrep=', 'mreq=',
  ].some((one) => text.includes(one));
  if (!reaches) for (const update of scriptFor(text)) notify(update);
  if (text.includes('chatter')) {
    process.stderr.write('a line the server said to nobody\n');
  }
  if (text.includes('fail')) {
    write({ jsonrpc: '2.0', id, error: { code: -32603, message: 'the model gave up' } });
    return;
  }
  if (text.includes('die')) {
    process.exit(3);
  }
  if (text.includes('noisy')) {
    // Exiting from the write's own callback, because `process.exit` truncates a
    // pipe it has not flushed and the trace under the code is the point.
    process.stderr.write(
      'the model backend refused the request\n    at Backend.send (backend.js:41)\n',
      () => { process.exit(4); },
    );
    return;
  }
  if (text.includes('wait')) {
    // Held open, and answered only by the cancel below: a test that sees this
    // turn end at all has proven the notification reached the server.
    pending = id;
    return;
  }

  if (text.includes('blocks')) {
    const blocks = Array.isArray(params?.prompt) ? params.prompt : [];
    // One block as `<type>:<what it carries>`, which is enough to tell an image
    // block from a text block naming the same image.
    const said = blocks.map((block) => {
      const what = block?.type === 'text'
        ? String(block.text ?? '')
        : String(block?.uri ?? block?.resource?.uri ?? '');
      return `${block?.type}:${what}`;
    });
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `blocks=${said.join('|')}` } });
  }

  if (text.includes('plan')) {
    // Two plans over one turn, which is what an agent running a plan sends: the
    // whole list each time, with the entries' statuses moved on.
    const planned = (entries) => notify({ sessionUpdate: 'plan', entries });
    planned([
      { content: 'Read the file', priority: 'high', status: 'in_progress' },
      { content: 'Write the answer', priority: 'medium', status: 'pending' },
    ]);
    planned([
      { content: 'Read the file', priority: 'high', status: 'completed' },
      { content: 'Write the answer', priority: 'medium', status: 'in_progress' },
    ]);
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'planned' } });
  }

  if (text.includes('shift')) {
    // Two config values the agent moves by itself, said the way a server says
    // it moved them: the mode as its own update and the model as the options
    // list that now names it.
    mode = 'code';
    model = 'thorough';
    notify({ sessionUpdate: 'current_mode_update', currentModeId: mode });
    notify({ sessionUpdate: 'config_option_update', configOptions: configOptions() });
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'shifted' } });
  }

  if (text.includes('name')) {
    // What the agent calls the conversation, which is a `session_info_update`
    // and not a turn's word: it names the session rather than answering.
    notify({ sessionUpdate: 'session_info_update', title: 'Naming the work' });
  }

  if (text.includes('reauth')) {
    // A prompt that finds the session no longer signed in, which is what the
    // protocol's `auth_required` is: the same code `session/new` answered with
    // above, asked of a turn this time.
    write({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Authentication required' } });
    return;
  }

  if (text.includes('mrep=') || text.includes('mreq=')) {
    /*
     * One client tool call, as the two things that arrive for it and name each
     * other nowhere: the updates the agent reports, and the `tools/call`s it
     * makes on the host's own MCP server.
     *
     * All the reports go out before the first request, and a file is read
     * between the two. That read is a round trip on this server's own pipe, so
     * by the time it is answered the bridge has read every report and put it on
     * the session - which is what stops a request from being paired against a
     * session that has not heard of the calls yet.
     */
    const reports = [...text.matchAll(/(mrep=\S+)/g)].map((one) => fields(one[1], 3));
    const requests = [...text.matchAll(/(mreq=\S+)/g)].map((one) => fields(one[1], 3));
    for (const [, toolCallId, tool, args] of reports) {
      notify({
        sessionUpdate: 'tool_call',
        toolCallId,
        title: tool,
        name: `mcp__ahp__${tool}`,
        kind: 'other',
        status: 'in_progress',
        // `-` for a report that says no arguments, which an agent need not: a
        // call announced with a title alone is one nothing here knows the
        // arguments of.
        ...(args === '-' ? {} : { rawInput: JSON.parse(args) }),
      });
    }
    if (reports.length > 0 && requests.length > 0) {
      await ask('fs/read_text_file', { sessionId: session, path: `${cwd}/note.txt` });
    }
    for (const [, tool, args, meta] of requests) {
      /*
       * One request at a time, awaited before the next is made.
       *
       * That is the order an agent works in, and it is what lets a test tell
       * one request from the next: the second is not on the wire until the
       * first has been answered.
       */
      const answer = await mcpCall(tool, JSON.parse(args), meta === '-' ? undefined : meta);
      // Encoded, and on a line of its own: one result is one word a test can
      // cut out of the prose whatever the agent's own words are, and the line
      // is what stops one result running into the next.
      const said = encodeURIComponent(JSON.stringify({
        isError: answer?.result?.isError === true,
        content: answer?.result?.content ?? answer?.error ?? null,
      }));
      notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `\nmcp=${said}` } });
    }
    // The rows the reports opened, finished once the tools they were for came
    // back - the order an agent works in.
    for (const [, toolCallId, tool] of reports) {
      notify({
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: `ran ${tool}` } }],
      });
    }
    respond(id, { stopReason: 'end_turn' });
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
      options: PERMISSION,
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

  if (text.includes('hold')) {
    /*
     * A call the agent is still holding when it asks about it.
     *
     * `pending` is what the protocol calls a call the agent has not started, so
     * nothing about this turn says nobody will be asked before the question
     * arrives - and it does arrive, which is the whole of what a test reads.
     *
     * The update carrying the arguments and the status goes out while the
     * question is standing, which is the one moment a `not-needed` behind the
     * question would be a lie.
     */
    const toolCall = {
      toolCallId: 'call-hold',
      title: 'Drop a branch',
      name: /ctool=(\S+)/.exec(text)?.[1] ?? 'drop_branch',
      kind: 'delete',
      status: 'pending',
      rawInput: { branch: 'main' },
    };
    notify({ sessionUpdate: 'tool_call', ...toolCall });
    const asking = ask('session/request_permission', {
      sessionId: session,
      toolCall,
      options: PERMISSION,
    });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-hold',
      status: 'in_progress',
      rawInput: { branch: 'main', force: true },
    });
    const answer = await asking;
    const chosen = answer?.outcome?.outcome === 'selected' ? String(answer.outcome.optionId) : 'cancelled';
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-hold',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: `answer=${chosen}` } }],
    });
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `perm=${chosen}` } });
  }

  if (text.includes('later')) {
    /*
     * A call announced `pending` with its arguments, and the update that starts
     * it carrying a status alone.
     *
     * The arguments arrived on the first announcement, so the ready that
     * follows the status is the only place a client can read them.
     */
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-later',
      title: 'Fetch the page',
      name: 'fetch',
      status: 'pending',
      rawInput: { url: 'https://example.test/page' },
    });
    notify({ sessionUpdate: 'tool_call_update', toolCallId: 'call-later', status: 'in_progress' });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-later',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'fetched' } }],
    });
  }

  if (text.includes('whole')) {
    /*
     * A call announced and finished in the one update: the protocol allows it,
     * and a bridge that only opens a row on a later update would never draw it.
     */
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-whole',
      title: 'Read the whole file',
      name: 'read_whole',
      status: 'completed',
      rawInput: { path: '/tmp/b.txt' },
      content: [{ type: 'content', content: { type: 'text', text: 'the whole body' } }],
    });
  }

  if (text.includes('jump')) {
    // The update that ends a call as the first word about it: a server that
    // announced nothing, so a bridge that only opens a row on a `tool_call`
    // would close one nobody ever saw.
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-jump',
      title: 'Count the lines',
      name: 'count_lines',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: '42' } }],
    });
  }

  if (text.includes('paint')) {
    /*
     * A call whose result is a shell and an edit.
     *
     * The terminal is one the host opened for this server, so its id is a host
     * terminal URI already, and the file is really written beside the session
     * before the update that names it, so a changeset reading either side of it
     * has something to read.
     */
    const created = await ask('terminal/create', {
      sessionId: session, command: 'echo', args: ['painted'], cwd,
    });
    const terminalId = String(created?.terminalId ?? '');
    const path = `${cwd}/painted.txt`;
    // The file as it was, then as it is: a diff carries both sides in words,
    // and by the time it arrives the file itself only holds the new one.
    writeFileSync(path, 'a blank canvas\n');
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-paint',
      title: 'Paint and preview',
      name: 'paint',
      status: 'in_progress',
      rawInput: { path },
    });
    writeFileSync(path, 'a line of paint\n');
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-paint',
      status: 'completed',
      content: [
        { type: 'terminal', terminalId },
        { type: 'diff', path, oldText: 'a blank canvas\n', newText: 'a line of paint\n' },
      ],
    });
    await ask('terminal/release', { sessionId: session, terminalId });
  }

  if (text.includes('away')) {
    /*
     * A diff of a path outside the session's own directories.
     *
     * Nothing is written: the bridge is meant to show this one and leave it out
     * of the changeset, so a file appearing here would prove nothing.
     */
    const outside = `${cwd}/../elsewhere.txt`;
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-away',
      title: 'Edit something else',
      name: 'edit_elsewhere',
      status: 'in_progress',
      rawInput: { path: outside },
    });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-away',
      status: 'completed',
      content: [{ type: 'diff', path: outside, oldText: '', newText: 'elsewhere\n' }],
    });
  }

  respond(id, { stopReason: stopReasonOf(text), ...countedFor(text) });
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

/**
 * The two turns a `--replay` server reads back before answering a load.
 *
 * The order is the spec's: the user's message, then what the agent said for
 * it, and then the next user message. A client that splits on the user chunk
 * reads two turns out of this rather than one long answer.
 *
 * The first message arrives in two chunks, as any message longer than one block
 * does: a bridge that starts a turn on each `user_message_chunk` reads three
 * turns here and has split one message in two.
 */
const replayed = () => {
  const said = (who, text) => notify({ sessionUpdate: who, content: { type: 'text', text } });
  said('user_message_chunk', 'what did we ');
  said('user_message_chunk', 'decide?');
  said('agent_message_chunk', 'we chose the fast one');
  said('user_message_chunk', 'and the slow one?');
  said('agent_thought_chunk', 'weighing it up');
  said('agent_message_chunk', 'we left it for later');
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

  if (LOG !== undefined) appendFileSync(LOG, `${JSON.stringify({ pid: process.pid, method: message.method, params: message.params })}\n`);

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
          ...(process.argv.includes('--no-load') ? {} : { loadSession: true }),
          mcpCapabilities: { http: !process.argv.includes('--no-http-mcp') },
          ...(process.argv.includes('--prompt-caps')
            ? { promptCapabilities: { image: true, embeddedContext: true } }
            : {}),
          sessionCapabilities: {
            list: {},
            resume: {},
            ...(process.argv.includes('--no-close') ? {} : { close: {} }),
            ...(process.argv.includes('--no-delete') ? {} : { delete: {} }),
            ...(process.argv.includes('--extra-dirs') ? { additionalDirectories: {} } : {}),
          },
        },
        authMethods: process.argv.includes('--signin') || process.argv.includes('--signin-fails') ? [{ id: 'api-key', name: 'API key' }] : [],
      });
      if (process.argv.includes('--auth-account')) write({ jsonrpc: '2.0', method: '_auth/status_update', params: { authStatus: { kind: 'account', account: { email: 'codex@example.com' }, label: 'ChatGPT' } } });
      if (process.argv.includes('--auth-key')) write({ jsonrpc: '2.0', method: '_auth/status_update', params: { authStatus: { kind: 'api_key', label: 'API key' } } });
      if (process.argv.includes('--auth-project')) write({ jsonrpc: '2.0', method: '_auth/status_update', params: { authStatus: { kind: 'account', account: { email: `${process.cwd().split('/').at(-1)}@example.com` }, label: 'ChatGPT' } } });
      return;

    case 'authenticate':
      // The protocol's own `auth_required`, by the code the SDK's
      // `RequestError.authRequired` carries, which is what the bridge reads.
      if (message.params?.methodId !== 'api-key') {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } });
        return;
      }
      // A key the server has decided against, said as this server says it and
      // by the same code, so a client cannot tell a refusal from a request for
      // a sign-in by the code alone.
      if (process.argv.includes('--signin-fails')) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'That API key was rejected' } });
        return;
      }
      signedIn = true;
      respond(message.id, {});
      return;

    case 'session/new': {
      if (process.argv.includes('--signin') && !signedIn) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Authentication required' } });
        return;
      }
      const id = nextSession();
      if (typeof message.params?.cwd === 'string' && message.params.cwd !== '') cwd = message.params.cwd;
      hostTools = named(message.params?.mcpServers);
      // Started with `--books`, the server says what the session had already
      // cost before any turn, before it answers, the way `session/load`
      // replays a resumed conversation before its response.
      if (process.argv.includes('--books')) notify(charge(0));
      respond(message.id, process.argv.includes('--legacy')
        ? { sessionId: id, modes: modes(), models: listed() }
        : { sessionId: id, modes: modes(), configOptions: configOptions() });
      return;
    }

    case 'session/load': {
      // The loaded id is the one the request named, so every update after it
      // belongs to the conversation the client asked to continue.
      session = String(message.params?.sessionId ?? nextSession());
      if (typeof message.params?.cwd === 'string' && message.params.cwd !== '') cwd = message.params.cwd;
      hostTools = named(message.params?.mcpServers);
      if (process.argv.includes('--replay')) replayed();
      respond(message.id, process.argv.includes('--legacy')
        ? { modes: modes(), models: listed() }
        : { modes: modes(), configOptions: configOptions() });
      return;
    }

    case 'session/list':
      respond(message.id, process.argv.includes('--pages')
        ? paged(message.params?.cursor)
        : { sessions: LISTED });
      return;

    case 'session/set_mode':
      mode = String(message.params?.modeId ?? mode);
      respond(message.id, {});
      notify({ sessionUpdate: 'current_mode_update', currentModeId: mode });
      return;

    case 'session/set_config_option': {
      // Each option is set under its own id, so a test can read what the bridge
      // asked for rather than what it meant.
      const asked = String(message.params?.configId ?? '');
      const value = message.params?.value;
      if (asked === 'model') model = String(value ?? model);
      if (asked === 'mode') mode = String(value ?? mode);
      if (asked === 'thinking') thinking = String(value ?? thinking);
      if (asked === 'telemetry') telemetry = value === true;
      respond(message.id, { configOptions: configOptions() });
      notify({ sessionUpdate: 'config_option_update', configOptions: configOptions() });
      return;
    }

    case 'session/set_model':
      // The call a `--legacy` server takes a model through, which the SDK's
      // agent no longer names and which this fixture answers anyway.
      model = String(message.params?.modelId ?? model);
      respond(message.id, {});
      return;

    case 'session/prompt':
      // Not awaited: a port script answers over later lines, and the reader
      // must stay free to deliver them.
      void respondPrompt(message.id, message.params);
      return;

    case 'session/close':
      respond(message.id, {});
      return;

    case 'session/delete': {
      // A server that cannot delete, for a client that has to tell that apart
      // from one that has already forgotten.
      if (process.argv.includes('--delete-fails')) {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'The store is read only' } });
        return;
      }
      // Which sessions this server holds, so a delete is a real removal rather
      // than an acknowledgement: a second delete of the same id is refused the
      // way a server refuses one it has no such session for.
      const gone = String(message.params?.sessionId ?? '');
      const at = LISTED.findIndex((one) => one.sessionId === gone);
      if (at < 0) {
        // The protocol's own `RequestError.resourceNotFound` code, which is how
        // a server says the thing is not there.
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: `Resource not found: ${gone}` } });
        return;
      }
      LISTED.splice(at, 1);
      respond(message.id, {});
      return;
    }

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

/*
 * A process of this server's own, for a test of what a close leaves behind.
 *
 * Not detached, so it lands in the group the bridge spawned this server into,
 * which is what a signal to that group has to reach. Its pid goes into the
 * file the flag named, because a test cannot see this server's children any
 * other way.
 */
const grandchild = process.argv.find((one) => one.startsWith('--grandchild='));
if (grandchild !== undefined) {
  const spawned = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], { stdio: 'ignore' });
  writeFileSync(grandchild.slice('--grandchild='.length), String(spawned.pid));
}

createInterface({ input: process.stdin }).on('line', onLine);
