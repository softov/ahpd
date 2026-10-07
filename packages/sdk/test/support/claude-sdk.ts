/*
 * The fake Claude SDK.
 *
 * What the real one returns is opaque - a registered in-process server - so
 * the fake keeps the definitions where a test can call one. It is a module of
 * its own, and imports nothing, because a `vi.mock` factory loads it while
 * `@anthropic-ai/claude-agent-sdk` is still being mocked.
 */

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
  init: {} as Record<string, unknown>,
  mcp: [] as Record<string, unknown>[],
  skills: [] as Record<string, unknown>[],
  said: [] as string[],
  modelsSet: [] as (string | undefined)[],
  modesSet: [] as string[],
  effortsSet: [] as (string | null | undefined)[],
  sandboxSet: [] as ({ enabled: boolean } | null | undefined)[],
  interrupted: 0,
  mcpToggled: [] as { name: string; enabled: boolean }[],
  mcpReconnected: [] as string[],
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
        sdk.said.push((frame as { message?: { content?: string } }).message?.content ?? '');
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
      applyFlagSettings: async (settings: { effortLevel?: string | null; sandbox?: { enabled: boolean } | null }) => {
        if ('effortLevel' in settings) sdk.effortsSet.push(settings.effortLevel);
        if ('sandbox' in settings) sdk.sandboxSet.push(settings.sandbox);
      },
      toggleMcpServer: async (name: string, enabled: boolean) => { sdk.mcpToggled.push({ name, enabled }); },
      reconnectMcpServer: async (name: string) => { sdk.mcpReconnected.push(name); },
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
      reloadPlugins: async () => ({ plugins: [] }),
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
  sdk.mcp.length = 0;
  sdk.skills.length = 0;
  sdk.said.length = 0;
  sdk.modelsSet.length = 0;
  sdk.modesSet.length = 0;
  sdk.effortsSet.length = 0;
  sdk.sandboxSet.length = 0;
  sdk.queries.length = 0;
  sdk.init = {};
  sdk.interrupted = 0;
  sdk.mcpToggled.length = 0;
  sdk.mcpReconnected.length = 0;
  sdk.mcpDeclared.length = 0;
  sdk.toolUseIds.length = 0;
  sdk.sendsToolUseId = true;
  sdk.canUseTool = undefined;
}
