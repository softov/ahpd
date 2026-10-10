/*
 * The protocol's own conformance cases, run against this host.
 *
 * `packages/sdk/test/fixtures/ahp-test-cases` is a copy of the protocol
 * repository's `types/test-cases`, taken from tag `v1.0.0`. `SOURCE.md` beside
 * the cases names the commit, and `tools/ahp-test-cases.mjs` takes a fresh
 * copy from a checkout. What these cases check is therefore not what this
 * suite believes the protocol says. It is what the protocol says.
 *
 * They are used three ways.
 *
 * The reducer cases go through the same reducers this host applies, one case
 * per test, with a key holding `null` read as a key that is absent - the rule
 * the reference's own harness uses, and the rule a state this host serves is
 * written to.
 *
 * The round-trip cases go through the JSON round trip a TypeScript host
 * performs, because a TypeScript host has no runtime decoder to go through,
 * and are compared the way `KNOWN-FIDELITY-GAPS.md` says to compare them: key
 * order does not matter, presence does, and a group B case - a known type
 * carrying a key the protocol does not model - is asserted against its
 * `preservedOutput` rather than skipped.
 *
 * The root, session and chat cases go through ahpd's own host, one host per
 * case. Most of them cannot be driven into it, and the two lists below name
 * every one of those with the reason, so that a case which stops running, or
 * one which starts, changes the test rather than the count.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  annotationsReducer, automationReducer, automationRunReducer, canvasReducer, changesetReducer, chatReducer,
  IS_CLIENT_DISPATCHABLE, resourceWatchReducer, rootReducer, sessionReducer, SUPPORTED_PROTOCOL_VERSIONS,
  terminalReducer,
} from '@microsoft/agent-host-protocol';
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
const { claude } = await import('../../agent-claude/src/claude.js');

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

beforeEach(() => { sdk.queries.length = 0; });

/** A host, with nothing asked of it yet. */
const aHost = () => createHost({ path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })] });

const CASES = join(import.meta.dirname, 'fixtures/ahp-test-cases');
const filesIn = (where: string): string[] => readdirSync(join(CASES, where)).filter((one) => one.endsWith('.json')).sort();
const read = <T>(where: string, file: string): T => JSON.parse(readFileSync(join(CASES, where, file), 'utf8')) as T;

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

/** One case's actions, applied to its own initial state, in order. */
const reduced = (reducer: string, state: Record<string, unknown>, actions: Record<string, unknown>[]): unknown =>
  actions.reduce((held, action) => REDUCERS[reducer]?.(held as never, action as never), state as unknown);

/**
 * A value with every key that holds `null` taken out, all the way down.
 *
 * The cases write `null` where the protocol's types let a field be absent, so
 * a reducer that leaves the field off entirely has said the same thing. A
 * `null` inside a list stays: a slot in a list is not a missing key.
 */
const withoutNulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, held]) => held !== null && held !== undefined)
    .map(([key, held]) => [key, withoutNulls(held)]));
};

describe('the protocol’s reducer cases', () => {
  for (const file of filesIn('reducers')) {
    const one = read<ReducerCase>('reducers', file);
    it(file.replace(/\.json$/u, ''), () => {
      expect(REDUCERS[one.reducer], `${file} names a channel this suite has no reducer for`).toBeDefined();
      expect(withoutNulls(reduced(one.reducer, one.initial, one.actions))).toEqual(withoutNulls(one.expected));
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
       * What a TypeScript host does with a payload: `JSON.parse` into a value,
       * `JSON.stringify` back out. Nothing is dropped and nothing is added,
       * which is why a group B case asserts the preserved form and a group A
       * case asserts the canonical one.
       */
      const back = JSON.parse(JSON.stringify(one.input)) as unknown;
      expect(one.acceptableOutputs.length, `${file} must carry exactly one acceptable form`).toBe(1);
      expect(back).toEqual(one.group === 'B' ? one.preservedOutput : one.acceptableOutputs[0]);
    });
  }
});

/*
 * Version negotiation.
 */

interface NegotiationRow {
  offered: string[];
  expected?: string | null;
  invalid?: boolean;
}

