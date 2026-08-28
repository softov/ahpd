import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * Ask the harness what it can do, once, without a session.
 *
 * `resolveSessionConfig` is the call a composer makes **before** creating
 * anything - it is how a client learns which models and permission modes to
 * offer. Learning the models from a session's handshake is therefore always
 * one step too late: the picker is empty at exactly the moment somebody is
 * choosing.
 *
 * So the daemon pays for one short-lived CLI at startup. It is asked, over the
 * control protocol, what it offers - and closed again. No prompt is sent, no
 * transcript is written, and the subprocess does not outlive the question.
 */

type Bag = Record<string, unknown>;

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

export interface Offered {
  models: { id: string; name: string }[];
  /**
   * What a slash offers, before any session exists.
   *
   * `completions` is asked against a chat, but a person types a slash into an
   * empty composer before there is one - so the host keeps the harness-wide
   * list and a live session's own list overrides it.
   */
  commands: { name: string; description?: string; argumentHint?: string }[];
}

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
    const init = bag(await handle.initializationResult() as unknown);
    return {
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
    return { models: [], commands: [] };
  } finally {
    handle.close();
  }
}
