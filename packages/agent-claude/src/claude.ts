import { probe } from './probe.js';
import { serversFor } from './mcp.js';
import { createSession, EFFORT_LABELS, EFFORTS } from './session.js';
import { turnsOf, subagentsOf } from './transcript.js';
import { catalogue } from './catalog.js';
import { offeredModels, ownModels, type ModelEntry, type OfferedModel } from './models.js';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { machineAsked, refuseComputer } from '@ahpd/sdk';
import { spawnInside } from './spawn.js';
import type { Asked, Spawned } from './spawn.js';
import type { Agent, Bag, MachineNeed, Start } from '@ahpd/sdk';

/**
 * The host's Claude Code CLI, as the installer leaves it.
 *
 * `~/.local/bin/claude` is a symlink into a versioned directory, and the
 * version changes under it on every update - which is why the computer docs
 * once pinned `versions/2.1.267` and the mount became an empty directory the
 * session exited 127 from. So this follows the link when it is asked, rather
 * than reading it once, and answers the path it points at. A missing link
 * answers the path itself, which a machine is then refused over by name.
 */
export const claudeExecutablePath = (home: string = homedir()): string => {
  const named = join(home, '.local', 'bin', 'claude');
  try { return realpathSync(named); }
  catch { return named; }
};

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
 * The API base URL a variant's own `env` names, or nothing.
 *
 * Where the CLI would be pointed, which is the endpoint a probe should ask: a
 * preset on another gateway is not reachable at the daemon's own base URL.
 */
const baseUrlOf = (preset: Bag | undefined): string | undefined => {
  const said = (preset?.['env'] as Bag | undefined)?.['ANTHROPIC_BASE_URL'];
  const named = typeof said === 'object' && said !== null ? (said as Bag)['fromEnv'] : undefined;
  const url = typeof named === 'string' ? process.env[named] : said;
  return typeof url === 'string' && url !== '' ? url : undefined;
};

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
  /** The id clients name. The variant's own key, `claude` for the built-in. */
  provider?: string;
  /** What a client reads instead of the id. The variant's own `name`. */
  displayName?: string;
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
  /**
   * What a stop given in a subagent's chat stops.
   *
   * `worker`, the default, stops that subagent alone and the turn that
   * started it goes on; `session` cancels that turn, and every subagent it
   * runs with it.
   */
  workerStop?: 'worker' | 'session';
  /**
   * The declared options this variant runs its sessions on.
   *
   * One variant, not a map of them: the plugin resolves its presets and calls
   * `claude()` once per preset, and each of those is a harness of its own with
   * its own id, name and models. Each field is declared in `options.ts`, so what
   * a preset may hold is what an SDK option is and a preset is checked when the
   * plugin loads.
   */
  preset?: Bag;
  /**
   * The models this harness offers, by id, with a name, or fetched from an
   * endpoint's model list and filtered. Without it, the CLI's own list.
   */
  models?: ModelEntry[];
  /** With `models`, add them to the CLI's list rather than replace it. */
  keepCliModels?: boolean;
  /** Where a model list that could not be fetched is said. */
  log?: (line: string) => void;
}