describe('the protocol’s version negotiation cases', () => {
  for (const [at, row] of read<NegotiationRow[]>('', 'version-negotiation.json').entries()) {
    const offered = row.offered.length === 0 ? 'nothing' : row.offered.join(' ');
    it(`${at + 1}. ${offered}`, async () => {
      const asked = peer();
      const client = aHost().accept(asked);
      const hello = client.handle({
        method: 'initialize',
        params: { channel: 'ahp-root://', clientId: 'negotiation', protocolVersions: row.offered },
      });
      if (row.invalid === true) {
        // Not a version at all, so not a version this host can decline politely.
        await expect(hello).rejects.toMatchObject({ code: -32602 });
        return;
      }
      if (row.expected === null) {
        // Nothing in common, which is recoverable: the answer says what to try.
        await expect(hello).rejects.toMatchObject({
          code: -32005,
          data: { supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS] },
        });
        return;
      }
      expect((await hello as { protocolVersion: string }).protocolVersion).toBe(row.expected);
    });
  }
});

/*
 * The same cases, through ahpd's host.
 */

interface HostCase extends ReducerCase {
  name: string;
}

/**
 * The cases a dispatch cannot carry, so their expected state is never reached.
 *
 * Two things put a case here. Most of them name an action a client may not
 * originate at all: `IS_CLIENT_DISPATCHABLE` says which those are, and this
 * host refuses one arriving from a client, so the case cannot be driven into
 * it. The rest name actions a client *may* send, refused because the state
 * the case describes is not a state this host has; those are named again in
 * `HOST_REFUSED` below, with the reason the host gave.
 *
 * Every name here is asserted to be refused, and every case refused is
 * asserted to be here, so a case that starts running or stops being refused
 * fails the test rather than the count.
 */
