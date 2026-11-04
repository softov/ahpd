/*
 * The protocol's own conformance cases, run against this host.
 *
 * `packages/sdk/test/fixtures/ahp-test-cases` is a copy of the protocol
 * repository's `types/test-cases`, taken from tag `v1.0.0`. `SOURCE.md` beside
 * the cases names the commit, and `tools/ahp-test-cases.mjs` takes a fresh
 * copy from a checkout. What these cases check is therefore not what this
 * suite believes the protocol says. It is what the protocol says.
 *
 * Every comparison here reads a value the one way the protocol's conformance
 * tests read it, `canonical` below.
 *
 * The reducer cases go through the installed package's reducers, as the
 * protocol's own harness runs them, so they check the package this host is
 * built on.
 *
 * The round-trip cases go through what JSON does to a payload, which is all a
 * TypeScript peer does to one before its own code reads it.
 *
 * The negotiation rows and the root, session and chat cases go through this
 * host. Each place it answers otherwise than the protocol is named in
 * `DIVERGES` or `NEGOTIATION_DIVERGES`, with the rule it breaks, so a host that
 * stops breaking one fails the test until its entry goes.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotationsReducer, automationReducer, automationRunReducer, canvasReducer, changesetReducer, chatReducer,
  IS_CLIENT_DISPATCHABLE, resourceWatchReducer, rootReducer, sessionReducer, SUPPORTED_PROTOCOL_VERSIONS,
  terminalReducer,
} from '@microsoft/agent-host-protocol';
import { localPath } from '../src/resources/fileuri.js';
import type { Peer } from '../src/types/rpc.js';

const sdk = vi.hoisted(() => ({ queries: [] as { frames: Record<string, unknown>[]; wake: (() => void) | undefined; closed: boolean }[] }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: async () => [],
  getSessionMessages: async () => [],
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false };
    sdk.queries.push(fake);
    void (async () => { for await (const _ of prompt) { /* drained */ } })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.frames.length > 0) yield fake.frames.shift() as Record<string, unknown>;
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');
const { chatUriFor } = await import('../src/host/channels.js');
const { claude } = await import('../../agent-claude/src/claude.js');

