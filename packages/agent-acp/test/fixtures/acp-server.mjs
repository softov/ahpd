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
 * - text containing `elicitform` asks the client for a form on a call it is
 *   making, with one field of each shape the protocol names, and says what the
 *   answer carried back as `elicit=<action>|branch=…|force=…|retries=…|mode=…|tags=…`;
 * - text containing `elicitother` asks for a form of the questions codex-acp
 *   marks open to an answer of one's own - one with a note field beside it and
 *   one without - beside a plain field, and says what the answer carried back
 *   as `elicit=<action>|branch=…|mode=…|note=…|size=…`;
 * - text containing `eliciturl` asks for a page rather than a form, then says
 *   the page is complete by itself, and reports `elicit=<action>|content=<none|some>`;
 * - text containing `elicitcancel` asks a form and holds the prompt until
 *   `session/cancel` ends it, so a turn stopped while a question stands is one a
 *   test can watch from both sides;
 * - text containing `elicitwithdraw` asks a form and takes it back with
 *   `$/cancel_request` once the question has been drawn, `elicitaborted` takes
 *   it back in the same breath so the request is over before it is handled, and
 *   both hold the prompt as `elicitcancel` does; `elicitwdafter` withdraws the
 *   same request only once it has been answered, which is a server giving up on
 *   a question that is already over;
 * - text containing `elicitunknown` asks a form with a field whose `type` ACP
 *   does not name, and says what came back for it, which is the field the
 *   bridge has no control of its own for;
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
 * - text containing `linger` opens a shell, ends a call with it as the content
 *   and leaves it running past both the call and the turn;
 * - text containing `unspoken` opens a shell that no call ever names, so the
 *   turn's end is what lists it;
 * - text containing `brief` waits for its shell to exit before ending the call
 *   that names it, so the call is over a process that already is;
 * - text containing `fade` opens a shell that exits once the file `fade-away`
 *   appears beside the session, which the test writes;
 * - text containing `release` opens a shell, ends the call that names it and
 *   releases the terminal while the process still runs;
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
 * - text containing `erroratend` does whatever else the text asks and then
 *   answers the prompt with a JSON-RPC error, so a turn fails after its calls;
 * - text containing `blocks` reports the content blocks the prompt arrived in,
 *   as `blocks=text|image|resource` with each block's text or its URI - a
 *   resource block saying its URI and then its own text on the next line - so a
 *   test can read exactly what a client sent;
 * - text containing `chatter` says one line on stderr and answers normally, so
 *   a test can read that a healthy server's noise never reaches a client;
 * - text containing `noisy` says two lines on stderr and then exits with code
 *   4, so a test can read what a failing server left behind;
 * - anything else streams two message chunks before ending.
 *
 * The port scripts are real requests *to* the client - `fs/read_text_file`,
 * `fs/write_text_file`, `terminal/*`, `session/request_permission`,
 * `elicitation/create` - awaited
 * on their answers, which is what makes them a test of the client half rather
 * than of this server.
 *
 * Beside the prompt scripts it answers the session lifecycle a catalogue and a
 * config want: `session/list`, `session/load`, `session/resume`,
 * `session/set_mode`, `session/set_config_option` and `session/set_model`,
 * with the modes and the config options a real server names on `session/new`:
 * a model, a select and a boolean of its own. `session/resume` is the one
 * lifecycle call that replays nothing, which is the whole difference between
 * it and `session/load`.
 *
 * `--legacy` makes it a server from before config options: `session/new` names
 * its models in a `models` list beside the session rather than as an option, so
 * the model is set by `session/set_model`.
 *
 * `--modes` adds a `mode` option to the config options, which is the newer
 * account of the same thing the legacy modes carry: a client sets the mode
 * through `session/set_config_option` rather than `session/set_mode`.
 *
 * Three flags take one capability away: `--no-load` makes the handshake stop
 * advertising `loadSession`, which is a server that cannot reopen a
 * conversation, `--no-resume` stops it advertising
 * `sessionCapabilities.resume`, which is a server a conversation cannot be
 * taken back from without a replay, and `--no-close` stops it advertising
 * `session/close`.
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
 * `--fork` advertises `sessionCapabilities.fork`, which is the capability ACP
 * marks unstable and most servers do not offer: `session/fork` answers with a
 * session id of its own and leaves the conversation it copied alone. A server
 * started without it has no fork to give.
 *
 * `--signin` makes it a server that has to be signed in first: the handshake
 * offers the `api-key` method and `session/new` answers `auth_required` until
 * `authenticate` has named it.
 *
 * `--signin-fails` is a server that offers the same method and refuses the
 * sign-in itself, which is a different thing: `authenticate` answers with an
 * error of its own and the session is never reached.
 *
 * `--auth-status=<kind>` makes it a server that reports its sign-in the way
 * `@agentclientprotocol/codex-acp` does: the handshake carries
 * `agentCapabilities._meta.authStatus`, and one `_auth/status_update` with a
 * `kind` of that name goes out as soon as the handshake is answered. A
 * `--auth-silent` server sends the same update and advertises nothing, which is
 * a server that reports a sign-in it never said it would.
 *
 * `--grandchild=<file>` starts a process of this server's own at startup and
 * writes its pid into that file, which is how a test reads what a close left
 * running.
 *
 * `--replay` makes `session/load` replay two earlier turns before it answers,
 * the way a server reads a conversation back: each turn's `user_message_chunk`
 * and then what the agent said for it.
 *
 * When `ACP_LOG` names a file, every message that arrives is appended to it as
 * one JSON line, so a test can prove what the bridge actually asked for and
 * what it answered - including the `clientCapabilities` it advertised - rather
 * than inferring either from state the bridge keeps. A request or a
 * notification is logged as its method and its params, and a response as the
 * id and the result or the error it answers with. Each line carries this
 * process's pid, because a catalogue read spawns a server of its own that logs
 * to the same file.
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