const NOT_REPLAYED = [
  '001-root-agentschanged',
  '002-root-activesessionschanged',
  '003-session-ready',
  '004-session-creationfailed',
  '010-session-delta-appends-content',
  '011-session-delta-with-wrong-turnid-is-no-op',
  '012-session-delta-without-activeturn-is-no-op',
  '013-session-responsepart-adds-to-responseparts',
  '014-session-turncomplete-finalizes-turn',
  '016-session-error-finalizes-turn-with-error',
  '017-turncomplete-force-cancels-in-progress-tool-calls',
  '018-turncomplete-with-wrong-turnid-is-no-op',
  '019-tool-call-full-lifecycle-start-delta-ready-confirmed-complete',
  '020-tool-call-ready-with-auto-confirm-transitions-to-running',
  '021-tool-call-denied-transitions-to-cancelled',
  '022-tool-call-result-confirmation-pending-approved',
  '023-tool-call-result-denied-cancelled-with-result-denied-reason',
  '024-tool-call-complete-from-pending-confirmation-defaults-confirmed',
  '025-tool-call-actions-for-unknown-toolcallid-are-no-op',
  '026-toolcallready-transitions-running-tool-back-to-pending-confirmation',
  '027-toolcallready-re-confirmation-approved-transitions-back-to-running',
  '028-toolcallready-re-confirmation-denied-transitions-to-cancelled',
  '029-toolcallready-updates-pending-confirmation-tool-calls',
  '031-session-usage-updates-usage-on-active-turn',
  '032-session-reasoning-appends-reasoning-content',
  '034-session-servertoolschanged-sets-server-tools',
  '039-set-steering-message',
  '040-replace-existing-steering-message',
  '041-update-steering-message-content-via-set-with-same-id',
  '052-steering-and-queued-messages-are-independent',
  '058-session-customizationschanged-replaces-entire-list',
  '059-session-customizationschanged-replaces-existing-customizations',
  '060-session-customizationtoggled-toggles-by-id',
  '061-session-customizationtoggled-is-no-op-for-unknown-id',
  '062-session-customizationtoggled-is-no-op-when-customizations-undefined',
  '063-session-truncated-keeps-turns-up-to-turnid',
  '064-session-truncated-keeps-all-when-turnid-is-last',
  '065-session-truncated-keeps-only-first-when-turnid-is-first',
  '066-session-truncated-clears-all-when-turnid-omitted',
  '067-session-truncated-drops-active-turn',
  '068-session-truncated-drops-active-turn-even-when-clearing-all',
  '069-session-truncated-is-no-op-for-unknown-turnid',
  '070-full-turn-flow-with-tool-calls-and-re-confirmation',
  '071-root-terminalschanged',
  '084-toolcall-contentchanged-updates-running',
  '085-toolcall-contentchanged-noop-non-running',
  '086-toolcall-contentchanged-replaces-existing',
  '087-root-unknown-action-type-is-no-op',
  '088-session-unknown-action-type-is-no-op',
  '090-toolcalldelta-wrong-turnid-is-no-op',
  '091-responsepart-wrong-turnid-is-no-op',
  '092-toolcallstart-wrong-turnid-is-no-op',
  '093-usage-wrong-turnid-is-no-op',
  '094-delta-nonexistent-partid-is-no-op',
  '095-toolcalldelta-wrong-status-is-no-op',
  '097-toolcallcomplete-wrong-status-is-no-op',
  '098-toolcallresultconfirmed-wrong-status-is-no-op',
  '099-endturn-force-cancels-running-tool-call',
  '100-delta-targeting-toolcall-partid-is-no-op',
  '101-toolcalldelta-without-invocationmessage',
  '102-reasoning-targeting-non-reasoning-is-no-op',
  '103-delta-skips-parts-without-id',
  '105-session-input-full-draft-and-complete-flow',
  '106-session-input-requested-with-drafts-status',
  '107-session-input-turn-end-cleans-turn-scoped-only',
  '108-session-input-upsert-and-clear-answer',
  '109-session-input-unknown-actions-are-no-op',
  '110-session-input-completion-and-truncation-filtering',
  '111-toolcall-pending-confirmation-sets-input-needed-status',
  '112-toolcall-pending-result-confirmation-sets-input-needed-status',
  '113-session-configchanged-merges-into-config-values',
  '114-session-configchanged-noops-when-config-undefined',
  '127-root-configchanged-merges-into-config-values',
  '127-toolcallready-with-confirmation-options',
  '128-root-configchanged-noops-when-config-undefined',
  '128-toolcallconfirmed-approved-with-selectedoption',
  '129-session-configchanged-replace-replaces-all-values',
  '129-toolcallconfirmed-denied-with-selectedoption',
  '130-root-configchanged-replace-replaces-all-values',
  '130-selectedoption-carries-through-to-completed',
  '131-selectedoption-carries-through-result-confirmation',
  '132-selectedoption-carries-through-result-denied',
  '133-session-activitychanged-sets-activity',
  '134-session-activitychanged-clears-activity',
  '135-session-metachanged-sets-meta',
  '137-session-customizationupdated-replaces-existing-container',
  '138-session-customizationupdated-appends-unknown-id',
  '139-session-customizationupdated-creates-list',
  '145-session-changesetschanged-sets-catalogue',
  '146-session-changesetschanged-clears-catalogue',
  '147-session-ready-preserves-inprogress-status',
  '152-session-customizationremoved-removes-container-and-children',
  '153-session-customizationremoved-removes-child',
  '154-session-customizationremoved-noop-unknown-id',
  '156-session-default-chat-changed',
  '158-toolcallconfirmed-approved-with-editedtoolinput-overrides-original',
  '159-session-mcpserverstatechanged-upserts-top-level-server',
  '160-session-default-chat-changed-unsets',
  '160-session-mcpserverstatechanged-upserts-container-child',
  '161-chat-turn-lifecycle-on-chat',
  '161-session-mcpserverstatechanged-noop-unknown-id',
  '162-session-mcpserverstatechanged-noop-non-mcp-id',
  '163-toolcallstart-carries-mcp-contributor-through-lifecycle',
  '170-session-chatadded-appends',
  '171-session-chatadded-upserts',
  '172-session-chatremoved',
  '173-session-chatupdated',
  '174-session-chatremoved-noop',
  '175-session-chatupdated-noop',
  '220-toolcall-actions-update-meta',
  '221-session-activeclientremoved-removes-client',
  '222-session-activeclientremoved-no-op-unknown-client',
  '223-chat-activitychanged-sets-activity',
  '223-session-inputneededset-adds-chat-input',
  '224-chat-activitychanged-clears-activity',
  '224-session-inputneededset-appends-tool-confirmation',
  '225-session-customizationtoggled-toggles-child-by-id',
  '225-session-inputneededset-replaces-existing',
  '226-session-customizationtoggled-is-no-op-for-unknown-child-id',
  '226-session-inputneededremoved-removes-entry',
  '227-session-inputneededremoved-no-op-unknown-id',
  '228-session-inputneededremoved-no-op-absent',
  '229-session-inputneededremoved-clears-status-when-empty',
  '230-session-inputneededremoved-preserves-orthogonal-flags',
  '231-session-inputneededset-preserves-orthogonal-flags',
  '232-chat-turnsloaded-prepends-older-turns',
  '233-chat-turnsloaded-dedupes-overlap-and-clears-cursor',
  '234-chat-truncated-clears-turns-next-cursor-when-clearing-all',
  '235-session-mcpserverstartrequested-starts-top-level-server',
  '236-session-input-completion-without-active-turn-records-nothing',
  '236-session-mcpserverstoprequested-stops-auth-required-server',
  '237-session-mcpserverstoprequested-stops-container-child',
  '238-session-mcpserverstartrequested-no-op-absent-customizations',
  '239-session-mcpserverstartrequested-no-op-unknown-id',
  '240-turn-duration-is-clamped-to-zero',
  '241-session-workingdirectoryset-adds-to-empty-set',
  '241-toolcallready-stores-loading-risk-assessment',
  '242-session-workingdirectoryset-appends-to-existing-set',
  '242-toolcallready-completes-risk-assessment',
  '243-session-workingdirectoryset-no-op-when-already-present',
  '243-toolcallauthrequired-full-lifecycle-running-authrequired-running-completed',
  '243-toolcallready-ignores-finished-tool-calls',
  '244-toolcallauthrequired-noop-for-non-mcp-contributor',
  '245-toolcallauthrequired-noop-when-contributor-absent',
  '246-toolcallauthrequired-noop-when-not-running',
  '247-chat-workingdirectoryset-adds-to-empty-set',
  '247-toolcallauthresolved-noop-when-not-auth-required',
  '248-chat-workingdirectoryset-appends-to-existing-set',
  '248-toolcallauthrequired-sets-input-needed-status-and-preserves-metadata',
  '249-chat-workingdirectoryset-no-op-when-already-present',
  '249-toolcallauthresolved-preserves-fields-and-clears-input-needed',
  '250-turncomplete-force-cancels-auth-required-tool-call',
  '251-session-inputneededset-appends-tool-authentication',
  '252-session-inputneededremoved-removes-tool-authentication',
  '253-toolcallcomplete-cancels-auth-required-tool-call',
  '254-toolcallcomplete-ignores-successful-result-from-auth-required',
  '255-toolcallcomplete-ignores-requiresresultconfirmation-when-cancelling-auth-required',
  '256-session-chatadded-preserves-sidechat-selection',
  '257-toolcallready-refines-metadata-without-changing-client-ownership',
  '260-edited-tool-input-survives-reconfirmation',
  '261-session-inputneededset-client-execution-keeps-inprogress',
  '262-session-inputneededremoved-client-execution-remains-inprogress',
  '263-chat-turn-resume-reopens-turn',
  '263-session-customizationtoggled-clears-enablement',
  '264-chat-turn-resume-noop-with-active-turn',
  '264-session-workingdirectoryreplaced-no-op-when-absent',
  '265-chat-turn-resume-noop-for-unknown-turn',
  '266-chat-turn-resume-noop-for-nonlatest-turn',
  '266-session-workingdirectoryreplaced-no-op-when-directory-is-absent',
  '267-chat-turn-resume-noop-for-unresumable-error',
  '267-session-workingdirectoryreplaced-replaces-and-deduplicates',
  '268-chat-turn-resume-preserves-errors-across-retries',
  '268-session-workingdirectoryreplaced-replaces-primary',
  '269-chat-turn-resume-completes-one-turn',
  '269-session-workingdirectoryreplaced-replaces-non-primary',
  '270-chat-responsepart-cannot-append-error',
  '270-session-workingdirectoryreplaced-deduplicates-earlier-replacement',
  '271-chat-changesetschanged-sets-catalogue',
  '271-chat-movablechanged-sets-true',
  '271-turn-end-normalizes-offset-and-rollover',
  '272-chat-changesetschanged-clears-catalogue',
  '272-chat-isarchivedchanged-archives-chat',
  '272-chat-movablechanged-sets-false',
  '272-toolcallready-typed-edit-previews',
  '273-chat-isarchivedchanged-unarchives-chat',
  '274-chat-canvaseschanged-sets-canvases',
  '275-chat-canvaseschanged-clears-canvases',
  '277-chat-backgroundworkset-adds',
  '277-session-chatsreordered-authoritative-order-to-start',
  '278-chat-backgroundworkset-replaces',
  '278-session-chatsreordered-authoritative-order-to-end',
  '279-chat-backgroundworkremoved-removes',
  '279-session-chatsreordered-before-default',
  '280-chat-backgroundworkremoved-absent',
  '280-session-chatsreordered-after-default',
  '281-session-chatsreordered-authoritative-full-order',
  '282-session-chatsreordered-incomplete-order-noop',
  '283-chat-backgroundworkset-keeps-unknown-kind',
  '283-session-chatsreordered-idempotent-reapplication',
  '284-chat-backgroundworkremoved-removes-unknown-kind',
  '284-session-chatsreordered-unknown-order-noop',
  '285-session-chatsreordered-duplicate-order-noop',
  '286-chat-isreadchanged-marks-default-chat-as-read',
  '287-chat-isreadchanged-marks-chat-as-unread',
  '288-session-chatupdated-mirrors-chat-read-status',
];

