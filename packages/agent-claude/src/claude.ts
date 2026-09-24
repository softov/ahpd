import { probe } from './probe.js';
import { serversFor } from './mcp.js';
import { createSession, EFFORT_LABELS, EFFORTS } from './session.js';
import { turnsOf } from './transcript.js';
import { catalogue } from './catalog.js';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { machineAsked, refuseComputer } from '@ahpd/sdk';
import { spawnInside } from './spawn.js';
import type { Asked, Spawned } from './spawn.js';
import type { Agent, Bag, Start } from '@ahpd/sdk';

/**
 * The resource a token for this backend is for.
 *
 * Named once, because it is the identifier a client must send back verbatim:
 * the protocol says `authenticate`'s `resource` MUST match one the server
 * advertised, so this string appearing twice with a typo between them is a
 * token nothing will accept.
 */
const ANTHROPIC = 'https://api.anthropic.com';

/**
 * Claude Code, as an agent backend.
 *
 * Everything the host would otherwise have to know about one particular
 * harness: which settings it takes, where its past sessions are kept, and how
 * to start one. The host asks through `Agent` and imports none of this.
 */

/** How to build the Claude backend. */
export interface ClaudeOptions {
  /**
   * The directories it lists, and where a session goes by default.
   *
   * The catalogue's scope: past sessions in these directories are listed and
   * openable, and ones elsewhere are not. The first is also where a new
   * session goes when the client names no directory. A client that names one
   * gets it, wherever on the machine it is - the connection token decided who
   * may be here, the way it does on the reference host.
   */
  paths: string[];
  /** The id clients name. `claude` unless something else already is. */
  provider?: string;
  /**
   * Where the CLI is *inside a machine*, for a session that names one.
   *
   * `claude` on the image's PATH unless a deployment says otherwise, because
   * an image that has the CLI installed normally has it there. It is never
   * this host's own path: the executable that runs on this host is the SDK's
   * to find, and this one has to exist in the image instead.
   */
  computerExecutable?: string;
  /**
   * The configuration directory the CLI reads *inside a machine*.
   *
   * Passed as `CLAUDE_CONFIG_DIR`, so a machine that mounts this host's
   * `~/.claude` at the same path is a machine the CLI is already signed in on.
   * Nothing here mounts it: the mount is the operator's, in the computer
   * plugin's `mounts` or in the machine's own manifest, and this only says
   * where to look. `false` says nothing at all and leaves the image's own.
   */
  computerConfigDir?: string | false;
}

