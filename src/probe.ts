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

/**
 * How hard *this* model can be told to think, as its own config schema.
 *
 * Per model and not per session, which is the whole point: the CLI reports a
 * different `supportedEffortLevels` for each - some take all five, some take
 * one, and some take none - so a single session-wide effort control offers
 * levels the chosen model may not have, and accepts one it will then ignore.
 * A model that supports none gets no schema and a client draws no control,
 * which is the honest form of "this one does not think harder on request".
 *
 * `thinkingLevel` is the key, because that is the one the reference client's
 * picker writes into `ModelSelection.config` for both of its providers.
 */
const thinkingFor = (efforts: string[]): { configSchema?: Record<string, unknown> } => {
  if (efforts.length === 0) return {};
  const said: Record<string, string> = {
    low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Maximum',
  };
  return {
    configSchema: {
      type: 'object',
      properties: {
        thinkingLevel: {
          type: 'string',
          title: 'Thinking Level',
          description: 'Controls how much reasoning effort Claude uses.',
          enum: [...efforts],
          enumLabels: efforts.map((one) => said[one] ?? one),
          ...(efforts.includes('high') ? { default: 'high' } : {}),
        },
      },
    },
  };
};

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
    const [init, mcp, skills] = await Promise.all([
      handle.initializationResult().then((answer) => bag(answer as unknown)),
      // Best effort beside the one that matters: a harness with no MCP servers
      // and one that will not say are the same empty list here, and neither is
      // worth failing the probe over.
      handle.mcpServerStatus().then((answer) => (Array.isArray(answer) ? answer : [])).catch(() => [] as unknown[]),
      handle.reloadSkills().then((answer) => list(bag(answer as unknown).skills)).catch(() => [] as unknown[]),
    ]);
    const styles = list(init.available_output_styles).filter((s): s is string => typeof s === 'string');
    return {
      customizations: customizationsOf(init, mcp, skills),
      // Only when the harness has them. An empty list would draw a picker
      // with nothing in it, which is worse than no control.
      ...(styles.length > 0 ? { outputStyles: styles } : {}),
      ...(str(init.output_style) ? { outputStyle: str(init.output_style) as string } : {}),
      models: list(init.models)
        // `value`, not `id`.
        .map((raw) => {
          const model = bag(raw);
          return {
            id: str(model.value) ?? '',
            name: str(model.displayName) ?? str(model.value) ?? '',
            ...thinkingFor(list(model.supportedEffortLevels).filter((one): one is string => typeof one === 'string')),
          };
        })
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