/**
 * The cases the host refuses although a client may send what they name.
 *
 * Each of these is a state this host does not have, and it says which: a
 * method it does not serve yet, a directory nobody trusted here, a config key
 * this backend does not take, a root config key no schema here declares, a
 * turn or a tool call this session has never had. The reason is the host's own
 * words, and the groups below are the ones it gave, so the field each case
 * names is refused rather than reaching the host's state and coming back
 * different.
 *
 * A case here that the host starts accepting fails the test, because it would
 * then be in neither this list nor a comparison.
 */
const HOST_REFUSED = [
  // `session/activeClientRemoved is not served yet`
  '221-session-activeclientremoved-removes-client',
  '222-session-activeclientremoved-no-op-unknown-client',
  // `chat/isArchivedChanged is not served yet`
  '272-chat-isarchivedchanged-archives-chat',
  '273-chat-isarchivedchanged-unarchives-chat',
  // `chat/isReadChanged is not served yet`
  '286-chat-isreadchanged-marks-default-chat-as-read',
  '287-chat-isreadchanged-marks-chat-as-unread',
  // `Nothing is running in this chat to steer`
  '039-set-steering-message',
  '040-replace-existing-steering-message',
  '041-update-steering-message-content-via-set-with-same-id',
  '052-steering-and-queued-messages-are-independent',
  // `<directory> is not a working directory of <session>`, and the workspace was never trusted here
  '241-session-workingdirectoryset-adds-to-empty-set',
  '242-session-workingdirectoryset-appends-to-existing-set',
  '243-session-workingdirectoryset-no-op-when-already-present',
  '247-chat-workingdirectoryset-adds-to-empty-set',
  '248-chat-workingdirectoryset-appends-to-existing-set',
  '249-chat-workingdirectoryset-no-op-when-already-present',
  '264-session-workingdirectoryreplaced-no-op-when-absent',
  '266-session-workingdirectoryreplaced-no-op-when-directory-is-absent',
  '267-session-workingdirectoryreplaced-replaces-and-deduplicates',
  '268-session-workingdirectoryreplaced-replaces-primary',
  '269-session-workingdirectoryreplaced-replaces-non-primary',
  '270-session-workingdirectoryreplaced-deduplicates-earlier-replacement',
  // `<turn> is not a completed turn in <chat>`
  '063-session-truncated-keeps-turns-up-to-turnid',
  '064-session-truncated-keeps-all-when-turnid-is-last',
  '065-session-truncated-keeps-only-first-when-turnid-is-first',
  '067-session-truncated-drops-active-turn',
  '069-session-truncated-is-no-op-for-unknown-turnid',
  '110-session-input-completion-and-truncation-filtering',
  // `This host can drop the turns after one, but not a conversation entire`
  '066-session-truncated-clears-all-when-turnid-omitted',
  '068-session-truncated-drops-active-turn-even-when-clearing-all',
  '234-chat-truncated-clears-turns-next-cursor-when-clearing-all',
  // `<turn> is not a turn that can be resumed`
  '263-chat-turn-resume-reopens-turn',
  '264-chat-turn-resume-noop-with-active-turn',
  '265-chat-turn-resume-noop-for-unknown-turn',
  '266-chat-turn-resume-noop-for-nonlatest-turn',
  '267-chat-turn-resume-noop-for-unresumable-error',
  // `<id> is not a call a client is running here`, and no call here asks for its result to be confirmed
  '084-toolcall-contentchanged-updates-running',
  '085-toolcall-contentchanged-noop-non-running',
  '086-toolcall-contentchanged-replaces-existing',
  '097-toolcallcomplete-wrong-status-is-no-op',
  '098-toolcallresultconfirmed-wrong-status-is-no-op',
  // `<key> is not a config key this backend takes`
  '113-session-configchanged-merges-into-config-values',
  '114-session-configchanged-noops-when-config-undefined',
  '129-session-configchanged-replace-replaces-all-values',
  // `root config does not declare theme`, the root half of the same refusal
  '127-root-configchanged-merges-into-config-values',
  '128-root-configchanged-noops-when-config-undefined',
  '130-root-configchanged-replace-replaces-all-values',
  // `<id> has no runtime switch`
  '060-session-customizationtoggled-toggles-by-id',
  '061-session-customizationtoggled-is-no-op-for-unknown-id',
  '062-session-customizationtoggled-is-no-op-when-customizations-undefined',
  '225-session-customizationtoggled-toggles-child-by-id',
  '226-session-customizationtoggled-is-no-op-for-unknown-child-id',
  '263-session-customizationtoggled-clears-enablement',
  // `<id> would not start`, or would not stop: this host runs no such server
  '235-session-mcpserverstartrequested-starts-top-level-server',
  '236-session-mcpserverstoprequested-stops-auth-required-server',
  '237-session-mcpserverstoprequested-stops-container-child',
  '238-session-mcpserverstartrequested-no-op-absent-customizations',
  '239-session-mcpserverstartrequested-no-op-unknown-id',
  // `<id> is not a question this chat is waiting on`
  '109-session-input-unknown-actions-are-no-op',
];