/** Claude Code on one or more directories, ready to be handed to `createHost`. */
export function claude(options: ClaudeOptions): Agent {
  const dirs = options.paths;
  const executable = options.computerExecutable ?? 'claude';
  const configDir = options.computerConfigDir === undefined ? '/ahpd/claude' : options.computerConfigDir;
  const dir = dirs[0];
  if (dir === undefined)
    throw new Error('claude() needs at least one directory to work in.');

  /** The models `models` names, fetched once and kept. */
  let named: Promise<OfferedModel[]> | undefined;
  /** A list the CLI reported, as this harness offers it. */
  const offer = async <T extends OfferedModel>(cli: T[]): Promise<(T | OfferedModel)[]> => {
    if (options.models === undefined) return cli;
    named ??= ownModels(options.models, options.log);
    return offeredModels(cli, await named, options.keepCliModels);
  };

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
        // Live: the SDK takes the lists when the query is built, and
        // `canUseTool` is where this host already sits between the agent and
        // the person.
        sessionMutable: true,
      },
    },
  });

  const defaults = (): Record<string, unknown> => ({
    permissionMode: 'default',
    // Beside its schema or not at all: a value with no property to draw it is
    // a control a client cannot show and cannot change.
    ...(perModelEffort ? {} : { effortLevel: 'high' }),
    permissions: { allow: [], deny: [] },
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
    displayName: options.displayName ?? 'Claude Code',
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

    /*
     * What a machine needs for this CLI to run in it.
     *
     * The configuration directory and the file beside it are what the CLI
     * signs in from, and the executable is what runs. They are the same host
     * paths the computer docs used to list as mounts by hand, and the
     * executable is resolved here so an update on this host is followed rather
     * than a pinned version that stops existing. `computerConfigDir: false`
     * leaves the image's own configuration alone, and a machine for this
     * backend then carries the executable alone.
     */
    machine: (): Record<string, MachineNeed> => {
      const config = configDir === false ? {} : {
        claudeConfigDirectory: {
          directory: '~/.claude',
          target: configDir,
          required: true,
          description: 'The Claude Code configuration directory, which holds the sign-in and the settings.',
        },
        claudeConfigJson: {
          file: '~/.claude.json',
          target: `${configDir}/.claude.json`,
          required: true,
          description: 'The Claude Code configuration file beside that directory.',
        },
      };
      return {
        ...config,
        claudeExecutable: {
          file: claudeExecutablePath(),
          target: executable.startsWith('/') ? executable : '/usr/local/bin/claude',
          readOnly: true,
          required: true,
          description: 'The Claude Code CLI, as this host has it installed.',
        },
      };
    },

    directories: () => [...dirs],

    // The models are kept as well as handed on: `schema()` is asked before any
    // session exists, and it can only offer what has already been learned.
    probe: async () => {
      const probed = await probe(dir);
      const offered = { ...probed, models: await offer(probed.models) };
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
    // base URL the CLI would use where one is set. This variant's own `env`
    // first, because a preset on another endpoint is probed there and not
    // where the daemon's own environment would send it.
    endpoints: () => [{
      name: 'Anthropic API',
      url: `${(baseUrlOf(options.preset) ?? process.env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com').replace(/\/$/, '')}/v1/models`,
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
     * The conversations that ran inside that session's calls.
     *
     * The CLI writes each one beside the session, with a meta file naming the
     * tool call that spawned it - which is the link, read exactly rather than
     * inferred. The spawning call's own result is the fallback for a harness
     * that writes no meta file, and a worker neither names is left out rather
     * than linked to the wrong call.
     */
    subagents: async (id, turns) => {
      for (const served of dirs) {
        const rows = await catalogue(served).catch(() => []);
        if (!rows.some((row) => row.id === id)) continue;
        return subagentsOf(id, served, turns ?? await turnsOf(id, served));
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
      ...(options.workerStop !== undefined ? { workerStop: options.workerStop } : {}),
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
      ...(start.onTurnRecorded ? { onTurnRecorded: start.onTurnRecorded } : {}),
      ...(start.onHandshake ? { onHandshake: start.onHandshake } : {}),
      // The host's worker-chat seam, carried through unchanged: this backend
      // names a call and what the harness said about it, and the host opens
      // the chat. Without one, a subagent's frames stay in the turn that
      // spawned them.
      ...(start.subagent ? { subagent: start.subagent } : {}),
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
      // The declared options this variant was configured with, which its
      // sessions are built from.
      ...(options.preset === undefined ? {} : { preset: options.preset }),
      ...(options.models === undefined ? {} : { offerModels: offer }),
      });
    },
  };
}
