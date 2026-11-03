import type { AskedQuestion, HostTool } from '../types/host.js';

/*
 * The person's answers, asked by the model.
 *
 * The input is cofold's `ask_user` schema, written here in this host's own
 * code: up to four questions, each with an id the answer is keyed by, the
 * words of the question, a short header, the choices it offers, and whether
 * more than one may be picked. A question with no options is free text.
 *
 * The answer is the tool's result, and a question the person declined or
 * cancelled is a result too: the model has to know that nobody answered,
 * rather than see a tool that failed.
 */

/** One question, as the model writes it. */
interface AskUserQuestion {
  /** The key of the answer, unique within one call. */
  id: string;
  /** The question itself. */
  question: string;
  /** A short label a client shows as a chip. */
  header?: string;
  /** The choices offered, when the question has any. */
  options?: { label: string; description?: string }[];
  /** The answer is a list of option labels. Only with `options`. */
  multiSelect?: boolean;
  /** Free text is accepted even when options are given. Default true. */
  allowOther?: boolean;
}

/** One question's shape, which is the same on every call. */
const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$', description: 'Key of the answer; unique within this call.' },
    question: { type: 'string', minLength: 1 },
    header: { type: 'string', maxLength: 12, description: 'Short label a UI shows as a chip.' },
    options: {
      type: 'array',
      minItems: 2,
      maxItems: 8,
      items: {
        type: 'object',
        properties: { label: { type: 'string', minLength: 1 }, description: { type: 'string' } },
        required: ['label'],
        additionalProperties: false,
      },
    },
    multiSelect: { type: 'boolean', description: 'The answer is a list of option labels. Only with options.' },
    allowOther: { type: 'boolean', description: 'Free text accepted even when options are given. Default true.' },
  },
  required: ['id', 'question'],
  additionalProperties: false,
};

/** The answer as the model reads it: one line for each question. */
const rendered = (questions: AskUserQuestion[], answers: Record<string, string | string[]>): string =>
  questions.map((one) => {
    const said = answers[one.id];
    return `${one.question} (${one.id}): ${Array.isArray(said) ? said.join(', ') : said ?? ''}`;
  }).join('\n');

/**
 * The tool a model asks the person with.
 *
 * `ask` settles it: the request goes on the chat the tool was called from and
 * the tool waits, so the model is stopped until somebody answers. A turn that
 * ends takes the wait with it.
 */
export const askUserTool = (): HostTool => ({
  definition: {
    name: 'ask_user',
    title: 'Ask the person',
    description: 'Ask the user one or more questions and wait for the answers. '
      + 'Use options for choices; leave options out for free text.',
    inputSchema: {
      type: 'object',
      properties: {
        questions: { type: 'array', minItems: 1, maxItems: 4, items: QUESTION_SCHEMA },
      },
      required: ['questions'],
    },
  },
  run: async (input, at) => {
    const questions = input.questions as AskUserQuestion[] | undefined;
    if (!Array.isArray(questions) || questions.length === 0) throw new Error('ask_user needs at least one question');
    const ids = new Set<string>();
    for (const one of questions) {
      if (ids.has(one.id)) throw new Error(`duplicate question id "${one.id}"`);
      ids.add(one.id);
      if (one.multiSelect === true && one.options === undefined) {
        throw new Error(`question "${one.id}": multiSelect needs options`);
      }
    }

    const answer = await at.ask(questions as AskedQuestion[]);
    if (answer.response === 'decline') return 'The person declined to answer.';
    if (answer.response === 'cancel') return 'The person cancelled the question.';
    return rendered(questions, answer.answers);
  },
});
