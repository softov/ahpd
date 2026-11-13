import type { HostTool } from '@ahpd/sdk';
import type { Wake } from './wake.js';

/**
 * The tool a back session answers its main chat with.
 *
 * A person says something to a bot in its main chat, and that message wakes a
 * back session as a turn (see `wake.ts`). The main turn stays open while the
 * work is done, and this is how the person is answered: the back session calls
 * `post_message` with what the person should be told, and the text is added to
 * the turn they are waiting on. A session may call it more than once, and the
 * main turn ends when the session's own turn ends.
 *
 * The main chat is found from the session the call was made in, which is the
 * one thing about a call a caller cannot choose - `at.session` - and never from
 * an input. So a back session posts into the chat that woke it and nowhere
 * else, and a session this wake never woke has nothing to post to.
 *
 * The end of the session's turn is what `plugin.ts` hears on `turn_end`, and a
 * turn with no post is answered as `mainTurnPostMessageAbsent` says; both roads
 * go through the wake, so one main turn is never ended twice.
 */
/**
 * What a back session is told about the person waiting on it.
 *
 * The bot's own rules are not here - they are its `AGENTS.md`, which its
 * harness reads - and this is the one thing about *this* session no file on
 * disk could say: somebody said something in the main chat, that turn is still
 * open, and `post_message` is what answers it. It is the tool's instruction,
 * so a session is told it exactly when it is offered the tool, a restart
 * included.
 *
 * `send_message` is named because it is the near miss. From inside a session it
 * looks like answering - it puts words where somebody will read them - but it
 * starts a turn somewhere else, and the person in the main chat is not reached
 * by it.
 *
 * The question tool is not named, because each harness names its own: the rule
 * is that a question is asked with the harness's tool, which is what task 06
 * shows in the main chat, and a harness with none asks in the text it posts.
 */
export const POST_INSTRUCTION = 'A person is waiting in the main chat for your reply to the message that woke this session. Only post_message answers them: each call adds its text to their reply, and the reply ends when your turn ends. When you need an answer from them before you can reply, ask with your question tool: it puts the question in the main chat and brings their answer back here. A harness with no question tool asks in the text it posts. send_message starts a turn in another session and does not reply to the person waiting, so do not use it to answer.';

export function postMessage(wake: Wake): HostTool {
  return {
    definition: {
      name: 'post_message',
      title: 'Post Message',
      description: 'Post to the main chat that woke this session. The text is added to the turn the person is waiting on, which ends when this session\'s turn ends.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'What to say in the main chat, in Markdown.' },
        },
        required: ['text'],
      },
      annotations: { title: 'Post Message', readOnlyHint: false, destructiveHint: false },
    },
    /*
     * Only a chat that asked for it has it.
     *
     * The tool means one thing: the Front that woke this chat is waiting on the
     * reply. A chat nobody is waiting on - anything but a bot's Back - has no
     * such Front, and offering the tool there would be offering a reply to
     * nowhere. The wake names it when it starts a Back chat, and the name is
     * kept with the chat, so a restart offers it again.
     */
    optIn: true,
    /*
     * The reply is the back session's own work, so nobody is asked to approve
     * it. A confirmation would ask the person to allow the answer they are
     * waiting on, and a deny list a session carries still refuses it.
     */
    confirm: false,
    instruction: POST_INSTRUCTION,
    /*
     * An answer for the model either way rather than a throw: posting into a
     * chat that is no longer waiting is a call the session can recover from -
     * it says what happened in its own reply - and not a failure of the tool.
     */
    run: (input, at) => {
      const asked = input['text'];
      const text = typeof asked === 'string' ? asked.trim() : '';
      if (text === '') return 'What should the reply say? Give post_message the text to post.';
      // The calling chat is the Back a Front turn waits on, or no chat at all:
      // a chat cannot name another chat's Front.
      if (!wake.posted(at.chat, text)) {
        return 'There is no main chat waiting on this chat, so there is nothing to post to.';
      }
      return 'Posted to the main chat.';
    },
  };
}