/**
 * The cases the host runs and answers differently, and the fields it keeps
 * its own value on.
 *
 * `activeTurn` and `turns` carry this host's own clock and its own turn ids,
 * `status` is what the session's backend is doing rather than what the case
 * says it is, and `activeClients` names the connections that are actually
 * here. The case's expectation for those fields is a state ahpd never makes,
 * so the difference is asserted rather than passed over: a case that starts
 * agreeing fails the test and has to come off this list.
 */
const HOST_OWNS: Record<string, string[]> = {
  '005-session-turnstarted': ['activeTurn'],
  '006-turnstarted-with-queuedmessageid-removes-from-queuedmessages': ['activeTurn'],
  '007-turnstarted-with-queuedmessageid-removes-last-queued-message': ['activeTurn'],
  '008-turnstarted-with-queuedmessageid-removes-matching-steering-message': ['activeTurn'],
  '009-turnstarted-without-queuedmessageid-does-not-touch-pending-messages': ['activeTurn'],
  '015-session-turncancelled-finalizes-turn': ['turns'],
  '035-session-activeclientset-adds-client': ['activeClients'],
  '045-set-a-new-queued-message': ['status'],
  '046-append-queued-message-when-id-is-new': ['status'],
  '047-update-queued-message-in-place-when-id-already-exists': ['status'],
  '075-turnstarted-clears-isread': ['activeTurn'],
};