/** The file every request is recorded in, when a test named one. */
const LOG = process.env.ACP_LOG;

/**
 * What this server reports its sign-in as, by the kind it was started with.
 *
 * The shapes are `@agentclientprotocol/codex-acp`'s: an `account` carries the
 * email and the plan of the sign-in it is, a `gateway` may name the provider it
 * goes through, and every one of them carries a label of its own for a client
 * to draw.
 */
const AUTH_STATUSES = {
  account: { kind: 'account', label: 'ChatGPT Max', account: { email: 'ana@example.test', plan: 'max' } },
  api_key: { kind: 'api_key', label: 'OpenAI API key' },
  gateway: { kind: 'gateway', label: 'Custom model gateway', detail: 'an internal gateway' },
  none: { kind: 'none', label: 'Not logged in' },
  external: { kind: 'external', label: 'AWS Bedrock' },
};

/** The kind this server was started to report, or nothing when it reports none. */
const authStatus = process.argv.find((one) => one.startsWith('--auth-status='));

/**
 * Whether the handshake says this server reports its sign-in at all.
 *
 * A server started with `--auth-silent` sends the update without this, which is
 * one that reports a sign-in it never said it would.
 */
const announcesAuth = authStatus !== undefined && !process.argv.includes('--auth-silent');

/** The session id this server names; one process serves one conversation. */
let session = 'acp-session-1';

/** Where the conversation works, as `session/new` was told. */
let cwd = '/tmp';

/**
 * The id a new session is given.
 *
 * Unique to the conversation, as a real server's is, because every bridge
 * session spawns its own server: a counter alone would name every conversation
 * `acp-session-1` and a process-wide catalogue would run them together. A pid
 * is not enough either, since Windows hands a gone process's pid to the next.
 */