function peer(): Peer & { notes: { method: string; params: unknown }[]; closed: boolean } {
  const notes: { method: string; params: unknown }[] = [];
  const told = {
    notes,
    closed: false,
    send: () => {},
    notify: (method: string, params: unknown) => { notes.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => { told.closed = true; },
  };
  return told;
}

const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Until a round of ticks tells a peer nothing new, so what it hears next is what was asked of the host. */
const quiet = async (p: { notes: unknown[] }): Promise<void> => {
  let heard = -1;
  for (let round = 0; round < 50 && p.notes.length !== heard; round++) {
    heard = p.notes.length;
    await settle();
  }
};

beforeEach(() => { sdk.queries.length = 0; });

/** A host, with nothing asked of it yet, and the one channel that opens with a state given it. */
const aHost = (seeded?: { channel: string; initial: Record<string, unknown> }) => createHost({
  path: '/home/softov',
  agents: [claude({ paths: ['/home/softov'] })],
  ...(seeded === undefined ? {} : {
    opening: (opened: string) => (opened === seeded.channel ? structuredClone(seeded.initial) : undefined),
  }),
});

const CASES = join(import.meta.dirname, 'fixtures/ahp-test-cases');
const filesIn = (where: string): string[] => readdirSync(join(CASES, where)).filter((one) => one.endsWith('.json')).sort();
const read = <T>(where: string, file: string): T => JSON.parse(readFileSync(join(CASES, where, file), 'utf8')) as T;

/**
 * A value as the protocol's conformance tests compare it: as JSON carries it,
 * with an object member holding `null` dropped and a slot in a list kept.
 *
 * The protocol's .NET tests give the reason, in `JsonCanon`: "null-valued
 * object members dropped (so an omitted optional field equals an explicit null
 * - matching the Go/TS conformance harnesses)".
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/JsonCanon.cs#L10-L13
 */
const canonical = (value: unknown): unknown => (value === undefined
  ? undefined
  : JSON.parse(JSON.stringify(value), function (this: unknown, _key: string, held: unknown) {
    return held === null && !Array.isArray(this) ? undefined : held;
  }) as unknown);

/*
 * The reducer cases.
 */

interface ReducerCase {
  description: string;
  reducer: string;
  initial: Record<string, unknown>;
  actions: Record<string, unknown>[];
  expected: Record<string, unknown>;
}

/** The protocol's own reducer for each channel a case names. */
const REDUCERS: Record<string, (state: never, action: never) => unknown> = {
  root: rootReducer,
  session: sessionReducer,
  chat: chatReducer,
  canvas: canvasReducer,
  terminal: terminalReducer,
  changeset: changesetReducer,
  annotations: annotationsReducer,
  resourceWatch: resourceWatchReducer,
  automation: automationReducer,
  automationRun: automationRunReducer,
};

/** Actions applied to a state through one channel's reducer, in order. */
const reduced = (reducer: string, state: Record<string, unknown>, actions: Record<string, unknown>[]): Record<string, unknown> =>
  actions.reduce((held, action) => REDUCERS[reducer]?.(held as never, action as never), state as unknown) as Record<string, unknown>;

/*
 * The protocol's harness runs each case the same way: its actions through the
 * reducer from its initial state, the result held to its expected state.
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145
 */
describe('the protocol’s reducer cases', () => {
  for (const file of filesIn('reducers')) {
    const one = read<ReducerCase>('reducers', file);
    it(file.replace(/\.json$/u, ''), () => {
      expect(REDUCERS[one.reducer], `${file} names a channel this suite has no reducer for`).toBeDefined();
      expect(canonical(reduced(one.reducer, one.initial, one.actions))).toEqual(canonical(one.expected));
    });
  }
});

/*
 * The round-trip cases.
 */

interface RoundTripCase {
  name: string;
  group?: string;
  description: string;
  type: string;
  input: unknown;
  acceptableOutputs: unknown[];
  preservedOutput?: unknown;
}

describe('the protocol’s round-trip cases', () => {
  for (const file of filesIn('round-trips')) {
    const one = read<RoundTripCase>('round-trips', file);
    it(one.name, () => {
      /*
       * What a TypeScript peer does with a payload: `JSON.parse` into a value,
       * `JSON.stringify` back out. Nothing is dropped and nothing is added,
       * which is why a group B case asserts the preserved form and a group A
       * case asserts the canonical one. Compared the way
       * `KNOWN-FIDELITY-GAPS.md` says: key order does not matter, presence does.
       */
      const back = JSON.parse(JSON.stringify(one.input)) as unknown;
      expect(one.acceptableOutputs.length, `${file} must carry exactly one acceptable form`).toBe(1);
      expect(back).toEqual(one.group === 'B' ? one.preservedOutput : one.acceptableOutputs[0]);
    });
  }
});

/*
 * Version negotiation, through the host.
 */

interface NegotiationRow {
  offered: string[];
  expected?: string | null;
  invalid?: boolean;
}

/** What a host answered `initialize` with, in the terms a row speaks. */
type Answered =
  | { protocolVersion: string }
  | { code: number; supportedVersions?: unknown; closed: boolean };

/**
 * A rule this host breaks: the protocol's words, the audit row that names the
 * assumption behind it, and the correction that takes it out.
 */
interface Broken {
  breaks: string;
  row: string;
  by: string;
}

/** The rules the divergences in this file break. */
const BROKEN = {
  baselines: {
    breaks: 'versioning.md: hosts accept ">=1.0.0 <2.0.0 or >=0.9.0 <0.10.0, regardless of offer order"; this host also agrees on 0.10.0',
    row: 'E14',
    by: '12',
  },
  refusalLeftOpen: {
    breaks: 'versioning.md: "A missing result means the host must send UnsupportedProtocolVersion with its supported baselines and close the connection."',
    row: 'E18',
    by: '10',
  },
  rootPerConnection: {
    breaks: 'authentication.md: "Root state is global and visible to all subscribed clients."; the root a connection is served carries a `_meta` and config values of its own',
    row: 'E46',
    by: '8, root state is global',
  },
  idleSteering: {
    breaks: 'chat-channel.md: "Steering messages added while idle are silently stored and consumed when a turn becomes active."; this host runs one as a turn of its own under its id',
    row: 'A10',
    by: 'none, VS Code\'s host: "Steering that arrived too late to steer a turn runs next, ahead of queued messages." (queueDrainContribution.ts L266-L267 at 6b68d3fe)',
  },
  idleQueue: {
    breaks: 'chat-channel.md: "When a queued message is added while the chat is idle (no active turn), the server SHOULD immediately consume it using the same two-step sequence."; this host starts the head of an idle chat\'s queue on any change to its pending messages, with the turn that names it alone',
    row: 'H1-0025',
    by: 'none, VS Code\'s host drains an idle chat\'s queue on every change to its pending messages and starts the head (queueDrainContribution.ts L71-L90 and L245-L326 at 6b68d3fe)',
  },
  removalUnserved: {
    breaks: 'types/channels-session/actions.ts: session/activeClientRemoved is @clientDispatchable and "a no-op when no entry matches"',
    row: 'A11',
    by: '10',
  },
} satisfies Record<string, Broken>;

/** The rows this host answers otherwise than the protocol, and what it answers. */
const NEGOTIATION_DIVERGES: Record<number, Broken & { answered: Answered }> = {
  1: { answered: { code: -32005, supportedVersions: ['1.0.0', '0.10.0', '0.9.0'], closed: false }, ...BROKEN.refusalLeftOpen },
  9: { answered: { protocolVersion: '0.10.0' }, ...BROKEN.baselines },
  10: { answered: { protocolVersion: '0.10.0' }, ...BROKEN.baselines },
};

/*
 * A row with a version in common is answered with it; an invalid offer is
 * malformed params, and the connection stays open, as the protocol's own
 * interop host answers one; a row with nothing in common is `-32005` with the
 * protocol's baselines in `supportedVersions`, and the connection closed.
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/versioning.md#L52-L68
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/clients/dotnet/tests/AgentHostProtocol.Tests/interop/session-host.ts#L85-L101
 */
describe('the protocol’s version negotiation cases, through ahpd', () => {
  for (const [at, row] of read<NegotiationRow[]>('', 'version-negotiation.json').entries()) {
    const offered = row.offered.length === 0 ? 'nothing' : row.offered.join(' ');
    it(`${at + 1}. ${offered}`, async () => {
      const asked = peer();
      const client = aHost().accept(asked);
      const answered: Answered = await (client.handle({
        method: 'initialize',
        params: { channel: 'ahp-root://', clientId: 'negotiation', protocolVersions: row.offered },
      }) as Promise<{ protocolVersion: string }>).then(
        (result) => ({ protocolVersion: result.protocolVersion }),
        (error: { code: number; data?: { supportedVersions?: unknown } }) => ({
          code: error.code,
          ...(error.data?.supportedVersions === undefined ? {} : { supportedVersions: error.data.supportedVersions }),
          closed: asked.closed,
        }),
      );
      const owed: Answered = row.invalid === true
        ? { code: -32602, closed: false }
        : row.expected === null || row.expected === undefined
          ? { code: -32005, supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS], closed: true }
          : { protocolVersion: row.expected };
      const departs = NEGOTIATION_DIVERGES[at + 1];
      if (departs !== undefined) {
        expect(answered, `row ${at + 1}: ${departs.breaks}`).toEqual(departs.answered);
        expect(answered, `row ${at + 1}: listed, so it departs`).not.toEqual(owed);
        return;
      }
      expect(answered).toEqual(owed);
    });
  }
});