/** The state the host serves for one channel, read by a connection of its own. */
const stateOf = async (client: { handle(r: { method: string; params: unknown }): unknown }, channel: string): Promise<Record<string, unknown>> => {
  const opened = await client.handle({ method: 'subscribe', params: { channel } }) as { snapshot: { state: Record<string, unknown> } };
  return opened.snapshot.state;
};

/** Whether two values are the same value: keys in any order, and `null` not read as absent. */
const sameValue = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((one, at) => sameValue(one, b[at]));
  }
  const right = b as Record<string, unknown>;
  return Object.entries(a as Record<string, unknown>)
    .every(([key, held]) => key in right && sameValue(held, right[key]))
    && Object.keys(right).length === Object.keys(a as object).length;
};

interface Driven {
  /** Whether the host refused one of the case's actions. */
  refused: boolean;
  /** The keys the case moves whose starting value the host agreed with, which it then answered differently. */
  differs: string[];
  after: Record<string, unknown>;
  expected: Record<string, unknown>;
}

/**
 * One case, driven through a host of its own.
 *
 * A session and its default chat are opened, the case's actions are sent on
 * the channel the case names, and the state is read back by a second
 * connection. A second one because the first has been watching every delta
 * since it opened, and what a delta-built view says is a different question
 * from what the state is.
 *
 * What can be compared is a key the host and the case *start* agree on. A key
 * they already disagree on - a title this host took from its backend where
 * the case wrote its own, a timestamp of the host's - says nothing about what
 * the action did, and comparing it would report the starting difference as a
 * defect in the action.
 */