const nextSession = () => {
  session = `acp-session-${randomUUID()}`;
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
const ask = (method, params) => askNamed(method, params).answered;

/**
 * The same, with the id this server's own request was given.
 *
 * A script that has to name its request again - to withdraw it with
 * `$/cancel_request`, which is addressed by that id - cannot read it off the
 * promise `ask` hands back, so the pair is returned rather than the answer
 * alone.
 */
const askNamed = (method, params) => {
  asked += 1;
  const id = `s${asked}`;
  const answered = new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
  });
  write({ jsonrpc: '2.0', id, method, params });
  return { id, answered };
};

/**
 * Withdraw a question this server asked.
 *
 * The protocol's own way of saying an outgoing request no longer wants an
 * answer, addressed by the id of that request: the client's handler for it is
 * aborted, and the response that comes back is the request being given up on.
 */
const withdraw = (requestId) => {
  write({ jsonrpc: '2.0', method: '$/cancel_request', params: { requestId } });
};

/**
 * Ask a question and withdraw it in the same write.
 *
 * One write puts both frames in one chunk on the pipe, so the client reads the
 * withdrawal before its handler for the question runs. Two writes are two
 * chunks a loaded client can read apart, and the question is then handled
 * before the withdrawal arrives.
 */
const askWithdrawn = (method, params) => {
  asked += 1;
  const id = `s${asked}`;
  const answered = new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
  });
  process.stdout.write([
    { jsonrpc: '2.0', id, method, params },
    { jsonrpc: '2.0', method: '$/cancel_request', params: { requestId: id } },
  ].map((message) => `${JSON.stringify(message)}\n`).join(''));
  return answered;
};

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
      availableCommands: [{ name: 'plan', description: 'Draft a plan', input: { hint: 'What to plan' } }],
    });
  }
  const reaches = [
    'read', 'write', 'term', 'ask', 'hold', 'jump', 'paint', 'away', 'plan', 'name', 'shift', 'reauth', 'mrep=', 'mreq=',
    'execrun', 'elicitform', 'elicitother', 'eliciturl', 'elicitcancel', 'elicitunknown',
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
    /*
     * One block as `<type>:<what it carries>`, which is enough to tell an image
     * block from a text block naming the same image. A resource block says its
     * URI and then its own text on the next line, so a test can read the words
     * a client sent for a file as well as which file they are under.
     */
    const said = blocks.map((block) => {
      if (block?.type === 'text') return `text:${String(block.text ?? '')}`;
      if (block?.type === 'resource') {
        return `resource:${String(block.resource?.uri ?? '')}\n${String(block.resource?.text ?? '')}`;
      }
      return `${String(block?.type)}:${String(block?.uri ?? '')}`;
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

  if (text.includes('execrun')) {
    /*
     * A shell command the server asks about, in the shape codex-acp 1.13.1
     * sends it: an `execute` call whose raw input carries the command and its
     * folder. `nocmd` is the same call with no command line, and `alwaysonly`
     * one whose choices have no `allow_once`.
     */
    const toolCall = {
      toolCallId: 'call-run',
      title: 'Run a command',
      name: 'shell',
      kind: 'execute',
      status: 'in_progress',
      rawInput: text.includes('nocmd') ? { cwd } : { command: 'make test', cwd },
    };
    notify({ sessionUpdate: 'tool_call', ...toolCall });
    const answer = await ask('session/request_permission', {
      sessionId: session,
      toolCall,
      options: text.includes('alwaysonly')
        ? [{ optionId: 'yes-always', name: 'Always allow', kind: 'allow_always' }]
        : PERMISSION,
    });
    const chosen = answer?.outcome?.outcome === 'selected' ? String(answer.outcome.optionId) : 'cancelled';
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-run',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: `answer=${chosen}` } }],
    });
    notify({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `exec=${chosen}` } });
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

  if (text.includes('elicitform')) {
    /*
     * A form the server asks a person to fill in, on a call it is making.
     *
     * The schema carries one field of each shape the protocol names, so a test
     * reads what each becomes as a question: a required string under a title
     * with a sentence about it, a boolean, an integer with bounds, a select over
     * an untitled enum, and a multi-select over an array's items. The answer
     * comes back as the content the server was handed, every field said as
     * itself, so a client that dropped one or renamed one is visible here.
     */
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-elicit',
      title: 'Create a branch',
      name: 'create_branch',
      status: 'in_progress',
      rawInput: { branch: 'main' },
    });
    const answer = await ask('elicitation/create', {
      mode: 'form',
      sessionId: session,
      toolCallId: 'call-elicit',
      message: 'Where should the branch go?',
      requestedSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', title: 'Branch name', description: 'What to call it' },
          force: { type: 'boolean', description: 'Overwrite one that exists', default: false },
          retries: { type: 'integer', description: 'How many times to try', minimum: 1, maximum: 5 },
          mode: { type: 'string', description: 'How careful to be', enum: ['fast', 'careful'] },
          tags: { type: 'array', description: 'Labels to put on it', items: { type: 'string', enum: ['a', 'b'] } },
        },
        required: ['branch'],
      },
    });
    const content = answer?.content ?? {};
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `elicit=${String(answer?.action ?? 'none')}`
          + `|branch=${String(content.branch ?? '-')}`
          + `|force=${String(content.force ?? '-')}`
          + `|retries=${String(content.retries ?? '-')}`
          + `|mode=${String(content.mode ?? '-')}`
          + `|tags=${Array.isArray(content.tags) ? content.tags.join('+') : String(content.tags ?? '-')}`,
      },
    });
  }

  if (text.includes('elicitother')) {
    /*
     * A question that takes an answer of one's own, as codex-acp writes one.
     *
     * The adapter marks such a field `isOther` on its own `_meta`, adds
     * `None of the above` to its options, and puts a note field beside it for
     * the words the person types - and it numbers the note field's name when a
     * question already has one, which is why `mode`'s is `mode_note2` rather
     * than `mode_note`: a client that matched on the name would draw it as a
     * question of its own, and one that matched on the `questionId` would not.
     * `size` is marked and given no note field at all, and `branch` is a plain
     * field, so a form with one of these in it is otherwise unchanged.
     *
     * The answer comes back as the content the server was handed, so a test
     * reads where a typed answer went rather than taking the bridge's word for
     * it.
     */
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-other',
      title: 'Pick a branch',
      name: 'pick_branch',
      status: 'in_progress',
      rawInput: { branch: 'main' },
    });
    const answer = await ask('elicitation/create', {
      mode: 'form',
      sessionId: session,
      toolCallId: 'call-other',
      message: 'How should the branch be made?',
      requestedSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', title: 'Branch name', description: 'What to call it' },
          mode: {
            type: 'string',
            description: 'How careful to be',
            oneOf: [
              { const: 'fast', title: 'Fast' },
              { const: 'careful', title: 'Careful' },
              {
                const: 'None of the above',
                title: 'None of the above',
                description: 'Provide a different answer in the note field.',
              },
            ],
            _meta: { codex: { isOther: true } },
          },
          mode_note2: {
            type: 'string',
            title: 'Additional answer or note',
            _meta: { codex: { questionId: 'mode', role: 'user_note' } },
          },
          size: {
            type: 'string',
            description: 'How large',
            oneOf: [
              { const: 'small', title: 'Small' },
              { const: 'large', title: 'Large' },
              {
                const: 'None of the above',
                title: 'None of the above',
                description: 'Provide a different answer in the note field.',
              },
            ],
            _meta: { codex: { isOther: true } },
          },
        },
        required: [],
      },
    });
    const content = answer?.content ?? {};
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `elicit=${String(answer?.action ?? 'none')}`
          + `|branch=${String(content.branch ?? '-')}`
          + `|mode=${String(content.mode ?? '-')}`
          + `|note=${String(content.mode_note2 ?? '-')}`
          + `|size=${String(content.size ?? '-')}`,
      },
    });
  }

  if (text.includes('eliciturl')) {
    /*
     * A page rather than a form: nobody fills anything in here, so the request
     * carries a URL and an id of the server's own, and the server says the page
     * is done by itself.
     *
     * The completion goes out while the question stands, which is what the
     * protocol asks a server to do once its own flow on the page has finished.
     * What comes back is what the bridge answered the request with: an accept
     * with no content, because there is nothing a person typed to carry.
     */
    const asking = ask('elicitation/create', {
      mode: 'url',
      sessionId: session,
      elicitationId: 'url-1',
      url: 'https://example.test/authorize',
      message: 'Sign in to continue',
    });
    write({ jsonrpc: '2.0', method: 'elicitation/complete', params: { elicitationId: 'url-1' } });
    const answer = await asking;
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `elicit=${String(answer?.action ?? 'none')}|content=${answer?.content === undefined ? 'none' : 'some'}`,
      },
    });
  }

  if (text.includes('elicitcancel')) {
    /*
     * A question left standing when the turn is stopped.
     *
     * The prompt is held the way `wait` holds it, so the `session/cancel` that
     * follows ends it here; the answer the question itself got is written down
     * by the client's own log rather than said as an update, because by then
     * there is no turn left to say anything in.
     */
    pending = id;
    await ask('elicitation/create', {
      mode: 'form',
      sessionId: session,
      message: 'What should I call it?',
      requestedSchema: {
        type: 'object',
        properties: { title: { type: 'string', title: 'The name' } },
        required: ['title'],
      },
    });
    return;
  }

  if (text.includes('elicitwithdraw')) {
    /*
     * A question this server asks and then takes back.
     *
     * The withdrawal goes out once the test has seen the question drawn, which
     * is what a server whose own deadline passes while the person is reading
     * does: the handler is holding it when the abort arrives. The test says so
     * by writing `<ACP_LOG>.go`, because a fixed delay loses to a slow bridge
     * under load and turns this into the withdrawal that beats the question.
     * The prompt is held the
     * way `elicitcancel` holds it, because the answer comes over a later line
     * and there is no turn left to say anything in.
     */
    pending = id;
    const question = askNamed('elicitation/create', {
      mode: 'form',
      sessionId: session,
      toolCallId: 'call-withdrawn',
      message: 'What should I call it?',
      requestedSchema: {
        type: 'object',
        properties: { title: { type: 'string', title: 'The name' } },
        required: ['title'],
      },
    });
    const drawn = setInterval(() => {
      if (LOG === undefined || !existsSync(`${LOG}.go`)) return;
      clearInterval(drawn);
      withdraw(question.id);
    }, 5);
    await question.answered;
    return;
  }

  if (text.includes('elicitaborted')) {
    /*
     * A withdrawal that beats the question to the client.
     *
     * Both frames go out in one write, so the request is already given up on by
     * the time its handler runs: the client was never asked anything, so there
     * is nothing for it to draw - and nothing it could take away afterwards,
     * because the abort that would do it has already gone by. The prompt is
     * held the way `elicitwithdraw` holds it.
     */
    pending = id;
    const answered = askWithdrawn('elicitation/create', {
      mode: 'form',
      sessionId: session,
      toolCallId: 'call-aborted',
      message: 'What should I call it?',
      requestedSchema: {
        type: 'object',
        properties: { title: { type: 'string', title: 'The name' } },
        required: ['title'],
      },
    });
    await answered;
    return;
  }

  if (text.includes('elicitwdafter')) {
    /*
     * A question answered, and the same request given up on afterwards.
     *
     * A real server whose own deadline passes does not always know the answer
     * is already on its way, so this is the withdrawal arriving for a question
     * that is over: nothing may move here, because everything it would move
     * has already been moved once. What came back is said as an update, so a
     * test can read that the person's own answer is what the server was given.
     */
    const question = askNamed('elicitation/create', {
      mode: 'form',
      sessionId: session,
      toolCallId: 'call-wd-after',
      message: 'What should I call it?',
      requestedSchema: {
        type: 'object',
        properties: { title: { type: 'string', title: 'The name' } },
        required: ['title'],
      },
    });
    const answer = await question.answered;
    withdraw(question.id);
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `elicit=${String(answer?.action ?? 'none')}|title=${String(answer?.content?.title ?? '-')}`,
      },
    });
  }

  if (text.includes('elicitunknown')) {
    /*
     * A form with a field whose `type` ACP does not name.
     *
     * A form's `requestedSchema` is JSON as the server wrote it, and this one
     * asks for a shape the protocol has no control for: a client is meant to
     * ask it as a line the person writes rather than leave it out, because a
     * form drawn with a field missing is one nobody can fill in. What comes
     * back is the field's own value, whatever was typed for it.
     */
    const answer = await ask('elicitation/create', {
      mode: 'form',
      sessionId: session,
      toolCallId: 'call-unknown',
      message: 'How should it be set up?',
      requestedSchema: {
        type: 'object',
        properties: {
          branch: { type: 'string', title: 'Branch name' },
          settings: { type: 'object', title: 'Settings', description: 'A shape this server keeps for itself' },
        },
        required: ['branch'],
      },
    });
    const content = answer?.content ?? {};
    notify({
      sessionUpdate: 'agent_message_chunk',
      content: {
        type: 'text',
        text: `elicit=${String(answer?.action ?? 'none')}`
          + `|branch=${String(content.branch ?? '-')}`
          + `|settings=${String(content.settings ?? '-')}`,
      },
    });
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

  if (text.includes('linger')) {
    /*
     * A shell still running when its call ends and when the turn does.
     *
     * Nothing waits for it and nothing releases it: the call's result names a
     * terminal whose process has not exited, which is what the bridge reads as
     * background work. The test stops it afterwards, or the sleep outlives the
     * case.
     */
    const created = await ask('terminal/create', {
      sessionId: session, command: 'sh', args: ['-c', 'sleep 30'], cwd,
    });
    const terminalId = String(created?.terminalId ?? '');
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-linger',
      title: 'Watch for changes',
      name: 'watch',
      status: 'in_progress',
      rawInput: { command: 'sleep 30' },
    });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-linger',
      status: 'completed',
      content: [{ type: 'terminal', terminalId }],
    });
  }

  if (text.includes('unspoken')) {
    // A shell no call names: the turn's end is the only thing that can list it.
    await ask('terminal/create', {
      sessionId: session, command: 'sh', args: ['-c', 'sleep 30'], cwd,
    });
  }

  if (text.includes('brief')) {
    /*
     * A shell that has exited by the time its call ends.
     *
     * Waiting for the exit before the completion is what makes that order the
     * server's rather than the test's.
     */
    const created = await ask('terminal/create', {
      sessionId: session, command: 'sh', args: ['-c', 'echo brief'], cwd,
    });
    const terminalId = String(created?.terminalId ?? '');
    await ask('terminal/wait_for_exit', { sessionId: session, terminalId });
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-brief',
      title: 'Say it briefly',
      name: 'brief',
      status: 'in_progress',
    });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-brief',
      status: 'completed',
      content: [{ type: 'terminal', terminalId }],
    });
    await ask('terminal/release', { sessionId: session, terminalId });
  }

  if (text.includes('fade')) {
    /*
     * A shell that exits only when the test touches `fade-away`.
     *
     * That makes the exit the test's to time, so the row is listed while the
     * process runs and is taken down by the exit rather than by a release.
     */
    const created = await ask('terminal/create', {
      sessionId: session,
      command: 'sh',
      args: ['-c', 'while [ ! -f fade-away ]; do sleep 0.05; done'],
      cwd,
    });
    const terminalId = String(created?.terminalId ?? '');
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-fade',
      title: 'Wait for the mark',
      name: 'fade',
      status: 'in_progress',
    });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-fade',
      status: 'completed',
      content: [{ type: 'terminal', terminalId }],
    });
  }

  if (text.includes('release')) {
    /*
     * A shell still running when the call ends and released straight after.
     *
     * The release is the agent letting go, and the exit it causes behind it
     * must not take the row down a second time.
     */
    const created = await ask('terminal/create', {
      sessionId: session, command: 'sh', args: ['-c', 'sleep 30'], cwd,
    });
    const terminalId = String(created?.terminalId ?? '');
    notify({
      sessionUpdate: 'tool_call',
      toolCallId: 'call-release',
      title: 'Start it, then let go',
      name: 'release',
      status: 'in_progress',
    });
    notify({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'call-release',
      status: 'completed',
      content: [{ type: 'terminal', terminalId }],
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

  if (text.includes('erroratend')) {
    write({ jsonrpc: '2.0', id, error: { code: -32603, message: 'the model gave up at the end' } });
    return;
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

  /*
   * Every line, including the answers.
   *
   * A response has no method, so its body would be dropped by a log of methods
   * alone - and what a client answered is exactly what a test of one of these
   * scripts is reading. The request id comes with it, because that is what says
   * which of this server's own questions the answer belongs to.
   */
  if (LOG !== undefined) appendFileSync(LOG, `${JSON.stringify(message.method === undefined
    ? { pid: process.pid, id: message.id, result: message.result, error: message.error }
    : { pid: process.pid, method: message.method, params: message.params })}\n`);

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
          // Presence alone is what a server promises with: the key is there and
          // what it holds is nothing.
          ...(announcesAuth ? { _meta: { authStatus: {} } } : {}),
          ...(process.argv.includes('--no-load') ? {} : { loadSession: true }),
          mcpCapabilities: { http: !process.argv.includes('--no-http-mcp') },
          ...(process.argv.includes('--prompt-caps')
            ? { promptCapabilities: { image: true, embeddedContext: true } }
            : {}),
          sessionCapabilities: {
            list: {},
            ...(process.argv.includes('--no-resume') ? {} : { resume: {} }),
            ...(process.argv.includes('--fork') ? { fork: {} } : {}),
            ...(process.argv.includes('--no-close') ? {} : { close: {} }),
            ...(process.argv.includes('--no-delete') ? {} : { delete: {} }),
            ...(process.argv.includes('--extra-dirs') ? { additionalDirectories: {} } : {}),
          },
        },
        authMethods: process.argv.includes('--signin') || process.argv.includes('--signin-fails') ? [{ id: 'api-key', name: 'API key' }] : [],
      });
      // A server that reports its sign-in says so as soon as it has answered
      // the handshake, which is when the account it was started with is known.
      if (authStatus !== undefined) {
        write({
          jsonrpc: '2.0',
          method: '_auth/status_update',
          params: { authStatus: AUTH_STATUSES[authStatus.slice('--auth-status='.length)] },
        });
      }
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

    /*
     * The same conversation taken back, with nothing read out of it.
     *
     * The id is the one the request named and the answer carries no
     * `sessionId`, because a resume continues the session it was given rather
     * than naming one. A `--replay` server replays nothing here even so: what
     * distinguishes this call is that the client is the one holding the
     * conversation.
     */
    case 'session/resume': {
      session = String(message.params?.sessionId ?? nextSession());
      if (typeof message.params?.cwd === 'string' && message.params.cwd !== '') cwd = message.params.cwd;
      hostTools = named(message.params?.mcpServers);
      respond(message.id, process.argv.includes('--legacy')
        ? { modes: modes(), models: listed() }
        : { modes: modes(), configOptions: configOptions() });
      return;
    }

    /*
     * A conversation copied into a new one, which is what a fork is.
     *
     * The id is this server's own and not the one the request named: the copy
     * is a session of its own, and the original is left alone - which is how a
     * test can tell a fork from a resume by the id a later prompt arrives
     * under. Only a `--fork` server offers the capability at all.
     */
    case 'session/fork': {
      const copied = nextSession();
      if (typeof message.params?.cwd === 'string' && message.params.cwd !== '') cwd = message.params.cwd;
      hostTools = named(message.params?.mcpServers);
      respond(message.id, { sessionId: copied, modes: modes(), configOptions: configOptions() });
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
