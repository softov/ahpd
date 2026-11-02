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
import { join } from 'node:path';
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

const ECHOED = '"the server echoes them back as an ActionEnvelope once accepted" (types/common/commands.ts, dispatchAction)';

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
  echoRewritten: {
    breaks: `${ECHOED}; the echo of chat/turnStarted carries the host's own startedAt and leaves queuedMessageId off`,
    row: 'E8',
    by: '3, the answer',
  },
  clientRewritten: {
    breaks: `${ECHOED}; the echo of session/activeClientSet carries the connection's clientId in place of the one sent`,
    row: 'C12',
    by: '3, the answer',
  },
  reorderRewritten: {
    breaks: `${ECHOED}; the echo of chat/queuedMessagesReordered carries the order the backend holds in place of the one sent`,
    row: 'E8',
    by: '3, the answer',
  },
  senderOnly: {
    breaks: 'subscriptions.md: "Session actions go to all clients subscribed to that session\'s URI." and "Chat actions go to all clients subscribed to that chat\'s URI."; an action the host\'s own records say moves nothing is echoed to its sender alone',
    row: 'E5',
    by: '4, one audience',
  },
  rootPerConnection: {
    breaks: 'authentication.md: "Root state is global and visible to all subscribed clients."; the root a connection is served carries a `_meta` and config values of its own',
    row: 'E46',
    by: '8, root state is global',
  },
  idleSteering: {
    breaks: 'chat-channel.md: "Steering messages added while idle are silently stored and consumed when a turn becomes active."',
    row: 'A10',
    by: '10',
  },
  removalUnserved: {
    breaks: 'types/channels-session/actions.ts: session/activeClientRemoved is @clientDispatchable and "a no-op when no entry matches"',
    row: 'A11',
    by: '10',
  },
  toggleNoOp: {
    breaks: 'types/channels-session/actions.ts, session/customizationToggled: "Is a no-op when no customization has the given id."',
    row: 'C2',
    by: '10',
  },
  startNoOp: {
    breaks: 'types/channels-session/actions.ts, session/mcpServerStartRequested: "Is a no-op when no matching McpServerCustomization is found."',
    row: 'C2',
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
 * malformed params; a row with nothing in common is `-32005` with the
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
        ? { code: -32602, closed: asked.closed }
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

const turnStartRewritten: (Differs & Broken)[] = [{ reduced: ['activeTurn', 'modifiedAt'], ...BROKEN.echoRewritten }];
const queuedTurnRewritten: (Differs & Broken)[] = [{ reduced: ['activeTurn', 'modifiedAt', 'queuedMessages'], ...BROKEN.echoRewritten }];
const reorderRewritten: (Differs & Broken)[] = [{ reduced: ['queuedMessages'], ...BROKEN.reorderRewritten }];
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
  '005-session-turnstarted': turnStartRewritten,
  '006-turnstarted-with-queuedmessageid-removes-from-queuedmessages': queuedTurnRewritten,
  '007-turnstarted-with-queuedmessageid-removes-last-queued-message': queuedTurnRewritten,
  '008-turnstarted-with-queuedmessageid-removes-matching-steering-message': [{ reduced: ['activeTurn', 'modifiedAt', 'steeringMessage'], ...BROKEN.echoRewritten }],
  '009-turnstarted-without-queuedmessageid-does-not-touch-pending-messages': turnStartRewritten,
  '035-session-activeclientset-adds-client': [{ reduced: ['activeClients'], ...BROKEN.clientRewritten }],
  '036-session-activeclientset-replaces-client': [{ reduced: ['activeClients'], ...BROKEN.clientRewritten }],
  '039-set-steering-message': [{ refused: ['Nothing is running in this chat to steer'], ...BROKEN.idleSteering }],
  '040-replace-existing-steering-message': [{ refused: ['Nothing is running in this chat to steer'], ...BROKEN.idleSteering }],
  '041-update-steering-message-content-via-set-with-same-id': [{ refused: ['Nothing is running in this chat to steer'], ...BROKEN.idleSteering }],
  '052-steering-and-queued-messages-are-independent': [{ refused: ['Nothing is running in this chat to steer'], ...BROKEN.idleSteering }],
  '053-reorders-queued-messages': reorderRewritten,
  '054-keeps-messages-not-in-order-at-end-in-original-order': reorderRewritten,
  '055-ignores-unknown-ids-in-reorder': reorderRewritten,
  '060-session-customizationtoggled-toggles-by-id': [{ refused: ['plugin-a has no runtime switch'], ...BROKEN.toggleNoOp }],
  '061-session-customizationtoggled-is-no-op-for-unknown-id': [{ refused: ['plugin-unknown has no runtime switch'], ...BROKEN.toggleNoOp }],
  '062-session-customizationtoggled-is-no-op-when-customizations-undefined': [{ refused: ['plugin-a has no runtime switch'], ...BROKEN.toggleNoOp }],
  '070-full-turn-flow-with-tool-calls-and-re-confirmation': turnStartRewritten,
  '071-root-terminalschanged': rootPerConnection,
  '071-session-isreadchanged-marks-session-as-read': [{ reduced: ['status'], ...BROKEN.senderOnly }],
  '074-session-isarchivedchanged-unarchives-session': [{ reduced: ['status'], ...BROKEN.senderOnly }],
  '075-turnstarted-clears-isread': turnStartRewritten,
  '087-root-unknown-action-type-is-no-op': rootPerConnection,
  '105-session-input-full-draft-and-complete-flow': turnStartRewritten,
  '127-root-configchanged-merges-into-config-values': rootMetaPerConnection,
  '128-root-configchanged-noops-when-config-undefined': rootPerConnection,
  '130-root-configchanged-replace-replaces-all-values': rootMetaPerConnection,
  '161-chat-turn-lifecycle-on-chat': turnStartRewritten,
  '221-session-activeclientremoved-removes-client': [{ refused: ['session/activeClientRemoved is not served yet'], ...BROKEN.removalUnserved }],
  '222-session-activeclientremoved-no-op-unknown-client': [{ refused: ['session/activeClientRemoved is not served yet'], ...BROKEN.removalUnserved }],
  '224-chat-draftchanged-clears-draft': [{ reduced: ['draft'], ...BROKEN.senderOnly }],
  '225-session-customizationtoggled-toggles-child-by-id': [{ refused: ['skill-1 has no runtime switch'], ...BROKEN.toggleNoOp }],
  '226-session-customizationtoggled-is-no-op-for-unknown-child-id': [{ refused: ['does-not-exist has no runtime switch'], ...BROKEN.toggleNoOp }],
  '235-session-mcpserverstartrequested-starts-top-level-server': [{ refused: ['mcp-1 would not start'], ...BROKEN.startNoOp }],
  '238-session-mcpserverstartrequested-no-op-absent-customizations': [{ refused: ['mcp-1 would not start'], ...BROKEN.startNoOp }],
  '239-session-mcpserverstartrequested-no-op-unknown-id': [{ refused: ['mcp-does-not-exist would not start'], ...BROKEN.startNoOp }],
  '244-session-workingdirectoryremoved-removes-existing': [{ reduced: ['workingDirectories'], ...BROKEN.senderOnly }],
  '250-chat-workingdirectoryremoved-removes-existing': [{ reduced: ['workingDirectories'], ...BROKEN.senderOnly }],
  '263-session-customizationtoggled-clears-enablement': [{ refused: ['server-a has no runtime switch'], ...BROKEN.toggleNoOp }],
  '267-session-workingdirectoryreplaced-replaces-and-deduplicates': [{ reduced: ['workingDirectories'], ...BROKEN.senderOnly }],
  '268-session-workingdirectoryreplaced-replaces-primary': [{ reduced: ['workingDirectories'], ...BROKEN.senderOnly }],
  '269-session-workingdirectoryreplaced-replaces-non-primary': [{ reduced: ['workingDirectories'], ...BROKEN.senderOnly }],
  '270-session-workingdirectoryreplaced-deduplicates-earlier-replacement': [{ reduced: ['workingDirectories'], ...BROKEN.senderOnly }],
  '273-chat-isarchivedchanged-unarchives-chat': [{ reduced: ['status'], ...BROKEN.senderOnly }],
  '286-chat-isreadchanged-marks-default-chat-as-read': [{ reduced: ['status'], ...BROKEN.senderOnly }],
};

