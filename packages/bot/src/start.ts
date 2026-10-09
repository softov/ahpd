import type { BotRecord } from './record.js';
import type { SessionRequest } from '@ahpd/sdk';

/**
 * The session a bot is started in, as the request the host is asked for.
 *
 * A bot is talked to in its session, so everything the session is made of comes
 * off the record: whose it is, which backend runs it, where it works, what it
 * opens with, and what it is called.
 *
 * A preset names a whole harness of its own - the options it runs with and the
 * model it asks for - so a preset wins over `harness` and `model`, both of
 * which are a second answer to a question the preset has already answered.
 * With neither, the request names no provider and no model, and the host starts
 * its own default harness with its own default model.
 *
 * The folder is the bot's own, and it is the working directory whatever else
 * the record says: a bot's workspace is the one thing about it that never
 * moves. The instructions are the first turn, which is what a session with
 * nothing said in it is not - and a bot with none asks for a session that
 * opens silent, which is a bot somebody talks to first.
 *
 * A `computer` on the record goes in as the session's config, the way a client
 * names one: a machine that already exists, or a source the host makes one
 * from. Which of the two it is is the host's reading and not this file's.
 */
export function sessionFor(bot: BotRecord): SessionRequest {
  const provider = bot.preset ?? bot.harness;
  return {
    owner: bot.owner,
    ...(provider === undefined ? {} : { provider }),
    workingDirectory: bot.workspace,
    ...(bot.preset !== undefined || bot.model === undefined ? {} : { model: { id: bot.model } }),
    ...(bot.computer === undefined ? {} : { config: { computer: bot.computer } }),
    ...(bot.instructions === undefined ? {} : { prompt: bot.instructions }),
    title: bot.name,
  };
}