/*
 * The root, session and chat cases, through ahpd's host.
 */

interface HostCase extends ReducerCase {
  name: string;
}

/** The keys a case's answer differs on, by check, or the host's words for a refusal. */
interface Differs {
  /** Keys where the state a client watching from the start is served differs from the case's `initial`. */
  start?: string[];
  /** Keys where a client that only watched holds other than the protocol's reducer makes of what the host accepted. */
  reduced?: string[];
  /** Keys where a client that subscribes afterwards is served other than what that watching client holds. */
  served?: string[];
  /** The host's words for a refusal of an action a client may send. */
  refused?: string[];
}

const rootPerConnection: (Differs & Broken)[] = [{ start: ['_meta', 'config'], ...BROKEN.rootPerConnection }];
const rootMetaPerConnection: (Differs & Broken)[] = [{ start: ['_meta'], ...BROKEN.rootPerConnection }];

/**
 * Where this host answers a case otherwise than the protocol.
 *
 * Each entry names the keys or the refusal, the rule it breaks, the audit row
 * that names the assumption behind it, and the correction that takes it out. A
 * host that stops answering this way fails its case until the entry goes.
 */
const DIVERGES: Record<string, (Differs & Broken)[]> = {
  '001-root-agentschanged': rootPerConnection,
  '002-root-activesessionschanged': rootPerConnection,
  '039-set-steering-message': [{ reduced: ['activeTurn', 'modifiedAt', 'status', 'steeringMessage'], ...BROKEN.idleSteering }],
  '040-replace-existing-steering-message': [{ reduced: ['activeTurn', 'modifiedAt', 'status', 'steeringMessage'], ...BROKEN.idleSteering }],
  '041-update-steering-message-content-via-set-with-same-id': [{ reduced: ['activeTurn', 'modifiedAt', 'status', 'steeringMessage'], ...BROKEN.idleSteering }],
  '043-remove-steering-message-is-no-op-for-mismatched-id': [{ reduced: ['activeTurn', 'modifiedAt', 'status', 'steeringMessage'], ...BROKEN.idleSteering }],
  '046-append-queued-message-when-id-is-new': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages'], ...BROKEN.idleQueue }],
  '048-remove-a-queued-message': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'status'], ...BROKEN.idleQueue }],
  '050-remove-queued-message-is-no-op-for-unknown-id': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'status'], ...BROKEN.idleQueue }],
  '052-steering-and-queued-messages-are-independent': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'steeringMessage'], ...BROKEN.idleSteering }],
  '053-reorders-queued-messages': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'status'], ...BROKEN.idleQueue }],
  '054-keeps-messages-not-in-order-at-end-in-original-order': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'status'], ...BROKEN.idleQueue }],
  '055-ignores-unknown-ids-in-reorder': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'status'], ...BROKEN.idleQueue }],
  '056-empty-reorder-preserves-all-messages-in-original-order': [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages', 'status'], ...BROKEN.idleQueue }],
  '071-root-terminalschanged': rootPerConnection,
  '087-root-unknown-action-type-is-no-op': rootPerConnection,
  '127-root-configchanged-merges-into-config-values': rootMetaPerConnection,
  '128-root-configchanged-noops-when-config-undefined': rootPerConnection,
  '130-root-configchanged-replace-replaces-all-values': rootMetaPerConnection,
  '221-session-activeclientremoved-removes-client': [{ refused: ['session/activeClientRemoved is not served yet'], ...BROKEN.removalUnserved }],
  '222-session-activeclientremoved-no-op-unknown-client': [{ refused: ['session/activeClientRemoved is not served yet'], ...BROKEN.removalUnserved }],
};

