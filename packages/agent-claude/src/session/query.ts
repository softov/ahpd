import { query } from '@anthropic-ai/claude-agent-sdk';
import { idOf } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import type { HookCallback, SDKUserMessage, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { failureOf } from './failure.js';
import { hostHoldsTasks, ownEnvOf, OWN_TASK_TOOLS, queryOptionsOf } from '../options.js';
import { agentNameOf } from './customizations.js';

/** What the SDK will accept as a session id of our choosing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The settings files one session loads, from the two answers it was started
 * with.
 *
 * `trusted` says whether the folder's own files may reach the model, and
 * `userSettings` whether the person's own may. They are independent: a bot's
 * back session is trusted in its own folder and loads nothing of the person's,
 * so it gets the folder's `CLAUDE.md` and none of `~/.claude` - which is the
 * whole point of saying both. A session that is neither trusted nor allowed the
 * person's settings loads no settings file at all, and the empty list is how
 * the CLI is told so.
 */
const settingSourcesOf = (trusted: boolean, userSettings: boolean): SettingSource[] => {
  const sources: SettingSource[] = [];
  if (userSettings) sources.push('user');
  if (trusted) sources.push('project', 'local');
  return sources;
};

/**
 * How long the CLI has to answer its handshake before it is a CLI that died.
 *
 * A cold start with several MCP servers is slow, which is the whole reason the
 * bound is this generous; a deployment whose machines are slower still raises
 * it with the plugin's own option.
 */
const HANDSHAKE_MS = 120000;

/** What this area offers the rest of the session. */
export interface Query {
  /**
   * Messages waiting to go out on the CLI's input stream.
   *
   * The SDK's own shape, because a message with attachments goes as content
   * blocks rather than as the string one without carries.
   */
  waiting: SDKUserMessage[];
  /** A query for this session, on the agent named. */
  startQuery: (agent: string | undefined, first: boolean) => ReturnType<typeof query>;
  /** The backend's id for the *last* thing in each turn, by this host's turn id. */
  ends: Map<string, string>;
  /** Ask the CLI for a model, and say why it would not take it if it will not. */
  take: (id: string) => Promise<string | undefined>;
  /** Move this session's CLI onto the agent a message picked, if it is not already there. */
  switchAgent: (uri: string | undefined) => string | undefined;
  /**
   * Read a record's values again, and move the CLI onto them when they changed.
   *
   * Nothing for a preset. A refusal is a sentence for the turn that asked.
   */
  refreshPreset: () => string | undefined;
  /** Read one CLI's frames until it ends. */
  consume: () => Promise<void>;
  /**
   * What the CLI said it still has in hand at the end of its last turn: its
   * background work and its session timers, from the `Stop` hook.
   */
  stopped: { backgroundTasks: Bag[]; sessionCrons: Bag[] };
  /** The `Stop` hook that keeps `stopped`. */
  keepStopped: HookCallback;
  /** The `UserPromptSubmit` hook that gives the turn now running what the host asked said. */
  giveHostInstructions: HookCallback;
}

export function createQuery(ctx: SessionContext): Query {
  /**
   * The `query()` options the declared values become. A pushed credential is
   * laid over their `env`, so a preset never replaces a signed-in token.
   *
   * Asked rather than held, because a record's values are read again at each
   * turn and the CLI is restarted onto whatever they say now.
   */
  const fromPreset = (): Bag => queryOptionsOf(ctx.values);

  /**
   * Whatever the host holds the list, the query is built the same way.
   *
   * A person's own deny list, and `TodoWrite`, `TaskCreate`, `TaskUpdate`,
   * `TaskList` and `TaskGet` too when the host holds the list. A host that does
   * not leaves the harness's own tools where they are.
   */
  const denyOption = (): Bag => {
    const deny = [...ctx.allowed.deny];
    if (hostHoldsTasks(ctx.values, ctx.offering)) for (const name of OWN_TASK_TOOLS) if (!deny.includes(name)) deny.push(name);
    return deny.length > 0 ? { disallowedTools: deny } : {};
  };

  const stopped: Query['stopped'] = { backgroundTasks: [], sessionCrons: [] };
  const keepStopped: HookCallback = async (input) => {
    if (input.hook_event_name !== 'Stop') return {};
    stopped.backgroundTasks = list(input.background_tasks).map(bag);
    stopped.sessionCrons = list(input.session_crons).map(bag);
    return {};
  };

  /**
   * What the host has to say to the model, on the turn that is running.
   *
   * The CLI's own door for context the person did not type: a
   * `UserPromptSubmit` hook returns `additionalContext`, and the harness puts
   * it into the prompt without it appearing as part of the message. Registered
   * once with the query and asked on every prompt, which is what makes it a
   * turn's own: the words are read off the turn now running, so a turn that
   * ended has already taken its instruction with it.
   *
   * Nothing when the host said nothing, which is every turn of a session it
   * began itself - and the key is left off rather than sent empty, because
   * empty context is a heading with nothing under it.
   */
  const giveHostInstructions: HookCallback = async (input) => {
    if (input.hook_event_name !== 'UserPromptSubmit') return {};
    const held = ctx.hostInstructions;
    if (held === undefined || held.turn !== ctx.active || held.said.length === 0) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit' as const,
        additionalContext: held.said.join('\n\n'),
      },
    };
  };

  /**
   * The plugin servers the host said a client switched off, by name.
   *
   * Read once, at the query: a set that moved reaches a chat by starting it
   * again, so what is here is what this CLI was told when it began.
   */
  const denied = ctx.options.deniedMcpServers ?? [];

  /**
   * What a CLI in a machine is started with: the variant's own `env`, a pushed
   * credential over it, and `CLAUDE_CONFIG_DIR` last.
   *
   * Nothing of the daemon's environment: its `HOME` and `PATH` are this host's,
   * and a key it holds is the one variant's that names it with `{ fromEnv }`,
   * not every variant's on the machine. Each value travels by name on the one
   * `docker exec` that starts this CLI, never as the container's own, so a key
   * one variant signs in with is not in another's process.
   */
  const inMachine = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries({ ...ownEnvOf(ctx.values), ...ctx.options.env })) {
      if (typeof value === 'string') out[name] = value;
    }
    const dir = ctx.options.spawnConfigDir;
    if (typeof dir === 'string') out.CLAUDE_CONFIG_DIR = dir;
    return out;
  };

  /**
   * The environment that turns Claude's own task tools on, where Claude keeps them.
   *
   * `CLAUDE_CODE_ENABLE_TASKS` is the CLI's switch. It is set only when the
   * host has not taken the tools' place and `enableTasks` is on, and a value a
   * preset's own `env` gives is kept rather than written over. A machine gets
   * the variable on the one command that starts its CLI, like every other
   * variable a variant names.
   */
  const taskToolsEnv = (): Bag => {
    if (ctx.values['enableTasks'] === false || hostHoldsTasks(ctx.values, ctx.offering)) return {};
    const env = ctx.options.spawn === undefined
      ? { ...(fromPreset().env as Bag | undefined ?? process.env), ...ctx.options.env }
      : inMachine();
    if (env.CLAUDE_CODE_ENABLE_TASKS !== undefined) return {};
    return { env: { ...env, CLAUDE_CODE_ENABLE_TASKS: '1' } };
  };

  /**
   * The CLI option that writes a conversation under a name this host chose.
   *
   * Only a UUID is handed over: the SDK takes an id of that shape, and a name a
   * client made up goes to the CLI instead, which invents one the host records
   * once the CLI says what it is.
   */
  const namedUnder = (id: string): { sessionId: string } | Record<string, never> =>
    UUID.test(id) ? { sessionId: id } : {};

  // The input stream. A query with a live stream stays open between turns,
  // which is what makes a session a session rather than a series of them.
  const waiting: SDKUserMessage[] = [];

  async function* input(): AsyncGenerator<(typeof waiting)[number]> {
    for (;;) {
      while (waiting.length > 0) {
        const next = waiting.shift() as (typeof waiting)[number];
        yield next;
        if (ctx.steering !== undefined) {
          const said = ctx.steering;
          ctx.steering = undefined;
          ctx.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id: String(said.id ?? '') });
          ctx.touch();
        }
      }
      if (ctx.closed) return;
      await new Promise<void>((resolve) => { ctx.wake = resolve; });
    }
  }

  // ------------------------------------------------------------------ the run

  /**
   * Fail the turn now running, and this session with it, for the reason given.
   *
   * The road a CLI that died takes, and the road the bound below takes when one
   * never answers: a turn in flight is recorded as one that failed, with the
   * reason as its error part, and the session is marked gone for the turns that
   * follow.
   */
  const died = (why: string): void => {
    ctx.failed = why;
    /*
     * The CLI is gone, and it is not coming back on this session.
     *
     * Remembered separately from `failed`, which is about the last *turn*
     * and is cleared by the next `begin`. This is about the session: the
     * query is built once, at creation, so a CLI that dies before any turn
     * exists leaves nothing for the branch below to report and a `begin`
     * afterwards would start a turn nothing is left to answer. That is a
     * session that says it is thinking for as long as anyone watches it.
     */
    ctx.gone = why;
    const turn = ctx.active;
    if (turn) {
      turn.state = 'error';
      turn.duration = Date.now() - ctx.startedAt;
      ctx.settleOpen(turn);
      const part = ctx.addFailure(turn, why);
      ctx.turns.push(turn);
      ctx.active = undefined;
      ctx.emit('chat', { type: 'chat/error', turnId: turn.id, duration: turn.duration, part });
    }
    ctx.doing(undefined);
    ctx.touch();
  };

  /**
   * A CLI that has not answered its handshake is a CLI that died.
   *
   * `initializationResult` is the one call that says the process is up and
   * talking: it is answered when the CLI takes the control request the SDK
   * sends at startup, and rejected when there is nothing there to take it. A
   * CLI that is there and silent - a machine whose `docker exec` never returns,
   * a wrapper waiting on something that will not come - leaves the query alive
   * and every turn after it unanswered, which is a session drawn as thinking
   * for as long as anyone watches. The bound is what turns that into the
   * ending a dead CLI gets.
   *
   * The timer is cleared by whichever answer comes, and a query this host has
   * since put away fails nothing: it is not the CLI this session is reading.
   *
   * The query comes back out, so the builder reads as what it always was: the
   * bound is put on the way through and not built into anything.
   */
  const bounded = (handle: ReturnType<typeof query>): ReturnType<typeof query> => {
    const within = ctx.options.handshakeTimeoutMs ?? HANDSHAKE_MS;
    const timer = setTimeout(() => {
      if (ctx.handle !== handle) return;
      died(`Claude Code did not answer within ${within / 1000} seconds`);
      /*
       * Closed rather than left running: a CLI that answers ten minutes later
       * would be a process nobody is reading, for a session that has already
       * failed, and the turn it was going to answer is over.
       */
      try { handle.close(); }
      catch { /* Closing something already closing is the same ending. */ }
    }, within);
    const answered = (): void => { clearTimeout(timer); };
    void handle.initializationResult().then(answered, answered);
    return handle;
  };

  /**
   * A query for this session, on the agent named, carrying the conversation
   * this session already has.
   *
   * A function rather than a single call because the agent a message picks is
   * read after the CLI has already been started, and the SDK takes `agent` at
   * startup: a send that picks a different one has to ask for a new CLI and
   * resume the conversation into it. Only the agent and the conversation move;
   * every other option is read from the same places in every call.
   *
   * `first` is how this conversation is picked up, which is a fact about the
   * query that opened it. A rebuild asks again for nothing: it resumes the id
   * the CLI gave this session, which is the whole of what carries it over.
   *
   * Every query built here goes out with the bound on its handshake, which is
   * this one place rather than the two a session starts one from.
   */
  const buildQuery = (agent: string | undefined, first: boolean): ReturnType<typeof query> => bounded(query({
    prompt: input(),
    options: {
      cwd: ctx.options.cwd,
      /*
       * Where the CLI runs, when it is not here.
       *
       * The executable is named so the SDK builds a command for a *binary*
       * rather than for a script it would run under this host's node: with a
       * path that ends in `.js` it passes that path as an argument, and it is
       * this host's path, which the machine does not have. `executableArgs`
       * is empty by default, so what reaches the hook is the in-machine
       * command and the CLI's own flags.
       */
      ...(ctx.options.spawn === undefined ? {} : {
        pathToClaudeCodeExecutable: ctx.options.spawnExecutable ?? 'claude',
        spawnClaudeCodeProcess: ctx.options.spawn as never,
      }),
      // The peers of `cwd`, which the SDK takes at startup. The first entry is
      // the process root and is not one of these.
      ...(ctx.peers.length > 0 ? { additionalDirectories: [...ctx.peers] } : {}),
      /*
       * The MCP servers, declared here rather than found by the CLI.
       *
       * The CLI reads the same files either way; what changes is ownership. A
       * server the SDK was *given* is one `setMcpServers` can re-declare, and
       * that is the only way a token a client signed in with can be applied -
       * `setMcpServers` does not touch servers that came from a settings file.
       */
      ...(Object.keys(ctx.declared).length > 0 ? { mcpServers: ctx.declared as never } : {}),
      /*
       * The client plugins this session runs with.
       *
       * Directories this host made by copying what a client announced, which
       * is the only kind of path a CLI running here can open. `skipMcpDiscovery`
       * because the servers of a plugin are read off the same copies and
       * declared above: left to itself the CLI would find them a second way
       * and run each server twice.
       *
       * Read at startup, so a set that moved reaches a chat by starting it
       * again rather than by anything here.
       */
      ...(ctx.options.plugins === undefined || ctx.options.plugins.length === 0 ? {} : {
        plugins: ctx.options.plugins.map((one) => ({ type: 'local' as const, path: one.path, skipMcpDiscovery: true })),
      }),
      /*
       * What the host wants said, after the CLI's own prompt.
       *
       * The preset with an `append`, not a prompt of this backend's own: the
       * CLI's prompt is what makes it the CLI. `snapshot`, so the prompt is
       * recorded once for the conversation and a resume does not rewrite it
       * under the model's reasoning.
       */
      ...(ctx.options.instructions && ctx.options.instructions.length > 0
        ? { systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const, append: ctx.options.instructions.join('\n\n'), snapshot: true } }
        : {}),
      includePartialMessages: true,
      /*
       * Which of the CLI's settings files this session loads.
       *
       * A project's settings declare hooks, which are commands this host runs,
       * and the CLI loads a project's `CLAUDE.md` only when `project` is among
       * the sources - so a folder nobody vouched for gets `user` alone and
       * reaches the model with none of it. The person's own file is not a
       * project's and is kept either way - unless the session asked for none
       * of the person's settings, which is a bot's back session: nothing of
       * `~/.claude` reaches it, and the folder's own file still does where the
       * folder is trusted.
       */
      settingSources: settingSourcesOf(
        ctx.options.trusted?.(ctx.options.cwd) === true,
        ctx.options.userSettings !== false,
      ),
      /*
       * A subagent's own words, not only its tool calls.
       *
       * Without this the harness forwards a worker's `tool_use` and
       * `tool_result` and nothing else - so a chat opened for it has rows and
       * no text and no thinking, which is a transcript with the reasoning cut
       * out. The reference host turns this on for the same reason.
       */
      forwardSubagentText: true,
      /*
       * Over the daemon's own environment, never instead of it.
       *
       * The SDK's `env` *replaces* the subprocess environment rather than
       * merging with it, so handing it a lone credential is a subprocess with
       * no `PATH` and no `HOME` - which fails as something that has nothing to
       * do with authentication. Absent when nobody pushed a token, and then
       * the subprocess simply inherits, which is how every session worked
       * before this and how an automation's still does.
       */
      ...fromPreset(),
      /*
       * The servers of a plugin that a client switched off, which the CLI is
       * told not to run.
       *
       * A plugin is loaded from a directory the CLI reads itself, so a server
       * the host left out of `mcpServers` can still be found there. Named in
       * the CLI's own settings rather than left to the host's word alone,
       * which is the only place the CLI takes such a list from. Merged with
       * whatever a preset already put there, so a declared value is added to
       * rather than replaced.
       */
      ...(denied.length === 0 ? {} : {
        settings: {
          ...bag(fromPreset().settings),
          deniedMcpServers: denied.map((serverName) => ({ serverName })),
        },
      }),
      ...(ctx.options.env ? { env: { ...(fromPreset().env as Bag | undefined ?? process.env), ...ctx.options.env } } : {}),
      // In a machine, the env above is replaced by the variant's own alone.
      ...(ctx.options.spawn === undefined ? {} : { env: inMachine() }),
      // The switch for the task tools Claude keeps to itself.
      ...taskToolsEnv(),
      // From the settings, which is where it lives: it is a config key like
      // the others, and a second way in was a second thing to keep in step.
      ...(typeof ctx.settings.permissionMode === 'string' ? { permissionMode: ctx.settings.permissionMode } : {}),
      /*
       * The model this session is on, which the CLI only reads at startup.
       *
       * A session that was set to one and stopped there has no other way to
       * reopen on it: the stored setting is read above, and the query is the
       * only thing the CLI will take the model from before it says anything.
       * `default` is the CLI's own choice rather than a name, so it is left off
       * exactly as `take` leaves it off.
       */
      ...(ctx.chosen && ctx.chosen !== 'default' ? { model: ctx.chosen } : {}),
      // Before every shell command, the operator's environment and any client
      // script in force; before every call, the question for a tool the
      // operator's rule names; on every prompt, what the host asked said on
      // that turn; and at the end of each turn, what the CLI still has in hand.
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [ctx.sourceFirst] },
          /*
           * No matcher, so every tool reaches it and the hook itself reads the
           * rule. A day, because a person may take one: the CLI's default
           * timeout is far shorter than an answer can be, and a hook that gave
           * up would leave the question on the chat and the call refused.
           */
          { hooks: [ctx.ruleFirst], timeout: 24 * 60 * 60 },
        ],
        UserPromptSubmit: [{ hooks: [giveHostInstructions] }],
        Stop: [{ hooks: [keepStopped] }],
      },
      /*
       * The lists, at the moment the query is built.
       *
       * The SDK takes them natively, which is what makes this the smallest
       * thing that works - and it is only half of it: the SDK has nowhere to
       * put a later change, so `canUseTool` reads the same lists on every
       * call and that is what makes one set mid-session take effect.
       */
      ...(ctx.allowed.allow.length > 0 ? { allowedTools: [...ctx.allowed.allow] } : {}),
      ...denyOption(),
      /*
       * Which conversation this query carries.
       *
       * The first one is told how to pick it up - a resume, a fork, a rewind,
       * or an id of its own - and a rebuild asks again for none of it: the
       * conversation exists, and what changed is the agent running on it.
       *
       * On disk under the name the client gave it, in the first query at least.
       * The SDK invents an id and writes the transcript under that, so a
       * session a client created lived on disk under a name the client had
       * never heard of. While the daemon ran it answered to both, because it
       * held the pair in memory; once it restarted, the catalogue listed the
       * SDK's name and the URI the client created the session under answered
       * `No agent for session` for ever - the session was still there and its
       * only name for it was dead.
       *
       * Only where the name is a UUID, because that is what the SDK will take.
       * A client that names a session - or a chat of one - something else keeps
       * what it had. A rebuild that happens before the CLI has said its own id
       * keeps it too, for the same reason: nothing has been said under any
       * other name.
       *
       * A chat's own name is asked for first: `Start.chatId` is the conversation
       * that chat is, and the session's id is the conversation of its first chat
       * alone. With it, two chats of one session are two transcripts rather than
       * one written by two CLIs, which is what a peer chat is for.
       */
      ...(first
        ? (ctx.options.resume === undefined
          ? namedUnder(ctx.options.chatId ?? idOf(ctx.options.uri))
          : {
            // Resumed, not replayed: the agent picks up the context it built -
            // the files it read, the decisions it made - rather than being
            // handed a transcript of them and asked to infer the rest.
            resume: ctx.options.resume,
            /*
             * A fork, which the SDK spells as a resume that does not keep the id.
             *
             * `resumeSessionAt` is the prompt to continue from and `forkSession`
             * makes the continuation a session of its own, so the conversation
             * this was cut from carries on untouched.
             */
            ...(ctx.options.forkAt ? { forkSession: true, resumeSessionAt: ctx.options.forkAt } : {}),
            /*
             * A rewind, which is the same resume without the new id.
             *
             * `chat/truncated` drops the turns after a named one and carries on
             * in the conversation it dropped them from - so the id has to
             * survive it, or every later resume would reach the transcript that
             * still has them. That is the whole difference from a fork, and it
             * is one word.
             */
            ...(!ctx.options.forkAt && ctx.options.rewindAt ? { resumeSessionAt: ctx.options.rewindAt } : {}),
          })
        : (ctx.agentId !== undefined
          ? { resume: ctx.agentId }
          : namedUnder(ctx.options.chatId ?? idOf(ctx.options.uri)))),
      /*
       * The agent the main thread runs as, which the CLI reads at startup.
       *
       * Absent means the CLI's own default agent, which is what a message that
       * picked nothing is asking for.
       */
      ...(agent === undefined ? {} : { agent }),
      canUseTool: ctx.canUseTool,
    },
  } as Parameters<typeof query>[0]));

  /**
   * A query for this session, and what it was built from.
   *
   * The values are recorded here rather than at each call site, because every
   * query a session builds is one of these: `begin` is where the record is read
   * again, and it compares against what the CLI answering now was started with.
   */
  const startQuery = (agent: string | undefined, first: boolean): ReturnType<typeof query> => {
    ctx.startedWith = JSON.stringify(ctx.values);
    return buildQuery(agent, first);
  };

  /**
   * The turns whose own transcript id has been said, by this host's turn id.
   *
   * Once per turn, because a turn is one line in the catalogue however many
   * `user` frames it is made of: only the first echo of a turn is its prompt,
   * and the rest are tool results that name entries of their own.
   */
  const reported = new Set<string>();

  /**
   * The backend's id for the *last* thing in each turn, by this host's turn id.
   *
   * What both cuts take. A rewind keeps the turn and drops what came after it,
   * a fork copies the conversation through it, and the SDK's rule for
   * `resumeSessionAt` is the same either way: the kept turn's last chain entry,
   * whatever it is. Cutting at the prompt instead keeps the question and drops
   * the answer to it, which is a turn a client can still see and the agent no
   * longer remembers giving.
   */
  const ends = new Map<string, string>();

  /**
   * Ask the CLI for a model, and say why it would not take it if it will not.
   *
   * `setModel` is the one call here that decides what the CLI will run, so a
   * turn that asked for a model the CLI refuses cannot be answered by whatever
   * the session was on before and still be the turn that was asked for. A
   * refusal is the reason to fail the turn with, and the model is not left
   * changed - so `chosen` stays where it was for the next turn.
   */
  const take = async (id: string): Promise<string | undefined> => {
    try {
      await ctx.handle.setModel(id === 'default' ? undefined : id);
      return undefined;
    }
    catch (error: unknown) {
      const why = error instanceof Error ? error.message : String(error);
      return `The harness would not take model ${id}: ${why}`;
    }
  };

  /**
   * Move this session's CLI onto the agent a message picked, if it is not
   * already there.
   *
   * The SDK reads `agent` when the query is built and has nowhere to put a
   * later one, so a pick that differs cannot be answered by the CLI already
   * running: it has to be answered by a new CLI, resumed into the same
   * conversation, before the turn's prompt goes out. A pick equal to what is
   * running costs nothing, which is the ordinary case - the picker sends the
   * same agent on every message.
   *
   * No agent named means the CLI's own default, which is also what a query
   * built without one runs on.
   */
  const switchAgent = (uri: string | undefined): string | undefined => {
    const name = uri === undefined ? undefined : agentNameOf(uri);
    if (name === ctx.running) return undefined;
    const was = ctx.handle;
    try { was.close(); }
    catch (error: unknown) {
      return `The harness would not stop for agent ${name ?? 'default'}: ${error instanceof Error ? error.message : String(error)}`;
    }
    ctx.running = name;
    ctx.gone = undefined;
    ctx.handle = startQuery(name, false);
    void consume();
    return undefined;
  };

  /**
   * Read one CLI's frames until it ends.
   *
   * One call per query rather than one for the session, because a message that
   * picks another agent replaces the query and this has to be reading whichever
   * one is current. A loop that ended because it was replaced says nothing:
   * `handle` is not the query it was reading, so its ending is this host's own
   * doing and the session is exactly where it was.
   */
  const consume = async (): Promise<void> => {
    const mine = ctx.handle;
    try {
      for await (const raw of mine) {
        const message = bag(raw as unknown);
        const type = str(message.type);
        // Every message carries it, so this needs no particular one to arrive.
        const said = str(message.session_id);
        if (said) ctx.agentId = said;

        // The message stream's own init. Capabilities come from the control
        // protocol instead (see `describe`), because those are needed before
        // a turn; what this adds is the model the turn actually ran on.
        if (type === 'system' && str(message.subtype) === 'init') { ctx.handshake = message; continue; }

        /*
         * The harness compacted its context.
         *
         * Deliberately *not* `chat/truncated`: that means "drop the turns
         * after this one", and every one of them is still in the transcript
         * and still readable. What was compacted is the model's context, not
         * the conversation, and a host that conflated the two would delete
         * from every client's screen a history it can still serve.
         *
         * Said as a notice in the running turn instead, because somebody
         * watching an answer change character halfway through deserves to
         * know why.
         */
        if (type === 'system' && str(message.subtype) === 'compact_boundary') {
          const turn = ctx.active;
          if (turn) {
            const about = bag(message.compact_metadata);
            const was = typeof about.pre_tokens === 'number' ? about.pre_tokens : undefined;
            const now = typeof about.post_tokens === 'number' ? about.post_tokens : undefined;
            const how = str(about.trigger) === 'manual' ? 'Context compacted' : 'Context compacted automatically';
            ctx.addPart(ctx.mainScope, {
              id: `${String(turn.id)}:compact:${String(ctx.turns.length)}`,
              kind: 'systemNotification',
              content: was !== undefined && now !== undefined
                ? `${how}: ${String(was)} tokens to ${String(now)}.`
                : `${how}.`,
            });
          }
          continue;
        }

        /*
         * How far this turn has got, in the backend's own names for things.
         *
         * `user` and `assistant` are the frames that become entries in the
         * transcript chain; a `stream_event` is a piece of one that is not
         * written down separately, and a `result` closes a turn without being
         * part of it. So the last of these two seen while a turn is active is
         * that turn's last chain entry, which is where a rewind cuts.
         */
        if (ctx.active !== undefined && (type === 'user' || type === 'assistant')) {
          const entry = str(message.uuid);
          if (entry !== undefined) ends.set(String(ctx.active.id), entry);
        }

        /*
         * A running subagent, saying how far it has got.
         *
         * `task_progress` is the harness's own status line for a `Task`
         * that is still running: a model-written summary when the option
         * is on, or the last tool it reached for. It goes on the call as
         * `_meta.progressMessage` - the reference client's word for a line
         * drawn on a running row and dropped when the row ends - and never
         * into the result, which is what the tool answered and not what it
         * was doing on the way. The reducer replaces a call's whole `_meta`
         * on any action that carries one, so the kind stamped at the start
         * is carried along rather than lost. The same line twice is said
         * once.
         */
        if (type === 'system' && str(message.subtype) === 'task_progress') {
          const id = str(message.tool_use_id);
          // The call is in the chat of the agent that made it, which for a
          // nested worker is another worker's chat and not the lead's.
          const scope = id === undefined ? undefined : ctx.scopeOfCall(id);
          const part = scope === undefined || id === undefined ? undefined : scope.parts.get(id);
          const call = part === undefined ? undefined : bag(part.toolCall);
          const line = str(message.summary)
            ?? (str(message.last_tool_name) !== undefined ? `Running ${String(message.last_tool_name)}` : undefined);
          if (call !== undefined && line !== undefined && str(call.status) === 'running'
            && scope !== undefined
            && str(bag(call._meta).progressMessage) !== line) {
            call._meta = { ...bag(call._meta), progressMessage: line };
            ctx.emitOn(scope, {
              type: 'chat/toolCallContentChanged',
              turnId: scope.turn?.id,
              toolCallId: id,
              content: list(call.content),
              _meta: call._meta,
            });
          }
          continue;
        }

        /*
         * A worker the harness says is running, and the one that says it ended.
         *
         * Every call `task_started` names is background, whatever its
         * `is_backgrounded` says, and ends on its terminal `task_notification`.
         * A call that did not ask for the background also ends on its own
         * `tool_result`; whichever of the two arrives first ends the worker,
         * and the second finds it ended.
         */
        if (type === 'system' && str(message.subtype) === 'task_started') {
          const id = str(message.tool_use_id);
          const task = str(message.task_id);
          if (id !== undefined) ctx.background.add(id);
          if (id !== undefined && task !== undefined && !ctx.ended.has(id)) ctx.tasks.set(id, task);
          ctx.noteTask(message);
          continue;
        }
        /*
         * Every task the harness is running, after a change to that set.
         *
         * The whole set, not the change: an id that left it has stopped, an id
         * that joined it has started, and either way this is what the chat
         * lists as its background work.
         */
        if (type === 'system' && str(message.subtype) === 'background_tasks_changed') {
          ctx.noteLive(message);
          continue;
        }
        if (type === 'system' && str(message.subtype) === 'task_notification') {
          const id = str(message.tool_use_id);
          const task = str(message.task_id);
          const status = str(message.status);
          if (status === 'completed' || status === 'failed' || status === 'stopped') {
            if (task !== undefined) ctx.dropTask(task);
            if (id !== undefined && ctx.background.has(id)) {
              ctx.endWorker(id, status === 'completed' ? 'complete' : status === 'stopped' ? 'cancelled' : 'error',
                status === 'failed' ? str(message.summary) : undefined);
            }
          }
          continue;
        }

        /*
         * The CLI started its running total again.
         *
         * `/clear`, a plan-mode exit and a fresh session all send one, and
         * every `modelUsage` figure behind it starts over from zero. The cost
         * baseline goes with it: left where it was it sits above the new total
         * and reads every result after the reset as no spend.
         */
        if (type === 'conversation_reset') { ctx.newConversation(); continue; }

        if (type === 'stream_event') { ctx.streamed(bag(message.event), str(message.parent_tool_use_id) ?? ''); continue; }
        if (type === 'assistant') { ctx.assistant(bag(message.message), str(message.parent_tool_use_id) ?? ''); continue; }
        if (type === 'user') {
          // The prompt's own id. Taken from the first echo of a turn and not
          // after: later `user` frames in one turn are tool results, which
          // name entries of their own and are not the turn.
          const said = str(message.uuid);
          const parent = str(message.parent_tool_use_id) ?? '';
          if (ctx.active && said !== undefined && !reported.has(String(ctx.active.id))) {
            reported.add(String(ctx.active.id));
            /*
             * The same echo, said as the id this turn is written down under.
             *
             * The CLI names every turn in the transcript by its own uuid, so
             * what the host keeps against the id a client chose is not what a
             * history read back asks about. Only
             * the lead turn's own echo says it: a worker's echo is a uuid in
             * the lead turn's transcript too, and a turn named after a
             * worker's prompt is not a turn a client can find.
             */
            if (parent === '') ctx.options.onTurnRecorded?.(String(ctx.active.id), said);
          }
          /*
           * The output Claude saved for a `Bash` result too large to send, read
           * before the result is mapped so its completion names the terminal,
           * as the reference waits for it. Only such a message waits here.
           * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeSdkMessageRouter.ts#L77-L87
           */
          const reading = ctx.readSavedOutput(raw as SDKUserMessage);
          if (reading !== undefined) await reading;
          ctx.results(bag(message.message), parent, message.tool_use_result);
          continue;
        }

        if (type === 'result') {
          const turn = ctx.active;
          /*
           * Read before the turn is pushed, because the reason goes inside it.
           * `is_error` carries the words; a subtype that is not `success` is a
           * turn that ended badly with none, and saying which is better than
           * an error part that says only that there was one.
           */
          const wrong = message.is_error === true
            ? (list(message.errors).map(String).join('\n') || 'The turn failed')
            : str(message.subtype) !== 'success'
              ? `The turn ended ${str(message.subtype) ?? 'without succeeding'}`
              : undefined;
          if (turn) {
            /*
             * Every turn that ends says how it ended.
             *
             * `Turn.state` is required and this only ever set it when
             * something went wrong, so a turn that simply worked went into
             * the history with no state at all. A client driven by actions
             * never saw it - its reducer fills the state in on
             * `chat/turnComplete` - but a client that subscribes afterwards
             * reads the snapshot, and the snapshot is this.
             */
            turn.state = str(message.subtype) !== 'success' ? 'error' : 'complete';
            turn.duration = typeof message.duration_ms === 'number' ? message.duration_ms : Date.now() - ctx.startedAt;
            // Before the turn completes, not after: the reducer hangs usage on
            // `activeTurn`, and `chat/turnComplete` is what moves that into
            // `turns` - so the other order reports it about nothing.
            // A stream that carried no partial messages leaves the sum empty,
            // and the result's own main-loop count is then the best there is.
            const used = ctx.sum() ?? ctx.usageOf(message.usage, ctx.ran);
            const cost = ctx.costOf(message);
            if (used !== undefined || cost !== undefined) {
              // The cost rides the tokens' own `_meta`, the same place cache
              // writes go, rather than beside them as a field of its own.
              const total: Bag = used ?? {};
              if (cost !== undefined) total._meta = { ...bag(total._meta), 'ahpd.cost': cost };
              turn.usage = total;
              ctx.emit('chat', { type: 'chat/usage', turnId: turn.id, usage: total });
            }
            ctx.settleOpen(turn);
            const part = wrong === undefined ? undefined : ctx.addFailure(turn, wrong);
            ctx.turns.push(turn);
            ctx.active = undefined;
            ctx.ran = undefined;
            ctx.parts.clear();
            ctx.calling.clear();
            ctx.streaming = undefined;
            /*
             * And every preview the turn was still holding. A question left
             * unanswered when the turn ended is one nobody will answer now, and
             * its text would be a file that never came to be. A subagent's
             * calls are the same: its frames arrive inside this turn, so this
             * is the end of them too.
             */
            ctx.settleEdits();
            /*
             * One action ends a turn, and which one says how it went.
             *
             * `chat/error` is not a message beside a completed turn - it *is*
             * the ending, with `turnId`, a required `duration` and the error
             * part it appends. This sent `chat/turnComplete` and then a
             * `chat/error` carrying only `message`: the turn landed in the
             * history as a success, and the second action reached a reducer
             * with no open turn left to end and did nothing at all. So a turn
             * that failed was drawn as one that worked, and the reason was in
             * the snapshot and nowhere in the stream.
             */
            if (part !== undefined) {
              ctx.emit('chat', { type: 'chat/error', turnId: turn.id, duration: turn.duration, part });
            }
            else {
              ctx.emit('chat', { type: 'chat/turnComplete', turnId: turn.id, duration: turn.duration });
            }
          }
          // The result an interrupt ends with, for a turn `cancel` already
          // ended: it says the turn was stopped, which is not a failure.
          const stopped = turn === undefined && ctx.interrupted;
          ctx.interrupted = false;
          // About the session rather than the turn: it reads into
          // `Status.Error` and into the summary, and the next turn clears it.
          if (message.is_error === true && !stopped) ctx.failed = wrong ?? 'The turn failed';
          ctx.doing(undefined);
          ctx.touch();
          ctx.startNext();
        }
      }
    } catch (error) {
      // A query this host put away is not a CLI that died: the one that
      // replaced it is already running the same conversation.
      if (ctx.handle !== mine) return;
      /*
       * A session already gone keeps the reason it went.
       *
       * The bound above closes a CLI that never answered, and what a close
       * raises afterwards is the close rather than the reason - which would
       * land here and replace the one sentence a person can act on with the
       * SDK's own words for a socket that went away.
       */
      if (ctx.gone !== undefined) return;
      /*
       * What the CLI never starting reads as, rather than what the SDK says
       * about this host.
       *
       * A spawn failure arrives with the SDK's own words for it - the bundled
       * binary's path, the libc it wanted, the errno - and none of that is
       * something a person can act on. `failureOf` answers the short message
       * for those and leaves every other error's message alone.
       */
      died(failureOf(error));
    }
    // A loop that ended without throwing has ended all the same: the CLI
    // exited and said nothing, and a later turn has as little to answer it.
    if (ctx.handle !== mine) return;
    ctx.gone ??= 'The agent stopped';
    ctx.touch();
  };

  /**
   * Read a record's values again, and put a new CLI on the conversation when
   * they changed.
   *
   * An edit applies at the next turn, which is the whole of the promise: the
   * turn already running finishes on the CLI it started on, and the turn that
   * begins after the edit is answered by a CLI built from what the record says
   * now. Nothing to do for a preset, which no running daemon can edit - the
   * values were read once and are what they were.
   *
   * The conversation moves as a `switchAgent` restart moves it: the new query
   * resumes the id the CLI gave this session, so the transcript, the model and
   * everything the SDK said are still there. A CLI that will not stop is the
   * turn's own refusal rather than a session that died, which is why it comes
   * back as a sentence.
   */
  const refreshPreset = (): string | undefined => {
    const live = ctx.options.presetOf;
    if (live === undefined) return undefined;
    const now = ctx.valuesOf(live());
    const said = JSON.stringify(now);
    if (said === ctx.startedWith) return undefined;
    const was = ctx.handle;
    try { was.close(); }
    catch (error: unknown) {
      return `The harness would not stop for the record: ${error instanceof Error ? error.message : String(error)}`;
    }
    ctx.values = now;
    ctx.gone = undefined;
    ctx.handle = startQuery(ctx.running, false);
    void consume();
    return undefined;
  };

  return { waiting, startQuery, ends, take, switchAgent, consume, refreshPreset, stopped, keepStopped, giveHostInstructions };
}
