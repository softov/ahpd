import { query } from '@anthropic-ai/claude-agent-sdk';
import { customizationsOf } from './session.js';
import type { Bag } from './types/common.js';
import type { Offered } from './types/probe.js';

/**
 * Reads what the agent backend offers, once, without creating a session.
 *
 * Clients ask `resolveSessionConfig` before creating anything, so the models
 * and commands have to be known before any session exists. This starts one
 * short-lived agent process at startup, asks it over the control protocol,
 * and closes it. No prompt is sent and no transcript is written.
 */

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export async function probe(cwd: string): Promise<Offered> {
  // A prompt that never yields. The query needs one to exist; it does not need
  // one to answer what it can do.
  async function* silence(): AsyncGenerator<never> {
    await new Promise<void>(() => {});
    // eslint-disable-next-line no-unreachable
    return;
  }

  const handle = query({ prompt: silence(), options: { cwd } } as Parameters<typeof query>[0]);
  try {
    const [init, mcp] = await Promise.all([
      handle.initializationResult().then((answer) => bag(answer as unknown)),
      // Best effort beside the one that matters: a harness with no MCP servers
      // and one that will not say are the same empty list here, and neither is
      // worth failing the probe over.
      handle.mcpServerStatus().then((answer) => (Array.isArray(answer) ? answer : [])).catch(() => [] as unknown[]),
    ]);
    return {
      customizations: customizationsOf(init, mcp),
      models: list(init.models)
        // `value`, not `id`.
        .map((raw) => ({
          id: str(bag(raw).value) ?? '',
          name: str(bag(raw).displayName) ?? str(bag(raw).value) ?? '',
        }))
        .filter((model) => model.id !== ''),
      commands: list(init.commands)
        .map((raw) => {
          const command = bag(raw);
          return {
            name: str(command.name) ?? '',
            ...(str(command.description) ? { description: str(command.description) as string } : {}),
            ...(str(command.argumentHint) ? { argumentHint: str(command.argumentHint) as string } : {}),
          };
        })
        .filter((command) => command.name !== ''),
    };
  } catch {
    // A harness that will not answer offers nothing, which is a real answer.
    return { models: [], commands: [], customizations: [] };
  } finally {
    handle.close();
  }
}
