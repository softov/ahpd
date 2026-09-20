import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { foldHostOptions } from '../packages/sdk/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { HostOptions, HostTool, ResourceStore } from '../packages/sdk/src/types/host.js';
import type { AutomationStore } from '../packages/sdk/src/types/automations.js';
import type { Contribution, PortContribution, PortKey } from '../packages/sdk/src/types/plugin.js';

/*
 * The fold, on its own.
 *
 * `foldHostOptions` is pure, so every rule decision
 * `plugin-contributes-host-options` and `plugin-registration-kinds` names can
 * be checked without a loader, a filesystem or a plugin package: what appends,
 * what a collision is, what `'replace'` buys, and that the base a caller
 * passed in comes back untouched.
 */

/** A backend like the example's, renamed so a collision has two names to print. */
const agent = (provider: string): Agent => ({ ...echo({ path: '/tmp/fold' }), provider });

const tool = (name: string): HostTool => ({
  definition: { name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } },
  run: () => name,
});

/** A base like the daemon builds, with `resources` already the daemon's. */
const base = (): HostOptions => ({
  path: '/tmp/fold',
  agents: [agent('echo')],
  resources: { claimed: 'the daemon' } as unknown as ResourceStore,
});

const contribution = (
  by: string,
  parts: { agents?: Agent[]; tools?: HostTool[]; ports?: Partial<Record<PortKey, PortContribution>> } = {},
): Contribution => ({
  by,
  agents: parts.agents ?? [],
  tools: parts.tools ?? [],
  ports: parts.ports ?? {},
  events: {},
});

const port = (value: unknown, replace = false): PortContribution => ({ value, replace });

describe('foldHostOptions', () => {
  it('appends agents and tools in contribution order, and leaves the base alone', () => {
    const options = base();
    const before = options.agents;
    const { options: folded, problems } = foldHostOptions(options, [
      contribution('alpha', { agents: [agent('alpha')], tools: [tool('alpha')] }),
      contribution('beta', { agents: [agent('beta')], tools: [tool('beta')] }),
    ]);

    expect(problems).toEqual([]);
    expect(folded.agents.map((one) => one.provider)).toEqual(['echo', 'alpha', 'beta']);
    expect(folded.tools?.map((one) => one.definition.name)).toEqual(['alpha', 'beta']);
    // The base is a value a caller still holds, so a fold that mutated it
    // would change what the daemon built before any plugin ran.
    expect(options.agents).toBe(before);
    expect(options.agents.map((one) => one.provider)).toEqual(['echo']);
    expect(options.tools).toBeUndefined();
  });

  it('reports an agent whose provider the base already has, naming both', () => {
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { agents: [agent('echo')] }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('echo');
    expect(problems[0]).toContain('the daemon');
    expect(options.agents.map((one) => one.provider)).toEqual(['echo', 'echo']);
  });

  it('tells a plugin that sets a port the daemon already set, and keeps the daemon\'s value', () => {
    const options = base();
    const { options: folded, problems } = foldHostOptions(options, [
      contribution('alpha', { ports: { resources: port({ claimed: 'alpha' }) } }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('resources');
    expect(problems[0]).toContain("'replace'");
    expect(folded.resources).toBe(options.resources);
  });

  it('lets a plugin take a daemon port over with replace, without a problem', () => {
    const mine = { claimed: 'alpha' } as unknown as ResourceStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { resources: port(mine, true) } }),
    ]);

    expect(problems).toEqual([]);
    expect(options.resources).toBe(mine);
  });

  it('reports two plugins claiming one free port once, naming both, and keeps the first', () => {
    const first = { claimed: 'alpha' } as unknown as AutomationStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { automations: port(first) } }),
      contribution('beta', { ports: { automations: port({ claimed: 'beta' }) } }),
    ]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('alpha');
    expect(problems[0]).toContain('beta');
    expect(problems[0]).toContain('automations');
    expect(options.automations).toBe(first);
  });

  it('lets the second plugin take the first one\'s port over with replace', () => {
    const second = { claimed: 'beta' } as unknown as AutomationStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { automations: port({ claimed: 'alpha' }) } }),
      contribution('beta', { ports: { automations: port(second, true) } }),
    ]);

    expect(problems).toEqual([]);
    expect(options.automations).toBe(second);
  });

  it('sets a port the base does not have with no replace needed', () => {
    const store = { claimed: 'alpha' } as unknown as AutomationStore;
    const { options, problems } = foldHostOptions(base(), [
      contribution('alpha', { ports: { automations: port(store) } }),
    ]);

    expect(problems).toEqual([]);
    expect(options.automations).toBe(store);
  });
});

describe('sdkVersion', () => {
  it('answers the version in this package\'s manifest', () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packages', 'sdk', 'package.json'), 'utf8')) as { version: string };
    expect(sdkVersion()).toBe(manifest.version);
    expect(sdkVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