const CUSTOMIZED = 'types/channels-session/actions.ts, session/customizationsChanged: "The session\'s customizations have changed. Full-replacement semantics: the `customizations` array replaces the previous `customizations` entirely."';
const READY = 'types/channels-session/actions.ts, session/ready: "Session backend initialized successfully."';
const RETAINED = 'types/common/commands.ts, SubscribeView.turns: "When omitted, the host MUST return all retained turns."; types/channels-chat/state.ts, turnsNextCursor: "Absence means the state contains all retained turns."';
const RERUN = 'types/channels-chat/actions.ts, chat/turnResume: "The host then resumes the provider\'s execution for that turn."; the backend here holds no such turn, and the host ends it again in an error that can be resumed, as VS Code\'s host ends a resume its agent rejects';

/**
 * Where a case's answer differs because the host did what the protocol has it
 * do on its own: each with the sentence that says so.
 */
const ALLOWED: Record<string, (Differs & { because: string })[]> = {
  '135-session-metachanged-sets-meta': [{
    start: ['_meta'],
    because: 'types/channels-session/state.ts, SessionState._meta: "Additional provider-specific metadata for this session."; the host says its own once the session is read',
  }],
  '146-session-changesetschanged-clears-catalogue': [{
    start: ['changesets'],
    because: 'types/channels-session/state.ts, SessionState.changesets: "Catalogue of changesets the server can produce for this session."; the host says the ones its folder has once the session is read',
  }],
  '232-chat-turnsloaded-prepends-older-turns': [{ start: ['turnsNextCursor'], because: RETAINED }],
  '233-chat-turnsloaded-dedupes-overlap-and-clears-cursor': [{ start: ['turnsNextCursor'], because: RETAINED }],
  '234-chat-truncated-clears-turns-next-cursor-when-clearing-all': [{ start: ['turnsNextCursor'], because: RETAINED }],
  '263-chat-turn-resume-reopens-turn': [{ reduced: ['activeTurn', 'status', 'turns'], because: RERUN }],
  '269-chat-turn-resume-completes-one-turn': [{ reduced: ['activeTurn', 'status', 'turns'], because: RERUN }],
};

/**
 * What a session the driver creates says as it comes up, after its state
 * opened with the case's `initial` and before the case's first action: the
 * customizations its backend offers, in place of the case's, and
 * `session/ready` for a session that starts `creating`.
 */
const cameUp = (one: HostCase): (Differs & { because: string })[] => (one.reducer !== 'session' ? [] : [
  { start: ['customizations'], because: CUSTOMIZED },
  ...(one.initial.lifecycle === 'ready' ? [] : [{ start: ['lifecycle'], because: READY }]),
]);

/** Where a refusal happened, in the terms the host's words use. */
interface Where {
  client: string;
  channel: string;
  session: string;
}

const MAY_NOT_ORIGINATE = 'types/common/reducer-helpers.ts, isClientDispatchable: servers "reject any action the client is not allowed to originate"';
const CONTRIBUTOR = 'the server SHOULD reject this action if the dispatching client does not match the contributor\'s `clientId`';
const RESUMED = 'chat-channel.md: "chat/turnResume | An active turn exists, turnId is not the latest errored turn, or its final error part is not resumable | Server MUST reject the action"';

/** The parts of a chat state's running turn, or none. */
const runningParts = (state: Record<string, unknown>): Record<string, unknown>[] =>
  ((state.activeTurn as { responseParts?: Record<string, unknown>[] } | undefined)?.responseParts ?? []);

