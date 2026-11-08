import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOST_CATALOGS } from '../src/i18n.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Catalogs } from '../src/i18n.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Worktrees } from '../src/types/worktrees.js';
import { hello, peer, resetSdk, serving } from './support/host.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

/*
 * The new session form, in the language of the client that asked.
 *
 * A key's title, description, enum labels and item title come from the
 * catalogs: the plugin that declared the key, or the plugin that registered
 * the backend, and then the host's own. A value an answerer gave is data and
 * keeps its label.
 */

/** The host's catalogs as each test writes them, put back after it. */
let held: Catalogs;
beforeEach(() => {
  resetSdk();
  held = { ...HOST_CATALOGS };
  HOST_CATALOGS.pt = {
    session: {
      isolation: {
        title: 'Isolamento',
        description: 'Onde o agente faz as alterações',
        enum: { folder: 'Pasta' },
      },
      worktreeIncludeFiles: { items: { title: 'Padrão' } },
      main: { title: 'not a key on this form' },
    },
  };
});
afterEach(() => {
  for (const key of Object.keys(HOST_CATALOGS)) delete HOST_CATALOGS[key];
  Object.assign(HOST_CATALOGS, held);
});

/** A repository the form can read, without git. */
const repository = (): Worktrees => ({
  repository: async () => '/home/softov/project',
  branches: async () => ['main', 'Pasta'],
  create: async () => {},
  dirty: async () => false,
  remove: async () => {},
});

type Property = { title?: string; description?: string; enum?: string[]; enumLabels?: string[]; items?: { title?: string } };

/** The new session form one client draws, introduced with `extra`. */
const form = async (extra: Record<string, unknown>, over: Partial<HostOptions> = {}): Promise<Record<string, Property>> => {
  const client = serving('/home/softov', [], { worktrees: repository(), ...over }).accept(peer());
  await client.handle(hello(['0.9.0'], extra));
  const cfg = await client.handle({
    method: 'resolveSessionConfig',
    params: { provider: 'claude', workingDirectory: 'file:///home/softov/project' },
  }) as { schema: { properties: Record<string, Property> } };
  return cfg.schema.properties;
};

describe('the new session form in a locale', () => {
  it('translates the host keys from the host catalog, as the tag or its language', async () => {
    for (const locale of ['pt', 'pt-BR']) {
      const properties = await form({ locale });
      expect(properties.isolation?.title).toBe('Isolamento');
      expect(properties.isolation?.description).toBe('Onde o agente faz as alterações');
      expect(properties.worktreeIncludeFiles?.items?.title).toBe('Padrão');
    }
  });

  it('keeps the English label of an enum value with no entry', async () => {
    const properties = await form({ locale: 'pt' });
    expect(properties.isolation?.enum).toEqual(['folder', 'worktree']);
    expect(properties.isolation?.enumLabels).toEqual(['Pasta', 'Worktree']);
  });

  /*
   * A value's description is translated with its label, as VS Code localizes
   * the two together.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L387-L405
   */
  it('translates each enum value\'s description from the catalog, and keeps the English one with no entry', async () => {
    (HOST_CATALOGS.pt as { session: { isolation: Record<string, unknown> } }).session.isolation.enumDescriptions = { folder: 'Trabalhar na pasta' };
    const properties = await form({ locale: 'pt' }) as Record<string, Property & { enumDescriptions?: string[] }>;
    expect(properties.isolation?.enumDescriptions).toEqual([
      'Trabalhar na pasta',
      'Work in a git worktree of its own, so two sessions in one repository do not edit under each other',
    ]);
  });

  it('answers the English form to a client with no locale', async () => {
    const english = await form({});
    expect(english.isolation?.title).toBe('Isolation');
    expect(english.isolation?.enumLabels).toEqual(['Folder', 'Worktree']);
    expect(english.worktreeIncludeFiles?.items?.title).toBe('Pattern');
  });

  it('translates a backend key from the catalogs of the plugin that registered the backend', async () => {
    const claude: Catalogs = { pt: { session: { permissionMode: { title: 'Aprovações', enum: { plan: 'Planejar' } } } } };
    const properties = await form({ locale: 'pt' }, { catalogs: { agents: { claude } } });
    expect(properties.permissionMode?.title).toBe('Aprovações');
    expect(properties.permissionMode?.enumLabels).toContain('Planejar');
    // A string the catalog does not hold comes in English.
    expect(properties.permissionMode?.description).toBe('How Claude handles tool approvals.');
    expect(properties.permissionMode?.enumLabels).toContain('Ask Before Edits');
    const english = await form({ locale: 'pt' });
    expect(english.permissionMode?.title).toBe('Approvals');
  });

  it('never translates a branch name, also one equal to a catalog entry', async () => {
    HOST_CATALOGS.pt = { session: { branch: { enum: { main: 'principal' } } } };
    const properties = await form({ locale: 'pt' });
    // The one seed, the branch checked out, named as git names it.
    expect(properties.branch?.enumLabels).toEqual(['main']);
  });

  it('never translates the labels an answerer gives a plugin key', async () => {
    const tracker: Catalogs = { pt: { session: { ticket: { title: 'Chamado', enum: { open: 'Aberto' } } } } };
    const properties = await form({ locale: 'pt' }, {
      sessionConfig: { ticket: { type: 'string', title: 'Ticket', enumDynamic: true } },
      sessionConfigCompletions: { ticket: () => [{ value: 'open', label: 'open' }] },
      catalogs: { sessionConfig: { ticket: tracker } },
    });
    expect(properties.ticket?.title).toBe('Chamado');
    expect(properties.ticket?.enumLabels).toEqual(['open']);
  });

  it('translates a plugin key without an answerer from that plugin catalog, then the host one', async () => {
    HOST_CATALOGS.pt = { session: { lane: { description: 'Da via, pelo host' } } };
    const plugin: Catalogs = { pt: { session: { lane: { title: 'Via', enum: { fast: 'Rápida' } } } } };
    const properties = await form({ locale: 'pt' }, {
      sessionConfig: { lane: { type: 'string', title: 'Lane', description: 'Which lane', enum: ['fast', 'slow'], enumLabels: ['Fast', 'Slow'] } },
      catalogs: { sessionConfig: { lane: plugin } },
    });
    expect(properties.lane?.title).toBe('Via');
    expect(properties.lane?.description).toBe('Da via, pelo host');
    expect(properties.lane?.enumLabels).toEqual(['Rápida', 'Slow']);
  });
});

describe('the catalogs a fold keeps', () => {
  const CONTEXT: LoaderContext = {
    path: '/tmp/i18n', paths: ['/tmp/i18n'], version: '0.0.0', hostName: 'host', configDir: '/tmp/i18n', log: () => {}, say: () => {},
  };

  it('keeps each plugin catalogs by the key and the agent it registered', () => {
    const catalogs: Catalogs = { pt: { meta: { title: 'Eco' } } };
    const { host, contribution } = pluginHost('echoes', CONTEXT, { i18n: catalogs });
    host.registerAgent(echo({ path: '/tmp/i18n' }));
    host.registerSessionConfig('lane', { type: 'string', title: 'Lane' });
    const bare = pluginHost('bare', CONTEXT);
    bare.host.registerSessionConfig('speed', { type: 'string', title: 'Speed' });

    const { options } = foldHostOptions({ path: '/tmp/i18n', agents: [] }, [contribution, bare.contribution]);
    expect(options.catalogs).toEqual({ sessionConfig: { lane: catalogs }, agents: { echo: catalogs } });
  });
});
