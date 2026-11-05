import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@microsoft/agent-host-protocol';
import { resetSdk, hello, peer, serving } from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/** A host and one client on it, introduced with what `extra` adds to `initialize`. */
const introduced = async (extra: Record<string, unknown> = {}) => {
  const host = serving('/home/softov');
  const client = host.accept(peer());
  await client.handle(hello([PROTOCOL_VERSION], extra));
  return { host, client };
};

/** The same client id, back on a new connection with `reconnect`. */
const back = async (host: Awaited<ReturnType<typeof introduced>>['host'], extra: Record<string, unknown> = {}) => {
  const again = host.accept(peer());
  await again.handle({
    method: 'reconnect',
    params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 0, subscriptions: [], ...extra },
  });
};

describe('a client locale', () => {
  it('is kept from initialize, by client id', async () => {
    const { host } = await introduced({ locale: 'pt-BR' });
    expect(host.localeOf('probe')).toBe('pt-BR');
  });

  it('is absent when initialize sends none', async () => {
    const { host } = await introduced();
    expect(host.localeOf('probe')).toBeUndefined();
  });

  /*
   * A host's own input on a typed request rides its `_meta`, as AHP carries a
   * request's extra inputs.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/common/commands.ts#L47-L51
   */
  it('is replaced by reconnect under _meta[\'ahpd.locale\'], and kept when reconnect sends none', async () => {
    const { host } = await introduced({ locale: 'pt-BR' });
    await back(host, { locale: 'fr' });
    expect(host.localeOf('probe')).toBe('pt-BR');
    await back(host, { _meta: { 'ahpd.locale': 'es' } });
    expect(host.localeOf('probe')).toBe('es');
    await back(host);
    expect(host.localeOf('probe')).toBe('es');
  });

  it('is cleared by a later initialize that sends none', async () => {
    const { host } = await introduced({ locale: 'pt-BR' });
    await host.accept(peer()).handle(hello([PROTOCOL_VERSION]));
    expect(host.localeOf('probe')).toBeUndefined();
  });

  it('ignores a locale that is not a string, is empty, or is longer than 35 characters', async () => {
    for (const locale of [42, '', 'x'.repeat(36)]) {
      const { host } = await introduced({ locale });
      expect(host.localeOf('probe')).toBeUndefined();
    }
    const { host } = await introduced({ locale: 'pt-BR' });
    await back(host, { _meta: { 'ahpd.locale': 7 } });
    await back(host, { _meta: { 'ahpd.locale': 'x'.repeat(36) } });
    expect(host.localeOf('probe')).toBe('pt-BR');
    const longest = 'x'.repeat(35);
    expect((await introduced({ locale: longest })).host.localeOf('probe')).toBe(longest);
  });
});
