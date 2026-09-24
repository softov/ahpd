import { describe, expect, it } from 'vitest';
import { foldHostOptions, pluginHost } from '../packages/sdk/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { EventListener, HostHandlers } from '../packages/sdk/src/types/events.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';

/*
 * The wiring half of events: what `on` records and what the fold does with it.
 *
 * No host is built here, because nothing fires yet - this is only the path a
 * subscription takes from `apply` to `HostOptions.events`, and the rules are
 * about order: the base's listeners first, then each plugin's in the order the
 * configuration listed them.
 */

const context = (): PluginContext => ({
  path: '/tmp/events',
  paths: ['/tmp/events'],
  version: sdkVersion(),
  log: () => {},
  say: () => {},
});

const base = (events?: HostHandlers): HostOptions => ({
  path: '/tmp/events',
  agents: [echo({ path: '/tmp/events' })],
  ...(events === undefined ? {} : { events }),
});

describe('on', () => {
  it('records one listener against the plugin that made it, with its context', () => {
    const { host, contribution } = pluginHost('alpha', context());
    const handle = (): void => {};
    host.on('session_start', handle);

    const listeners = contribution.events.session_start ?? [];
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.by).toBe('alpha');
    expect(listeners[0]?.handle).toBe(handle);
    // The context is the same read-only one `apply` was handed, captured so a
    // handler reads the directories the daemon was actually told to serve.
    expect(listeners[0]?.context.paths).toEqual(['/tmp/events']);
  });

  it('keeps two plugins on one event in the order they were configured', () => {
    const one = pluginHost('alpha', context());
    one.host.on('turn_end', () => {});
    const two = pluginHost('beta', context());
    two.host.on('turn_end', () => {});

    const { options, problems } = foldHostOptions(base(), [one.contribution, two.contribution]);
    expect(problems).toEqual([]);
    expect(options.events?.turn_end?.map((listener) => listener.by)).toEqual(['alpha', 'beta']);
  });

  it('keeps the base\'s own listener and appends the plugin\'s after it', () => {
    const embedder: EventListener<'log'> = { by: 'embedder', context: context(), handle: () => {} };
    const alpha = pluginHost('alpha', context());
    alpha.host.on('log', () => {});
    const beta = pluginHost('beta', context());
    beta.host.on('log', () => {});

    const { options } = foldHostOptions(base({ log: [embedder] }), [alpha.contribution, beta.contribution]);
    expect(options.events?.log?.map((listener) => listener.by)).toEqual(['embedder', 'alpha', 'beta']);
  });

  it('contributes an empty record when nothing was subscribed to, and the fold adds nothing', () => {
    const { contribution } = pluginHost('alpha', context());
    expect(contribution.events).toEqual({});

    const { options } = foldHostOptions(base(), [contribution]);
    // Absent rather than empty: a host with no listeners should not carry a
    // record that says there are none.
    expect(options.events).toBeUndefined();
  });
});