/** Whether a chat state's latest turn is the one named, errored, with a resumable error as its last part. */
const resumable = (state: Record<string, unknown>, turnId: unknown): boolean => {
  const last = ((state.turns ?? []) as Record<string, unknown>[]).at(-1);
  const part = ((last?.responseParts ?? []) as Record<string, unknown>[]).at(-1);
  return last !== undefined && last.id === turnId && last.state === 'error' && part?.kind === 'error' && part.resumable === true;
};

/** The client a call of a chat state's running turn names as its contributor, when one does. */
const clientOf = (state: Record<string, unknown>, toolCallId: unknown): unknown => runningParts(state)
  .map((part) => (part.kind === 'toolCall' ? part.toolCall as { toolCallId?: unknown; contributor?: { kind?: unknown; clientId?: unknown } } : undefined))
  .find((call) => call !== undefined && call.toolCallId === toolCallId && call.contributor?.kind === 'client')?.contributor?.clientId;

/** Whether a chat state's running turn has an input request by this id with no response. */
const waitingOn = (state: Record<string, unknown>, requestId: unknown): boolean => runningParts(state)
  .some((part) => part.kind === 'inputRequest' && part.response === undefined
    && (part.request as { id?: unknown } | undefined)?.id === requestId);

/**
 * Why this host refuses an action a client may send, by its type: the host's
 * words for it, and the specification row or the host policy that allows it.
 *
 * A row the protocol states over the chat's state says so in `holds`, read
 * against the state the client held when it sent the action: the state it
 * was served, and every action before it the host accepted. So a refusal is
 * held to its condition and not to its words alone, and a host that read the
 * condition off anything but that state is caught where the two disagree.
 *
 * An action a client may not originate is not here: the protocol's
 * `IS_CLIENT_DISPATCHABLE` names those, and each is refused with one sentence.
 */
const REFUSALS: Record<string, {
  said: (action: Record<string, unknown>, where: Where) => string;
  source: string;
  holds?: (state: Record<string, unknown>, action: Record<string, unknown>, where: Where) => boolean;
}[]> = {
  'chat/toolCallConfirmed': [{
    said: (action) => `${String(action.toolCallId)} is not a call this chat is waiting to have confirmed`,
    source: 'chat-channel.md: "chat/toolCallConfirmed | Tool call not in pending-confirmation state | Server MUST reject the action"',
    holds: (state, action) => !runningParts(state).some((part) => part.kind === 'toolCall'
      && (part.toolCall as { toolCallId?: unknown; status?: unknown }).toolCallId === action.toolCallId
      && (part.toolCall as { status?: unknown }).status === 'pending-confirmation'),
  }],
  'chat/turnResume': [{
    said: () => 'A turn is running in this chat',
    source: RESUMED,
    holds: (state) => state.activeTurn !== undefined && state.activeTurn !== null,
  }, {
    said: (action) => `${String(action.turnId)} is not the latest turn`,
    source: RESUMED,
    holds: (state, action) => ((state.turns ?? []) as Record<string, unknown>[]).at(-1)?.id !== action.turnId,
  }, {
    said: (action) => `${String(action.turnId)} did not end with an error that can be resumed`,
    source: RESUMED,
    holds: (state, action) => !resumable(state, action.turnId),
  }],
  'chat/inputAnswerChanged': [{
    said: (action) => `${String(action.requestId)} is not a question this chat is waiting on`,
    source: 'chat-channel.md: "chat/inputAnswerChanged | No input request with matching requestId | Server SHOULD reject the action"',
    holds: (state, action) => !waitingOn(state, action.requestId),
  }],
  'chat/inputCompleted': [{
    said: (action) => `${String(action.requestId)} is not a question this chat is waiting on`,
    source: 'chat-channel.md: "chat/inputCompleted | No input request with matching requestId | Server SHOULD reject the action"',
    holds: (state, action) => !waitingOn(state, action.requestId),
  }],
  'chat/pendingMessageRemoved': [{
    said: () => 'Cannot change a steering message while it is being processed.',
    source: 'VS Code agentService.ts L13530-L13537 at 6b68d3fe: "Steering handed to the provider cannot be edited, and can be removed only if the provider can withdraw it."',
    holds: (state, action) => state.activeTurn !== undefined && state.activeTurn !== null
      && (state.steeringMessage as { id?: unknown } | undefined)?.id === action.id,
  }],
  'chat/toolCallComplete': [{
    said: (action, where) => `${String(action.toolCallId)} is not a call ${where.client} is running here`,
    source: `types/channels-chat/actions.ts, chat/toolCallComplete: ${CONTRIBUTOR}`,
    holds: (state, action, where) => clientOf(state, action.toolCallId) !== where.client,
  }],
  'chat/toolCallContentChanged': [{
    said: (action) => `${String(action.toolCallId)} is not a call a client is running here`,
    source: `types/channels-chat/actions.ts, chat/toolCallContentChanged: ${CONTRIBUTOR}`,
    holds: (state, action) => clientOf(state, action.toolCallId) === undefined,
  }],
  'chat/workingDirectorySet': [{
    said: (action, where) => `${localPath(String(action.directory))} is not a working directory of ${where.session}`,
    source: 'types/channels-chat/actions.ts, chat/workingDirectorySet: "`directory` MUST be one of the owning session\'s SessionState.workingDirectories; a host MUST reject a directory that is not."',
  }],
  'session/configChanged': [{
    said: (action) => `${Object.keys(action.config as object)[0] ?? ''} is not a config key this backend takes`,
    source: 'types/channels-session/actions.ts, session/configChanged: "Only properties with `sessionMutable: true` in the config schema may be changed."',
  }],
  'root/nonExistentAction': [{ said: (action) => `${String(action.type)} names nothing here`, source: MAY_NOT_ORIGINATE }],
  'session/nonExistentAction': [{ said: (action) => `${String(action.type)} is not served yet`, source: MAY_NOT_ORIGINATE }],
  'root/configChanged': [{
    said: (action) => `root config does not declare ${Object.keys(action.config as object)[0] ?? ''}`,
    source: 'host policy, host/actions.ts: a root config push writes only keys the root config schema declares',
  }],
  'session/workingDirectorySet': [{
    // The folder as it resolves, which on Windows is on the daemon's drive.
    said: (action) => `Workspace trust was not granted for '${resolve(localPath(String(action.directory)))}'`,
    source: 'host policy, host/chatactions.ts: a folder joins a session only once the window trusts it',
  }],
  'chat/truncated': [{
    said: (action, where) => `${String(action.turnId)} is not a completed turn in ${where.channel}`,
    source: 'host policy, host/chatactions.ts: a truncation names a turn this chat holds completed',
    holds: (state, action) => !((state.turns ?? []) as { id?: unknown }[]).some((one) => one.id === action.turnId),
  }],
  'chat/toolCallResultConfirmed': [{
    said: () => 'No tool call here asks for its result to be confirmed',
    source: 'host policy, host/chatactions.ts: no call on this host asks for its result to be confirmed',
  }],
};