async function driven(one: HostCase, name: string): Promise<Driven> {
  const host = aHost();
  const asked = peer();
  const client = host.accept(asked);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: `cases-${name}`, protocolVersions: ['0.9.0'] },
  });
  const uri = `ahp-session:/${name}`;
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  const channel = one.reducer === 'root' ? 'ahp-root://' : one.reducer === 'session' ? uri : opened.snapshot.state.defaultChat;
  const before = await stateOf(client, channel);
  for (const action of one.actions) {
    await client.handle({ method: 'dispatchAction', params: { channel, action } });
    await settle();
  }
  const reader = host.accept(peer());
  await reader.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: `cases-read-${name}`, protocolVersions: ['0.9.0'] },
  });
  const after = await stateOf(reader, channel);
  const refused = asked.notes.some((note) => note.method === 'action'
    && (note.params as { rejectionReason?: string }).rejectionReason !== undefined);
  const named = Object.keys(one.expected);
  const started = named.filter((key) => sameValue(one.initial[key], before[key]));
  const differs = started.length === 0
    ? named.filter((key) => !sameValue(one.initial[key], before[key]))
    : started.filter((key) => !sameValue(after[key], one.expected[key]));
  return { refused, differs, after, expected: one.expected };
}

/** Whether every action a case names is one a client may send. */
const sendable = (one: HostCase): boolean => one.actions.every((action) =>
  (IS_CLIENT_DISPATCHABLE as Record<string, boolean | undefined>)[String((action as { type?: unknown }).type)] === true);

const hostCases: HostCase[] = ['root', 'session', 'chat'].flatMap((reducer) =>
  filesIn('reducers')
    .map((file) => ({ ...read<ReducerCase>('reducers', file), name: file.replace(/\.json$/u, '') }))
    .filter((one) => one.reducer === reducer));

describe('the protocol’s root, session and chat cases, through ahpd', () => {
  for (const one of hostCases) {
    it(one.name, async () => {
      const outcome = await driven(one, one.name);
      if (outcome.refused) {
        // Refused, and named for it. Which list it belongs in is the
        // protocol's answer to whether a client may send what it names: an
        // action a client may not send is refused before its state is
        // reached, and one it may send is refused because this host has no
        // such state, which is a different thing to write down.
        const why = sendable(one) ? HOST_REFUSED : NOT_REPLAYED;
        expect(why, `${one.name}: refused, and named for the reason`).toContain(one.name);
        expect(NOT_REPLAYED, `${one.name}: refused, and in the whole list`).toContain(one.name);
        return;
      }
      // It ran, so nothing about it may be refused: a client may send every
      // action it names, and it is in neither list.
      expect(sendable(one), `${one.name}: ran, so a client may send it`).toBe(true);
      expect(NOT_REPLAYED, `${one.name}: ran, so it cannot be listed as refused`).not.toContain(one.name);
      expect(outcome.differs, `${one.name}: the fields the host answers differently`)
        .toEqual(HOST_OWNS[one.name] ?? []);
    });
  }

  it('names every case it cannot replay, and no other', () => {
    expect(NOT_REPLAYED).toHaveLength(205);
    expect(new Set(NOT_REPLAYED).size).toBe(205);
    expect(HOST_REFUSED).toHaveLength(59);
    // The rest of the refused cases are the ones a client may not send, and
    // each of those is checked against the protocol's own answer per case.
    expect(NOT_REPLAYED.length - HOST_REFUSED.length).toBe(146);
    expect(Object.keys(HOST_OWNS)).toHaveLength(11);
    // And 32 that ran and agreed, which need no entry in either list: they are
    // the coverage this suite is for, and a case joining or leaving them is
    // what moves this number.
    expect(NOT_REPLAYED.length + Object.keys(HOST_OWNS).length + 32).toBe(hostCases.length);
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
