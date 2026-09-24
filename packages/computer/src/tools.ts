import { randomUUID } from 'node:crypto';
import type { HostTool } from '@ahpd/sdk';
import type { ComputerRuntime } from './runtime.js';

/**
 * Making a machine, using one, and throwing it away.
 *
 * Tools rather than resource writes, because a write carries a URI and a mode
 * and can say neither what image nor what limits - decision
 * `a-machine-is-made-by-a-host-tool`. Each declares its `effects` so a backend
 * with a policy has something to ask a person on.
 */

/** What the tools were configured with. */
export interface ToolOptions {
  /** The image a machine is made from when the call names none. */
  image: string;
  cpus?: string;
  memory?: string;
  /** The label every machine this provider makes carries. */
  label: string;
  /** How many will exist at once. */
  max: number;
  /** The start of a generated name. */
  prefix: string;
}

const object = (value: unknown): Record<string, unknown> =>
  (typeof value === 'object' && value !== null ? value as Record<string, unknown> : {});

const said = (value: unknown): string | undefined =>
  (typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined);

export function computerTools(runtime: ComputerRuntime, options: ToolOptions): HostTool[] {
  /** The machine a call names, or a sentence saying there is none. */
  const find = async (id: string): Promise<{ said: string } | { machine: string }> => {
    const found = (await runtime.list()).find((one) => one.id === id);
    return found === undefined ? { said: `There is no computer called ${id}.` } : { machine: found.id };
  };

  return [
    {
      definition: {
        name: 'request_disposable_computer',
        description: 'Start a disposable computer and answer its computer:// URI. It runs until it is released.',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string', description: `What to make it from. Default ${options.image}.` },
            cpus: { type: 'string', description: 'CPU limit, for example 2. Default is this host\'s.' },
            memory: { type: 'string', description: 'Memory limit, for example 2g. Default is this host\'s.' },
            name: { type: 'string', description: 'A name for it. One is generated when this is left out.' },
          },
        },
      },
      // It writes to the machine and reaches the network to make it, and it is
      // not destructive: nothing that existed stopped existing.
      effects: { writes: true, network: true },
      advancedPermission: true,
      instruction: 'Ask for one when a task needs a machine of its own - something to install into, break, or run work in that should not touch this host. Release it when the work is done.',
      run: async (input) => {
        const asked = object(input);
        const held = await runtime.list();
        if (held.length >= options.max) {
          return `There are already ${held.length} computers, which is the most this host will have. Release one first: ${held.map((one) => `computer://${one.id}`).join(', ')}`;
        }
        const name = said(asked.name) ?? `${options.prefix}-${randomUUID().slice(0, 8)}`;
        if (held.some((one) => one.id === name)) {
          return `There is already a computer called ${name}.`;
        }
        const cpus = said(asked.cpus) ?? options.cpus;
        const memory = said(asked.memory) ?? options.memory;
        const made = await runtime.run({
          name,
          image: said(asked.image) ?? options.image,
          label: options.label,
          ...(cpus === undefined ? {} : { cpus }),
          ...(memory === undefined ? {} : { memory }),
        });
        return `computer://${made.id} is running on ${made.image}. Read computer://${made.id}/status for what it is, or run something in it with computer_exec.`;
      },
    },
    {
      definition: {
        name: 'release_computer',
        description: 'Stop a disposable computer and remove it. Nothing on it survives.',
        inputSchema: {
          type: 'object',
          properties: { id: { type: 'string', description: 'The name from its computer:// URI.' } },
          required: ['id'],
        },
      },
      effects: { destructive: true },
      advancedPermission: true,
      run: async (input) => {
        const id = said(object(input).id);
        if (id === undefined) return 'Which computer? Give the name from its computer:// URI.';
        const held = await find(id);
        if ('said' in held) return held.said;
        await runtime.stop(held.machine);
        await runtime.remove(held.machine);
        return `${held.machine} is gone.`;
      },
    },
    {
      definition: {
        name: 'computer_exec',
        description: 'Run a shell command inside a disposable computer and answer what it printed and what it exited with.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The name from its computer:// URI.' },
            command: { type: 'string', description: 'The command line to run, through `sh -lc` inside the machine.' },
          },
          required: ['id', 'command'],
        },
      },
      effects: { writes: true, network: true, destructive: true },
      advancedPermission: true,
      run: async (input) => {
        const asked = object(input);
        const id = said(asked.id);
        const command = said(asked.command);
        if (id === undefined) return 'Which computer? Give the name from its computer:// URI.';
        if (command === undefined) return 'What command? Give a command line to run inside it.';
        const held = await find(id);
        if ('said' in held) return held.said;
        const ran = await runtime.exec(held.machine, ['sh', '-lc', command]);
        // A command that failed is the tool working: the exit code is the
        // answer, and it is said rather than thrown.
        return ran.output === '' ? `exit ${ran.code}` : `${ran.output}\n\nexit ${ran.code}`;
      },
    },
  ];
}
