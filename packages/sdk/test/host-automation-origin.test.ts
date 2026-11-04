import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryAutomations } from '../src/automations/automations.js';
import { idOf } from '../src/sessions/catalog.js';
import { fileSessions } from '../src/sessions/sessions.js';
import {
  hello, peer, resetSdk, running, sdk, serving, sessionQueries, settle,
} from './support/host.js';
import type { Bag } from '../src/types/common.js';
import type { AutomationStore } from '../src/types/automations.js';
import type { HostOptions } from '../src/types/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * What started a session, written down beside it.
 *
 * The origin of a session an automation began is in the host's memory for as
 * long as that host runs. A session outlives it, and a catalogue read after a
 * restart names the automation and the run the same way it did before one, so
 * the store keeps a copy of its own.
 */

const AUTOMATION = 'ahp-automation:/triage';

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Bag
  : {});

/** One automation watching for a turn that failed. */
const watching = (): Bag => ({
  title: 'Triage a failed turn',
  enabled: true,
  message: { text: 'Look at {{session}}' },
  session: { provider: 'claude', workingDirectories: ['file:///home/softov'] },
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'session',
    title: 'When a turn fails',
    events: [{ id: 'turnFailed' }],
    config: {},
  }],
});

const runsOf = (store: AutomationStore): Bag[] => (store.get(AUTOMATION)?.runs ?? []).map(bag);

const until = async (done: () => boolean, what: string, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened`);
};

/** A host with one live session, and where that session's CLI sits. */
async function live(over: Partial<HostOptions> = {}) {
  const cli = sessionQueries().length;
  return { ...(await running(over)), cli };
}

/** One turn of the live session that ended badly, which is what the rule watches. */
const fails = async (client: Awaited<ReturnType<typeof running>>['client'], chat: string, turnId: string, cli = 0): Promise<void> => {
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId, message: { text: 'go' } } },
  });
  await settle();
  const fake = sessionQueries()[cli];
  if (fake === undefined) throw new Error('no session is running to fail');
  fake.frames.push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 3 });
  fake.wake?.();
  fake.wake = undefined;
  await settle();
};

describe('a session an automation began', () => {
  it('names the automation and the run after the host that made it closes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ahpd-origin-'));
    const store = memoryAutomations();
    const kept = fileSessions({ dir });
    const first = await live({ automations: store, sessions: kept });
    store.create(AUTOMATION, watching());

    await fails(first.client, first.chatUri, 't1', first.cli);
    await until(() => String(bag(runsOf(store)[0])['primarySession'] ?? '') !== '', 'the run');

    const run = bag(runsOf(store)[0]);
    const made = String(run['primarySession']);
    const started = { kind: 'automation', automation: AUTOMATION, run: String(run['resource']) };
    // The store is given the origin when the session opens, so it is not only
    // in the memory of the host that made it.
    expect(kept.automationOrigin?.(idOf(made))).toEqual(started);
    const folder = kept.workingDirectory?.(idOf(made));
    if (folder === undefined) throw new Error('the run recorded no folder for its session');

    // The daemon stops, and starts again over the folder of sessions it left.
    // Its backend still has the conversation, and the row is built from the
    // store rather than from anything this process held in memory.
    await first.host.close();
    sdk.sessions.push({ sessionId: idOf(made), summary: 'Triage a failed turn', lastModified: Date.now(), cwd: folder });
    const again = serving('/home/softov', [], { sessions: fileSessions({ dir }) });
    const client = again.accept(peer());
    await client.handle(hello(['0.9.0']));
    try {
      const listed = await client.handle({ method: 'listSessions', params: {} }) as { items: Bag[] };
      expect(listed.items.find((one) => one.resource === made)?.origin).toEqual(started);
    } finally {
      await again.close();
    }
  });
});