/** Claude Code on one or more directories, ready to be handed to `createHost`. */
export function claude(options: ClaudeOptions): Agent {
  const dirs = options.paths;
  const executable = options.computerExecutable ?? 'claude';
  const configDir = options.computerConfigDir === undefined ? '/ahpd/claude' : options.computerConfigDir;
  const dir = dirs[0];
  if (dir === undefined)
    throw new Error('claude() needs at least one directory to work in.');

  /**
   * Which directory a session goes in.
   *
   * Named, or the first. An absolute path is taken as it was given, so the
   * session runs where the client said; a relative one has no meaning on a
   * host whose own directory the client cannot see, and is refused.
   */
  const workingDirectory = (asked?: string): string => {
    if (asked === undefined)
      return dir;
    if (!isAbsolute(asked))
      throw new Error(`A working directory is an absolute path, not ${asked}.`);
    return asked;
  };

  /*
   * What the probe learned about output styles.
   *
   * The schema is otherwise fixed, but this one property's choices belong to
   * the harness rather than to the protocol - a person's own styles live in
   * their settings - so it is learned once at startup, the way models are,
   * and the control is simply absent until it is known.
   */
  let styles: string[] = [];

  /**
   * Whether the models this harness offers carry effort controls of their own.
   *
   * A model's `configSchema` and the session-wide `effortLevel` reach the same
   * setting, and a client draws both - so a person is shown two effort
   * controls, on two different values, for one thing. The model's is the
   * truthful one: it lists what that model actually supports, where the
   * session-wide key lists all five whatever is chosen. So this backend offers
   * the session key only while there is nothing better.
   */
  let perModelEffort = false;
  let style: string | undefined;

  /**
   * What a session can be told to do differently.
   *
   * One schema, used by `resolveSessionConfig` (before a session exists) and
   * by every session's own state (after one does). Two copies would drift, and
   * the composer would offer one set of controls on the new-session screen and
   * a different set the moment a session opened.
   *
   * `sessionMutable` is what each row turns on: the permission mode, the model
   * and the effort level are things the CLI takes on a *running* session.
   * `thinking` is fixed when the query is built, so offering it live would be
   * a switch that flips back.
   */
  const schema = (): Bag => ({
    // A JSON Schema object, and it has to say so: `type` is required, and a
    // schema without it matches nothing a client validates.
    type: 'object',
    properties: {
      /*
       * One axis, and the CLI's own six values.
       *
       * The protocol's config schema is generic and a backend advertises what
       * it has - VS Code's own hosts advertise different properties for
       * Copilot and for Claude, and a client draws whatever it is given. Its
       * Claude host says why in as many words: it collapses the platform's
       * `autoApprove` x `mode` two-axis surface onto one `permissionMode`
       * matching the SDK's enum, and *omits* `autoApprove`, `mode`,
       * `isolation` and `branch` deliberately, because the pickers key off
       * property names and omitting them suppresses a mode and branch UI that
       * would not mean anything here.
       *
       * The wording is that host's too, so one session reads the same however
       * it is opened. `auto` was missing here and is a real mode the CLI
       * takes: the agent deciding, per call, whether it needs to ask. `dontAsk`
       * was missing too, and is the SDK's other mode.
       */
      permissionMode: {
        scope: 'session',
        type: 'string',
        title: 'Approvals',
        description: 'How the agent handles tool approvals.',
        enum: ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'],
        enumLabels: [
          'Ask Before Edits',
          'Edit Automatically',
          'Plan Mode',
          'Auto Mode',
          'Bypass Permissions',
          "Don't Ask",
        ],
        enumDescriptions: [
          'Asks before editing files.',
          'Edits files without asking, and asks before using other tools.',
          'Creates a plan before making changes.',
          'Decides whether to ask for each tool operation.',
          'Runs all tools without asking.',
          'Denies anything not already approved, without asking.',
        ],
        default: 'default',
        sessionMutable: true,
      },
      /*
       * The model is not a config property.
       *
       * A session has no model; each message has one. The choices are carried
       * on the agent (`RootState.agents[].models`) and the choice on the turn.
       * `session/configChanged` with a `model` key is still honoured, but the
       * model is not advertised here as a control of its own.
       */
      ...(perModelEffort ? {} : {
        effortLevel: {
          scope: 'chat',
          type: 'string',
          title: 'Effort',
          description: 'How hard it thinks before answering.',
          enum: [...EFFORTS],
          enumLabels: EFFORTS.map((one) => EFFORT_LABELS[one]),
          default: 'high',
          sessionMutable: true,
        },
      }),
      // Learned, so absent until the probe has answered and absent for good
      // on a harness that has no styles.
      ...(styles.length > 0
        ? {
            outputStyle: {
        scope: 'session',
              type: 'string',
              title: 'Output style',
              description: 'The voice it answers in.',
              enum: styles,
              enumLabels: styles.map((name) => name.charAt(0).toUpperCase() + name.slice(1)),
              ...(style !== undefined ? { default: style } : {}),
              sessionMutable: true,
            },
          }
        : {}),
      thinking: {
        type: 'string',
        title: 'Thinking',
        description: 'Fixed when the session is created.',
        enum: ['adaptive', 'disabled'],
        enumLabels: ['Adaptive', 'Off'],
        enumDescriptions: ['The agent decides when to think', 'No extended thinking'],
        default: 'adaptive',
        sessionMutable: false,
      },
      /*
       * The sandbox, on the reference host's three words.
       *
       * A platform key the reference client draws a control for on every
       * backend that declares it. The CLI has a sandbox of its own for shell
       * commands, `sandbox.enabled` in its settings, and that is what the
       * three values reach: `on` and `off` set it, `default` leaves it to the
       * settings files. Live, because the flag settings take it mid-session.
       */
      sandboxEnabled: {
        scope: 'session',
        type: 'string',
        title: 'Sandbox',
        description: 'Sandbox behavior for this session. Default follows the global setting.',
        enum: ['default', 'on', 'off'],
        enumLabels: ['Default', 'On', 'Off'],
        default: 'default',
        sessionMutable: true,
      },
      /*
       * Scripts a client generated, sourced before every shell command.
       *
       * The reference client sends this only where a schema declares it, and
       * `readOnly` because nobody types one: it carries the shell profile and
       * the Python environment the window has selected for the folder. No
       * `default`, so absent stays tellable from an explicit empty list.
       */
      shellInitScripts: {
        scope: 'session',
        type: 'array',
        title: 'Shell Init Script',
        description: 'A script sourced before each built-in shell tool command.',
        items: {
          type: 'object',
          title: 'Shell Init Script',
          properties: {
            shell: { type: 'string', title: 'Shell', enum: ['bash', 'powershell'] },
            script: { type: 'string', title: 'Script' },
          },
          required: ['shell', 'script'],
        },
        readOnly: true,
        sessionMutable: true,
      },
      /*
       * Per-tool allow and deny, which is the slope the mode above is a cliff.
       *
       * A platform key rather than one of this backend's invention: it is what
       * the reference client's permission picker writes when somebody approves
       * a tool "in this session", and its own Claude host advertises it
       * unchanged because the SDK takes `allowedTools` / `disallowedTools`
       * natively. Without it the only way to stop being asked about the one
       * command you trust is `bypassPermissions`, which stops asking about
       * everything.
       *
       * An object, and the first config value here that is not a string. The
       * protocol declares the bag `Record<string, unknown>`; this host used to
       * declare it `Record<string, string>`, which is why nothing of this
       * shape could be carried at all.
       */
      permissions: {
        scope: 'session',
        type: 'object',
        title: 'Permissions',
        description: 'Per-tool session permissions. Updated when a tool is approved for this session.',
        properties: {
          allow: { type: 'array', title: 'Allowed tools', items: { type: 'string', title: 'Tool name' } },
          deny: { type: 'array', title: 'Denied tools', items: { type: 'string', title: 'Tool name' } },
        },
        default: { allow: [], deny: [] },
        // Unlike `thinking`, this one really can move on a running session:
        // the SDK takes the lists when the query is built, and `canUseTool`
        // is where this host already sits between the agent and the person.
        sessionMutable: true,
      },
    },
  });

  const defaults = (): Record<string, unknown> => ({
    permissionMode: 'default',
    // Beside its schema or not at all: a value with no property to draw it is
    // a control a client cannot show and cannot change.
    ...(perModelEffort ? {} : { effortLevel: 'high' }),
    thinking: 'adaptive',
    sandboxEnabled: 'default',
    permissions: { allow: [], deny: [] },
    ...(style !== undefined ? { outputStyle: style } : {}),
  });

  /**
   * How to start the CLI for a session that named a machine, or nothing.
   *
   * Resolved per session rather than per agent, because the machine is the
   * person's choice in `Start.settings` while the port is the host's, handed
   * to each session. A named machine with no port is the refusal: this backend
   * cannot reach it, and running on the host would be the silent failure the
   * gate exists to stop.
   */
  const insideOf = (start: Start): ((asked: Asked) => Spawned) | undefined => {
    const said = machineAsked(start);
    if (said === undefined) return undefined;
    const named = /^computer:\/\/([^/\s]+)$/.exec(said);
    if (named === null) throw new Error(`${said} is not a computer URI; a session runs in computer://<id>`);
    const id = named[1] as string;
    const port = start.computers;
    // Throws, and the `return` is what the compiler needs rather than a path.
    if (port === undefined) { refuseComputer(start, 'Claude Code'); return undefined; }
    return (asked) => spawnInside(asked, (given) => port.how(id, {
      command: given.command,
      args: given.args,
      // An unset variable is not one to pass: `-e K=undefined` would put the
      // word in the machine as the value.
      env: Object.fromEntries(Object.entries(given.env)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)),
      // This host's path; the port reads it through the machine's mounts and
      // falls back to the machine's own working directory.
      ...(start.workingDirectory === undefined ? {} : { cwd: start.workingDirectory }),
    }), said);
  };

  return {
    provider: options.provider ?? 'claude',
    displayName: 'Claude Code',
    // Both, because the SDK resumes at a named prompt: `resumeSessionAt` with
    // `forkSession` continues from a turn under a new id, and a side chat is
    // an unresumed session handed what that turn said.
    chats: { fork: true, sideChat: true },
    // The SDK takes `additionalDirectories` at startup, so a session works in
    // as many as it was given; the first is the process root and is fixed.
    multipleDirectories: true,
    description: `The Claude Agent SDK, on ${dirs.join(', ')}`,
    schema,
    defaults,

    directories: () => [...dirs],

    // The styles are kept as well as handed on: `schema()` is asked before any
    // session exists, and it can only offer what has already been learned.
    probe: async () => {
      const offered = await probe(dir);
      styles = offered.outputStyles ?? [];
      style = offered.outputStyle;
      perModelEffort = offered.models.some((model) => model.configSchema !== undefined);
      return offered;
    },

    // Every directory it serves, as one list. A session is listed by the
    // catalogue of the directory it ran in, and a host serving several has
    // one catalogue.
    list: async () => (await Promise.all(dirs.map((served) => catalogue(served)))).flat(),

    /*
     * The transcript on disk, which is the CLI's own record of a session.
     *
     * `~/.claude/projects/<directory>/<id>.jsonl`, with the directory spelled
     * the way the CLI spells it - every character that is not a letter or a
     * digit made a dash - and `CLAUDE_CONFIG_DIR` in place of `~/.claude`
     * where it is set. A session resumed elsewhere may have been written
     * under the directory it started in, so the other projects are looked
     * through before answering that there is none.
     */
    stateFile: (id, directory) => {
      if (!/^[A-Za-z0-9-]+$/.test(id)) return undefined;
      const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
      const own = join(projects, directory.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
      if (existsSync(own)) return own;
      let names: string[];
      try { names = readdirSync(projects); }
      catch { return undefined; }
      for (const name of names) {
        const file = join(projects, name, `${id}.jsonl`);
        if (existsSync(file)) return file;
      }
      return undefined;
    },

    // What to probe when the network is in question: the API, which answers
    // an unauthenticated request with 401 - reached, and refusing - and the
    // base URL the CLI would use where one is set.
    endpoints: () => [{
      name: 'Anthropic API',
      url: `${(process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`,
      expectedStatus: 401,
    }],

    // Whichever directory holds it. The transcript reader wants the one the
    // session ran in, and only its own catalogue knows which that was.
    transcript: async (id) => {
      for (const served of dirs) {
        const rows = await catalogue(served).catch(() => []);
        if (rows.some((row) => row.id === id))
          return turnsOf(id, served);
      }
      return undefined;
    },

    /*
     * The one resource this backend can be given a token for.
     *
     * `required: false`, and that is the honest declaration rather than the
     * lenient one: this daemon runs as whoever started it and inherits their
     * `claude login` or `ANTHROPIC_API_KEY`, so it works with nothing pushed
     * at all. Saying `required: true` would refuse clients that would
     * otherwise be perfectly able to open a session.
     */
    protectedResources: [{
      resource: ANTHROPIC,
      resource_name: 'Anthropic API',
      authorization_servers: ['https://console.anthropic.com'],
      required: false,
    }],

    create: (start: Start) => {
      /*
       * The machine this session runs in, when it names one.
       *
       * The CLI is a child process, so it is moved by starting it somewhere
       * else rather than by anything inside it: the SDK's own
       * `spawnClaudeCodeProcess` is handed a spawn that goes through the
       * host's `computers` port, and every other part of this backend is
       * unchanged. A session that names a machine this host cannot reach is
       * refused rather than run here, because a person told they are in a
       * sandbox must not be on the host instead.
       */
      const inside = insideOf(start);
      return createSession({
      ...(inside === undefined ? {} : { spawn: inside, spawnExecutable: executable, spawnConfigDir: configDir }),
      uri: start.uri,
      chatUri: start.chatUri,
      cwd: workingDirectory(start.workingDirectory),
      /*
       * The MCP servers, declared by this host rather than found by the CLI.
       *
       * The same files the CLI reads - `.mcp.json` beside the project and
       * `mcpServers` in `~/.claude.json` - handed to the SDK so they are
       * *its* servers. That is what makes a token a client signed in with
       * applicable: `setMcpServers` re-declares only what the SDK was given.
       */
      mcpServers: serversFor([workingDirectory(start.workingDirectory), ...(start.additional ?? [])]),
      // Each one checked the way the first is: a directory this host does not
      // serve is not one an agent may be pointed at, however it arrived.
      ...(start.additional && start.additional.length > 0
        ? { additional: start.additional.map((one) => workingDirectory(one)) }
        : {}),
      // The host's own tools, offered to the model beside this backend's.
      ...(start.tools && start.tools.length > 0 ? { tools: start.tools } : {}),
      ...(start.instructions && start.instructions.length > 0 ? { instructions: start.instructions } : {}),
      settings: start.settings,
      schema: start.schema,
      emit: start.emit,
      ...(start.seedCustomizations ? { seedCustomizations: start.seedCustomizations } : {}),
      ...(start.resume !== undefined ? { resume: start.resume } : {}),
      ...(start.forkAt !== undefined ? { forkAt: start.forkAt } : {}),
      ...(start.rewindAt !== undefined ? { rewindAt: start.rewindAt } : {}),
      ...(start.context !== undefined ? { context: start.context } : {}),
      ...(start.seed ? { seed: start.seed } : {}),
      ...(start.onFileEdit ? { onFileEdit: start.onFileEdit } : {}),
      ...(start.onHandshake ? { onHandshake: start.onHandshake } : {}),
      /*
       * A pushed token, as the variable the CLI reads.
       *
       * Which variable that is, is this file's business and not the host's:
       * the host knows a token belongs to `https://api.anthropic.com` and
       * stops there, which is what keeps `createHost` the protocol and
       * nothing else.
       */
      ...(start.credentials?.[ANTHROPIC]
        ? { env: { ANTHROPIC_API_KEY: start.credentials[ANTHROPIC] } }
        : {}),
      });
    },
  };
}