/** The snapshot the host serves for one channel: its state, and the sequence it was taken at. */
const stateOf = async (client: { handle(r: { method: string; params: unknown }): unknown }, channel: string): Promise<{ state: Record<string, unknown>; fromSeq: number }> => {
  const opened = await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Record<string, unknown>; fromSeq: number } };
  return opened.snapshot;
};

/** Every key either state holds where the two differ, compared the protocol's way. */
const parted = (a: Record<string, unknown>, b: Record<string, unknown>): string[] => {
  const left = canonical(a) as Record<string, unknown>;
  const right = canonical(b) as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .filter((key) => !isDeepStrictEqual(left[key], right[key]));
};

interface Driven {
  /** For each of the case's actions, the envelopes that carried its origin back to the client that sent it. */
  answers: { rejectionReason?: string }[][];
  /** What the watching client was served before the case's actions: the case's `initial`, and what the host said on the channel since it opened. */
  start: Record<string, unknown>;
  /** What a client that only watched holds: its snapshot, and every action it was told of since. */
  view: Record<string, unknown>;
  /**
   * What the protocol's reducer makes of that start, the actions the host did
   * not refuse, and the actions the protocol has the host say for them on its
   * own: the case's `expected` when the start is its `initial`, the host
   * refused nothing and the protocol has it say nothing.
   */
  reduced: Record<string, unknown>;
  /** The state a client that subscribes after the actions is served. */
  served: Record<string, unknown>;
}

/** The cases whose chat is a peer chat of the session, beside its default one: their `initial` titles it "Peer Chat". */
const PEER_CHATS = new Set(['272-chat-isarchivedchanged-archives-chat', '273-chat-isarchivedchanged-unarchives-chat']);

/**
 * One case, driven through a host of its own.
 *
 * The case's channel opens with the case's `initial`: the root, the session
 * the driver creates, its default chat, or the peer chat a case names, created
 * beside it. The host is left to go quiet. A second client subscribes and only
 * watches. The first client sends the case's actions on that channel, and a
 * third client subscribes afterwards.
 *
 * The state the watching client is served is held to `initial`, each key the
 * host said otherwise before the case's first action named. What that client
 * holds afterwards is held to what the protocol's reducer makes of the state
 * it was served and the actions the host accepted: the case's `expected`
 * where it was served `initial` and the host refused nothing, which is the
 * reducer cases' own rule run through this host.
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/reducers.test.ts#L116-L145
 *
 * The clock stands still within each of those steps and moves a minute between
 * them, so a time the host stamps while it applies the actions differs from one
 * it stamps while it serves the later client, the same way on every run.
 */
