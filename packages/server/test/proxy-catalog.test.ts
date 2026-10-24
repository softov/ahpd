/*
 * The provider lists the proxy keeps.
 *
 * The catalog is a function of the open connectors, so it is checked here
 * without a listener and without a socket: each connector's `models` is a
 * fixture, and the clock is vitest's.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnectorOwner, ProviderConnector, ProviderModel } from '@ahpd/sdk';
import { modelCatalog, prefixOf, REFETCH_MS } from '../src/proxy/catalog.js';

/** A model as a provider lists one, with the prices OpenRouter writes per token. */
const PRICED: ProviderModel = {
  id: 'anthropic/claude-sonnet-5.5',
  name: 'Anthropic: Claude Sonnet 5.5',
  context_length: 200_000,
  pricing: { prompt: '0.000003', completion: '0.000015' },
};

/** A free model, which is priced at zero rather than unpriced. */
const FREE: ProviderModel = { id: 'meta/llama-3', pricing: { prompt: '0', completion: '0' } };

/** One open connector serving one list, and the calls its list was read by. */
const connector = (id: string, owner: ConnectorOwner, lists: ProviderModel[] = [PRICED, FREE], reads: string[] = []): ProviderConnector => ({
  id,
  adapter: 'openrouter',
  owner,
  provider: { endpoint: 'https://openrouter.ai/api/v1', accepts: ['openai-chat'] },
  models: async () => {
    reads.push(id);
    return lists;
  },
});

/** The catalog a test built, so its timer is stopped whatever the test did. */
const built: (() => void)[] = [];

const catalog = (options: Parameters<typeof modelCatalog>[0]) => {
  const catalogue = modelCatalog(options);
  built.push(() => catalogue.stop());
  return catalogue;
};

afterEach(() => {
  for (const stop of built.splice(0)) stop();
  vi.useRealTimers();
});

describe('the model catalog', () => {
  it('reads each open connector once, and lists what it answered', async () => {
    const reads: string[] = [];
    const one = connector('work', 'host', [PRICED], reads);
    const catalogue = catalog({ providers: () => [one] });

    await catalogue.refresh();
    expect(reads).toEqual(['work']);
    expect(catalogue.listed()).toEqual([{ connector: one, models: [PRICED] }]);
    expect(catalogue.modelOf(one, PRICED.id)).toEqual(PRICED);
  });

  it('reads no connector twice within the hour', async () => {
    const reads: string[] = [];
    const one = connector('work', 'host', [PRICED], reads);
    const catalogue = catalog({ providers: () => [one] });

    await catalogue.refresh();
    await catalogue.refresh();
    expect(reads).toEqual(['work']);
  });

  it('keeps two owners\' connectors of one id apart', async () => {
    const reads: string[] = [];
    const mine = connector('work', 'user:ana', [], reads);
    const theirs = connector('work', 'user:gus', [PRICED], reads);
    const catalogue = catalog({ providers: () => [mine, theirs] });

    await catalogue.refresh();
    expect(catalogue.listed().map((row) => row.connector.owner)).toEqual(['user:ana', 'user:gus']);
    expect(catalogue.modelOf(mine, PRICED.id)).toBeUndefined();
    expect(catalogue.modelOf(theirs, PRICED.id)).toEqual(PRICED);
  });

  it('reads a connector again after an hour, with a timer that holds nothing open', async () => {
    vi.useFakeTimers();
    const reads: string[] = [];
    const one = connector('work', 'host', [PRICED], reads);
    const catalogue = catalog({ providers: () => [one] });

    await catalogue.refresh();
    await vi.advanceTimersByTimeAsync(REFETCH_MS - 1);
    expect(reads).toEqual(['work']);
    await vi.advanceTimersByTimeAsync(1);
    // The timer's own read, settled before the next line.
    await catalogue.refresh();
    expect(reads).toEqual(['work', 'work']);
  });

  it('keeps the last list when a read fails, says it once, and tries again next hour', async () => {
    vi.useFakeTimers();
    const problems: string[] = [];
    let failing = false;
    const one: ProviderConnector = {
      id: 'work',
      adapter: 'openrouter',
      owner: 'host',
      provider: { endpoint: 'https://openrouter.ai/api/v1', accepts: ['openai-chat'] },
      models: async () => {
        if (failing) throw new Error('HTTP 502');
        return [PRICED];
      },
    };
    const catalogue = catalog({ providers: () => [one], onProblem: (line) => { problems.push(line); } });

    await catalogue.refresh();
    failing = true;
    await vi.advanceTimersByTimeAsync(REFETCH_MS);
    await catalogue.refresh();
    expect(problems).toEqual(['work lists no models: HTTP 502']);
    expect(catalogue.listed()).toEqual([{ connector: one, models: [PRICED] }]);
    // The hour counts from the failed try, so a list request does not retry it.
    await catalogue.refresh();
    expect(problems).toHaveLength(1);
  });

  it('drops a connector that is no longer open', async () => {
    let open: ProviderConnector[] = [connector('work', 'host')];
    const catalogue = catalog({ providers: () => open });

    await catalogue.refresh();
    expect(catalogue.listed()).toHaveLength(1);
    open = [];
    await catalogue.refresh();
    expect(catalogue.listed()).toEqual([]);
  });

  it('reads one connector\'s list once, though two refresh calls meet', async () => {
    const reads: string[] = [];
    let answer: (models: ProviderModel[]) => void = () => undefined;
    const one: ProviderConnector = {
      id: 'work',
      adapter: 'openrouter',
      owner: 'host',
      provider: { endpoint: 'https://openrouter.ai/api/v1', accepts: ['openai-chat'] },
      models: () => new Promise<ProviderModel[]>((resolve) => {
        reads.push('work');
        answer = resolve;
      }),
    };
    const catalogue = catalog({ providers: () => [one] });

    const first = catalogue.refresh();
    const second = catalogue.refresh();
    answer([PRICED]);
    await Promise.all([first, second]);
    expect(reads).toEqual(['work']);
  });

  it('prices a listed model in dollars per million tokens', async () => {
    const one = connector('work', 'host');
    const catalogue = catalog({ providers: () => [one] });
    await catalogue.refresh();

    expect(catalogue.priceOf(one, PRICED.id)).toEqual({ input: 3, output: 15 });
    // Free is a price, and an unpriced side stays out.
    expect(catalogue.priceOf(one, FREE.id)).toEqual({ input: 0, output: 0 });
    expect(catalogue.priceOf(one, 'nobody/here')).toBeUndefined();
  });

  it('prices a model before the first read as no price', () => {
    const one = connector('work', 'host');
    const catalogue = catalog({ providers: () => [one] });
    expect(catalogue.modelOf(one, PRICED.id)).toBeUndefined();
    expect(catalogue.priceOf(one, PRICED.id)).toBeUndefined();
    expect(catalogue.listed()).toEqual([]);
  });

  it('stops reading when it is stopped', async () => {
    vi.useFakeTimers();
    const reads: string[] = [];
    const catalogue = catalog({ providers: () => [connector('work', 'host', [PRICED], reads)] });

    await catalogue.refresh();
    catalogue.stop();
    await vi.advanceTimersByTimeAsync(REFETCH_MS * 2);
    expect(reads).toEqual(['work']);
  });
});

describe('prefixOf', () => {
  it('answers the provider\'s prefix, and the adapter name when it names none', () => {
    const one = connector('local', 'host');
    expect(prefixOf(one)).toBe('openrouter');
    expect(prefixOf({ ...one, adapter: 'openai-compatible', provider: { ...one.provider, prefix: 'local' } })).toBe('local');
  });
});
