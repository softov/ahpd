/**
 * The updates this bridge watched, rebuilt as the turns a client reads.
 *
 * ACP has no stored transcript to read: `loadSession` replays notifications
 * rather than returning turns, so the only record of a session this process
 * saw is the one it kept as it went. What is kept is the raw `session/update`
 * stream per turn; what a client wants is `WireTurn`s. This file is the
 * translation between them, and it runs the same `mapUpdate` the live session
 * runs, so a rebuilt turn cannot drift from the one that was streamed.
 *
 * What a server replays on `session/load` is watched the same way: the updates
 * are split at each user message into turns that sit ahead of the ones this
 * process watched, so a resumed session opens with the conversation it was
 * resumed for rather than with only what came after.
 *
 * A resume replays nothing, so the conversation the host held when it asked is
 * kept on the record as it was given and read ahead of both.
 *
 * A session this process never watched has no record, and `Agent.transcript`
 * answers `undefined` for it rather than inventing a conversation.
 */

import { bag, endedParts } from '@ahpd/sdk';
import type { Agent, Bag, MessageAttachment } from '@ahpd/sdk';
import type { ContentBlock, SessionUpdate } from '@agentclientprotocol/sdk';
import { mapUpdate } from './mapping.js';
import type { AcpTurn, WatchedSession, WatchedTurn } from './types.js';

/**
 * The turns `Agent.transcript` answers with.
 *
 * Named by query rather than imported from the protocol package: an agent
 * backend states its protocol shapes through `@ahpd/sdk`, and taking a second
 * dependency to repeat the same type would be a boundary this package does not
 * declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
export type TranscriptTurn = Transcript[number];

/** A server's stable assistant-message identity, when it supplies one. */
export function messageIdOf(update: SessionUpdate): string | undefined {
  if (update.sessionUpdate !== 'agent_message_chunk') return undefined;
  const id = bag(update).messageId;
  return typeof id === 'string' && id.trim() !== '' ? id : undefined;
}

/**
 * One watched session's turns, in the order they ran.
 *
 * What the host already held comes first, whole: a resume replays nothing, so
 * those turns were never watched here and there are no updates to rebuild them
 * from. The rest start with no part, exactly as the live one does, and every
 * watched update is replayed into it. The part list a replay builds is the
 * same list the live turn held, because it is the same function building it.
 */
export function turnsOf(session: WatchedSession): TranscriptTurn[] {
  // The host's own turns, which are the shape a client reads already: a cast
  // because a `Bag` states nothing and the wire turn is what was put in it.
  const held = session.held as unknown as TranscriptTurn[];
  return [...held, ...session.turns.map((watched) => {
    const replay: AcpTurn = {
      turnId: watched.turnId,
      parts: [],
      calls: new Map(),
      opening: [],
    };
    for (const { update, at } of watched.updates) mapUpdate(replay, update, at);
    // A call still open when its turn ended is held as the protocol's reducer
    // holds it once the turn's ending is reduced, as the live session holds it.
    replay.parts = endedParts(replay.parts);
    /*
     * A turn cut off ends with VS Code's error for one, after its parts. ahpd
     * resumes no ACP turn, so the part is not resumable, which the protocol
     * reads as a turn that cannot be resumed.
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/actions.ts#L499-L500
     */
    if (watched.interrupted === true) {
      (replay.parts as Bag[]).push({
        kind: 'error',
        error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
      });
    }
    return {
      id: watched.turnId,
      startedAt: watched.startedAt,
      /*
       * A turn this bridge began is the person's unless somebody said
       * otherwise, and the transcript says so: the protocol requires an
       * origin, which a typed read of the live snapshot's `Bag` cannot carry.
       * What was attached to the message comes back with it.
       */
      message: {
        text: watched.message.text,
        origin: watched.message.origin ?? { kind: 'user' },
        ...(watched.message.attachments === undefined ? {} : { attachments: watched.message.attachments }),
      },
      responseParts: replay.parts,
      // What the turn last said it had spent, which is what the live turn holds
      // and what a rebuilt one has to agree with. What the turn itself kept
      // wins: it counts the cost from where this turn opened, which a replay
      // starting at the session's first update cannot know.
      usage: watched.usage ?? replay.usage,
      state: watched.state,
      ...(watched.duration === undefined ? {} : { duration: watched.duration }),
    };
  })];
}

/**
 * One block of a person's replayed message as the attachment it was, or
 * nothing for a block that is no attachment: an image's bytes, a resource the
 * person embedded, or a link to one.
 *
 * A `Bag` in the protocol's shape: its kinds are an enum of the protocol
 * package, which this package names through `@ahpd/sdk` alone, and these are
 * the enum's values.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L686-L703
 */