async function driven(one: HostCase): Promise<Driven & { channel: string; session: string }> {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const uri = `ahp-session:/${one.name}`;
    const peerChat = PEER_CHATS.has(one.name) ? String(one.initial.resource) : undefined;
    const channel = one.reducer === 'root' ? 'ahp-root://' : one.reducer === 'session' ? uri : peerChat ?? chatUriFor(uri);
    const host = aHost({ channel, initial: one.initial });
    const asked = peer();
    const client = host.accept(asked);
    await client.handle({
      method: 'initialize',
      params: { channel: 'ahp-root://', clientId: `cases-${one.name}`, protocolVersions: ['0.9.0'] },
    });
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    if (peerChat !== undefined) await client.handle({ method: 'createChat', params: { channel: uri, chat: peerChat } });
    await stateOf(client, channel);
    await quiet(asked);
    const watched = peer();
    const watcher = host.accept(watched);
    await watcher.handle({
      method: 'initialize',
      params: { channel: 'ahp-root://', clientId: `cases-watch-${one.name}`, protocolVersions: ['0.9.0'] },
    });
    const watching = await stateOf(watcher, channel);
    vi.setSystemTime(new Date('2026-01-01T00:01:00.000Z'));
    // Numbered as a client numbers what it sends, so each answer names its action.
    const sent = one.actions.map((action, at) => ({ action, clientSeq: at + 1 }));
    for (const { action, clientSeq } of sent) {
      await client.handle({ method: 'dispatchAction', params: { channel, clientSeq, action } });
      await settle();
    }
    await quiet(asked);
    vi.setSystemTime(new Date('2026-01-01T00:02:00.000Z'));
    const reader = host.accept(peer());
    await reader.handle({
      method: 'initialize',
      params: { channel: 'ahp-root://', clientId: `cases-read-${one.name}`, protocolVersions: ['0.9.0'] },
    });
    const served = await stateOf(reader, channel);
    const answers = sent.map(({ clientSeq }) => asked.notes
      .filter((note) => note.method === 'action')
      .map((note) => note.params as { origin?: { clientId?: string; clientSeq?: number }; rejectionReason?: string })
      .filter((envelope) => envelope.origin?.clientId === `cases-${one.name}` && envelope.origin.clientSeq === clientSeq));
    // A refused envelope reaches only its sender, and a client applies none.
    const told = watched.notes
      .filter((note) => note.method === 'action')
      .map((note) => note.params as { channel: string; action: Record<string, unknown>; serverSeq: number; rejectionReason?: string })
      .filter((envelope) => envelope.channel === channel && envelope.serverSeq > watching.fromSeq && envelope.rejectionReason === undefined)
      .map((envelope) => envelope.action);
    const view = reduced(one.reducer, watching.state, told);
    const accepted = sent
      .filter((_, at) => (answers[at] ?? []).every((envelope) => envelope.rejectionReason === undefined))
      .map(({ action }) => action);
    /*
     * A queued message a chat takes while it is idle is taken up at once, in
     * the two actions the protocol has the host say: the message taken out,
     * and the turn that takes it up naming it. The turn's id and its start are
     * the host's own, read off the turn it said naming the message.
     * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L365-L372
     */
    const due: Record<string, unknown>[] = [];
    let held = watching.state;
    for (const action of accepted) {
      const taken = [action];
      held = reduced(one.reducer, held, [action]);
      if (one.reducer === 'chat' && action.type === 'chat/pendingMessageSet' && (action.kind ?? 'queued') === 'queued' && held.activeTurn === undefined) {
        const turn = told.find((said) => said.type === 'chat/turnStarted' && said.queuedMessageId === action.id);
        const consumed = [
          { type: 'chat/pendingMessageRemoved', kind: 'queued', id: action.id },
          { type: 'chat/turnStarted', turnId: turn?.turnId, startedAt: turn?.startedAt, message: action.message, queuedMessageId: action.id },
        ];
        held = reduced(one.reducer, held, consumed);
        taken.push(...consumed);
      }
      due.push(...taken);
    }
    const goal = accepted.length === one.actions.length && due.length === accepted.length && parted(watching.state, one.initial).length === 0
      ? one.expected
      : reduced(one.reducer, watching.state, due);
    return { answers, start: watching.state, view, reduced: goal, served: served.state, channel, session: uri };
  }
  finally {
    vi.useRealTimers();
  }
}

/** Whether the protocol says a client may not originate an action. */
const hostOnly = (action: Record<string, unknown>): boolean =>
  (IS_CLIENT_DISPATCHABLE as Record<string, boolean | undefined>)[String(action.type)] === false;

