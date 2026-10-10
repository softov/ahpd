/** The prompts that ask for a commit message or a pull request's words, and the split of an answer. */

/*
 * What a model or an agent is asked, and what is done with what it says.
 *
 * The two prompts are the reference host's, `agentHostPullRequestOperationHandler.ts`
 * at `7516b04bc94` for the pull request and `agentHostCommitOperationHandler.ts`
 * for the commit: the branch, the base, the changed files, the diff and what
 * the session has said, and an answer of a title under 72 characters, a blank
 * line, and a markdown body.
 *
 * Here rather than in `changes.ts` because none of it is git's: what changed is
 * read there and handed in, and the words are this file's whole business.
 */

/** The most characters a title may run to, which the prompt asks for and the split enforces. */
export const TITLE_MOST = 72;

/**
 * The most characters of a diff a prompt carries.
 *
 * A model's window is not a repository, and a commit of a minified bundle
 * would otherwise be a prompt nothing can read. The cut is said in the prompt
 * rather than left to look like the end of the diff.
 */
export const DIFF_MOST = 20_000;

/** What a prompt is built from. Every part is optional, and what is missing is left out. */
export interface PromptInput {
  /** The branch the words are about. */
  branch?: string;
  /** The branch the work goes to, for a pull request. */
  base?: string;
  /** The paths that changed, one per line. */
  files?: string[];
  /** The diff itself, already cut by the caller. */
  diff?: string;
  /** What has been said in the session the work was done in. */
  conversation?: string;
}

/** One labelled block of a prompt, left out whole when there is nothing to say. */
const block = (label: string, body: string | undefined): string =>
  body === undefined || body.trim() === '' ? '' : `${label}:\n${body.trim()}\n\n`;

/** What a commit message is asked for. */
export const commitPrompt = (what: PromptInput): string =>
  'Write a commit message for the changes below.\n\n'
  + block('Changed files', what.files?.join('\n'))
  + block('Diff', what.diff)
  + block('What was said about this work', what.conversation)
  + 'Answer with a subject line of at most 72 characters, a blank line, and then a markdown body.\n'
  + 'Answer with the message and nothing else: no explanation, no code fence, no quotes.';

/** What a pull request's title and description are asked for. */
export const pullRequestPrompt = (what: PromptInput): string =>
  'Write the title and description of a pull request for the work below.\n\n'
  + block('Branch', what.branch)
  + block('Base branch', what.base)
  + block('Changed files', what.files?.join('\n'))
  + block('Diff', what.diff)
  + block('What was said about this work', what.conversation)
  + 'Answer with a title of at most 72 characters, a blank line, and then a markdown description.\n'
  + 'Answer with the title and description and nothing else: no explanation, no code fence, no quotes.';

/**
 * What an answer holds, or nothing when it holds no title.
 *
 * The title is the first line and the description is what follows the first
 * blank line, which is the shape both prompts ask for. A title keeps its words
 * and loses the decoration a model reaches for anyway - a leading `#`, a pair
 * of quotes, a code span - and is cut at 72 characters rather than refused,
 * because a long title is a title.
 */
export const splitWords = (answer: string): { title: string; description: string } | undefined => {
  const text = answer.trim();
  if (text === '') return undefined;
  const blank = /\r?\n[ \t]*\r?\n/.exec(text);
  const head = (blank === null ? text : text.slice(0, blank.index)).split('\n')[0] ?? '';
  const title = head
    .replace(/^#+\s*/, '')
    .replace(/^[`"']+/, '')
    .replace(/[`"']+$/, '')
    .trim()
    .slice(0, TITLE_MOST)
    .trim();
  if (title === '') return undefined;
  const rest = blank === null ? '' : text.slice(blank.index + blank[0].length).trim();
  return { title, description: rest };
};

/**
 * A diff and the paths it touches, as a prompt carries them.
 *
 * The cut is made here rather than by the caller so both prompts and both
 * operations agree on how much of a diff is worth sending, and the sentence
 * says the diff was cut rather than ending in the middle of a hunk with
 * nothing to explain it.
 */
export const cutDiff = (diff: string, most = DIFF_MOST): string =>
  diff.length <= most ? diff : `${diff.slice(0, most)}\n... the diff was cut here.`;
