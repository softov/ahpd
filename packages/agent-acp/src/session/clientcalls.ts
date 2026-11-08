import { createClientCalls as holder } from '@ahpd/sdk';
import type { Bag, BoundTool, ClientCalls as Held, RunClientTool } from '@ahpd/sdk';
import { HOST_SERVER } from '../mapping.js';
import type { AcpCall, ClientTool } from '../types.js';
import { bag } from './common.js';
import type { SessionContext } from './context.js';

/**
 * Where an agent names the call it is making, on a `tools/call`'s `_meta`.
 *
 * The key the Claude CLI's own tool server reads, and the one an agent that
 * carries it uses here: a `tools/call` holds a tool and some arguments and
 * nothing else, so this is the only thing in one that says which of two
 * identical concurrent calls it was made for.
 */
const TOOL_USE_ID = 'claudecode/toolUseId';

/**
 * The prefix of an id this bridge made up for a call.
 *
 * A call the agent never reported has no ACP tool call id to be held under, so
 * this bridge gives it one: the prefix says the id is this bridge's, and no
 * agent spells anything this way.
 */
const OWN_PREFIX = 'ahp-mcp-';

/** What this area offers the rest of the session, and the `Session` members it brings. */
export interface ClientCalls {
  /**
   * Which client's tool the agent reported a call for, if any: its owner and
   * the name the client announced it with.
   *
   * Nothing for a call that is not a client's: the host's own tools ride the
   * same server and are nobody's to run.
   */
  clientToolOf: (name: string | undefined, title: string) => ClientTool | undefined;
  /**
   * Hold a call a client owns, so the entry asking it goes out.
   *
   * Called where the ready says the call is running, and at the approval for a
   * call the person was asked about first.
   */
  openCall: (call: AcpCall, turnId: string) => void;
  /** The one place this session's client calls are held, for the snapshot and above. */
  calls: Held;
  /**
   * Run one tool where the client that provides it lives, and wait for it.
   *
   * What the host's tool server is handed, because it is the thing that
   * receives the agent's `tools/call` and has nothing to run a client's tool
   * with: it finds the call the request is for and hands back what the owner
   * said.
   */
  ranByClient: RunClientTool;
  /**
   * The tools this session may offer, replaced whole.
   *
   * Whole because that is how the host sends them: a client announces what it
   * provides or stops being active, and what a session may offer is the
   * session's rather than one chat's. The lookup a reported call is recognised
   * by reads this, and the endpoint the agent is served from is told the same
   * list, which is what lets a client that arrived after the session opened own
   * its calls and be called.
   */
  setTools: (tools: BoundTool[]) => Promise<boolean>;
}

