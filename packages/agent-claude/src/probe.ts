import { query } from '@anthropic-ai/claude-agent-sdk';
import { customizationsOf, EFFORT_DESCRIPTIONS, EFFORT_LABELS, EFFORTS, SDK_DEFAULT_MODEL_VALUE } from './session.js';
import { configDirOf, diskOf, managedDirOf } from './session/disk.js';
import type { Account, Offered } from '@ahpd/sdk';
import { bag, isRecord, str } from '@ahpd/sdk';

/**
 * Reads what the agent backend offers, once, without creating a session.
 *
 * Clients ask `resolveSessionConfig` before creating anything, so the models
 * and commands have to be known before any session exists. This starts one
 * short-lived agent process at startup, asks it over the control protocol,
 * and closes it. No prompt is sent and no transcript is written.
 */

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * How hard *this* model can be told to think, as its own config schema.
 *
 * Per model: the CLI reports a different `supportedEffortLevels` for each -
 * some take all five, some take one, and some take none - and a control lists
 * what its model has. A model that supports none gets no schema and a client
 * draws no control, which is the honest form of "this one does not think
 * harder on request".
 *
 * `thinkingLevel` is the key, because that is the one the reference client's
 * picker writes into `ModelSelection.config` for both of its providers, and
 * the property is VS Code's Claude schema for it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/claudeModelConfig.ts#L107-L126
 */
const thinkingFor = (efforts: string[]): { configSchema?: Record<string, unknown> } => {
  if (efforts.length === 0) return {};
  return {
    configSchema: {
      type: 'object',
      properties: {
        thinkingLevel: {
          type: 'string',
          title: 'Effort Level',
          description: 'Controls how much reasoning effort Claude uses.',
          enum: [...efforts],
          enumLabels: efforts.map((one) => EFFORT_LABELS[one as typeof EFFORTS[number]] ?? one),
          enumDescriptions: efforts.map((one) => EFFORT_DESCRIPTIONS[one as typeof EFFORTS[number]] ?? ''),
          ...(efforts.includes('high') ? { default: 'high' } : {}),
        },
      },
    },
  };
};

/**
 * The account the CLI is signed in as, as `Offered.account`.
 *
 * `initializationResult()` answers an `account` on every CLI, signed in or
 * not, so the state is read out of what the answer holds and not out of the
 * answer being there. A key is not an account, and neither is a provider that
 * hands out its own credentials - Bedrock, Vertex, a gateway - so both say
 * `unavailable` and neither names an email: a field beside those states would
 * be read as the account they say is not there. What is left is a CLI that
 * could have one, which is `signedIn` when it names an email and `signedOut`
 * when it names none.
 *
 * `observedAt` is the time of the probe, which is also the time of the boot
 * that ran it: this is read once, and a client drawing it wants to know how
 * old the answer is.
 */
const accountOf = (value: unknown, at: number): Account | undefined => {
  // A CLI that answered no account at all said nothing, which is not the same
  // as one answering that it has no sign-in.
  if (!isRecord(value)) return undefined;
  const key = str(value.apiKeySource);
  const provider = str(value.apiProvider);
  if ((key !== undefined && key !== 'none') || (provider !== undefined && provider !== 'firstParty')) {
    return { status: 'unavailable', observedAt: at };
  }
  const email = str(value.email);
  if (email === undefined) return { status: 'signedOut', observedAt: at };
  const plan = str(value.subscriptionType);
  return { status: 'signedIn', email, ...(plan === undefined ? {} : { planType: plan }), observedAt: at };
};

export async function probe(cwd: string): Promise<Offered> {
  // A prompt that never yields. The query needs one to exist; it does not need
  // one to answer what it can do.
  async function* silence(): AsyncGenerator<never> {
    await new Promise<void>(() => {});
    // eslint-disable-next-line no-unreachable
    return;
  }

  const handle = query({ prompt: silence(), options: { cwd, permissionMode: 'default' } } as Parameters<typeof query>[0]);
  const at = Date.now();
  try {
    const [init, mcp, skills, plugins] = await Promise.all([
      handle.initializationResult().then((answer) => bag(answer as unknown)),
      // Best effort beside the one that matters: a harness with no MCP servers
      // and one that will not say are the same empty list here, and neither is
      // worth failing the probe over.
      handle.mcpServerStatus().then((answer) => (Array.isArray(answer) ? answer : [])).catch(() => [] as unknown[]),
      handle.reloadSkills().then((answer) => list(bag(answer as unknown).skills)).catch(() => [] as unknown[]),
      // The plugins, which `initializationResult()` does not report. Only its
      // plugin list is used; it re-reads commands and agents too, and those
      // already came from the initialize answer above.
      handle.reloadPlugins().then((answer) => list(bag(answer as unknown).plugins)).catch(() => [] as unknown[]),
    ]);
    const styles = list(init.available_output_styles).filter((s): s is string => typeof s === 'string');
    const account = accountOf(init.account, at);
    return {
      // The personal scope only: a probe has no working directory.
      customizations: customizationsOf(init, mcp, skills, undefined, plugins, undefined, [], diskOf({ configDir: configDirOf(), managedDir: managedDirOf() })),
      ...(account === undefined ? {} : { account }),
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
        .filter((model) => model.id !== '' && model.id !== SDK_DEFAULT_MODEL_VALUE),
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
