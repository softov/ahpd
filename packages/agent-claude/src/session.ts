import { createSdkMcpServer, query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import { protectedResource, urlOf } from './mcp.js';
import type { ActiveTurn, McpServerState, ToolCallCompletedState, ToolCallRunningState, ToolResultContent, ToolResultTerminalContent, ToolResultTextContent } from '@microsoft/agent-host-protocol';
import { Status, idOf, tail } from '@ahpd/server';
import type { Bag, BoundTool, Chosen, OnWire, Session, SessionOptions, WireTurn } from '@ahpd/server';

/**
 * The effort levels this backend has, weakest first.
 *
 * One list, because two of them drifted: a model's own `thinkingLevel` form
 * and the session-wide `effortLevel` key are the same five words reaching the
 * same setting, and a client that read one set of labels from one control and
 * another set from the other is being told they are different things.
 */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/** What a person reads instead of an effort level. The reference client's words. */
export const EFFORT_LABELS: Record<typeof EFFORTS[number], string> = {
  low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra High', max: 'Max',
};

/**
 * RFC 9728 metadata for a server that needs signing in.
 *
 * `resource` is the one field the protocol requires of it - the canonical
 * identifier a client's `authenticate` must name - so it is the one this
 * spells out; the rest is whatever the server published.
 */
export type Published = Bag & { resource: string };

/** What the SDK will accept as a session id of our choosing. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One agent session, reduced into the state its channels hold.
 *
 * The agent SDK reports what happened as its own message stream; a host has to
 * report the same events as AHP state actions. This module is that
 * translation, and holds the resulting state for a subscription snapshot.
 *
 * Rules the protocol requires of anything emitting chat actions:
 *
 * - A response part must exist before text streams into it: emit
 *   `chat/responsePart` to create it, then `chat/delta` to append. A delta
 *   naming a part that was never opened appends to nothing.
 * - The running turn is `activeTurn` and is not in `turns`. It moves into
 *   `turns` when it completes.
 * - A turn carries both sides: `message.text` is what the person said,
 *   `responseParts` is what the agent answered.
 * - The client starts turns. `chat/turnStarted` arrives from the client; the
 *   host reduces it and runs the agent.
 */

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

interface PendingInput {
  id: string;
  entry: Bag;
  /** `AskUserQuestion` needs its own payload echoed back verbatim. */
  questions?: unknown[];
  /** Question id to the question text the SDK keys answers by. */
  asked: Map<string, string>;
  /**
   * What somebody has typed so far, by question id.
   *
   * The protocol calls this the request's synced answer state: a client
   * dispatches `chat/inputAnswerChanged` per question as it is filled in, and
   * `chat/inputCompleted` may arrive with no answers at all because these are
   * the answers. Held here rather than in a client so the other people in the
   * session see the form being filled in.
   */
  answers: Map<string, Bag>;
  settle(result: { behavior: 'allow'; updatedInput: Bag } | { behavior: 'deny'; message: string }): void;
}

/**
 * What a tool call is *about*, in one line.
 *
 * The only thing separating twenty identical rows, so it is worth doing per
 * tool: `Bash` is its command, the file tools are their path. A row reading
 * `{"file_path":"/very/long/…","offset":0}` is a row nobody reads.
 */
function summarize(name: string, input: Bag): string | undefined {
  if (name === 'Bash') return str(input.command);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return str(input.file_path);
  if (name === 'Glob' || name === 'Grep') return str(input.pattern);
  if (name === 'Task' || name === 'Agent') return str(input.description);
  return Object.keys(input).length > 0 ? JSON.stringify(input).slice(0, 400) : undefined;
}

function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  const parts = list(content).map((block) => str(bag(block).text)).filter((t): t is string => t !== undefined);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * What the session was handed, in the protocol's shape.
 *
 * Eight `CustomizationType`s and one flat list. `disableUserInvocation` is
 * what decides whether a skill or prompt appears after a slash - offering one
 * the host will refuse is worse than not offering it at all.
 *
 * The source is the CLI's *control* protocol, not its message stream:
 * `initializationResult()` and `mcpServerStatus()` answer without a turn
 * having happened. That matters because everything here is what a client
 * needs **before** anybody says anything - the models to pick from, the
 * commands behind a slash. Waiting for the `init` message would mean a
 * composer that can only offer them once the conversation has started, which
 * is exactly too late.
 */
export function customizationsOf(init: Bag, mcp: unknown[], skills: unknown[] = [], wanted?: Map<string, Published>): Bag[] {
  const out: Bag[] = [];

  /*
   * Where a customization of each kind lives, and the container it goes in.
   *
   * A top-level `Customization` is a *container* - a plugin or a directory -
   * whose leaves are its `children`, or a bare MCP server. Skills, prompts and
   * agents are `ChildCustomization`s and belong inside one. Published flat
   * they are read as plugins, and the reference client then walks
   * `<uri>/agents`, `<uri>/skills`, `<uri>/commands` and `<uri>/rules` looking
   * for their contents - four failed reads per customization, against a `uri`
   * that was a bare name rather than anything a filesystem could answer.
   *
   * One container per kind, because `contents` names a single
   * `ChildCustomizationType`. The directory is the conventional one for that
   * kind - the CLI reports *what* it loaded and never where it came from, so
   * this is where a person would go to add one rather than a path this host
   * read off disk. A built-in the CLI ships has no file of its own and the
   * path under it will not exist; nothing dereferences it, because a client
   * reads a directory's `children` rather than walking it.
   */
  const home = process.env.HOME ?? '';
  const folder = (kind: string): string => `file://${home}/.claude/${kind}`;
  const container = (kind: string, contents: string, children: Bag[]): Bag | undefined =>
    (children.length === 0 ? undefined : {
      type: 'directory',
      id: `directory:${kind}`,
      uri: folder(kind),
      name: kind,
      contents,
      enabled: true,
      // The person's own directory, so a client may offer to write one.
      writable: true,
      children,
    });
  const asSkills: Bag[] = [];
  const asPrompts: Bag[] = [];
  const asAgents: Bag[] = [];

  /*
   * Which of the commands are skills, and which skills a person can invoke.
   *
   * The CLI hands out two lists that overlap and neither says which is which:
   * `commands` is what a slash offers, `skills` is what was loaded from disk.
   * A command in both is a skill; one in `commands` alone is a built-in
   * prompt. And a skill the CLI did *not* put behind a slash is one it will
   * not let a person invoke - which is the agent-only skill the protocol has
   * `disableUserInvocation` for, read off the CLI's own two answers rather
   * than guessed from a name.
   */
  const offered = new Map(list(init.commands)
    .map((raw) => [str(bag(raw).name) ?? '', bag(raw)] as const)
    .filter(([name]) => name !== ''));
  const loaded = new Map(list(skills)
    .map((raw) => [str(bag(raw).name) ?? '', bag(raw)] as const)
    .filter(([name]) => name !== ''));

  for (const [name, skill] of loaded) {
    const command = offered.get(name);
    const described = str(skill.description) ?? str(bag(command).description);
    const hint = str(skill.argumentHint) ?? str(bag(command).argumentHint);
    asSkills.push({
      type: 'skill',
      id: `skill:${name}`,
      name,
      uri: `${folder('skills')}/${name}`,
      enabled: true,
      ...(command ? {} : { disableUserInvocation: true }),
      ...(described ? { description: described } : {}),
      // Under `_meta` for the reason the session's model is: `SkillCustomization`
      // declares `description` and the two `disable*` flags and nothing else,
      // so an argument hint sent beside them is this host's own extension.
      ...(hint ? { _meta: { argumentHint: hint } } : {}),
    });
  }

  for (const [name, command] of offered) {
    if (loaded.has(name)) continue;
    asPrompts.push({
      type: 'prompt',
      id: `command:${name}`,
      name,
      uri: `${folder('commands')}/${name}.md`,
      enabled: true,
      ...(str(command.description) ? { description: str(command.description) as string } : {}),
      ...(str(command.argumentHint) ? { argumentHint: str(command.argumentHint) as string } : {}),
    });
  }

  for (const raw of list(init.agents)) {
    const found = bag(raw);
    const name = str(found.name);
    if (!name) continue;
    asAgents.push({
      type: 'agent',
      id: `agent:${name}`,
      name,
      uri: `${folder('agents')}/${name}.md`,
      enabled: true,
      ...(str(found.description) ? { description: str(found.description) as string } : {}),
    });
  }

  for (const found of [
    container('skills', 'skill', asSkills),
    container('commands', 'prompt', asPrompts),
    container('agents', 'agent', asAgents),
  ]) {
    if (found) out.push(found);
  }

  // Bare, and correctly so: an MCP server is the one leaf the protocol lets a
  // session surface at the top level without a container around it.
  for (const raw of mcp) {
    const server = bag(raw);
    const name = str(server.name);
    if (!name) continue;
    const reported = str(server.status);
    const said = str(server.error);
    /*
     * The state, in the shape the kind it claims actually requires.
     *
     * The protocol's words, not the SDK's: the CLI says `connected` and
     * `failed`, a client reads `ready` and `error`. Each kind carries
     * different fields and only `error` carries any - `ready`, `starting` and
     * `stopped` are `{ kind }` and nothing else, and `error` needs a whole
     * `ErrorInfo` rather than the bare `message` this used to send.
     *
     * A server that needs signing in is `authRequired`, carrying the protected
     * resource it published. Discovered rather than invented: the server's own
     * URL is the canonical resource identifier the MCP authorization spec
     * names, and `<url>/.well-known/oauth-protected-resource` is where the
     * authorization server is announced. A stdio server has no URL and so no
     * resource to describe, and stays an error - which is the honest answer
     * for a thing a client cannot sign into over the network.
     */
    const published = wanted?.get(name);
    const state: OnWire<McpServerState> = reported === 'connected' ? { kind: 'ready' }
      : reported === 'disabled' ? { kind: 'stopped' }
        : reported === 'failed'
          ? {
            kind: 'error',
            error: { errorType: 'mcpServerFailed', message: said ?? 'The server did not start.' },
          }
          : reported === 'needs-auth'
            ? (published !== undefined
              ? {
                kind: 'authRequired',
                reason: 'required',
                resource: published,
                ...(Array.isArray(published.scopes_supported) && published.scopes_supported.length > 0
                  ? { requiredScopes: published.scopes_supported.filter((one): one is string => typeof one === 'string') }
                  : {}),
                ...(said !== undefined ? { description: said } : {}),
              }
              : {
                kind: 'error',
                error: {
                  errorType: 'mcpAuthRequired',
                  message: said ?? 'This server needs signing in, and it did not say where.',
                },
              })
            : { kind: 'starting' };
    out.push({
      type: 'mcpServer',
      id: `mcp:${name}`,
      name,
      uri: name,
      /*
       * `enablement`, not `enabled`.
       *
       * An MCP server is the one customization the protocol does not give a
       * flat flag: it carries the decision per scope, most specific first,
       * and a consumer reads `enablement[0].enabled`. This host decides at
       * one scope - the session's - because that is where a CLI's answer
       * about a server applies.
       *
       * Off the CLI's own word rather than off the kind above, so a server
       * that needs signing in stays switched *on* - it is enabled and
       * unreachable, which is not the same as somebody having turned it off.
       */
      enablement: [{ kind: 'session', enabled: reported !== 'failed' && reported !== 'disabled' }],
      state,
    });
  }

  return out;
}

/**
 * A permission mode a client asked for in somebody else's vocabulary.
 *
 * This backend advertises `permissionMode` and its own four values, which is
 * what the protocol asks a backend to do - the config schema is deliberately
 * generic, and VS Code's own hosts advertise different properties for Copilot
 * and for Claude. So the schema stays this harness's.
 *
 * What arrives is another matter. A client draws controls from the schema and
 * *also* dispatches two conventional keys of its own: `autoApprove` (how much
 * may run unasked) and `mode` (how the agent works). VS Code sends both at
 * session creation whatever a host advertises, and this host used to answer
 * `autoApprove is not a config key this backend takes` and leave the session
 * where it was.
 *
 * So they are accepted and mapped here, on the way in, and nothing about what
 * is advertised changes. Planning wins over any approval level - a plan that
 * ran a command would not be a plan - and `autopilot` is the mode axis saying
 * what `autoApprove` says at its top, which is why VS Code's own migration
 * moved `autoApprove: 'autopilot'` onto that axis.
 *
 * `assisted` is the inexact one: VS Code means "assess the risk first" and
 * this harness has no risk model, so it gets `acceptEdits`, which is the rung
 * it does have in that place.
 *
 * Undefined for a key or a value neither axis knows, so a caller refuses it
 * rather than collapsing it into `default`.
 */
export function permissionFor(key: string, value: string): PermissionMode | undefined {
  if (key === 'mode') {
    if (value === 'plan') return 'plan';
    if (value === 'autopilot') return 'bypassPermissions';
    if (value === 'interactive') return 'default';
    return undefined;
  }
  if (key !== 'autoApprove') return undefined;
  if (value === 'autoApprove' || value === 'autopilot') return 'bypassPermissions';
  if (value === 'assisted') return 'acceptEdits';
  if (value === 'default') return 'default';
  return undefined;
}

/**
 * A `permissions` value, if it is one.
 *
 * `undefined` for anything else, which is what makes `setConfig` able to
 * refuse: a client sending a string where the schema says an object should
 * hear that the value was not taken rather than have it quietly ignored.
 */
const listsOf = (value: unknown): { allow: string[]; deny: string[] } | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const held = value as { allow?: unknown; deny?: unknown };
  const names = (one: unknown): string[] =>
    (Array.isArray(one) ? one : []).filter((entry): entry is string => typeof entry === 'string');
  if (held.allow === undefined && held.deny === undefined) return undefined;
  return { allow: names(held.allow), deny: names(held.deny) };
};

