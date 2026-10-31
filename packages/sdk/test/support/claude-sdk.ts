/*
 * The fake Claude SDK.
 *
 * What the real one returns is opaque - a registered in-process server - so
 * the fake keeps the definitions where a test can call one. It is a module of
 * its own, and imports nothing but node's, because a `vi.mock` factory loads
 * it while `@anthropic-ai/claude-agent-sdk` is still being mocked.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Where the CLI keeps its conversations for the cases that load the fake.
 *
 * A folder of their own, as `CLAUDE_CONFIG_DIR` names one to the backend, so
 * what a case writes there is all the backend finds: it resumes only a
 * conversation the CLI wrote, and reads the project folders to know.
 */
const config = mkdtempSync(join(tmpdir(), 'ahpd-claude-config-'));
process.env.CLAUDE_CONFIG_DIR = config;

/**
 * The conversation `id` as the CLI writes it once its first message reaches
 * it: a file in the project folder of `cwd`, spelled as the CLI spells it,
 * whose first entry is the prompt, as CLI 2.1.301 wrote one.
 *
 * A case that resumes a conversation says the CLI wrote it here, since the
 * backend starts any other under the id it was asked to resume.
 */
export function wrote(id: string, cwd: string): void {
  let real = cwd;
  try { real = realpathSync(cwd); }
  catch { /* a folder that is not there is spelled as given */ }
  const project = join(config, 'projects', real.replace(/[^A-Za-z0-9]/g, '-'));
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, `${id}.jsonl`), `${JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: 'f0829d44-61b9-476c-abb6-cb4427e28cb3', type: 'user',
    message: { role: 'user', content: 'hi' }, uuid: '6f79faf7-646d-4773-b101-06232d161be1',
    timestamp: '2026-10-29T22:14:15.249Z', permissionMode: 'auto', promptSource: 'sdk', turnOrigin: 'sdk',
    turnPosition: { promptIndex: 0, turnIndex: 1 }, userType: 'external', entrypoint: 'sdk-cli',
    cwd: real, sessionId: id, version: '2.1.301', gitBranch: 'master',
  })}\n`);
}

export interface Fake {
  frames: Record<string, unknown>[];
  wake: (() => void) | undefined;
  closed: boolean;
  options: Record<string, unknown>;
}