export function createClientCalls(ctx: SessionContext): ClientCalls {
  /*
   * The calls this session has out with its clients, held in one place.
   *
   * The holder raises the entry on the session, keeps an answer that arrives
   * before the harness asks for it, and times a call out.
   */
  const calls = holder({
    chat: ctx.start.chatUri,
    emit: ctx.emit,
    timeoutMs: ctx.start.clientToolTimeoutMs,
  });

  /**
   * The tool of a client's that what the agent said names, as it is offered.
   *
   * Whole or after the prefix, because the agent may say the name either way.
   * A tool nobody owns is not a client's: the host's own tools ride the same
   * server, and a schema the offering does not hold is nothing this session
   * ever offered.
   */
  const offered = (said: string): BoundTool | undefined => {
    const bare = said.startsWith(HOST_SERVER) ? said.slice(HOST_SERVER.length) : said;
    return ctx.offering.find((one) => one.owner !== undefined && one.definition.name === bare);
  };

  /**
   * Which client's tool the agent reported a call for, by its owner and the
   * name the client announced it with, which is what follows the owner's id in
   * the name the tool is offered under.
   *
   * The name the agent gave is read before the title, and the title only when
   * it named none: an agent that said what the tool was called has said which
   * one it meant, so a title that happens to spell another client's tool is not
   * what it reported.
   */
  const clientToolOf = (name: string | undefined, title: string): ClientTool | undefined => {
    const tool = offered(name ?? title);
    return tool?.owner === undefined ? undefined : { owner: tool.owner, name: tool.definition.name.slice(tool.owner.length + 2) };
  };

  /**
   * Ask the client that owns a call to run it.
   *
   * The call is named by the tool the client announced, which is the name the
   * client answers to and the name every sentence about the call uses, drawn
   * as the chat's row draws it, and is held while the offering still has that
   * client's tool.
   */
  const openCall = (call: AcpCall, turnId: string): void => {
    const owner = call.contributor;
    if (owner === undefined || !ctx.offering.some((one) => one.owner === owner && one.definition.name === `${owner}__${call.toolName}`)) return;
    calls.open({
      turnId,
      owner,
      toolCall: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        displayName: call.displayName,
        invocationMessage: call.displayName,
        // Nothing is being asked here: a call that runs at all has cleared its
        // confirmation gate.
        confirmed: 'not-needed',
        ...(call.input === undefined ? {} : { toolInput: call.input }),
      },
    });
  };

  /** How many calls this bridge has named itself, so that no two share an id. */
  let invented = 0;

  /**
   * A row of this bridge's own, for a request the agent never reported.
   *
   * An ACP agent may call a client's tool without reporting the call, and the
   * agent is blocked on the request all the same, so the call is held and its
   * owner is asked through the entry like any other. It is drawn on the chat
   * as well, because a client that watches the chat rather than the session
   * has to see the call it is being asked about: everything a reported call
   * gets, less the agent's own id, which the agent never gave. The row is
   * named by the client's own name for the tool, as a reported call's row is.
   *
   * The turn is the running one. A request arriving with no turn behind it is
   * still held, since the entry is what asks, and has no turn to draw it in.
   * The row is drawn under the client's name too: this call was never
   * reported, so it has no title of the agent's.
   */
  const openOwn = (owner: string, name: string, input: string): string => {
    invented += 1;
    const toolCallId = `${OWN_PREFIX}${invented}`;
    const call: AcpCall = {
      toolCallId,
      toolName: name,
      displayName: name,
      readied: true,
      asked: false,
      contributor: owner,
      input,
    };
    /*
     * Said out loud, because the row is drawn from nothing the agent said, so
     * a person reading a transcript with a row the agent has no account of has
     * only this line to tell them where it came from.
     */
    ctx.options.log?.(`${ctx.provider}: the agent reported no call for ${owner}__${name}; it is run as ${toolCallId}`);
    const turnId = ctx.mapping?.turnId;
    if (turnId !== undefined) {
      const contributor = { contributor: { kind: 'client', clientId: owner } };
      ctx.emit('chat', {
        type: 'chat/toolCallStart', turnId, toolCallId, toolName: name, displayName: name, ...contributor,
      });
      ctx.emit('chat', {
        type: 'chat/toolCallReady',
        turnId,
        toolCallId,
        invocationMessage: name,
        confirmed: 'not-needed',
        toolInput: input,
        ...contributor,
      });
    }
    openCall(call, turnId ?? '');
    return toolCallId;
  };

  /**
   * The call one `tools/call` is for, opening one of this bridge's own when
   * the agent reported none.
   *
   * Four ways to find it, in this order: the id the agent put on the request,
   * the one open call of that tool, the call whose arguments are the request's,
   * and a row of this bridge's own. The id is what tells two identical
   * concurrent calls apart, a lone open call is the only thing a request that
   * names no call can be for, and the arguments tell apart two calls of one
   * tool that were made for different things, when the agent reported them,
   * which it need not.
   *
   * Two or more calls and nothing to choose between them is answered with an
   * error result, as VS Code's client tool server answers a request it cannot
   * name a call for: a result never lands on another call, and the agent is
   * told to make the call again. A record whose `unreportedClientCalls` is
   * `error` answers a request no reported call matched the same way.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/clientTools/claudeClientToolMcpServer.ts#L46-L55
   */
  const callFor = (owner: string, name: string, input: Bag, meta: Bag | undefined): string => {
    const said = meta?.[TOOL_USE_ID];
    const id = typeof said === 'string' && said !== '' ? said : undefined;
    // Only one of this owner's own calls: an id that names another client's
    // call, or one already answered, says nothing about this request.
    if (id !== undefined && calls.owner(id) === owner) return id;
    const open = calls.entries()
      .filter((entry) => String(entry.clientId) === owner)
      .map((entry) => bag(entry.toolCall))
      .filter((call) => String(call.toolName) === name);
    if (open.length === 0) {
      if (ctx.options.unreportedClientCalls !== 'error') return openOwn(owner, name, JSON.stringify(input));
      throw new Error(`Client tool "${name}" could not run: the agent reported no call it is for, and the request names none (expected at _meta["${TOOL_USE_ID}"]).`);
    }
    // An agent that makes one call at a time, which is most of them, has
    // nothing else this request could be for.
    if (open.length === 1) return String(open[0]?.toolCallId);
    /*
     * More than one, so the arguments are all there is - and they are here only
     * when the agent said them. A call the agent reported with a title alone
     * carries no arguments, and matches none.
     */
    const written = JSON.stringify(input);
    const found = open.find((call) => call.toolInput === written);
    if (found !== undefined) return String(found.toolCallId);
    throw new Error(`${open.length} calls of ${owner}__${name} are open and the request names no call; nothing says which one this is for`);
  };

  /**
   * Run one tool where the client that provides it lives, and wait for it.
   *
   * What the host's tool server calls when a `tools/call` arrives for a tool a
   * client owns. The tool is offered under the client's id and the client's own
   * name, so the name the client answers to is that one stripped; the answer is
   * the owner's own words and blocks, which the server turns into the MCP
   * content the agent reads.
   */
  const ranByClient: RunClientTool = async (tool, input, meta) => {
    const owner = String(tool.owner ?? '');
    const name = tool.definition.name.slice(owner.length + 2);
    return await calls.wait(callFor(owner, name, input, meta));
  };

  /**
   * The tools this session may offer, replaced whole.
   *
   * Two places hold that list and both move: the offering, which is what a
   * reported call's owner is looked up in, and the endpoint, which is what the
   * agent is served from. They are one list seen from two sides, so a client
   * that arrives is a tool that can be recognised and a tool the agent can
   * call, or neither.
   */
  const setTools = async (tools: BoundTool[]): Promise<boolean> => {
    ctx.offering = [...tools];
    ctx.toolsEndpoint()?.setTools([...tools]);
    return true;
  };

  return { clientToolOf, openCall, calls, ranByClient, setTools };
}
