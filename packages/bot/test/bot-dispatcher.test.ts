/*
 * The bot's own connection to its host, as a client of it.
 *
 * The host answers every action it is sent, with the action carrying the
 * sender's origin or with a refusal. A dispatch is settled by that answer, or
 * given up after ten seconds as unconfirmed, as VS Code's router gives up on a
 * message it sent into another session: it may still be taken, so it is not
 * sent again.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/reconciliation.md#L19-L32
 */

import { afterEach, expect, it, vi } from 'vitest';
import { dispatcher } from '../src/plugin.js';
import type { PluginPeer } from '@ahpd/sdk';

afterEach(() => { vi.useRealTimers(); });

/** A connection whose host answers only when the case says so. */
const connection = () => {
  let heard: (message: { method?: string; params?: unknown }) => void = () => {};
  const sent: { channel: string; clientSeq: number }[] = [];
  const conn = {
    send: () => {},
    notify: (_method: string, params: unknown) => { sent.push(params as { channel: string; clientSeq: number }); },
    request: async () => ({}),
    onMessage: (handler: typeof heard) => { heard = handler; },
  } as unknown as PluginPeer;
  return { conn, sent, answer: (params: unknown) => { heard({ method: 'action', params }); } };
};

it('takes a refusal that comes within ten seconds as the refusal', async () => {
  vi.useFakeTimers();
  const { conn, sent, answer } = connection();
  const sender = dispatcher(conn, 'ahpd-bot');
  let settled: { refused: string | undefined } | undefined;
  void sender.dispatch('ahp-chat:/1', { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' } } })
    .then((refused) => { settled = { refused }; });
  await vi.advanceTimersByTimeAsync(9_999);
  expect(settled).toBeUndefined();

  answer({ channel: 'ahp-chat:/1', origin: { clientId: 'ahpd-bot', clientSeq: sent[0]?.clientSeq }, rejectionReason: 'host is stopping' });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toEqual({ refused: 'host is stopping' });
});

it('gives up a dispatch the host has not answered in ten seconds as unconfirmed, in VS Code\'s words, and sends it once', async () => {
  vi.useFakeTimers();
  const { conn, sent, answer } = connection();
  const sender = dispatcher(conn, 'ahpd-bot');
  let settled: { refused?: string | undefined; failed?: string } | undefined;
  void sender.dispatch('ahp-chat:/1', { type: 'chat/pendingMessageSet', kind: 'queued', id: 'm1' }).then(
    (refused) => { settled = { refused }; },
    (error: unknown) => { settled = { failed: (error as Error).message }; },
  );
  await vi.advanceTimersByTimeAsync(10_000);
  expect(settled).toEqual({
    failed: 'Remote message delivery was not confirmed. It may already be queued; do not retry automatically. Timed out waiting for remote message acknowledgement.',
  });
  // An answer after that settles nothing, and nothing was sent again.
  answer({ channel: 'ahp-chat:/1', origin: { clientId: 'ahpd-bot', clientSeq: sent[0]?.clientSeq } });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled?.failed).toBeDefined();
  expect(sent).toHaveLength(1);
});

it('settles a dispatch the host took when its echo arrives, and not on another client\'s answer', async () => {
  const { conn, sent, answer } = connection();
  const sender = dispatcher(conn, 'ahpd-bot');
  let settled: { refused: string | undefined } | undefined;
  void sender.dispatch('ahp-chat:/1', { type: 'chat/draftChanged' }).then((refused) => { settled = { refused }; });
  answer({ channel: 'ahp-chat:/1', origin: { clientId: 'somebody', clientSeq: sent[0]?.clientSeq } });
  await Promise.resolve();
  expect(settled).toBeUndefined();
  answer({ channel: 'ahp-chat:/1', origin: { clientId: 'ahpd-bot', clientSeq: sent[0]?.clientSeq } });
  await Promise.resolve();
  expect(settled).toEqual({ refused: undefined });
});