/**
 * One property of a tool's input schema, as the zod the SDK asks for.
 *
 * `createSdkMcpServer` takes a zod raw shape and turns it back into JSON
 * Schema for the model, so a definition written as JSON Schema - which is
 * what the protocol declares - has to make the round trip. Only the shapes a
 * tool argument is: everything else is a string, which is what an unschema'd
 * argument would have been anyway.
 */
const shaped = (property: object): z.ZodTypeAny => {
  const kind = str((property as Bag).type);
  const of = (property as Bag).items;
  if (kind === 'number' || kind === 'integer') return z.number();
  if (kind === 'boolean') return z.boolean();
  if (kind === 'array') return z.array(of === undefined ? z.string() : shaped(bag(of)));
  return z.string();
};

/**
 * The host's tools, as an in-process MCP server the CLI can call.
 *
 * In-process: `createSdkMcpServer` registers the handlers here rather than
 * spawning anything, so a host tool is a function call. The result is handed
 * back as text, because that is the one content shape every model reads and
 * a host tool answering with anything richer would be answering in a shape
 * this host cannot check.
 */
const contributed = (
  tools: BoundTool[],
  /** Hand a call to the client that provides it, and wait for what it says. */
  byClient: (tool: BoundTool, input: Bag) => Promise<{ text: string; ok: boolean }>,
): unknown => createSdkMcpServer({
  name: 'ahp',
  version: '1.0.0',
  tools: tools.map((one) => {
    const schema = one.definition.inputSchema;
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [key, property] of Object.entries(schema?.properties ?? {})) {
      const value = shaped(property);
      shape[key] = (schema?.required ?? []).includes(key) ? value : value.optional();
    }
    return {
      name: one.definition.name,
      description: one.definition.description ?? one.definition.title ?? one.definition.name,
      inputSchema: shape,
      ...(one.definition.annotations ? { annotations: one.definition.annotations } : {}),
      handler: async (input: Record<string, unknown>) => {
        /*
         * Somebody else's tool, run where it lives.
         *
         * A client that announced this one is the only thing that can run it -
         * it is the editor's own command, or a plugin's - so the call goes out
         * against that client and this waits. The wait is what makes the model
         * see a tool at all: an MCP handler that returned before the answer
         * came back would be answering on the client's behalf.
         */
        if (one.owner !== undefined) {
          const answer = await byClient(one, input);
          return {
            content: [{ type: 'text' as const, text: answer.text }],
            ...(answer.ok ? {} : { isError: true }),
          };
        }
        try {
          return { content: [{ type: 'text' as const, text: await one.run?.(input) ?? '' }] };
        }
        catch (error: unknown) {
          // The message, not a throw: an MCP tool that rejects is a transport
          // failure, and a tool that could not do the thing is an answer.
          return {
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
            isError: true,
          };
        }
      },
    };
  }),
}) as unknown;