const THINKING = 'types/channels-chat/actions.ts, chat/activityChanged: "Dispatched by the server to indicate what the chat is currently doing (e.g. running a tool, thinking)."';
const CONSUMED = 'chat-channel.md: "When a queued message is added while the chat is idle (no active turn), the server SHOULD immediately consume it using the same two-step sequence."';
const CUSTOMIZED = 'types/channels-session/actions.ts, session/customizationsChanged: "The session\'s customizations have changed. Full-replacement semantics: the `customizations` array replaces the previous `customizations` entirely."';
const READY = 'types/channels-session/actions.ts, session/ready: "Session backend initialized successfully."';
const RETAINED = 'types/common/commands.ts, SubscribeView.turns: "When omitted, the host MUST return all retained turns."; types/channels-chat/state.ts, turnsNextCursor: "Absence means the state contains all retained turns."';

/**
 * Where a case's answer differs because the host did what the protocol has it
 * do on its own: each with the sentence that says so.
 */
const ALLOWED: Record<string, (Differs & { because: string })[]> = {
  '005-session-turnstarted': [{ reduced: ['activity'], because: THINKING }],
  '006-turnstarted-with-queuedmessageid-removes-from-queuedmessages': [{ reduced: ['activity'], because: THINKING }],
  '007-turnstarted-with-queuedmessageid-removes-last-queued-message': [{ reduced: ['activity'], because: THINKING }],
  '008-turnstarted-with-queuedmessageid-removes-matching-steering-message': [{ reduced: ['activity'], because: THINKING }],
  '009-turnstarted-without-queuedmessageid-does-not-touch-pending-messages': [{ reduced: ['activity'], because: THINKING }],
  '045-set-a-new-queued-message': [{ reduced: ['activeTurn', 'activity', 'modifiedAt', 'queuedMessages', 'status'], because: CONSUMED }],
  '046-append-queued-message-when-id-is-new': [{ reduced: ['activeTurn', 'activity', 'modifiedAt', 'queuedMessages', 'status'], because: CONSUMED }],
  '047-update-queued-message-in-place-when-id-already-exists': [{ reduced: ['activeTurn', 'activity', 'modifiedAt', 'queuedMessages', 'status'], because: CONSUMED }],
  '052-steering-and-queued-messages-are-independent': [{ reduced: ['activeTurn', 'activity', 'modifiedAt', 'queuedMessages', 'status'], because: CONSUMED }],
  '070-full-turn-flow-with-tool-calls-and-re-confirmation': [{ reduced: ['activity'], because: THINKING }],
  '075-turnstarted-clears-isread': [{ reduced: ['activity'], because: THINKING }],
  '105-session-input-full-draft-and-complete-flow': [{ reduced: ['activity'], because: THINKING }],
  '135-session-metachanged-sets-meta': [{
    start: ['_meta'],
    because: 'types/channels-session/state.ts, SessionState._meta: "Additional provider-specific metadata for this session."; the host says its own once the session is read',
  }],
  '146-session-changesetschanged-clears-catalogue': [{
    start: ['changesets'],
    because: 'types/channels-session/state.ts, SessionState.changesets: "Catalogue of changesets the server can produce for this session."; the host says the ones its folder has once the session is read',
  }],
  '161-chat-turn-lifecycle-on-chat': [{ reduced: ['activity'], because: THINKING }],
  '232-chat-turnsloaded-prepends-older-turns': [{ start: ['turnsNextCursor'], because: RETAINED }],
  '233-chat-turnsloaded-dedupes-overlap-and-clears-cursor': [{ start: ['turnsNextCursor'], because: RETAINED }],
  '234-chat-truncated-clears-turns-next-cursor-when-clearing-all': [{ start: ['turnsNextCursor'], because: RETAINED }],
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

/**
 * Why this host refuses an action a client may send, by its type: the host's
 * words for it, and the specification row or the host policy that allows it.
 *
 * An action a client may not originate is not here: the protocol's
 * `IS_CLIENT_DISPATCHABLE` names those, and each is refused with one sentence.
 */
const REFUSALS: Record<string, { said: (action: Record<string, unknown>, where: Where) => string; source: string }[]> = {
  'chat/toolCallConfirmed': [{
    said: (action) => `${String(action.toolCallId)} is not a call this chat is waiting to have confirmed`,
    source: 'chat-channel.md: "chat/toolCallConfirmed | Tool call not in pending-confirmation state | Server MUST reject the action"',
  }],
  'chat/turnCancelled': [{
    said: (_action, where) => `Nothing is running on ${where.channel} to stop`,
    source: 'chat-channel.md: "chat/turnCancelled | No active turn | Server MUST reject the action"',
  }],
  'chat/turnResume': [{
    said: (action) => `${String(action.turnId)} is not the latest turn`,
    source: 'chat-channel.md: "chat/turnResume | An active turn exists, turnId is not the latest errored turn, or its final error part is not resumable | Server MUST reject the action"',
  }],
  'chat/inputAnswerChanged': [{
    said: (action) => `${String(action.requestId)} is not a question this chat is waiting on`,
    source: 'chat-channel.md: "chat/inputAnswerChanged | No input request with matching requestId | Server SHOULD reject the action"',
  }],
  'chat/inputCompleted': [{
    said: (action) => `${String(action.requestId)} is not a question this chat is waiting on`,
    source: 'chat-channel.md: "chat/inputCompleted | No input request with matching requestId | Server SHOULD reject the action"',
  }],
  'chat/pendingMessageRemoved': [{
    said: (action) => `${String(action.id)} is not a ${String(action.kind)} message this chat holds`,
    source: 'chat-channel.md: "chat/pendingMessageRemoved | No pending message with matching id and kind | Server SHOULD reject the action"',
  }],
  'chat/toolCallComplete': [{
    said: (action, where) => `${String(action.toolCallId)} is not a call ${where.client} is running here`,
    source: `types/channels-chat/actions.ts, chat/toolCallComplete: ${CONTRIBUTOR}`,
  }],
  'chat/toolCallContentChanged': [{
    said: (action) => `${String(action.toolCallId)} is not a call a client is running here`,
    source: `types/channels-chat/actions.ts, chat/toolCallContentChanged: ${CONTRIBUTOR}`,
  }],
  'chat/workingDirectorySet': [{
    said: (action, where) => `${localPath(String(action.directory))} is not a working directory of ${where.session}`,
    source: 'types/channels-chat/actions.ts, chat/workingDirectorySet: "`directory` MUST be one of the owning session\'s SessionState.workingDirectories; a host MUST reject a directory that is not."',
  }],
  'session/configChanged': [{
    said: (action) => `${Object.keys(action.config as object)[0] ?? ''} is not a config key this backend takes`,
    source: 'types/channels-session/actions.ts, session/configChanged: "Only properties with `sessionMutable: true` in the config schema may be changed."',
  }],
  'session/mcpServerStopRequested': [{
    said: (action) => `${String(action.id)} would not stop`,
    source: 'types/channels-session/actions.ts, session/mcpServerStopRequested: "The host remains authoritative and MAY reject the action"',
  }],
  'root/nonExistentAction': [{ said: (action) => `${String(action.type)} names nothing here`, source: MAY_NOT_ORIGINATE }],
  'session/nonExistentAction': [{ said: (action) => `${String(action.type)} is not served yet`, source: MAY_NOT_ORIGINATE }],
  'root/configChanged': [{
    said: (action) => `root config does not declare ${Object.keys(action.config as object)[0] ?? ''}`,
    source: 'host policy, host/actions.ts: a root config push writes only keys the root config schema declares',
  }],
  'session/workingDirectorySet': [{
    said: (action) => `Workspace trust was not granted for '${localPath(String(action.directory))}'`,
    source: 'host policy, host/chatactions.ts: a folder joins a session only once the window trusts it',
  }],
  'chat/truncated': [{
    said: (action, where) => `${String(action.turnId)} is not a completed turn in ${where.channel}`,
    source: 'host policy, host/chatactions.ts: a truncation names a turn this chat holds completed',
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
   * What the protocol's reducer makes of that start and the actions the host
   * did not refuse: the case's `expected` when the start is its `initial` and
   * the host refused nothing.
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
    const view = reduced(one.reducer, watching.state, watched.notes
      .filter((note) => note.method === 'action')
      .map((note) => note.params as { channel: string; action: Record<string, unknown>; serverSeq: number; rejectionReason?: string })
      .filter((envelope) => envelope.channel === channel && envelope.serverSeq > watching.fromSeq && envelope.rejectionReason === undefined)
      .map((envelope) => envelope.action));
    const accepted = sent
      .filter((_, at) => (answers[at] ?? []).every((envelope) => envelope.rejectionReason === undefined))
      .map(({ action }) => action);
    const goal = accepted.length === one.actions.length && parted(watching.state, one.initial).length === 0
      ? one.expected
      : reduced(one.reducer, watching.state, accepted);
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
      for (const [at, action] of one.actions.entries()) {
        const reason = reasons[at];
        const type = String(action.type);
        if (hostOnly(action)) expect(reason, `${one.name}: ${type} refused by the protocol's rule`).toBeDefined();
        if (reason === undefined || listed.includes(reason)) continue;
        if (hostOnly(action)) expect(reason, `${one.name}: ${type} refused by the protocol's rule`).toBe(`${type} is this host's to say, not a client's`);
        else expect((REFUSALS[type] ?? []).map((rule) => rule.said(action, where)), `${one.name}: ${type} refused for a reason a source allows`).toContain(reason);
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