const hostCases: HostCase[] = ['root', 'session', 'chat'].flatMap((reducer) =>
  filesIn('reducers')
    .map((file) => ({ ...read<ReducerCase>('reducers', file), name: file.replace(/\.json$/u, '') }))
    .filter((one) => one.reducer === reducer));

describe('the protocol’s root, session and chat cases, through ahpd', () => {
  for (const one of hostCases) {
    it(one.name, async () => {
      const outcome = await driven(one);
      const departs = DIVERGES[one.name] ?? [];
      const keys = (check: 'start' | 'reduced' | 'served'): string[] => [...departs, ...(ALLOWED[one.name] ?? []), ...cameUp(one)]
        .flatMap((entry) => entry[check] ?? []).sort();
      expect(outcome.answers.map((list) => list.length), `${one.name}: each action answered once, echoed or refused`)
        .toEqual(one.actions.map(() => 1));
      /*
       * Every refusal with its reason. One of an action a client may not
       * originate is the protocol's own rule, read off its map: servers
       * "reject any action the client is not allowed to originate".
       * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/common/reducer-helpers.ts#L41-L46
       */
      const reasons = outcome.answers.map((list) => list[0]?.rejectionReason);
      const listed = departs.flatMap((entry) => entry.refused ?? []);
      const where: Where = { client: `cases-${one.name}`, channel: outcome.channel, session: outcome.session };
      // What the client held as it sent each action: its start, and every
      // action before it the host accepted.
      let held = outcome.start;
      for (const [at, action] of one.actions.entries()) {
        const reason = reasons[at];
        const type = String(action.type);
        if (hostOnly(action)) expect(reason, `${one.name}: ${type} refused by the protocol's rule`).toBeDefined();
        if (reason === undefined) {
          held = reduced(one.reducer, held, [action]);
          continue;
        }
        if (listed.includes(reason)) continue;
        if (hostOnly(action)) {
          expect(reason, `${one.name}: ${type} refused by the protocol's rule`).toBe(`${type} is this host's to say, not a client's`);
          continue;
        }
        const rule = (REFUSALS[type] ?? []).find((one) => one.said(action, where) === reason);
        expect(rule?.said(action, where), `${one.name}: ${type} refused for a reason a source allows`).toBe(reason);
        if (rule?.holds !== undefined) {
          expect(rule.holds(held, action, where), `${one.name}: ${type} refused as "${reason}" against a state that says otherwise`).toBe(true);
        }
      }
      expect(listed.filter((reason) => !reasons.includes(reason)), `${one.name}: every refusal named a divergence still happens`).toEqual([]);
      expect(parted(outcome.start, one.initial), `${one.name}: where a client watching from the start starts`).toEqual(keys('start'));
      expect(parted(outcome.view, outcome.reduced), `${one.name}: what a client that only watched holds`).toEqual(keys('reduced'));
      expect(parted(outcome.served, outcome.view), `${one.name}: what a client subscribing afterwards is served`).toEqual(keys('served'));
    });
  }

  it('lists only cases it drives, and names a source for every difference and refusal', () => {
    const names = new Set(hostCases.map((one) => one.name));
    for (const [name, entries] of [...Object.entries(DIVERGES), ...Object.entries(ALLOWED)]) {
      expect(names, `${name} is a case`).toContain(name);
      for (const entry of entries) expect([entry.start, entry.reduced, entry.served, entry.refused].some((one) => one !== undefined), `${name} names what differs`).toBe(true);
    }
    for (const entries of Object.values(DIVERGES)) {
      for (const entry of entries) expect(entry.breaks !== '' && entry.row !== '' && entry.by !== '', 'a divergence names its rule, its row and its correction').toBe(true);
    }
    for (const entries of Object.values(ALLOWED)) {
      for (const entry of entries) expect(entry.because, 'an allowed difference quotes the sentence that allows it').toContain('"');
    }
    for (const rules of Object.values(REFUSALS)) {
      for (const rule of rules) expect(rule.source, 'a refusal names its source').not.toBe('');
    }
  });
});

/*
 * The copy itself.
 */

describe('the copy of the cases', () => {
  it('was taken from the version of the protocol this repository installs', () => {
    const source = readFileSync(join(CASES, 'SOURCE.md'), 'utf8');
    const installed = JSON.parse(readFileSync(
      join(import.meta.dirname, '../../../node_modules/@microsoft/agent-host-protocol/package.json'),
      'utf8',
    )) as { version: string };
    expect(source).toContain(`- Tag: \`v${installed.version}\``);
    expect(source).toMatch(/^- Commit: `[0-9a-f]{40}`$/mu);
  });
});
