import { reason } from '../utils/values.js';
import type { ChatPreamble, OpenedChat } from '../types/plugin.js';
import type { LogLevel } from '../log.js';

/**
 * The text the plugins give a new chat, or `undefined` when none gave any.
 *
 * Every preamble is asked at once, and the answers that are not empty are
 * joined with a blank line in plugin order. A preamble that throws is logged
 * and gives nothing, so one broken plugin never stops a chat opening.
 */
export async function preambleOf(
  preambles: readonly ChatPreamble[],
  opened: OpenedChat,
  log: (message: string, level?: LogLevel) => void,
): Promise<string | undefined> {
  const answers = await Promise.all(preambles.map(async (preamble) => {
    try {
      const text = await preamble(opened);
      return typeof text === 'string' ? text : undefined;
    }
    catch (error) {
      log(`a chat preamble for ${opened.chat} failed: ${reason(error)}`, 'error');
      return undefined;
    }
  }));
  const texts = answers.filter((text): text is string => text !== undefined && text !== '');
  return texts.length > 0 ? texts.join('\n\n') : undefined;
}

/** Two pieces of a first turn's hidden context, the preamble first. */
export const withPreamble = (preamble: string | undefined, context: string | undefined): string | undefined =>
  preamble === undefined ? context : context === undefined || context === '' ? preamble : `${preamble}\n\n${context}`;