export const sdk = {
  sessions: [] as Record<string, unknown>[],
  transcript: [] as Record<string, unknown>[],
  /** How many times a transcript was actually read off disk. */
  reads: 0,
  /**
   * How many times the projects directory was listed.
   *
   * The cost this host's largest is made of: every variant of the Claude
   * plugin reads the same directory for the same sessions, so a count of three
   * for one answer is two passes over the same files that need not happen.
   */
  listed: 0,
  /**
   * How many times the store was asked about one session by id.
   *
   * What a client opening a row the host does not hold costs, against `listed`:
   * one file read rather than a pass over every transcript on the machine.
   */
  asked: 0,
  /** How many of the next reads should throw, so a retry can be seen. */
  throwOnce: 0,
  /** Every conversation `deleteSession` was asked to delete, in order. */
  deleted: [] as string[],
  init: {} as Record<string, unknown>,
  mcp: [] as Record<string, unknown>[],
  skills: [] as Record<string, unknown>[],
  /**
   * The plugins the CLI reports, and the ones `enabledPlugins` has taken away.
   *
   * A plugin switch is an `enabledPlugins` setting the CLI reads when it loads
   * its plugins, so one switched off stops being one it loads - which is what
   * `reloadPlugins` answers and why the CLI's own list cannot be what a
   * switched-off row is drawn from.
   */
  plugins: [] as Record<string, unknown>[],
  pluginsOff: new Set<string>(),
  /** Every set of flag settings the CLI was handed, in order. */
  flags: [] as Record<string, unknown>[],
  said: [] as string[],
  /**
   * What each prompt carried when it was not plain text, in order.
   *
   * A message with attachments goes to the CLI as content blocks rather than
   * a string, and `said` holds the strings alone - so a case about a message
   * with a picture reads it here.
   */
  blocks: [] as unknown[][],
  /**
   * The uuid each prompt carried, in order.
   *
   * The CLI writes a streamed prompt to its transcript under that uuid and
   * echoes nothing back, so a case about a turn read back after a restart
   * names the turn's prompt by it.
   */
  uuids: [] as (string | undefined)[],
  modelsSet: [] as (string | undefined)[],
  modesSet: [] as string[],
  effortsSet: [] as (string | null | undefined)[],
  sandboxSet: [] as ({ enabled: boolean } | null | undefined)[],
  interrupted: 0,
  mcpToggled: [] as { name: string; enabled: boolean }[],
  mcpReconnected: [] as string[],
  /**
   * What a toggle or a reconnect of an MCP server throws, when set.
   *
   * The SDK's contract for both calls is "Throws on failure", which is how a
   * server that would not start or stop reaches the session. The call is
   * recorded before it throws, as one the session made.
   */
  mcpFails: undefined as string | undefined,
  /** Every set of MCP servers re-declared on a running session, in order. */
  mcpDeclared: [] as Record<string, unknown>[],
  /**
   * The call ids the CLI hands its in-process handlers, in the order it does.
   *
   * The real CLI names the call it is running in the handler's `_meta`, so a
   * test that queues an id here is a test of a handler that was handed one. A
   * queue and not a counter, because the ids are the model's own - `call-1`
   * from the assistant frame this test emitted - and no counter could guess
   * them.
   */
  toolUseIds: [] as string[],
  /**
   * Whether the fake hands an id at all.
   *
   * False is a CLI that puts nothing in `_meta`, which is what the fallback
   * exists for. `packages/agent-claude` logs when it joins by name and input,
   * so a live run against a real CLI is what says whether that path is still
   * needed.
   */
  sendsToolUseId: true,
  canUseTool: undefined as undefined | ((n: string, i: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
  /**
   * Every CLI the host started, in order.
   *
   * Per query and not shared, because the host opens one at boot just to
   * ask what the harness offers - and a single frame queue would let that
   * one swallow the frames meant for a session, which is a test failing for
   * a reason that has nothing to do with the code under it.
   */
  queries: [] as Fake[],
};

/**
 * What the CLI passes beside the arguments, which is where the call id rides.
 *
 * One id per invocation, taken from the queue in the order the handlers are
 * called - which is the order the CLI runs the tools. Nothing when the test
 * queued nothing or asked the fake not to send one, and then a handler is in
 * the position of a CLI that named no call.
 */
const extraFor = (): Record<string, unknown> | undefined => {
  if (!sdk.sendsToolUseId) return undefined;
  const id = sdk.toolUseIds.shift();
  return id === undefined ? undefined : { _meta: { 'claudecode/toolUseId': id } };
};

export const fake = {
  /*
   * The definitions as the host built them, with the arguments a handler is
   * handed wrapped on: the real SDK calls a tool handler with the arguments
   * and the request's `extra`, and a test calling one has to be calling the
   * same thing.
   */
  createSdkMcpServer: (given: Record<string, unknown>) => ({
    type: 'sdk',
    name: given.name,
    tools: (given.tools as { handler: (input: unknown, extra?: unknown) => unknown }[]).map((one) => ({
      ...one,
      handler: (input: unknown, extra?: unknown) => one.handler(input, extra ?? extraFor()),
    })),
  }),
  listSessions: async () => {
    sdk.listed += 1;
    // A tick, so callers meant to share one listing really do overlap: a
    // listing that answers synchronously is finished before the second caller
    // asks for it, and one pass and three are then indistinguishable.
    await new Promise((r) => { setTimeout(r, 0); });
    return sdk.sessions;
  },
  getSessionInfo: async (id: string) => {
    sdk.asked += 1;
    await new Promise((r) => { setTimeout(r, 0); });
    // The same store `listSessions` reads, so a row found by id is the row a
    // listing would have offered - which is what the CLI's own answer is.
    return sdk.sessions.find((one) => one['sessionId'] === id);
  },
  /*
   * The SDK's delete, as its declaration says it works: the conversation's
   * file goes from the projects folder, and a session it does not hold throws.
   * The fake holds a conversation in two places, its listing and the files
   * `wrote` made, so either one is a session it holds.
   */
  deleteSession: async (id: string) => {
    sdk.deleted.push(id);
    await new Promise((r) => { setTimeout(r, 0); });
    const projects = join(config, 'projects');
    const files = existsSync(projects)
      ? readdirSync(projects).map((project) => join(projects, project, `${id}.jsonl`)).filter((file) => existsSync(file))
      : [];
    const listed = sdk.sessions.findIndex((one) => one['sessionId'] === id);
    if (files.length === 0 && listed < 0) throw new Error(`Session ${id} not found`);
    for (const file of files) rmSync(file);
    if (listed >= 0) sdk.sessions.splice(listed, 1);
  },
  getSessionMessages: async () => {
    sdk.reads += 1;
    // A tick, so concurrent callers actually overlap: an implementation that
    // reads once per caller and one that shares a read are indistinguishable
    // when the read resolves synchronously.
    await new Promise((r) => { setTimeout(r, 1); });
    if (sdk.throwOnce > 0) {
      sdk.throwOnce -= 1;
      throw new Error('the transcript could not be read');
    }
    return sdk.transcript;
  },
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false, options };
    sdk.queries.push(fake);
    if (options.canUseTool) sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    void (async () => {
      for await (const frame of prompt) {
        const { message, uuid } = frame as { message?: { content?: unknown }; uuid?: string };
        const content = message?.content;
        if (typeof content === 'string') sdk.said.push(content);
        else if (Array.isArray(content)) sdk.blocks.push(content);
        sdk.uuids.push(uuid);
      }
    })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.frames.length > 0) yield fake.frames.shift() as Record<string, unknown>;
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => { sdk.interrupted++; },
      setPermissionMode: async (mode: string) => { sdk.modesSet.push(mode); },
      setModel: async (model?: string) => { sdk.modelsSet.push(model); },
      applyFlagSettings: async (settings: { effortLevel?: string | null; sandbox?: { enabled: boolean } | null; enabledPlugins?: Record<string, boolean> }) => {
        sdk.flags.push(settings);
        if ('effortLevel' in settings) sdk.effortsSet.push(settings.effortLevel);
        if ('sandbox' in settings) sdk.sandboxSet.push(settings.sandbox);
        // The flag layer as the CLI keeps it, one assignment per key, with the
        // source of a plugin as the key a switch moves.
        for (const [source, on] of Object.entries(settings.enabledPlugins ?? {})) {
          if (on) sdk.pluginsOff.delete(source);
          else sdk.pluginsOff.add(source);
        }
      },
      toggleMcpServer: async (name: string, enabled: boolean) => {
        sdk.mcpToggled.push({ name, enabled });
        if (sdk.mcpFails !== undefined) throw new Error(sdk.mcpFails);
      },
      reconnectMcpServer: async (name: string) => {
        sdk.mcpReconnected.push(name);
        if (sdk.mcpFails !== undefined) throw new Error(sdk.mcpFails);
      },
      // Replaces the set, which is what the real one does - so the options a
      // test reads back are what the session is actually offering now.
      setMcpServers: async (servers: Record<string, unknown>) => {
        fake.options.mcpServers = servers;
        sdk.mcpDeclared.push(servers);
      },
      // The control protocol: answers without a turn having happened, which
      // is the whole reason capabilities are read from here.
      initializationResult: async () => sdk.init,
      mcpServerStatus: async () => sdk.mcp,
      reloadSkills: async () => ({ skills: sdk.skills }),
      reloadPlugins: async () => ({
        plugins: sdk.plugins.filter((one) => !sdk.pluginsOff.has(
          String(one['source'] ?? '') === '' ? `${String(one['name'])}@${String(one['path'])}` : String(one['source']),
        )),
      }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
};

export function resetSdk(): void {
  sdk.sessions.length = 0;
  sdk.transcript.length = 0;
  sdk.reads = 0;
  sdk.listed = 0;
  sdk.asked = 0;
  sdk.throwOnce = 0;
  sdk.deleted.length = 0;
  sdk.mcp.length = 0;
  sdk.skills.length = 0;
  sdk.plugins.length = 0;
  sdk.pluginsOff.clear();
  sdk.flags.length = 0;
  sdk.said.length = 0;
  sdk.blocks.length = 0;
  sdk.uuids.length = 0;
  sdk.modelsSet.length = 0;
  sdk.modesSet.length = 0;
  sdk.effortsSet.length = 0;
  sdk.sandboxSet.length = 0;
  sdk.queries.length = 0;
  sdk.init = {};
  sdk.interrupted = 0;
  sdk.mcpToggled.length = 0;
  sdk.mcpReconnected.length = 0;
  sdk.mcpFails = undefined;
  sdk.mcpDeclared.length = 0;
  sdk.toolUseIds.length = 0;
  sdk.sendsToolUseId = true;
  sdk.canUseTool = undefined;
  rmSync(join(config, 'projects'), { recursive: true, force: true });
}
