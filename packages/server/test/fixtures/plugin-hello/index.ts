import type { Agent, PluginHost } from '@ahpd/sdk';

/**
 * A fixture plugin, and the whole of one.
 *
 * It exports its `apply` and contributes one backend and one tool, so the
 * loader has something real to fold: the agent is a complete `Agent` and the
 * tool is a complete `HostTool`, because the registration check would refuse
 * anything less and this fixture is also what proves the check accepts what
 * the contracts allow.
 */

export const name = 'hello';

const backend: Agent = {
  provider: 'hello',
  displayName: 'Hello',
  schema: () => ({ type: 'object', properties: {} }),
  defaults: () => ({}),
  create: () => { throw new Error('the hello fixture starts no session'); },
};

export function apply(host: PluginHost): void {
  host.registerAgent(backend);
  host.registerTool({
    definition: {
      name: 'hello_tool',
      description: 'Says hello.',
      inputSchema: { type: 'object', properties: {} },
    },
    run: () => 'hello',
  });
}