export function createSession(options: SessionOptions): Session {
  const { uri, chatUri, cwd, emit } = options;

  const turns: Bag[] = [...(options.seed ?? [])];
  let active: Bag | undefined;
  /**
   * Everything the agent is waiting on, by request id.
   *
   * A map because a turn can ask twice at once. The CLI calls `canUseTool`
   * per tool call and an agent that fires two in parallel produces two live
   * questions - this used to be a single slot, so the second overwrote the
   * first, the first's `settle` became unreachable and that tool waited for
   * an answer no one could give any more. Approving the surviving one then
   * did nothing, because the id no longer matched.
   *
   * The protocol has always modelled it this way: `inputNeeded` is a list and
   * `session/inputNeededSet` says it adds or updates *matched by id*.
   */
  const pending = new Map<string, PendingInput>();
  /**
   * The tools this session has already been told about, by name.
   *
   * Held here as well as handed to the SDK, because the SDK takes them when
   * the query is built: a list changed on a running session reaches the agent
   * only through `canUseTool`, which is the one place this host sits between
   * the two.
   */
  let allowed = listsOf(options.settings?.permissions) ?? { allow: [], deny: [] };
  let title = str(bag(bag((options.seed ?? [])[0]).message).text)?.slice(0, 60) || 'New session';
  let modified = new Date().toISOString();
  /**
   * Why the *last* turn failed, or nothing.
   *
   * About one turn, not about the session for the rest of its life. It reads
   * into `Status.Error` and into the summary's `error`, and it used to be set
   * and never unset - so one failed tool call left every client showing a
   * session in error through every turn that followed, and through a restart
   * of the client, because the flag lives here rather than there. Starting a
   * turn supersedes it: what went wrong last time is not what is happening
   * now.
   */
  let failed: string | undefined;
  let startedAt = 0;
  /**
   * The model the turn now running actually answered on, as its own frames
   * reported it.
   *
   * Not the one configured: a session may be set to `sonnet` and a turn may
   * run on whatever that resolved to on the day, and the protocol asks for
   * the model a turn *was* answered by. A client reads it to name the model
   * on a historic turn and to size the context window that turn used.
   */
  let ran: string | undefined;
  let handshake: Bag | undefined;
  /**
   * The id the agent gave this session, which is not the URI it is served at.
   *
   * The client picks the URI before anything exists; the CLI picks its own id
   * when it starts and writes the transcript under that. Both name the same
   * conversation, so the catalogue has to know they do - otherwise the row on
   * disk and the row in memory are two sessions saying the same thing.
   */
  let agentId: string | undefined = options.resume;
  /** What the session is doing, in one line, or nothing when it is idle. */
  let activity: string | undefined;
  /**
   * Messages waiting for the running turn to end.
   *
   * The host's, not a client's. A client that held them would be the only
   * thing that could ever send them, and would not - nothing in a client is
   * watching for a turn to end - and a second client watching the same chat
   * would not see them at all.
   */
  const queued: Bag[] = [];
  /**
   * What somebody is part-way through typing.
   *
   * Held here so two people on one session see each other's, which is the
   * only reason a draft is on the wire at all - a client that kept its own
   * would need nothing from a host for it.
   */
  let draft: Bag | undefined;
  let customizations: Bag[] = [...(options.seedCustomizations ?? [])];
  let offered: { id: string; name: string }[] = [];
  /** What the client picked. Absent means whatever the CLI defaults to. */
  let chosen: string | undefined;
  /** The config in force, by key. What `session/configChanged` merges into. */
  /*
   * What this session was told to run as.
   *
   * `unknown` and not `string`, because the protocol declares a config bag
   * `Record<string, unknown>` and `permissions` is an object. Keys this
   * backend declared a string are narrowed where they are read.
   */
  const settings: Record<string, unknown> = { permissionMode: 'default', ...options.settings };

  /**
   * The MCP server a tool belongs to, out of its name.
   *
   * `mcp__<server>__<tool>` is the CLI's own naming, and it is the only thing
   * that says a call is somebody else's server's rather than the harness's -
   * which is what `ToolCallMcpContributor` records and what makes a call
   * blocked on a sign-in tellable from one blocked on its own work.
   */
  const serverOf = (toolName: string): string | undefined => /^mcp__(.+?)__/.exec(toolName)?.[1];

  /*
   * The tools on offer, which is not a fixed list.
   *
   * The host's own are settled when the session is built; a client's arrive
   * when it announces itself and go when it leaves. So this is held rather
   * than read from `options` once, and `setTools` re-declares the server the
   * model reaches them through.
   */
  let offering: BoundTool[] = [...(options.tools ?? [])];
  /** The full name the CLI calls a contributed tool by. */
  const called = (name: string): string => `mcp__ahp__${name}`;
  /** Which client provides a tool, by the name the CLI calls it. */
  const providedBy = (toolName: string): string | undefined =>
    offering.find((one) => called(one.definition.name) === toolName)?.owner;

  /*
   * Joining the call the model made to the handler that has to answer it.
   *
   * The two arrive separately and neither carries the other's name: the
   * assistant frame opens the call under the CLI's id, and the in-process MCP
   * handler is invoked with the input and nothing else - the SDK surfaces a
   * `toolUseID` to `canUseTool` and to hooks, and not to a tool. So they are
   * matched here, by tool name and then by the input itself, which tells two
   * concurrent calls of one tool apart. Whichever arrives first waits for the
   * other.
   */
  const unclaimed = new Map<string, { id: string; input: string }[]>();
  const expecting = new Map<string, ((id: string) => void)[]>();

  const opening = (toolName: string, id: string, input: Bag): void => {
    const waiting = expecting.get(toolName) ?? [];
    const first = waiting.shift();
    expecting.set(toolName, waiting);
    if (first) { first(id); return; }
    unclaimed.set(toolName, [...(unclaimed.get(toolName) ?? []), { id, input: JSON.stringify(input) }]);
  };

  const claim = (toolName: string, input: Bag): Promise<string> => {
    const open = unclaimed.get(toolName) ?? [];
    const written = JSON.stringify(input);
    const at = open.findIndex((one) => one.input === written);
    const took = at >= 0 ? open.splice(at, 1)[0] : open.shift();
    unclaimed.set(toolName, open);
    if (took !== undefined) return Promise.resolve(took.id);
    return new Promise((resolve) => {
      expecting.set(toolName, [...(expecting.get(toolName) ?? []), resolve]);
    });
  };

  /**
   * Calls a client is running for this session, by call id.
   *
   * Held for the same reason `pending` is: the thing that has to settle them
   * arrives later and from somewhere else, and anything that ends the turn has
   * to settle them itself or the CLI waits for ever on a promise nobody owns.
   */
  const byClient = new Map<string, { owner: string; settle: (answer: { text: string; ok: boolean }) => void }>();

  /** Every outstanding client call, answered the same way and forgotten. */
  const releaseCalls = (why: string, whose?: string): void => {
    for (const [id, held] of [...byClient.entries()]) {
      if (whose !== undefined && held.owner !== whose) continue;
      byClient.delete(id);
      held.settle({ text: why, ok: false });
    }
  };

  const ranByClient = async (tool: BoundTool, input: Bag): Promise<{ text: string; ok: boolean }> => {
    const id = await claim(called(tool.definition.name), input);
    const owner = tool.owner ?? '';
    doing(`Waiting on ${owner}: ${tool.definition.title ?? tool.definition.name}`);
    return await new Promise((settle) => { byClient.set(id, { owner, settle }); });
  };
  /**
   * Tool calls running against an MCP server, by call id.
   *
   * Kept so a server that starts asking for a sign-in can say *which* calls
   * are stuck on it: the CLI reports a server's status and never a call's, so
   * the join is here or nowhere.
   */
  const onServer = new Map<string, { server: string; turnId: string; blocked: boolean }>();

  /** Open parts, keyed by message and index; tool calls by their own id. */
  const parts = new Map<string, Bag>();
  /**
   * Which tool call a streaming content block belongs to.
   *
   * A `content_block_delta` names the block by its index and nothing else, so
   * the id the block opened with has to be kept beside it. Tool calls only:
   * prose parts are already keyed by the same index.
   */
  const calling = new Map<string, string>();
  let streaming: string | undefined;

  // The input stream. A query with a live stream stays open between turns,
  // which is what makes a session a session rather than a series of them.
  const waiting: { type: 'user'; message: { role: 'user'; content: string }; parent_tool_use_id: null }[] = [];
  let wake: (() => void) | undefined;
  let closed = false;

  /**
   * The directories beside `cwd`, as this session currently has them.
   *
   * Mutable because a client may add and remove peers on a running session;
   * `cwd` itself never moves, which is what the protocol's `immutablePrimary`
   * says and what the SDK enforces anyway.
   */
  let peers = [...(options.additional ?? [])];

  /**
   * The MCP servers this session declared, by name, as it declared them.
   *
   * Kept because re-declaring one means sending the whole set back: the SDK
   * replaces its dynamic servers with what it is given, so a set rebuilt from
   * one server would take the others away.
   */
  const declared: Record<string, Bag> = { ...(options.mcpServers ?? {}) };
  /*
   * The host's own tools, as an MCP server the CLI does not have to find.
   *
   * `createSdkMcpServer` runs in this process rather than spawning anything,
   * so a host tool is a function call and not a subprocess. Named `ahp`
   * because that is what a client sees the tools attributed to. Declared once
   * at construction so `setMcpServers` keeps it: that call replaces the whole
   * set, and a set rebuilt without this would take the host's tools away.
   */
  if (offering.length > 0) declared.ahp = contributed(offering, ranByClient) as Bag;

  /** What each server that needs signing in published about itself, by name. */
  const wanted = new Map<string, Published>();

  /**
   * Ask each server that needs signing in where to sign in.
   *
   * Only the remote ones: a stdio server has no URL, so there is no protected
   * resource to describe and it stays an error. Cached by name, because the
   * status is re-read on every refresh and the metadata does not move.
   */
  const discover = async (servers: unknown[]): Promise<void> => {
    await Promise.all(servers.map(async (raw) => {
      const server = bag(raw);
      const name = str(server.name);
      if (name === undefined || str(server.status) !== 'needs-auth' || wanted.has(name)) return;
      const url = urlOf(declared[name] ?? server.config);
      if (url === undefined) return;
      wanted.set(name, await protectedResource(url, name).catch(() => ({ resource: url, resource_name: name })) as Published);
    }));
  };


  /**
   * A steering message, for as long as it is waiting to be read.
   *
   * The protocol's `ChatState.steeringMessage` is "a message to inject into
   * the current turn at a convenient point", and the convenient point is when
   * the CLI next reads its prompt. Between the two there is a real window - a
   * turn mid-tool-call has not read anything for some time - and this is what
   * fills it. Cleared where the generator hands the message over, because that
   * is the moment it stops waiting.
   */
  let steering: Bag | undefined;

  async function* input(): AsyncGenerator<(typeof waiting)[number]> {
    for (;;) {
      while (waiting.length > 0) {
        const next = waiting.shift() as (typeof waiting)[number];
        yield next;
        if (steering !== undefined) {
          const said = steering;
          steering = undefined;
          emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id: String(said.id ?? '') });
          touch();
        }
      }
      if (closed) return;
      await new Promise<void>((resolve) => { wake = resolve; });
    }
  }

  const touch = (): void => { modified = new Date().toISOString(); };

  /**
   * Say what it is doing now, if that has changed.
   *
   * On both channels: the chat is where the work happens, and the protocol
   * says a session mirrors its default chat's activity - which is the one a
   * catalogue row and a detail pane read.
   */
  const doing = (said: string | undefined): void => {
    if (activity === said)
      return;
    activity = said;
    emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /** One line for a tool that is running. The name alone says too little. */
  /**
   * The file a tool is about to change, if it is one of the tools that do.
   *
   * Named tools rather than a guess at the input: a tool called `Bash` may
   * write a file too, and there is nothing in `rm -rf` that says which. What
   * this misses is honest - a changeset that claimed a file it could not name
   * would be worse than one that says nothing about it.
   */
  const edits = (name: string, input: Bag): string | undefined => {
    const known = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
    if (!known.includes(name)) return undefined;
    const path = str(input.file_path) ?? str(input.notebook_path);
    return path === '' ? undefined : path;
  };

  const busyWith = (name: string, input: Bag): string => {
    const what = summarize(name, input);
    return (what ? `${name} ${what}` : name).replace(/\s+/g, ' ').slice(0, 80);
  };

  /** Retitle, and say so: a client that opened the session holds the old one. */
  const retitle = (said: string): void => {
    if (said === '' || said === title)
      return;
    title = said;
    emit('session', { type: 'session/titleChanged', title });
  };

  /**
   * The SDK's token counts, in the protocol's spelling.
   *
   * Every field is optional on both sides, so anything missing is left out
   * rather than reported as zero - a nought is a measurement and an absence
   * is not.
   */
  const usageOf = (raw: unknown, model?: string): Bag | undefined => {
    const found = bag(raw);
    const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const info: Bag = {
      ...(num(found.input_tokens) !== undefined ? { inputTokens: num(found.input_tokens) } : {}),
      ...(num(found.output_tokens) !== undefined ? { outputTokens: num(found.output_tokens) } : {}),
      ...(num(found.cache_read_input_tokens) !== undefined ? { cacheReadTokens: num(found.cache_read_input_tokens) } : {}),
      ...(model !== undefined ? { model } : {}),
    };
    return Object.keys(info).length > 0 ? info : undefined;
  };

  const status = (): number => (pending.size > 0 ? Status.InputNeeded
    : active ? Status.InProgress
      : failed ? Status.Error
        : Status.Idle);

  /** The session-level summary of what is wanted. Set with the tool call, cleared with it. */
  /*
   * One request at a time, named by its id.
   *
   * `session/inputNeededSet` carries `request` and adds or updates the entry
   * with that id; `session/inputNeededRemoved` carries the `id` to drop. This
   * sent `inputNeeded: [entry]` and a bare removal, so a client reducing the
   * actions could neither add the second question nor tell which one had been
   * answered.
   */
  const inputNeededSet = (entry: Bag): void => {
    emit('session', { type: 'session/inputNeededSet', request: entry });
  };
  const inputNeededRemoved = (id: string): void => {
    emit('session', { type: 'session/inputNeededRemoved', id });
  };

  // ------------------------------------------------------------- translation

  const openTurn = (): Bag => {
    if (active) return active;
    // A turn the client did not begin: the agent spoke first, which happens on
    // a resumed session. Better an id of our own than a turn with none.
    // `usage` is required on an `ActiveTurn` and means "not measured yet".
    // Leaving the key off put a turn on the wire that did not satisfy its own
    // type, which nothing here would have noticed.
    active = {
      id: `turn-${Date.now()}`,
      startedAt: new Date().toISOString(),
      // The agent spoke first, so the message in front of this turn is its
      // own. `Message.origin` is required and used to be left off entirely.
      message: { text: '', origin: { kind: 'agent' } },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    startedAt = Date.now();
    failed = undefined;
    emit('chat', {
      type: 'chat/turnStarted',
      turnId: active.id,
      startedAt: active.startedAt,
      message: { text: '', origin: { kind: 'agent' } },
    });
    return active;
  };

  /** Prose: the part is announced, then filled by deltas. */
  const addPart = (turn: Bag, part: Bag): void => {
    (turn.responseParts as Bag[]).push(part);
    emit('chat', { type: 'chat/responsePart', turnId: turn.id, part });
  };

  /**
   * A tool call: held for the snapshot, and announced by `chat/toolCallStart`.
   *
   * That action *creates* the response part on the client side, so sending
   * `chat/responsePart` for one as well puts the same call in the transcript
   * twice - once as this host's part and once as the reducer's own.
   */
  const holdPart = (turn: Bag, part: Bag): void => {
    (turn.responseParts as Bag[]).push(part);
  };

  /**
   * Why a turn stopped, as a part of it.
   *
   * 0.9.0 took `error` off `Turn` and gave the reason a response part instead,
   * which is the better home for it: what the agent said before it failed
   * still stands, and the failure belongs after those three things rather than
   * beside them. Without this the state says `error` and nothing anywhere says
   * what went wrong.
   *
   * No `resumable`. It is only ever `true` to offer a resume, and this host
   * cannot resume a turn - saying so with a `false` it never varies would be
   * answering a question nobody asked.
   */
  /*
   * Why a turn stopped, held for the snapshot rather than announced.
   *
   * `chat/error` *carries* this part and appends it itself, so a
   * `chat/responsePart` for the same thing is the failure printed twice. The
   * part is `{ kind, error }` and nothing else: `ErrorResponsePart` has no id.
   */
  const failurePart = (why: string): Bag => ({
    kind: 'error',
    error: { errorType: 'turnFailed', message: why },
  });
  const addFailure = (turn: Bag, why: string): Bag => {
    const part = failurePart(why);
    (turn.responseParts as Bag[]).push(part);
    return part;
  };

  const streamed = (event: Bag): void => {
    const type = str(event.type);

    if (type === 'message_start') {
      streaming = str(bag(event.message).id) ?? 'm';
      openTurn();
      return;
    }

    const of = streaming ?? 'm';
    const key = `#${of}:${String(event.index)}`;

    if (type === 'content_block_start') {
      const turn = openTurn();
      const block = bag(event.content_block);
      const kind = str(block.type);
      /*
       * A tool call, opened while its arguments are still arriving.
       *
       * `streaming` is the status the protocol has for exactly this, and
       * `partialInput` is where the half-written json goes - a client draws
       * the row as soon as the name is known and fills the arguments in as
       * they come, rather than waiting for the complete block. The permission
       * callback and the completed assistant message both find this call
       * under the same id and carry it on from here.
       */
      if (kind === 'tool_use') {
        const id = str(block.id) ?? `${of}:${String(event.index)}`;
        calling.set(key, id);
        if (parts.has(id)) return;
        const name = str(block.name) ?? 'tool';
        // Whose tool it is, when it is an MCP server's. The reducer refuses
        // `chat/toolCallAuthRequired` on a call with no MCP contributor, so
        // this is also what makes a sign-in mid-call sayable at all.
        const from = serverOf(name);
        const contributor = from === undefined
          ? undefined
          : { kind: 'mcp' as const, customizationId: `mcp:${from}` };
        const call: Bag = {
          toolCallId: id,
          toolName: name,
          displayName: name,
          status: 'streaming',
          ...(contributor ? { contributor } : {}),
        };
        const part: Bag = { id, kind: 'toolCall', toolCall: call };
        parts.set(id, part);
        holdPart(turn, part);
        emit('chat', {
          type: 'chat/toolCallStart',
          turnId: turn.id,
          toolCallId: id,
          toolName: name,
          displayName: name,
          ...(contributor ? { contributor } : {}),
        });
        return;
      }
      // Everything else that is not prose has no part to open.
      if (kind !== 'text' && kind !== 'thinking') return;
      if (parts.has(key)) return;
      const part: Bag = {
        id: `${of}:${String(event.index)}`,
        kind: kind === 'text' ? 'markdown' : 'reasoning',
        content: '',
      };
      parts.set(key, part);
      // The part first, always. A delta naming a part nobody opened is text
      // the client has nowhere to put.
      addPart(turn, part);
      return;
    }

    if (type === 'content_block_delta') {
      const toolCallId = calling.get(key);
      if (toolCallId !== undefined) {
        const json = str(bag(event.delta).partial_json);
        const call = bag(parts.get(toolCallId)?.toolCall);
        // Only while it is streaming: once the arguments are complete the
        // call carries `toolInput`, and appending to `partialInput` after
        // that is writing into a field the reducer has stopped reading.
        if (json === undefined || str(call.status) !== 'streaming') return;
        call.partialInput = `${String(call.partialInput ?? '')}${json}`;
        emit('chat', { type: 'chat/toolCallDelta', turnId: active?.id, toolCallId, content: json });
        return;
      }
      const part = parts.get(key);
      if (!part) return;
      const text = str(bag(event.delta).text) ?? str(bag(event.delta).thinking);
      if (text === undefined) return;
      part.content = `${String(part.content ?? '')}${text}`;
      /*
       * The append action follows the part it appends to.
       *
       * `chat/delta` is defined against a *markdown* part and `chat/reasoning`
       * against a *reasoning* one, and the canonical reducer enforces the
       * pairing rather than being lenient about it - a delta naming a
       * reasoning part is returned unchanged. Sending thinking as a delta
       * therefore opens the part and never fills it, which draws a thinking
       * header with nothing under it for as long as the model thinks.
       */
      const append = part.kind === 'reasoning' ? 'chat/reasoning' : 'chat/delta';
      emit('chat', { type: append, turnId: active?.id, partId: part.id, content: text });
    }
  };

  const assistant = (message: Bag): void => {
    const turn = openTurn();
    const of = str(message.id) ?? 'm';
    ran = str(message.model) ?? ran;
    const blocks = list(message.content);

    for (let index = 0; index < blocks.length; index++) {
      const block = bag(blocks[index]);
      const kind = str(block.type);

      if (kind === 'text' || kind === 'thinking') {
        // Already opened and already filled by the deltas. Writing the complete
        // block on top of it prints the whole answer twice.
        if (parts.has(`#${of}:${index}`)) continue;
        const part: Bag = {
          id: `${of}:${index}`,
          kind: kind === 'text' ? 'markdown' : 'reasoning',
          content: str(block.text) ?? str(block.thinking) ?? '',
        };
        parts.set(`#${of}:${index}`, part);
        addPart(turn, part);
        continue;
      }

      if (kind === 'tool_use') {
        const id = str(block.id) ?? `${of}:${index}`;
        /*
         * The call as it stands, if something opened it already.
         *
         * Two things do. The arguments streaming in open it `streaming`, with
         * the name and nothing else, and leave the input to be filled in here
         * - which is what `chat/toolCallReady` is for. The permission callback
         * opens it `pending-confirmation` and has already asked, so that one
         * is left alone: completing it here would answer a question nobody
         * put. The same assistant message can also arrive more than once while
         * it streams, and a second part for it is the same row drawn twice.
         */
        const open = parts.get(id);
        if (open !== undefined && str(bag(open.toolCall).status) !== 'streaming') continue;
        const name = str(block.name) ?? 'tool';
        const command = summarize(name, bag(block.input));
        const from = serverOf(name);
        /*
         * Whose tool this is, which decides who has to run it.
         *
         * A client's own beats the server it is offered through: the tools a
         * client provides are carried to the model on this host's in-process
         * server, so by name they all look like `mcp__ahp__*` - and reporting
         * one as this host's contribution would tell every client that the
         * call is nobody's to answer, including the one whose call it is.
         */
        const own = providedBy(name);
        if (own !== undefined) opening(name, id, bag(block.input));
        const contributor = own !== undefined
          ? { kind: 'client' as const, clientId: own }
          : from === undefined
            ? undefined
            : { kind: 'mcp' as const, customizationId: `mcp:${from}` };
        // Running against somebody else's server, and so a call that can end
        // up waiting on a sign-in rather than on its own work.
        if (from !== undefined) onServer.set(id, { server: from, turnId: str(turn.id) ?? '', blocked: false });
        const call: Bag = open !== undefined ? bag(open.toolCall) : {
          toolCallId: id,
          toolName: name,
          displayName: name,
          status: 'running',
          ...(contributor ? { contributor } : {}),
          /*
           * On the call, and not only on the action that announces it.
           *
           * A client driven by actions builds its own state and gets these
           * from `chat/toolCallReady` below. A client that *subscribes* reads
           * the snapshot instead, and `ToolCallState` requires both - so every
           * tool call in a transcript was a row with no sentence to draw and
           * no answer to whether anybody had approved it. The two have to say
           * the same thing, and this is the half that was not being said.
           */
          invocationMessage: name,
          confirmed: 'not-needed',
          ...(command ? { toolInput: command } : {}),
        } satisfies OnWire<ToolCallRunningState>;
        if (open === undefined) {
          const part: Bag = { id, kind: 'toolCall', toolCall: call };
          parts.set(id, part);
          holdPart(turn, part);
        }
        else {
          // The half-written json is what `toolInput` now says properly, and
          // a client that kept both would draw the arguments twice.
          call.status = 'running';
          call.invocationMessage = name;
          call.confirmed = 'not-needed';
          delete call.partialInput;
          if (command) call.toolInput = command;
        }
        doing(busyWith(name, bag(block.input)));
        /*
         * The file as it is *now*, before the tool has run.
         *
         * Announced and executed are concurrent - the SDK yields this block
         * and runs the tool - so this is a race the tool's own disk I/O
         * usually loses. Best effort, and the reference host relies on the
         * same headroom.
         */
        const changing = edits(name, bag(block.input));
        if (changing !== undefined) {
          editing.set(id, changing);
          options.onFileEdit?.(str(turn.id) ?? '', changing, 'before');
        }
        if (open === undefined) {
          emit('chat', {
            type: 'chat/toolCallStart',
            turnId: turn.id,
            toolCallId: id,
            toolName: name,
            displayName: name,
            ...(contributor ? { contributor } : {}),
          });
        }
        emit('chat', {
          type: 'chat/toolCallReady',
          turnId: turn.id,
          toolCallId: id,
          ...(contributor ? { contributor } : {}),
          // The tool's name, never its input. A client draws the intention
          // above the input, so the same string in both is the command
          // printed twice on every row.
          invocationMessage: name,
          // Nothing is being asked here - `canUseTool` is what asks. Without
          // this the reducer moves every tool call in the transcript into
          // `pending-confirmation` and draws it as a question nobody put.
          confirmed: 'not-needed',
          ...(command ? { toolInput: command } : {}),
        });
      }
    }
  };

  const results = (message: Bag): void => {
    for (const raw of list(message.content)) {
      const block = bag(raw);
      if (str(block.type) !== 'tool_result') continue;
      const id = str(block.tool_use_id);
      const part = id ? parts.get(id) : undefined;
      if (!part) continue;
      const call = bag(part.toolCall);
      /*
       * A tool that failed is `completed`, and says so in its result.
       *
       * `ToolCallStatus` has no `failed`: the seven are `streaming`,
       * `pending-confirmation`, `running`, `auth-required`,
       * `pending-result-confirmation`, `completed` and `cancelled`. A tool that
       * ran and went wrong ran - what went wrong is `result.success` and
       * `result.error`, which is also the only place a client looks for it.
       */
      const ok = block.is_error !== true;
      call.status = 'completed';
      // Finished, so it is no longer waiting on anything - including a
      // sign-in nobody ever did.
      if (id !== undefined) onServer.delete(id);
      // Back to thinking. Leaving the last tool's name up makes a session look
      // busy with something that finished.
      doing('Thinking');
      const text = resultText(block.content);
      /*
       * The result, as one object, because that is the only part of the action
       * a client reads.
       *
       * `ToolCallCompletedState` extends `ToolCallResult`, and the reducer
       * builds it by spreading `action.result` over the call - so `status` and
       * `content` sent beside the action rather than inside it are dropped
       * without a word, and every tool's output stopped at this host. `success`
       * and `pastTenseMessage` are required; `content` blocks are MCP's, and
       * carry a `type`.
       *
       * The past-tense sentence is the CLI's own invocation message, which is
       * the best text there is: the alternative is a sentence rebuilt here out
       * of a tool name, and the CLI knows what it asked for.
       */
      const said = str(call.invocationMessage) ?? str(call.displayName) ?? str(call.toolName) ?? 'the tool';
      const result = {
        success: ok,
        pastTenseMessage: said,
        ...(text !== undefined ? { content: [{ type: 'text', text }] } : {}),
        ...(ok ? {} : { error: { message: text ?? 'The tool failed' } }),
      } satisfies Partial<OnWire<ToolCallCompletedState>>;
      /*
       * Onto the call *and* into the action, from one object.
       *
       * `ToolCallCompletedState` extends `ToolCallResult`, and the reducer
       * builds the state by spreading the action's `result` over the call - so
       * the two have to say the same thing. Written out twice they drifted,
       * which is how a transcript's tool calls came to be missing fields the
       * action had been carrying all along. One literal cannot drift from
       * itself, and it is checked against the state it completes.
       */
      Object.assign(call, result);
      // And as it is now the tool has run. Paired with the `before` above by
      // the call's own id, which is the only thing that survives the gap.
      const changed = id === undefined ? undefined : editing.get(id);
      if (id !== undefined && changed !== undefined) {
        editing.delete(id);
        options.onFileEdit?.(str(active?.id) ?? '', changed, 'after');
      }
      emit('chat', {
        type: 'chat/toolCallComplete',
        turnId: active?.id,
        toolCallId: id,
        result,
      });
    }
  };

  // ------------------------------------------------------ asking a person

  /**
   * Which tools a person has already answered for, for this session.
   *
   * Deny wins over allow, because the two lists are answers to different
   * questions: allow says "stop asking me", deny says "never do this", and a
   * tool in both is one somebody has forbidden and also once approved.
   */
  const settled = (toolName: string): 'allow' | 'deny' | undefined => {
    if (allowed.deny.includes(toolName)) return 'deny';
    if (allowed.allow.includes(toolName)) return 'allow';
    return undefined;
  };

  const canUseTool = async (toolName: string, raw: Bag, asked?: Bag): Promise<unknown> => {
    /*
     * Answered from the lists, before anybody is asked.
     *
     * The SDK was handed the same lists when the query was built, so in the
     * ordinary case it never calls this at all. This is what makes a list set
     * *during* a session take effect: the query cannot be told, and this can.
     * Nothing is announced either way - a tool nobody was asked about is not
     * a question that was answered, and drawing one would put a row on screen
     * for a decision made before the turn began.
     */
    const already = settled(toolName);
    if (already === 'allow') return { behavior: 'allow', updatedInput: raw };
    if (already === 'deny') return { behavior: 'deny', message: `${toolName} is denied for this session` };
    return await new Promise((settle) => {
      const turn = openTurn();
      const about = bag(asked);
      /*
       * The agent's own id for this call.
       *
       * Not one of this host's making. The assistant message opens the call
       * under this id, and a confirmation that invented its own put a second
       * row beside it for the same command - and answered under a name the
       * client had never been given, so approving did nothing.
       */
      const id = str(about.toolUseID) ?? `req-${Date.now()}`;

      if (toolName === 'AskUserQuestion') {
        const asked = new Map<string, string>();
        const questions = list(raw.questions).map((entry, index) => {
          const question = bag(entry);
          const key = `q${index + 1}`;
          asked.set(key, str(question.question) ?? '');
          return {
            id: key,
            kind: question.multiSelect === true ? 'multi-select' : 'single-select',
            message: str(question.question) ?? '',
            required: true,
            // The label is the id, because the label is what the SDK wants
            // back: answers are valued by the option's own label, not by an id.
            options: list(question.options).map((option) => ({
              id: str(bag(option).label) ?? '',
              label: str(bag(option).label) ?? '',
            })),
            allowFreeformInput: true,
          };
        });
        const request = { id, message: str(raw.header) ?? 'The agent has a question', questions };
        // `chat` is required on every input request and was never sent.
        const entry: Bag = { id, chat: chatUri, kind: 'chatInput', request };
        pending.set(id, { id, entry, questions: list(raw.questions), asked, answers: new Map(), settle });
        emit('chat', { type: 'chat/inputRequested', turnId: turn.id, request });
        inputNeededSet(entry);
        touch();
        return;
      }

      const command = summarize(toolName, raw);
      const displayName = str(about.displayName) ?? toolName;
      /*
       * The sentence a person reads, which is not the input.
       *
       * The CLI renders one - "Claude wants to run …" - and it is better than
       * anything rebuilt here. Its subtitle is sometimes the input itself
       * though, and a client draws the intention *above* the input, so a
       * sentence that is the input is the command printed twice.
       */
      const said = str(about.title) ?? str(about.description);
      const invocationMessage = said !== undefined && said !== command ? said : displayName;
      const confirmationTitle = str(about.title) ?? `Run ${displayName}?`;

      // The call the assistant message opened, if it arrived first. Which of
      // the two comes first is the CLI's business; either order is one call.
      const held = parts.get(id);
      const call = held ? bag(held.toolCall) : {
        toolCallId: id,
        toolName,
        displayName,
        ...(command ? { toolInput: command } : {}),
      } as Bag;
      call.status = 'pending-confirmation';
      call.confirmationTitle = confirmationTitle;
      // The same sentence the action carries, so a client reading the snapshot
      // has one too. See the call built in `assistant`.
      call.invocationMessage = invocationMessage;
      delete call.confirmed;
      if (!held) {
        const part: Bag = { id, kind: 'toolCall', toolCall: call };
        parts.set(id, part);
        holdPart(turn, part);
        emit('chat', { type: 'chat/toolCallStart', turnId: turn.id, toolCallId: id, toolName, displayName });
      }
      emit('chat', {
        type: 'chat/toolCallReady',
        turnId: turn.id,
        toolCallId: id,
        invocationMessage,
        confirmationTitle,
        ...(command ? { toolInput: command } : {}),
      });

      doing(`Waiting on you: ${displayName}`);
      // `chat` and `turnId` are both required on a tool confirmation and
      // neither was sent.
      const entry: Bag = { id, chat: chatUri, kind: 'toolConfirmation', turnId: str(turn.id) ?? '', toolCall: call };
      pending.set(id, {
        id,
        entry,
        asked: new Map(),
        answers: new Map(),
        settle: (result) => settle(result.behavior === 'allow'
          ? { behavior: 'allow', updatedInput: raw }
          : result),
      });
      inputNeededSet(entry);
      touch();
    });
  };

  // ------------------------------------------------------------------ the run

  const handle = query({
    prompt: input(),
    options: {
      cwd,
      // The peers of `cwd`, which the SDK takes at startup. The first entry is
      // the process root and is not one of these.
      ...(peers.length > 0 ? { additionalDirectories: [...peers] } : {}),
      /*
       * The MCP servers, declared here rather than found by the CLI.
       *
       * The CLI reads the same files either way; what changes is ownership. A
       * server the SDK was *given* is one `setMcpServers` can re-declare, and
       * that is the only way a token a client signed in with can be applied -
       * `setMcpServers` does not touch servers that came from a settings file.
       */
      ...(Object.keys(declared).length > 0 ? { mcpServers: declared as never } : {}),
      includePartialMessages: true,
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
      ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
      // From the settings, which is where it lives: it is a config key like
      // the others, and a second way in was a second thing to keep in step.
      ...(typeof settings.permissionMode === 'string' ? { permissionMode: settings.permissionMode } : {}),
      /*
       * The lists, at the moment the query is built.
       *
       * The SDK takes them natively, which is what makes this the smallest
       * thing that works - and it is only half of it: the SDK has nowhere to
       * put a later change, so `canUseTool` reads the same lists on every
       * call and that is what makes one set mid-session take effect.
       */
      ...(allowed.allow.length > 0 ? { allowedTools: [...allowed.allow] } : {}),
      ...(allowed.deny.length > 0 ? { disallowedTools: [...allowed.deny] } : {}),
      // Resumed, not replayed: the agent picks up the context it built - the
      // files it read, the decisions it made - rather than being handed a
      // transcript of them and asked to infer the rest.
      ...(options.resume ? { resume: options.resume } : {}),
      /*
       * A fork, which the SDK spells as a resume that does not keep the id.
       *
       * `resumeSessionAt` is the prompt to continue from and `forkSession`
       * makes the continuation a session of its own, so the conversation this
       * was cut from carries on untouched.
       */
      ...(options.resume && options.forkAt
        ? { forkSession: true, resumeSessionAt: options.forkAt }
        : {}),
      /*
       * A rewind, which is the same resume without the new id.
       *
       * `chat/truncated` drops the turns after a named one and carries on in
       * the conversation it dropped them from - so the id has to survive it,
       * or every later resume would reach the transcript that still has them.
       * That is the whole difference from a fork, and it is one word.
       */
      ...(options.resume && options.rewindAt && !options.forkAt
        ? { resumeSessionAt: options.rewindAt }
        : {}),
      /*
       * On disk under the name the client gave it.
       *
       * The SDK invents an id and writes the transcript under that, so a
       * session a client created lived on disk under a name the client had
       * never heard of. While the daemon ran it answered to both, because it
       * held the pair in memory; once it restarted, the catalogue listed the
       * SDK's name and the URI the client created the session under answered
       * `No agent for session` for ever - the session was still there and its
       * only name for it was dead.
       *
       * Only where the client named a UUID, because that is what the SDK will
       * take. A client that names a session something else keeps what it had.
       */
      ...(options.resume === undefined && UUID.test(idOf(uri)) ? { sessionId: idOf(uri) } : {}),
      // Set once, at creation, and that is why the schema marks it immutable:
      // the CLI takes `thinking` when the query is built and has nowhere to
      // put a later change, so offering it as a live control would be a
      // switch that flips back.
      ...(settings.thinking === 'disabled' ? { thinking: { type: 'disabled' } } : {}),
      ...(settings.thinking === 'adaptive' ? { thinking: { type: 'adaptive' } } : {}),
      canUseTool,
    },
  } as Parameters<typeof query>[0]);

  /**
   * Start a turn, whoever asked for it.
   *
   * `queuedMessageId` names the waiting message this turn came from, and the
   * client's reducer takes it out of the queue on that word - which is what
   * makes the queue empty as its turns start rather than needing a second
   * action to say so.
   */
  /** Context for the first prompt only, which never reaches the wire. */
  let carried = options.context;

  /** The backend's id for the prompt that began each turn, by this host's turn id. */
  const cuts = new Map<string, string>();

  /**
   * The backend's id for the *last* thing in each turn, by this host's turn id.
   *
   * Where a rewind that keeps the turn has to cut. The SDK's rule for
   * `resumeSessionAt` is the kept turn's last chain entry, whatever it is -
   * cutting at the prompt instead keeps the question and drops the answer to
   * it, which is a turn a client can still see and the agent no longer
   * remembers giving.
   */
  const ends = new Map<string, string>();

  const beginTurn = (turnId: string, text: string, model?: Chosen, queuedMessageId?: string): void => {
    if (model !== undefined && model.id !== chosen) {
      chosen = model.id;
      void handle.setModel(model.id === 'default' ? undefined : model.id).catch(() => {});
    }
    /*
     * The form the model came with, which is one key here.
     *
     * `thinkingLevel` is what a client writes into `ModelSelection.config`,
     * and the CLI holds one effort setting for the whole query rather than one
     * per turn - so a turn that names a level sets it from here on, and the
     * session-wide `effortLevel` is told so the two controls do not describe
     * different futures.
     */
    const level = EFFORTS.find((one) => one === (model?.config ?? {}).thinkingLevel);
    if (level !== undefined && level !== settings.effortLevel) {
      settings.effortLevel = level;
      void handle.applyFlagSettings({ effortLevel: level }).catch(() => {});
      emit('session', { type: 'session/configChanged', config: { effortLevel: level } });
    }
    active = {
      id: turnId,
      startedAt: new Date().toISOString(),
      message: {
        text,
        origin: { kind: 'user' },
        ...(chosen ? { model: { id: chosen, ...(model?.config ? { config: model.config } : {}) } } : {}),
      },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    startedAt = Date.now();
    failed = undefined;
    // Said back, including to the client that started it. A host that only
    // reduced this privately would go on to emit `chat/responsePart` for a
    // turn no client has - so the parts land nowhere and the conversation
    // appears only when somebody reopens it and gets a fresh snapshot.
    emit('chat', {
      type: 'chat/turnStarted',
      turnId: active.id,
      startedAt: active.startedAt,
      message: active.message,
      ...(queuedMessageId !== undefined ? { queuedMessageId } : {}),
    });
    if (title === 'New session' && text) retitle(text.slice(0, 60));
    doing('Thinking');
    /*
     * What the model is given, which is not always what the transcript shows.
     *
     * A side chat is started from a turn somewhere else and has to know what
     * that turn said, and the protocol is explicit that the source is *not*
     * copied into this chat's visible history. So it rides on the first prompt
     * and nowhere else: the wire message stays what the person typed.
     */
    const sent = carried === undefined ? text : `${carried}\n\n${text}`;
    carried = undefined;
    waiting.push({ type: 'user', message: { role: 'user', content: sent }, parent_tool_use_id: null });
    wake?.();
    wake = undefined;
    touch();
  };

  /**
   * The head of the queue, once there is nothing running.
   *
   * Called wherever a turn ends, which is the only place it can be: a queue
   * that waited for a client to notice would be a list, and every client
   * watching this chat would have to agree about which of them sends it.
   */
  const startNext = (): void => {
    if (active || closed)
      return;
    const next = queued.shift();
    if (!next)
      return;
    const message = bag(next.message);
    // Read back, not re-parsed: `queue` wrote this entry from a `Chosen` and
    // the values in it are the ones it kept.
    const named = bag(message.model);
    const id = str(named.id);
    let model: Chosen | undefined;
    if (id !== undefined)
      model = named.config ? { id, config: named.config as NonNullable<Chosen['config']> } : { id };
    beginTurn(crypto.randomUUID(), str(message.text) ?? '', model, str(next.id));
  };

  /**
   * Ask the CLI what it can do, without asking it to do anything.
   *
   * Fired as soon as the query exists. Best effort: a CLI that will not answer
   * yet leaves the lists empty, which is a real answer - the same one a host
   * gives for a harness nobody has signed into - rather than a session that
   * refuses to open.
   */
  /**
   * Re-read the MCP servers and say what changed.
   *
   * Asked of the CLI rather than assumed from what was just requested: a
   * server told to start can come back `ready`, still `authRequired`, or
   * `error`, and reporting the state that was *asked for* would show a green
   * row against a server nobody has signed into.
   */
  const refreshMcp = async (): Promise<void> => {
    const found = await handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]);
    await discover(found);
    for (const raw of found) {
      const server = bag(raw);
      const name = str(server.name);
      if (!name) continue;
      const id = `mcp:${name}`;
      const held = customizations.find((entry) => str(entry.id) === id);
      const fresh = bag(customizationsOf({}, [server], [], wanted)[0]);
      if (!held) {
        customizations.push(fresh);
        emit('session', { type: 'session/customizationUpdated', customization: fresh });
        continue;
      }
      const moved = JSON.stringify(held.state) !== JSON.stringify(fresh.state);
      const switched = JSON.stringify(held.enablement) !== JSON.stringify(fresh.enablement);
      if (!moved && !switched)
        continue;
      /*
       * Which running tool calls this moved, before the row itself.
       *
       * The CLI reports a *server's* status and never a call's, so a call
       * blocked on a sign-in is only tellable by joining the two: every call
       * running against this server is blocked when it starts asking, and
       * unblocked when it is ready again. `chat/toolCallAuthRequired` is a
       * no-op in the reducer unless the call carries an MCP contributor,
       * which is why one is put on every `mcp__…` call.
       */
      const asking = str(fresh.state === undefined ? undefined : bag(fresh.state).kind) === 'authRequired';
      for (const [callId, running] of onServer) {
        if (running.server !== name || running.blocked === asking) continue;
        running.blocked = asking;
        const at = parts.get(callId);
        const call = bag(at?.toolCall);
        if (asking) {
          const { kind: _kind, ...auth } = bag(fresh.state);
          call.status = 'auth-required';
          call.auth = auth;
          emit('chat', { type: 'chat/toolCallAuthRequired', turnId: running.turnId, toolCallId: callId, auth });
          // The same block at the session level, which is where a client
          // looking at a list rather than at a conversation sees it.
          inputNeededSet({
            id: `auth:${callId}`,
            chat: chatUri,
            kind: 'toolAuthentication',
            turnId: running.turnId,
            toolCall: { ...call },
          });
        }
        else {
          call.status = 'running';
          delete call.auth;
          emit('chat', { type: 'chat/toolCallAuthResolved', turnId: running.turnId, toolCallId: callId });
          inputNeededRemoved(`auth:${callId}`);
        }
      }
      held.state = fresh.state;
      held.enablement = fresh.enablement;
      // `mcpServerStateChanged` carries the state and nothing else, so a
      // server that came back on would arrive `ready` with the switch still
      // drawn off. The whole row when both moved, the narrow action when only
      // the state did.
      if (switched)
        emit('session', { type: 'session/customizationUpdated', customization: { ...held } });
      else
        emit('session', { type: 'session/mcpServerStateChanged', id, state: fresh.state });
    }
    /*
     * And the ones that are no longer there.
     *
     * A server taken out of the configuration stops being reported, and a
     * customization list that only ever grew left it drawn for as long as the
     * session ran. Said one at a time rather than by re-sending the list: the
     * removal is the change, and a list re-sent on every refresh is the row
     * redrawn whether or not anything moved.
     */
    const still = new Set(found.map((raw) => `mcp:${str(bag(raw).name) ?? ''}`));
    for (const entry of [...customizations]) {
      const id = str(entry.id) ?? '';
      if (!id.startsWith('mcp:') || still.has(id)) continue;
      customizations.splice(customizations.indexOf(entry), 1);
      emit('session', { type: 'session/customizationRemoved', id });
    }
  };

  /*
   * Output styles this CLI has, learned at the handshake.
   *
   * Empty until then, which is why `setOutputStyle` does not refuse on an
   * empty list: not knowing the styles and knowing there are none are
   * different answers and only one of them is a reason to say no.
   */
  let styles: string[] = [];

  /** Which file each running edit tool is changing, by its call id. */
  const editing = new Map<string, string>();

  /** The server name behind an `mcp:` customization id, if it is one. */
  const serverNamed = (id: string): string | undefined =>
    (id.startsWith('mcp:') ? id.slice(4) : undefined);

  const describe = async (): Promise<void> => {
    const [init, mcp, skills] = await Promise.all([
      handle.initializationResult().then((r) => bag(r as unknown)).catch(() => ({} as Bag)),
      handle.mcpServerStatus().then((r) => (Array.isArray(r) ? r : [])).catch(() => [] as unknown[]),
      // The only way to know which commands are skills. It re-reads them from
      // disk, which at the start of a session is what one wants anyway.
      handle.reloadSkills().then((r) => list(bag(r as unknown).skills)).catch(() => [] as unknown[]),
    ]);
    offered = list(init.models)
      .map((raw) => {
        const model = bag(raw);
        // `value`, not `id`. Reading the wrong name costs every model there
        // is and leaves a picker that offers nothing.
        return { id: str(model.value) ?? '', name: str(model.displayName) ?? str(model.value) ?? '' };
      })
      .filter((model) => model.id !== '');
    styles = list(init.available_output_styles).filter((s): s is string => typeof s === 'string');
    /*
     * The style, settled both ways.
     *
     * A style chosen at creation is only a *setting* until the CLI is told,
     * and the CLI is not there to be told until now. One that was not chosen
     * is whatever the CLI already runs on, and reporting anything else would
     * draw a control sitting on a value that is not in force.
     */
    const asked = str(settings.outputStyle);
    const running = str(init.output_style);
    if (asked !== undefined && asked !== running) {
      await handle.applyFlagSettings({ outputStyle: asked }).catch(() => {});
    }
    else if (asked === undefined && running !== undefined) {
      settings.outputStyle = running;
    }
    await discover(mcp);
    customizations = customizationsOf(init, mcp, skills, wanted);
    if (customizations.length > 0) {
      emit('session', { type: 'session/customizationsChanged', customizations });
    }
    options.onHandshake?.();
  };
  void describe().catch(() => {});

  void (async () => {
    try {
      for await (const raw of handle) {
        const message = bag(raw as unknown);
        const type = str(message.type);
        // Every message carries it, so this needs no particular one to arrive.
        const said = str(message.session_id);
        if (said) agentId = said;

        // The message stream's own init. Capabilities come from the control
        // protocol instead (see `describe`), because those are needed before
        // a turn; what this adds is the model the turn actually ran on.
        if (type === 'system' && str(message.subtype) === 'init') { handshake = message; continue; }

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
          const turn = active;
          if (turn) {
            const about = bag(message.compact_metadata);
            const was = typeof about.pre_tokens === 'number' ? about.pre_tokens : undefined;
            const now = typeof about.post_tokens === 'number' ? about.post_tokens : undefined;
            const how = str(about.trigger) === 'manual' ? 'Context compacted' : 'Context compacted automatically';
            addPart(turn, {
              id: `${String(turn.id)}:compact:${String(turns.length)}`,
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
        if (active !== undefined && (type === 'user' || type === 'assistant')) {
          const entry = str(message.uuid);
          if (entry !== undefined) ends.set(String(active.id), entry);
        }

        if (type === 'stream_event') { streamed(bag(message.event)); continue; }
        if (type === 'assistant') { assistant(bag(message.message)); continue; }
        if (type === 'user') {
          // The prompt's own id, which is what a fork is cut at. Recorded on
          // the first echo of a turn and not after: later `user` frames in one
          // turn are tool results, and cutting at one of those would resume
          // halfway through work the agent had already started.
          const said = str(message.uuid);
          if (active && said !== undefined && !cuts.has(String(active.id))) cuts.set(String(active.id), said);
          results(bag(message.message));
          continue;
        }

        if (type === 'result') {
          const turn = active;
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
            turn.duration = typeof message.duration_ms === 'number' ? message.duration_ms : Date.now() - startedAt;
            // Before the turn completes, not after: the reducer hangs usage on
            // `activeTurn`, and `chat/turnComplete` is what moves that into
            // `turns` - so the other order reports it about nothing.
            const used = usageOf(message.usage, ran);
            if (used) {
              turn.usage = used;
              emit('chat', { type: 'chat/usage', turnId: turn.id, usage: used });
            }
            const part = wrong === undefined ? undefined : addFailure(turn, wrong);
            turns.push(turn);
            active = undefined;
            ran = undefined;
            parts.clear();
            calling.clear();
            streaming = undefined;
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
              emit('chat', { type: 'chat/error', turnId: turn.id, duration: turn.duration, part });
            }
            else {
              emit('chat', { type: 'chat/turnComplete', turnId: turn.id, duration: turn.duration });
            }
          }
          // About the session rather than the turn: it reads into
          // `Status.Error` and into the summary, and the next turn clears it.
          if (message.is_error === true) failed = wrong ?? 'The turn failed';
          doing(undefined);
          touch();
          startNext();
        }
      }
    } catch (error) {
      failed = error instanceof Error ? error.message : String(error);
      const turn = active;
      if (turn) {
        turn.state = 'error';
        turn.duration = Date.now() - startedAt;
        const part = addFailure(turn, failed);
        turns.push(turn);
        active = undefined;
        emit('chat', { type: 'chat/error', turnId: turn.id, duration: turn.duration, part });
      }
      doing(undefined);
      touch();
    }
  })();

  return {
    uri,
    chatUri,
    status,

    models: () => offered,
    agentId: () => agentId,
    forkPoint: (turnId) => cuts.get(turnId),
    endPoint: (turnId) => ends.get(turnId),

    customizations: () => customizations,
    allTurns: () => turns,
    activity: () => activity,
    title: () => title,
    modifiedAt: () => modified,
    workingDirectories: () => [`file://${cwd}`, ...peers.map((one) => `file://${one}`)],

    sessionState: () => ({
      // No `resource`: it is declared on `SessionSummary` and not on
      // `SessionState`, and a client subscribed to this channel named it.
      provider: 'claude',
      title,
      status: status(),
      lifecycle: 'ready',
      defaultChat: chatUri,
      chats: [{ resource: chatUri, title }],
      workingDirectories: [`file://${cwd}`, ...peers.map((one) => `file://${one}`)],
      customizations,
      // What it is doing, only while it is doing something. The protocol has
      // a session mirror its default chat's, which is where this is set.
      ...(activity !== undefined ? { activity } : {}),
      /*
       * The schema *and* what is in force.
       *
       * A client reads `config.schema.properties` to know which controls to
       * draw and `config.values` to know where each one sits - so a session
       * without this has no permission control, no model picker and no
       * effort control, which is what it had.
       */
      config: {
        schema: options.schema?.() ?? { type: 'object', properties: {} },
        values: { ...settings, ...(chosen ? { model: chosen } : {}) },
      },
      /*
       * The model this session is on, under `_meta` because the protocol has
       * no field for it.
       *
       * `SessionState` declares none: `UsageInfo.model` says what some past
       * turn ran on and `ModelSelection` says what a client asked for, and
       * neither answers "what is this session on now" before a turn exists.
       * `_meta` is the protocol's own escape hatch, and a client reading
       * `_meta.model` knows it is reading an extension - where a bare `model`
       * beside `title` and `provider` reads like a declared field, which is a
       * mistake somebody has already made with this one.
       */
      ...(chosen ?? str(bag(handshake).model)
        ? { _meta: { model: (chosen ?? str(bag(handshake).model)) as string } }
        : {}),
      // Set only while something is wanted. A key that is always present and
      // sometimes empty is a client that has to guess which it is.
      ...(pending.size > 0 ? { inputNeeded: [...pending.values()].map((one) => one.entry) } : {}),
      ...(failed ? { error: failed } : {}),
    }),

    chatState: () => ({
      resource: chatUri,
      title,
      status: status(),
      modifiedAt: modified,
      // A chat's own set, which may be narrower than its session's: the
      // process is rooted at the same place, and which peers it was given is
      // this chat's to say.
      workingDirectories: [`file://${cwd}`, ...peers.map((one) => `file://${one}`)],
      // The newest page. A resumed session can be seeded with hundreds of
      // turns, and the snapshot is what a client waits on before it draws.
      ...tail(turns),
      ...(active ? { activeTurn: active } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(draft !== undefined ? { draft } : {}),
      // Said rather than left to a default: `Full` is what a client assumes
      // when the field is absent, and assuming it is not the same as being
      // told. Every chat here is one somebody can type into.
      interactivity: 'full',
      ...(steering !== undefined ? { steeringMessage: steering } : {}),
      queuedMessages: [...queued],
    }),

    /**
     * The client said the turn has begun, so reduce it and get to work.
     *
     * Write-ahead: the turn is real the moment the client says so, and the
     * host's job is to make it true rather than to decide whether it may.
     */

    /**
     * A key this backend does not advertise, taken anyway when it means one.
     *
     * `autoApprove` and `mode` are conventional names a client sends whatever
     * a host advertises, and both mean something this harness can do. Mapped
     * onto the mode the CLI takes and recorded there, so the control this
     * backend *does* advertise shows what actually happened.
     *
     * False for anything else, and false is a real answer: a setter that
     * reported success and changed nothing would leave a client showing a
     * session in a state it is not in.
     */
    setConfig: async (key, value) => {
      /*
       * The lists, which really do move on a running session.
       *
       * The SDK takes `allowedTools` / `disallowedTools` when the query is
       * built and has nowhere to put a later change, so a list set halfway
       * through would be a control that reported success and did nothing.
       * `canUseTool` is the other half and reads `allowed` on every call -
       * which is where a change made now takes effect.
       */
      if (key === 'permissions') {
        const held = listsOf(value);
        if (!held) return `${key} takes an object with allow and deny, not ${typeof value}`;
        allowed = held;
        settings.permissions = held;
        return true;
      }
      const said = typeof value === 'string' ? value : '';
      if (key === 'model') {
        try {
          await handle.setModel(said === 'default' ? undefined : said);
          chosen = said;
          settings.model = said;
          return true;
        }
        catch { return `The harness would not take model ${said}`; }
      }
      if (key === 'effortLevel') {
        const found = EFFORTS.find((one) => one === said);
        if (!found) return `The harness has no effort level called ${said}`;
        settings.effortLevel = found;
        void handle.applyFlagSettings({ effortLevel: found }).catch(() => {});
        return true;
      }
      /*
       * Taken unvalidated until the CLI has said what it has.
       *
       * Before the handshake the list is not known, and refusing then would
       * refuse every style there is - so it is taken and the CLI is left to
       * disagree. The only wrong answer is a control that reports success and
       * changes nothing.
       */
      if (key === 'outputStyle') {
        if (styles.length > 0 && !styles.includes(said)) return `The harness has no output style called ${said}`;
        settings.outputStyle = said;
        void handle.applyFlagSettings({ outputStyle: said }).catch(() => {});
        return true;
      }
      /*
       * The mode this backend advertises, and the two conventional names for
       * the same axis.
       *
       * `permissionMode` is the schema's own property and its five values are
       * the CLI's. `autoApprove` and `mode` are what a client sends whatever a
       * host advertises, and `permissionFor` maps them onto the same axis.
       */
      const modes = ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk', 'auto'] as const;
      const found = key === 'permissionMode'
        ? modes.find((one) => one === said)
        : permissionFor(key, said);
      if (!found) {
        return key === 'permissionMode' || key === 'autoApprove' || key === 'mode'
          ? `The harness has no permission mode called ${said}`
          : `${key} is not a config key this backend takes`;
      }
      settings.permissionMode = found;
      void handle.setPermissionMode(found).catch(() => {});
      return true;
    },



    settings: () => ({ ...settings, ...(chosen ? { model: chosen } : {}) }),

    /**
     * Turn one on or off.
     *
     * Only MCP servers: the CLI has `toggleMcpServer` and nothing equivalent
     * for a skill, a prompt or a subagent. Those are refused rather than
     * accepted and dropped - a switch that reports success and changes
     * nothing is worse than one that says it cannot.
     */
    setCustomizationEnabled: async (id, enabled) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      const held = customizations.find((entry) => str(entry.id) === id);
      const was = str(bag(held?.state).kind);
      try {
        if (!enabled) {
          await handle.toggleMcpServer(server, false);
        }
        /*
         * Switching on a server that is not ready is how somebody signs into
         * one.
         *
         * `toggleMcpServer` only lifts the disabled flag - a server that was
         * off *because* nobody had signed in comes straight back needing a
         * sign-in, which reads as a switch that flips itself off.
         * `reconnectMcpServer` is the one that makes the CLI run its own
         * sign-in.
         */
        else if (was === 'ready') {
          await handle.toggleMcpServer(server, true);
        }
        else {
          await handle.toggleMcpServer(server, true).catch(() => {});
          emit('session', { type: 'session/mcpServerStartRequested', id });
          await handle.reconnectMcpServer(server);
        }
      }
      catch {
        // What it actually is now, which after a failed sign-in is still the
        // CLI's own `needs-auth` rather than anything this host invented.
        await refreshMcp();
        return true;
      }
      await refreshMcp();
      return true;
    },

    /**
     * Start one, which is also how a server that needs signing into is signed
     * into.
     *
     * `reconnectMcpServer` makes the CLI run its own sign-in, on the machine
     * the CLI is on. AHP's `authenticate` is the other model - the client
     * fetches a token and pushes it - and the SDK has nowhere to put one, so
     * this host serves the gesture and not the token.
     */
    startMcpServer: async (id) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      emit('session', { type: 'session/mcpServerStartRequested', id });
      try {
        await handle.reconnectMcpServer(server);
      }
      catch {
        await refreshMcp();
        return false;
      }
      await refreshMcp();
      return true;
    },

    /*
     * A token a client signed in with, put where the server will use it.
     *
     * The whole set is re-declared, not the one server: `setMcpServers`
     * replaces the SDK's dynamic servers with what it is given, so sending one
     * would take the others away. Then the server is asked to connect again,
     * which is when the CLI tries the header.
     */
    authenticated: async (resource, token) => {
      const named = [...wanted.entries()].find(([, published]) => published.resource === resource)?.[0];
      if (named === undefined) return false;
      const config = declared[named];
      if (config === undefined) return false;
      const headers = typeof config.headers === 'object' && config.headers !== null
        ? config.headers as Record<string, string>
        : {};
      declared[named] = { ...config, headers: { ...headers, Authorization: `Bearer ${token}` } };
      try {
        await handle.setMcpServers(declared as never);
        // Discovered again next time: a server that connects is no longer one
        // anybody needs to sign into.
        wanted.delete(named);
        await handle.reconnectMcpServer(named);
      }
      catch { return false; }
      await refreshMcp();
      return true;
    },

    awaiting: () => [...wanted.values()].map((published) => published.resource),

    stopMcpServer: async (id) => {
      const server = serverNamed(id);
      if (!server)
        return false;
      emit('session', { type: 'session/mcpServerStopRequested', id });
      try {
        await handle.toggleMcpServer(server, false);
      }
      catch {
        await refreshMcp();
        return false;
      }
      await refreshMcp();
      return true;
    },


    /**
     * A model named on the turn takes effect and **stays** in effect.
     *
     * The SDK has no per-turn model, so honouring `message.model` means
     * `setModel` before the prompt - and setting it back afterwards would
     * race the next turn onto whichever call landed last. Leaving it is the
     * behaviour that can be explained; silently ignoring the field is the one
     * that cannot, because the transcript would then credit a turn to a model
     * that never ran it.
     */
    begin: (turnId, text, model) => beginTurn(turnId, text, model),

    /**
     * A turn this host answered itself, with a shell rather than the agent.
     *
     * The same shape as any other turn - it opens, carries one tool call, and
     * completes - because that is what makes it readable afterwards: the
     * command and its output are in the transcript beside the conversation
     * they interrupted, rather than in a panel that closed. Nothing is pushed
     * to the CLI, which is the whole difference from `begin`.
     */
    ran: (turnId, command, run) => {
      // Queued behind whatever is running, like anything else a person types.
      // A shell command that jumped the queue would run against a tree the
      // turn in front of it is still editing.
      if (active) {
        queued.push({ id: turnId, message: { text: `!${command}`, origin: { kind: 'user' } } });
        emit('chat', { type: 'chat/pendingMessageSet', message: queued[queued.length - 1] });
        touch();
        return;
      }
      const turn: Bag = {
        id: turnId,
        startedAt: new Date().toISOString(),
        message: { text: `!${command}`, origin: { kind: 'user' } },
        responseParts: [],
        usage: undefined,
      } satisfies WireTurn<ActiveTurn> as Bag;
      active = turn;
      startedAt = Date.now();
      failed = undefined;
      emit('chat', {
        type: 'chat/turnStarted', turnId, startedAt: turn.startedAt, message: turn.message,
      });
      if (title === 'New session') retitle(command.slice(0, 60));
      doing('Running');
      const toolCallId = `${turnId}:command`;
      /*
       * `terminal` as the name, which is what the reference host calls it.
       *
       * A client draws a tool call by its name, and one called anything else
       * would be drawn as an unknown tool rather than as the shell it is.
       */
      const call = {
        toolCallId,
        toolName: 'terminal',
        displayName: 'Terminal',
        intention: command,
        invocationMessage: command,
        toolInput: command,
        // The person typed it themselves, so there is nobody left to ask.
        confirmed: 'not-needed',
        status: 'running',
      } satisfies OnWire<ToolCallRunningState> as Bag;
      holdPart(turn, call);
      emit('chat', {
        type: 'chat/toolCallStart', turnId, toolCallId, toolName: 'terminal',
        displayName: 'Terminal', intention: command,
      });
      emit('chat', {
        type: 'chat/toolCallReady', turnId, toolCallId,
        invocationMessage: command, toolInput: command, confirmed: 'not-needed',
      });
      void run(toolCallId).then((done) => {
        if (active !== turn) return;
        /*
         * The terminal first, so a client can watch the output arrive.
         *
         * `content` is replaced rather than appended to, so the terminal
         * reference and the text it produced go out together at the end -
         * and the reference alone goes out as soon as there is one, which is
         * what a client needs to start streaming.
         */
        const watched = done.terminal === undefined ? [] : [{
          type: 'terminal',
          resource: done.terminal,
          title: 'Terminal',
          // Pipes, not a pseudoterminal, which is what the field is for: a
          // client reads it to decide whether the preview needs VT parsing.
          isPty: false,
          result: {
            ...(done.code !== undefined ? { exitCode: done.code } : {}),
            ...(done.output === '' ? {} : { preview: done.output }),
          },
        } satisfies OnWire<ToolResultTerminalContent>];
        const said = done.output === ''
          ? []
          : [{ type: 'text', text: done.output } satisfies OnWire<ToolResultTextContent>];
        const shown = [...watched, ...said];
        const result = {
          success: done.success,
          pastTenseMessage: done.said,
          content: shown,
          ...(done.success ? {} : { error: { message: done.said } }),
        } satisfies Partial<OnWire<ToolCallCompletedState>>;
        Object.assign(call, result, { status: 'completed', confirmed: 'not-needed' });
        emit('chat', { type: 'chat/toolCallComplete', turnId, toolCallId, result });
        turn.state = done.success ? 'complete' : 'error';
        turn.duration = Date.now() - startedAt;
        turns.push(turn);
        active = undefined;
        if (!done.success) failed = done.said;
        emit('chat', { type: 'chat/turnComplete', turnId, duration: turn.duration });
        doing(undefined);
        touch();
        startNext();
      });
    },

    /**
     * Into the turn that is already running, rather than after it.
     *
     * The whole of it is `waiting.push` and a wake, which is the same door
     * `begin` and the queue go through: the prompt handed to the CLI is a
     * generator that stays open for the life of the session, so a message
     * pushed while a turn runs is delivered to that turn. This was refused on
     * the grounds that "the SDK has nowhere to put one", which was a claim
     * about the harness nobody had tested and is not true of this one.
     *
     * Set and removed in the same breath, because it is consumed the instant
     * it arrives: `steeringMessage` describes a message *waiting* to be
     * injected, and nothing waits here. The protocol says the server emits
     * the removal when it consumes one, so both go out and the state field
     * stays empty - which is the honest description of what happened.
     */
    steer: (id, text) => {
      if (!active) return false;
      const message = { text, origin: { kind: 'user' } };
      // Held in the state as well as announced, and taken out again where the
      // CLI reads it rather than here: a client that only read the state saw
      // nothing waiting, because the announcement and its removal used to
      // happen in one tick.
      steering = { id, message };
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id, message });
      waiting.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
      wake?.();
      wake = undefined;
      touch();
      return true;
    },

    /**
     * Wait, then be the next turn.
     *
     * Idle *now* means this is not a queue at all, and the protocol says the
     * host starts the head as soon as it can - so it is announced and then
     * immediately started, which is a queue entry a client sees appear and
     * leave rather than one that was never there.
     */
    queue: (id, text, model) => {
      const entry: Bag = {
        id,
        message: {
          text,
          origin: { kind: 'user' },
          ...(model ? { model: { id: model.id, ...(model.config ? { config: model.config } : {}) } } : {}),
        },
      };
      const at = queued.findIndex((held) => str(held.id) === id);
      // The same id again edits what is waiting; a fresh one appends. That is
      // the client's spelling for "change my mind" and it costs nothing here.
      if (at >= 0) queued[at] = entry;
      else queued.push(entry);
      emit('chat', { type: 'chat/pendingMessageSet', kind: 'queued', id, message: entry.message });
      touch();
      startNext();
    },

    setDraft: (next) => {
      if (JSON.stringify(next) === JSON.stringify(draft))
        return;
      draft = next;
      // Not `touch()`: typing is not a change to the conversation, and a
      // catalogue that reordered itself on every keystroke would be unusable.
      // The key is left off to clear it, which is what the action's
      // `undefined` means and the only way JSON can say it.
      emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
    },

    unqueue: (id) => {
      const at = queued.findIndex((held) => str(held.id) === id);
      if (at < 0) return;
      queued.splice(at, 1);
      emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
      touch();
    },

    reorder: (order) => {
      const byId = new Map(queued.map((held) => [str(held.id) ?? '', held]));
      const moved: Bag[] = [];
      const seen = new Set<string>();
      for (const id of order) {
        const held = byId.get(id);
        if (!held || seen.has(id)) continue;
        seen.add(id);
        moved.push(held);
      }
      // Anything the order did not mention keeps its place behind what did,
      // rather than being dropped for not having been named.
      for (const held of queued) {
        if (!seen.has(str(held.id) ?? '')) moved.push(held);
      }
      queued.length = 0;
      queued.push(...moved);
      emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => str(held.id) ?? '') });
      touch();
    },

    /*
     * The same turn, run again.
     *
     * The protocol is precise about this: the latest turn, in `error`, reopened
     * with its message and parts intact rather than replaced by a new one. So
     * the turn moves back to `active` as it was and its text goes to the CLI
     * again - which is what makes a failed turn retryable without somebody
     * having to type it a second time.
     */
    resume: (turnId) => {
      if (active !== undefined) return false;
      const last = turns.at(-1);
      if (last === undefined || String(last.id ?? '') !== turnId || last.state !== 'error') return false;
      turns.pop();
      const again = { ...last } as Bag;
      // `state` and `duration` are what made it a finished turn; an active one
      // has neither, and the protocol says the reducer reopens *this* turn
      // rather than replacing it.
      delete again.state;
      delete again.duration;
      active = again as unknown as NonNullable<typeof active>;
      startedAt = Date.now();
      failed = undefined;
      doing('Thinking');
      const message = bag((active as Bag).message);
      waiting.push({
        type: 'user',
        message: { role: 'user', content: str(message.text) ?? '' },
        parent_tool_use_id: null,
      });
      wake?.();
      wake = undefined;
      touch();
      return true;
    },

    cancel: (turnId) => {
      // A turn blocked on a person is stopped by answering no, not by leaving
      // a promise nobody will settle - the subprocess would sit there for ever.
      // All of them, not the last one: a turn stopped while two questions
      // were open used to leave the other tool waiting for ever.
      for (const one of [...pending.values()]) {
        pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The turn was stopped' });
        inputNeededRemoved(one.id);
      }
      // And the calls a client is running for us, for the same reason: a
      // promise settled by somebody else is one a stopped turn still waits on.
      releaseCalls('The turn was stopped');
      void handle.interrupt().catch(() => {});
      const turn = active;
      if (turn) {
        turn.state = 'cancelled';
        turn.duration = Date.now() - startedAt;
        turns.push(turn);
        active = undefined;
        emit('chat', { type: 'chat/turnCancelled', turnId: turnId || turn.id, duration: turn.duration });
      }
      doing(undefined);
      touch();
      // Deliberately not `startNext`: somebody stopping a turn is stopping
      // this conversation, and starting the one behind it is the opposite of
      // what they asked for.
    },

    confirm: (toolCallId, approved) => {
      // Found by id rather than assumed to be the only one. This used to
      // compare against whichever question happened to be held and return
      // silently when it did not match - which, with two tool calls open, is
      // a person pressing Approve and nothing at all happening.
      const held = [...pending.values()].find((one) => one.entry.kind === 'toolConfirmation'
        && str(bag(one.entry.toolCall).toolCallId) === toolCallId);
      if (!held) return;
      const settle = held.settle;
      pending.delete(held.id);
      inputNeededRemoved(held.id);
      const part = parts.get(toolCallId);
      if (part) {
        bag(part.toolCall).status = approved ? 'running' : 'cancelled';
        // And how it was approved, which is required on the call and was only
        // ever said in the action.
        if (approved) bag(part.toolCall).confirmed = 'user-action';
      }
      doing(approved ? busyWith(str(bag(part?.toolCall).toolName) ?? 'tool', {}) : 'Thinking');
      // Said back, like every other action a client originates. Nothing in a
      // client applies its own dispatch, so a row approved here stayed
      // `pending-confirmation` on every screen watching it - including the
      // one that had just answered it.
      emit('chat', {
        type: 'chat/toolCallConfirmed',
        turnId: active?.id,
        toolCallId,
        approved,
        ...(approved ? { confirmed: 'user-action' } : {}),
      });
      settle(approved
        ? { behavior: 'allow', updatedInput: {} }
        : { behavior: 'deny', message: 'The person declined this action' });
      touch();
    },

    /**
     * The tools on offer, replaced whole.
     *
     * Whole because that is what the SDK takes: `setMcpServers` replaces the
     * set it is given, so a server rebuilt from one tool would take the others
     * away. Called when a client announces what it provides or stops being
     * active, which is the only thing that moves this list after a session is
     * built.
     */
    setTools: async (next) => {
      const before = offering.map((one) => `${one.definition.name} ${one.owner ?? ''}`).join('\n');
      const after = next.map((one) => `${one.definition.name} ${one.owner ?? ''}`).join('\n');
      if (before === after) return true;
      offering = [...next];
      if (offering.length > 0) declared.ahp = contributed(offering, ranByClient) as Bag;
      else delete declared.ahp;
      try { await handle.setMcpServers(declared as never); }
      catch { return false; }
      return true;
    },

    toolCallOwner: (toolCallId) => byClient.get(toolCallId)?.owner,

    /**
     * What a client says its own tool did.
     *
     * Only from the client the call was reported against: the protocol makes
     * that one responsible for the call, and a result from anybody else is a
     * client answering for work it did not do. Answered `false` either way -
     * for a call nobody is waiting on and for a client that does not own it -
     * because both are a client out of step, and the caller says which.
     *
     * Nothing is emitted here. The answer goes back to the CLI, the CLI writes
     * the tool result, and `results` reports the completion to everybody from
     * that - which is the same path every other tool call takes. A completion
     * announced here as well would be the same row finished twice.
     */
    completeToolCall: (toolCallId, clientId, result) => {
      const held = byClient.get(toolCallId);
      if (!held || held.owner !== clientId) return false;
      byClient.delete(toolCallId);
      held.settle(result);
      return true;
    },

    clientGone: (clientId) => {
      // A tool call whose client has gone is a turn waiting on a promise
      // nothing will settle. The agent is told it failed, which is true, and
      // is left to decide what to do about it.
      releaseCalls('The client that provides this tool is no longer here', clientId);
    },

    /**
     * One question of a request, part-way answered.
     *
     * The same thing `setDraft` is for a message: held here so that two people
     * looking at one elicitation see the form being filled in rather than each
     * filling in their own. Kept on the request itself as well as emitted,
     * because a client that arrives while the question is open reads
     * `session.inputNeeded` and would otherwise see an empty form somebody has
     * already answered.
     *
     * False when the request is not one this session is waiting on, which is
     * the caller's to report - answering a question nobody asked is a client
     * out of step, not a no-op.
     */
    setAnswer: (requestId, questionId, answer) => {
      const held = pending.get(requestId);
      // Only a question has answers. A tool confirmation is the other kind of
      // pending input and is answered by approving it, so a draft answer to
      // one names a field it does not have.
      if (!held || held.entry.kind !== 'chatInput') return false;
      if (answer === undefined) held.answers.delete(questionId);
      else held.answers.set(questionId, answer);
      const request = bag(held.entry.request);
      if (held.answers.size > 0) request.answers = Object.fromEntries(held.answers);
      else delete request.answers;
      // Not `touch()`: typing is not a change to the conversation, and a
      // catalogue that reordered itself on every keystroke would be unusable.
      emit('chat', {
        type: 'chat/inputAnswerChanged',
        requestId,
        questionId,
        ...(answer !== undefined ? { answer } : {}),
      });
      return true;
    },

    /**
     * Answer the question, in the shape the tool wants it back.
     *
     * Keyed by each question's own *text* and valued by the option's own
     * label - not by any id. Sending ids, or dropping `questions`, is a call
     * the tool cannot process and a turn that stalls rather than errors.
     */
    answer: (requestId, accepted, answers) => {
      const held = pending.get(requestId);
      if (!held) return;
      pending.delete(requestId);
      inputNeededRemoved(requestId);

      if (!accepted) {
        held.settle({ behavior: 'deny', message: 'The person declined to answer' });
        touch();
        return;
      }
      const said: Record<string, unknown> = {};
      /*
       * What was typed, under what was sent.
       *
       * The protocol has `chat/inputCompleted` use the request's synced answer
       * state *plus* whatever the completion carries, and the completion is
       * allowed to carry nothing at all - a client that has been syncing each
       * answer as it went has already said everything. Reading only the action
       * threw that away and submitted an empty form.
       */
      const whole = { ...Object.fromEntries(held.answers), ...answers };
      for (const [key, value] of Object.entries(whole)) {
        const question = held.asked.get(key);
        if (!question) continue;
        const answer = bag(value);
        /*
         * Two levels in, which is where the protocol puts it.
         *
         * `ChatInputAnswer` is `{ state, value }` and that value is itself
         * `{ kind, value }` - so an answer synced through
         * `chat/inputAnswerChanged`, which is protocol-shaped, holds the word
         * the tool wants one level below where a completion's own `answers`
         * carried it. Read at one level a selection arrived as the object
         * around it, and the tool was handed a shape it cannot read.
         *
         * Freeform is the person's own words as the value, not the word they
         * typed it under - the tool reads the value as the answer itself.
         */
        const inner = bag(answer.value);
        said[question] = inner.value ?? answer.value ?? value;
      }
      held.settle({ behavior: 'allow', updatedInput: { questions: held.questions ?? [], answers: said } });
      touch();
    },

    close: () => {
      closed = true;
      wake?.();
      for (const one of [...pending.values()]) {
        pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The session was disposed' });
      }
      releaseCalls('The session was disposed');
      handle.close();
    },
  };
}
