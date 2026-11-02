/*
 * The bot's own connection to its host, as a client of it.
 *
 * The host answers every action it is sent, with the action carrying the
 * sender's origin or with a refusal, and a client holds what it sent until that
 * answer comes. So a dispatch is settled by the answer alone, however long the
 * host takes: an action the host is still deciding about is neither taken nor
 * refused yet.
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

it('waits for the host to answer a dispatch, however long it takes, and takes a late refusal as the refusal', async () => {
  vi.useFakeTimers();
  const { conn, sent, answer } = connection();
  const sender = dispatcher(conn, 'ahpd-bot');
  let settled: { refused: string | undefined } | undefined;
  void sender.dispatch('ahp-chat:/1', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } })
    .then((refused) => { settled = { refused }; });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(settled).toBeUndefined();

  answer({ channel: 'ahp-chat:/1', origin: { clientId: 'ahpd-bot', clientSeq: sent[0]?.clientSeq }, rejectionReason: 'A turn is running in this chat' });
  await vi.advanceTimersByTimeAsync(0);
  expect(settled).toEqual({ refused: 'A turn is running in this chat' });
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
