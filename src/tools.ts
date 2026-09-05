import type { HostTool } from './types/host.js';

/**
 * The tools this package contributes to every session, as a host's `tools`.
 *
 * The protocol's `serverTools` are the *host's* own - not a backend's and not
 * a client's - and what makes one worth contributing is that the host knows
 * something the agent inside a session cannot: the other sessions running
 * beside it, and the terminals the person is watching. Both are read-only.
 *
 * ```ts
 * createHost({ path, agents, tools: hostTools() });
 * ```
 *
 * A host that wants its own passes its own; a host that passes none
 * contributes none, and its sessions report no `serverTools` at all.
 */
export const hostTools = (): HostTool[] => [
  {
    definition: {
      name: 'ahp_sessions',
      title: 'Sessions on this host',
      description: 'The other agent sessions running on this host, with the directories each works in. '
        + 'Use it before touching a file to find out whether another agent is already working there.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Sessions on this host', readOnlyHint: true, openWorldHint: false },
    },
    run: (_input, at) => {
      const others = at.sessions().filter((one) => one.uri !== at.session);
      if (others.length === 0) return 'No other session is running on this host.';
      return others
        .map((one) => `${one.uri}\t${one.provider}\t${one.title}\t${one.workingDirectories.join(' ')}`)
        .join('\n');
    },
  },
  {
    definition: {
      name: 'ahp_terminals',
      title: 'Terminals on this host',
      description: 'The terminals this host has open, with what each is running and where. '
        + 'These are the terminals the person can see, which is not the same as a shell run from a tool.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { title: 'Terminals on this host', readOnlyHint: true, openWorldHint: false },
    },
    run: (_input, at) => {
      const open = at.terminals();
      if (open.length === 0) return 'This host has no terminal open.';
      return open
        .map((one) => `${one.uri}\t${one.title}\t${one.cwd}\t${one.running ? 'running' : 'exited'}`)
        .join('\n');
    },
  },
];
