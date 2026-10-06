/**
 * What a machine needs for pi to run in it.
 *
 * pi runs in an `ahpd` started inside the machine, from the `ahpd` part, which
 * carries this plugin. Its agent directory - settings, models, the sign-in and
 * the sessions - is `PI_CODING_AGENT_DIR`, pointed at `/ahpd/pi` in the
 * machine: a state volume seeded with this host's settings and models, or this
 * host's own directory mounted for a profile that keeps state on the host.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MachineNeed } from '@ahpd/sdk';

/** Where pi's agent directory is inside a machine. */
export const PI_MACHINE_DIR = '/ahpd/pi';

/**
 * The provider key variables pi reads from its environment, by its own
 * provider list (`getApiKeyEnvVars` in `@earendil-works/pi-ai`).
 *
 * A variable a person's pi settings name beyond these is not here: a profile
 * adds it as a need of its own.
 */
export const PI_KEY_VARIABLES: readonly string[] = [
  'AI_GATEWAY_API_KEY',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_OAUTH_TOKEN',
  'ANT_LING_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'BASETEN_API_KEY',
  'CEREBRAS_API_KEY',
  'CLOUDFLARE_API_KEY',
  'COPILOT_GITHUB_TOKEN',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_CLOUD_API_KEY',
  'GROQ_API_KEY',
  'HF_TOKEN',
  'KIMI_API_KEY',
  'META_API_KEY',
  'MINIMAX_API_KEY',
  'MINIMAX_CN_API_KEY',
  'MISTRAL_API_KEY',
  'MOONSHOT_API_KEY',
  'NVIDIA_API_KEY',
  'OPENAI_API_KEY',
  'OPENCODE_API_KEY',
  'OPENROUTER_API_KEY',
  'QWEN_TOKEN_PLAN_API_KEY',
  'QWEN_TOKEN_PLAN_CN_API_KEY',
  'RADIUS_API_KEY',
  'TOGETHER_API_KEY',
  'XAI_API_KEY',
  'XIAOMI_API_KEY',
  'XIAOMI_TOKEN_PLAN_AMS_API_KEY',
  'XIAOMI_TOKEN_PLAN_CN_API_KEY',
  'XIAOMI_TOKEN_PLAN_SGP_API_KEY',
  'ZAI_API_KEY',
  'ZAI_CODING_CN_API_KEY',
];

/** pi's agent directory on this host: `PI_CODING_AGENT_DIR` when the daemon has it, else `~/.pi/agent`. */
export const hostAgentDir = (): string => process.env.PI_CODING_AGENT_DIR ?? join(homedir(), '.pi', 'agent');

/**
 * The needs, read when asked, so the daemon's `PI_CODING_AGENT_DIR` and `HOME`
 * at that moment are the ones followed.
 *
 * Each key variable is a need named `<provider>.<VARIABLE>` with no default:
 * its value is the profile's or the computer plugin's, a `{ "$secret" }` among
 * them, and a key nobody gave is left out of the machine. `auth.json` is never
 * seeded, so a sign-in on this host does not reach a machine.
 */
export const piMachine = (provider: string): Record<string, MachineNeed> => {
  const dir = hostAgentDir();
  return {
    ahpdPart: {
      part: 'ahpd',
      required: true,
      description: 'ahpd with its plugins, which the nested host pi runs in is started from.',
    },
    piState: {
      state: PI_MACHINE_DIR,
      seed: [{ source: join(dir, 'settings.json') }, { source: join(dir, 'models.json') }],
      description: "pi's agent directory, kept in a volume and seeded with this host's settings and models.",
    },
    piAgentDirectory: {
      directory: dir,
      target: PI_MACHINE_DIR,
      required: true,
      when: 'host',
      description: "This host's pi agent directory, sign-in and sessions included.",
    },
    piAgentDir: {
      name: 'PI_CODING_AGENT_DIR',
      default: PI_MACHINE_DIR,
      description: "Where pi keeps its agent directory inside the machine.",
    },
    ...Object.fromEntries(PI_KEY_VARIABLES.map((variable): [string, MachineNeed] => [
      `${provider}.${variable}`,
      { name: variable, description: `${variable} for ${provider}, when a profile gives it.` },
    ])),
  };
};