const attachmentOf = (content: ContentBlock): Bag | undefined => {
  const kind = (type: string | null | undefined): string => (type?.startsWith('image/') === true ? 'image' : 'document');
  switch (content.type) {
    case 'image':
      return { type: 'embeddedResource', label: 'attachment', data: content.data, contentType: content.mimeType, displayKind: 'image' };
    case 'resource_link':
      return {
        type: 'resource',
        uri: content.uri,
        label: content.title ?? content.name,
        ...(typeof content.mimeType === 'string' ? { contentType: content.mimeType } : {}),
        ...(typeof content.size === 'number' ? { sizeHint: content.size } : {}),
        displayKind: kind(content.mimeType),
      };
    case 'resource': {
      const { resource } = content;
      const label = resource.uri.slice(resource.uri.lastIndexOf('/') + 1) || resource.uri;
      return 'blob' in resource
        ? { type: 'embeddedResource', label, data: resource.blob, contentType: resource.mimeType ?? 'application/octet-stream', displayKind: kind(resource.mimeType) }
        : { type: 'resource', uri: resource.uri, label, ...(typeof resource.mimeType === 'string' ? { contentType: resource.mimeType } : {}), displayKind: 'document' };
    }
    default:
      return undefined;
  }
};

/**
 * The turns a `session/load` replayed, in the order the conversation had them.
 *
 * The spec replays a turn as the person's message followed by the updates the
 * agent made for it, so the split is at each message - which is not the same as
 * at each `user_message_chunk`, because a message of any length arrives as
 * several chunks: text, an image, a resource. Consecutive user chunks are one
 * message and one turn, and a chunk starts a new turn only once the open one
 * holds something the agent said.
 *
 * What comes before the first message is kept as a turn of its own with no
 * text, because a server that replays without a question has still said
 * something and dropping it would lose the start of the conversation. No
 * person began it, so its message is the agent's, the protocol's origin for a
 * message the agent produced itself.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L760-L767
 *
 * A person's image or resource in a chunk of their message is read into the
 * message's attachments, as VS Code reads a replayed message's attachments:
 * bytes sent with the message as an embedded resource, labelled `attachment`
 * where nothing names them, and a file named by its URI as a resource,
 * labelled by its name and drawn as an image or a document by its type.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1238-L1288
 *
 * The updates are kept raw and read back through `turnsOf` like any watched
 * turn, so a replayed turn and a live one are the same rendering. ACP carries
 * no turn ids or times for a replay. A server's first assistant messageId,
 * when present, is the same anchor a live turn records; otherwise the id is
 * this process's. The time is when the replay was heard.
 */
export function replayedTurns(updates: SessionUpdate[], at: string): WatchedTurn[] {
  const turns: WatchedTurn[] = [];
  let open: WatchedTurn | undefined;
  /** Whether anything the agent said has gone into the turn being built. */
  let answered = false;
  let anchored = false;
  for (const update of updates) {
    const asked = update.sessionUpdate === 'user_message_chunk';
    if (open === undefined || (asked && answered)) {
      open = {
        turnId: crypto.randomUUID(),
        startedAt: at,
        message: { text: '', ...(asked ? {} : { origin: { kind: 'agent' } }) },
        state: 'complete',
        updates: [],
      };
      turns.push(open);
      answered = false;
      anchored = false;
    }
    if (asked && update.content.type === 'text') {
      open.message.text = `${open.message.text}${update.content.text}`;
    }
    const messageId = messageIdOf(update);
    if (!anchored && messageId !== undefined) {
      open.turnId = messageId;
      anchored = true;
    }
    const attached = asked ? attachmentOf(update.content) : undefined;
    if (attached !== undefined) open.message.attachments = [...(open.message.attachments ?? []), attached as unknown as MessageAttachment];
    open.updates.push({ update });
    answered = answered || !asked;
  }
  /*
   * A turn with a call the replay never says finished was cut off around it,
   * and reads back cancelled, as the reference reads a transcript's turn
   * holding a call with no result back.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514
   */
  for (const turn of turns) {
    const last = new Map<string, string>();
    for (const { update } of turn.updates) {
      if (update.sessionUpdate === 'tool_call') last.set(update.toolCallId, update.status ?? 'pending');
      else if (update.sessionUpdate === 'tool_call_update' && typeof update.status === 'string') last.set(update.toolCallId, update.status);
    }
    if ([...last.values()].some((status) => status !== 'completed' && status !== 'failed')) turn.state = 'cancelled';
  }
  /*
   * The last turn of a replay that ends while its request still ran is cut
   * off, as VS Code's reader ends a turn whose request is still active at the
   * end of its events: a call still open, or no message of the agent after its
   * last call or at all. It ends in error, and `turnsOf` lays VS Code's
   * `executionInterrupted` part after its parts. A replay says no idle, so a
   * turn whose last word is the agent's message reads as it ended.
   * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7987-L7990
   * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1128-L1130
   */
  const cut = turns.at(-1);
  if (cut !== undefined) {
    const kinds = cut.updates.map(({ update }) => update.sessionUpdate);
    const said = kinds.lastIndexOf('agent_message_chunk');
    const called = Math.max(kinds.lastIndexOf('tool_call'), kinds.lastIndexOf('tool_call_update'));
    if (cut.state === 'cancelled' || said === -1 || said < called) {
      cut.state = 'error';
      cut.interrupted = true;
    }
  }
  return turns;
}
