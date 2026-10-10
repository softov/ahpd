import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitChanges } from '../src/changes.js';
import { TITLE_MOST, commitPrompt, cutDiff, pullRequestPrompt, splitWords } from '../src/changewords.js';
import { createHost, ROOT } from '../src/host.js';
import { fileResources } from '../src/resources.js';
import { shellTerminals } from '../src/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { NewPullRequest, PullRequests } from '../src/types/github.js';
import type { HostOptions } from '../src/types/host.js';
import type { Peer } from '../src/types/rpc.js';
import type { Session } from '../src/types/session.js';

/*
 * Where a commit message and a pull request's words come from when the person
 * gives none.
 *
 * Two halves. The prompts and the split of an answer are string work with no
 * host in it, and are read as such. The two modes that ask are driven through a
 * real host over a real repository, because the ask is built in
 * `operationContext` and handed to the source - a test that called `wordsFor`
 * with an ask of its own would be testing the one part that is already in the
 * open, and would not prove that a commit ever reaches it.
 */

let made: string[] = [];
afterEach(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made = [];
});

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe' }).toString().trim();

/** A repository on `main` with one committed file. */
const repository = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-words-'));
  made.push(dir);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  return dir;
};

/**
 * A repository with a bare `origin` beside it, which a pull request needs.
 *
 * The one above has nobody to push to, which is all a commit wants and not
 * enough for a request: `create-pr` pushes the branch before it opens one.
 * Same shape as the clone `pullrequest.test.ts` builds, and for the same
 * reason - the only honest test of an operation that is git is a repository.
 */
const wired = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-words-'));
  made.push(root);
  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  const dir = join(root, 'work');
  execFileSync('git', ['clone', '-q', origin, dir], { stdio: 'pipe' });
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(dir, 'tracked.txt'), 'one\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'first');
  git(dir, 'push', '-q', '-u', 'origin', 'main');
  git(dir, 'remote', 'set-head', 'origin', 'main');
  return dir;
};

/** GitHub, as far as a pull request needs it: what it was opened with. */
const github = () => {
  const opened: NewPullRequest[] = [];
  const port: PullRequests = {
    resource: { resource: 'https://api.github.com/repos' },
    forBranch: async () => [],
    create: async (_repo, wanted) => {
      opened.push(wanted);
      return { url: `https://github.com/softov/ahpd/pull/${opened.length}`, state: 'open' };
    },
  };
  return { opened, port };
};

/**
 * What the host is told about a directory, which is what offers `create-pr`.
 *
 * `operationContext` builds the `github` half of the context out of these two
 * names, and offers no request operation without them. It is the host's own
 * reading of a directory that the daemon wires in; here it is fixed, because
 * what is under test is where a request's words come from.
 */
const onGitHub = () => ({
  meta: () => ({ git: { branchName: 'main', hasGitHubRemote: true, githubOwner: 'softov', githubRepo: 'ahpd' } }),
  refresh: async () => false,
});

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/**
 * Whether a turn is one asked for the words, rather than something a person said.
 *
 * The two prompts open differently - a commit message is asked for, and a pull
 * request's title and description are - so a test that matched one of them
 * would count one ask where a pull request makes two.
 */
const askedForWords = (text: string): boolean =>
  text.startsWith('Write a commit message') || text.startsWith('Write the title and description');

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/**
 * Every action this client was sent, whichever channel it came on.
 *
 * Whatever channel, because a session this host holds under one name and a
 * client asked about under another is answered under the client's - and a test
 * that named a channel would be testing the spelling rather than the action.
 */
const actions = (p: ReturnType<typeof peer>): Record<string, unknown>[] => p.notes
  .filter((one) => one.method === 'action')
  .map((one) => (one.params as { action: Record<string, unknown> }).action);

/**
 * A backend that answers with the words the test chose, and keeps what it was asked.
 *
 * The example backend says back what it was told, which is a fine answer for a
 * chat and no answer at all for a test that needs a known title. So the turn is
 * a real one - the host reads a model's answer off the turn it ran - and its
 * one part is replaced with what this backend was built to say. `undefined` is
 * a turn that ended having said nothing, which is the other half of what a
 * fallback is for.
 *
 * `asked` is every turn this backend was given and the chat it arrived in,
 * which is how a side chat is told from the session's own.
 *
 * The directory is the example backend's own, because that is the one it
 * reports a session as working in - and a session's directory is what a
 * changeset is about.
 */
const backing = (dir: string, answer: string | undefined, over: Partial<Agent> = {}) => {
  const base = echo({ path: dir, pace: 0 });
  const asked: { chat: string; text: string }[] = [];
  const agent: Agent = {
    ...base,
    provider: 'voice',
    // One model, so a `model` mode naming it has a list to be checked against.
    probe: async () => ({ models: [{ id: 'fast', name: 'Fast' }], commands: [], customizations: [] }),
    create: (start) => {
      const chat = base.create(start);
      const said: Session = {
        ...chat,
        begin: (turnId, text, model, from) => {
          chat.begin(turnId, text, model, from);
          asked.push({ chat: start.chatUri, text });
          const newest = chat.allTurns().at(-1);
          if (newest !== undefined) {
            newest.responseParts = answer === undefined
              ? []
              : [{ id: `${turnId}:0`, kind: 'markdown', content: answer }];
          }
        },
      };
      return said;
    },
    ...over,
  };
  return { agent, asked };
};

/**
 * A backend that takes the turn asked for the words and never finishes it.
 *
 * The example backend answers as soon as it is called, which is what every
 * other test here wants and exactly what this one does not: the host has a
 * limit on waiting for the words, and a backend that always answers never
 * reaches it. So the turn for the words is recorded and left running - no
 * `chat/turnStarted`, no `chat/turnComplete`, no answer to read - while every
 * other turn, the person's own among them, runs as it always did.
 *
 * `stopped` is every turn the host cancelled, which is what the limit is
 * supposed to do rather than merely stop waiting.
 */
const stuck = (dir: string, over: Partial<Agent> = {}) => {
  const base = echo({ path: dir, pace: 0 });
  const asked: { chat: string; text: string }[] = [];
  const stopped: string[] = [];
  const agent: Agent = {
    ...base,
    provider: 'voice',
    probe: async () => ({ models: [{ id: 'fast', name: 'Fast' }], commands: [], customizations: [] }),
    create: (start) => {
      const chat = base.create(start);
      return {
        ...chat,
        begin: (turnId, text, model, from) => {
          asked.push({ chat: start.chatUri, text });
          if (askedForWords(text)) return;
          chat.begin(turnId, text, model, from);
        },
        cancel: (turnId) => {
          stopped.push(turnId);
          chat.cancel(turnId);
        },
      };
    },
    ...over,
  };
  return { agent, asked, stopped };
};

/**
 * One client on one session in a fresh repository, ready to be committed.
 *
 * The session's own chat is subscribed and the changeset too, so the whole of
 * what a client sees is read from here: a turn is sent the way a client sends
 * one, and the commit is invoked the way a client invokes one. Both matter -
 * agent mode asks a side chat made from the session's newest turn, and the
 * commit is what carries the ask to the source.
 */
const studio = async (dir: string, agent: Agent, over: Partial<HostOptions> = {}) => {
  const host = createHost({
    path: dir, agents: [agent], resources: fileResources(), terminals: shellTerminals(), changes: gitChanges(),
    ...over,
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  const uri = 'ahp-session:/words';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: agent.provider } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chat = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  const changeset = `${uri}/changeset/uncommitted`;
  await client.handle({ method: 'subscribe', params: { channel: changeset } });
  await settle();

  /** Where the words come from, pushed the way a client pushes it. */
  const config = async (changeWords: Record<string, unknown>): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { changeWords } } },
    });
    await settle();
  };
  /** A turn of the session's own chat, which is what gives the session a title. */
  const say = async (text: string): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId: crypto.randomUUID(), message: { text } } },
    });
    await settle();
  };
  /** The form's own contents, pushed the way a client pushes them. */
  const run = async (operationId: string, meta?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const said = await client.handle({
      method: 'invokeChangesetOperation',
      params: { channel: changeset, operationId, ...(meta === undefined ? {} : { _meta: meta }) },
    }) as Record<string, unknown>;
    await settle();
    return said;
  };
  const commit = async (): Promise<string> => String((await run('commit')).message ?? '');
  return { dir, client, p, uri, chat, changeset, config, say, run, commit };
};

describe('the words an answer holds', () => {
  it('splits an answer at its first blank line, and cuts the title at 72 characters', () => {
    expect(splitWords('Fix the build\n\nIt was flaky.')).toEqual({ title: 'Fix the build', description: 'It was flaky.' });
    // A title alone is a whole answer: a commit under one has no body, which is
    // the shape the session title has always had.
    expect(splitWords('Fix the build')).toEqual({ title: 'Fix the build', description: '' });
    // Cut rather than refused, because a long title is still a title.
    expect(splitWords('x'.repeat(TITLE_MOST + 40))?.title).toHaveLength(TITLE_MOST);
  });

  it('loses the decoration a model reaches for anyway', () => {
    expect(splitWords('# Fix the build\n\nBecause.')).toEqual({ title: 'Fix the build', description: 'Because.' });
    expect(splitWords('"Fix the build"')?.title).toBe('Fix the build');
    expect(splitWords('`Fix the build`')?.title).toBe('Fix the build');
    expect(splitWords('  Fix the build  ')?.title).toBe('Fix the build');
  });

  it('is no words at all when an answer holds no title', () => {
    expect(splitWords('')).toBeUndefined();
    expect(splitWords('   \n\n  ')).toBeUndefined();
    // Decoration and nothing else, which is what a model that answered inside
    // a code fence says on its first line.
    expect(splitWords('#\n\nFix the build')).toBeUndefined();
  });
});

describe('the prompt a model is asked', () => {
  const what = {
    branch: 'work', base: 'main', files: ['a.txt', 'b.txt'], diff: '--- a\n+++ b', conversation: '> name it\n\n-sure',
  };

  it('carries what changed and what was said, and asks for a title and a body', () => {
    const asked = commitPrompt(what);
    expect(asked).toContain('a.txt');
    expect(asked).toContain('+++ b');
    expect(asked).toContain('> name it');
    expect(asked).toContain('subject line of at most 72 characters, a blank line, and then a markdown body');
  });

  it('carries the branch and the base for a pull request, which a commit has no use for', () => {
    const asked = pullRequestPrompt(what);
    expect(asked).toContain('Branch:\nwork');
    expect(asked).toContain('Base branch:\nmain');
    expect(asked).toContain('title of at most 72 characters, a blank line, and then a markdown description');
    expect(commitPrompt(what)).not.toContain('Base branch:');
  });

  it('leaves a block out whole when there is nothing to put in it', () => {
    const bare = commitPrompt({});
    for (const label of ['Changed files:', 'Diff:', 'What was said about this work:', 'Branch:']) {
      expect(bare).not.toContain(label);
    }
    // The two sentences that ask for the shape are not a block, and are asked
    // whoever is being written to.
    expect(bare).toContain('Write a commit message for the changes below.');
  });

  it('says a diff was cut rather than ending in the middle of one', () => {
    expect(cutDiff('short', 100)).toBe('short');
    expect(cutDiff('x'.repeat(20), 10)).toBe(`${'x'.repeat(10)}\n... the diff was cut here.`);
  });
});

describe('a model writes the words', () => {
  it('commits under what the named model answered, on a session it then lets go of', async () => {
    const dir = repository();
    const { agent, asked } = backing(dir, 'Fix the flaky kqueue build\n\nIt raced the poller.');
    const { p, chat, config, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await config({ mode: 'model', provider: 'voice', model: 'fast' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(git(dir, 'log', '-1', '--format=%b')).toBe('It raced the poller.');
    // Nothing fell back, so the operation says nothing about a mode.
    expect(message).toBe(`Committed ${git(dir, 'rev-parse', '--short', 'HEAD')}: Fix the flaky kqueue build`);

    // One turn, in a chat of the model's own: the session's chat was never
    // asked, which is what "the main conversation does not change" means.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.chat).not.toBe(chat);
    // And what it was asked is the prompt over what changed.
    expect(asked[0]?.text).toContain('Write a commit message for the changes below.');
    expect(asked[0]?.text).toContain('tracked.txt');

    // The session it was asked on is gone, so nothing of it is left behind.
    const gone = p.notes.filter((one) => one.method === 'root/sessionRemoved')
      .map((one) => (one.params as { session?: string }).session);
    expect(gone).toHaveLength(1);
    expect(gone[0]).not.toBe('voice:/words');
  });

  it('falls back to the session title when the model says nothing, and says so', async () => {
    const dir = repository();
    const { agent } = backing(dir, undefined);
    const { config, say, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'model', provider: 'voice', model: 'fast' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).toContain(' - the model did not answer, so the session title was used');
  });

  it('falls back to the session title when the model cannot be asked at all, and says so', async () => {
    const dir = repository();
    const { agent } = backing(dir, 'never read');
    /*
     * A harness that is gone: the session under test starts and the throwaway
     * one does not. The host opens the throwaway in the changeset's own
     * directory and hands the client's session no directory at all, which is
     * what tells the two apart.
     */
    const plain = agent.create;
    agent.create = (start) => {
      if (start.workingDirectory !== undefined) throw new Error('no harness here');
      return plain(start);
    };
    const { config, say, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'model', provider: 'voice', model: 'fast' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).toContain(' - the model did not answer, so the session title was used');
  });

  it('falls back to the session title when the mode names no model to ask, and says so', async () => {
    const dir = repository();
    const { agent } = backing(dir, 'never read');
    const { config, say, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    // The mode alone, which the push takes: a client that sets the mode in one
    // push and the name in the next is not refused for the gap between them.
    await config({ mode: 'model' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).toContain(' - the setting names no provider and model, so the session title was used');
  });
});

describe('the session\'s agent writes the words', () => {
  it('asks a side chat of the session, and the side chat stays', async () => {
    const dir = repository();
    const { agent, asked } = backing(dir, 'Name it well\n\nThe agent said so.', { chats: { sideChat: true } });
    const { p, config, say, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'agent' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Name it well');
    expect(git(dir, 'log', '-1', '--format=%b')).toBe('The agent said so.');
    expect(message).not.toContain('session title was used');

    // The session's own chat was asked once, and that was the person's turn -
    // the words were written in a chat of their own, by a prompt nobody typed.
    const mine = asked.filter((one) => one.text === 'Fix the flaky kqueue build');
    const written = asked.filter((one) => one.text.startsWith('Write a commit message'));
    expect(mine).toHaveLength(1);
    expect(written).toHaveLength(1);
    expect(written[0]?.chat).not.toBe(mine[0]?.chat);

    // And it stays - host/76's *Decisions locked in*, "The side chat stays in
    // the session after it answers" - so a client is told the session has one
    // more chat, and it is the one that answered.
    const added = actions(p).filter((one) => one.type === 'session/chatAdded');
    expect(added).toHaveLength(1);
    expect((added[0]?.summary as { resource?: string }).resource).toBe(written[0]?.chat);
  });

  it('falls back to the session title when the agent has no side chat, and says so', async () => {
    const dir = repository();
    const { agent, asked } = backing(dir, 'never read');
    const { p, config, say, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'agent' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).toContain(' - voice cannot start a side chat, so the session title was used');
    // The person's own turn, and no other chat opened anywhere.
    expect(asked).toHaveLength(1);
    expect(actions(p).filter((one) => one.type === 'session/chatAdded')).toEqual([]);
  });

  it('falls back to the session title when the session has said nothing yet, and says so', async () => {
    const dir = repository();
    const { agent } = backing(dir, 'never read', { chats: { sideChat: true } });
    const { config, commit } = await studio(dir, agent);
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await config({ mode: 'agent' });
    const message = await commit();

    // No turn, so no title either: the commit keeps the line it always kept.
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Echo session');
    expect(message).toContain(' - the session has no turn to ask from, so the session title was used');
  });
});

/*
 * The limit on waiting for the words.
 *
 * `changeWordsTimeoutMs` is pushed small, because the default is two minutes
 * and a test that waited for it would be a test nobody runs. What is being
 * tested is the limit and not its size: the same code runs at any value, and
 * the two minutes themselves are a number in one place.
 */
describe('a turn that never ends', () => {
  it('stops a model that has not answered in time, and commits under the session title', async () => {
    const dir = repository();
    const { agent, asked, stopped } = stuck(dir);
    const { p, config, say, commit } = await studio(dir, agent, { changeWordsTimeoutMs: 50 });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'model', provider: 'voice', model: 'fast' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).toContain(' - the model did not answer, so the session title was used');
    // The model was asked once and its turn was stopped, rather than left
    // running on words the commit has already given up on.
    const written = asked.filter((one) => askedForWords(one.text));
    expect(written).toHaveLength(1);
    expect(stopped).toHaveLength(1);
    // And the throwaway session is disposed of as it always was: a client sees
    // it arrive and go, whether or not its turn ever ended.
    const gone = p.notes.filter((one) => one.method === 'root/sessionRemoved');
    expect(gone).toHaveLength(1);
  });

  it('stops an agent that has not answered in time, and the side chat stays', async () => {
    const dir = repository();
    const { agent, asked, stopped } = stuck(dir, { chats: { sideChat: true } });
    const { p, config, say, commit } = await studio(dir, agent, { changeWordsTimeoutMs: 50 });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'agent' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).toContain(' - the agent did not answer, so the session title was used');
    const written = asked.filter((one) => askedForWords(one.text));
    expect(written).toHaveLength(1);
    expect(stopped).toHaveLength(1);
    // The chat stays, which is what it does when the agent answers in time -
    // host/76's *Decisions locked in*, "The side chat stays in the session
    // after it answers" - so a client is told about it once and told no more.
    const added = actions(p).filter((one) => one.type === 'session/chatAdded');
    expect(added).toHaveLength(1);
    expect((added[0]?.summary as { resource?: string }).resource).toBe(written[0]?.chat);
  });

  it('waits on the side chat when a turn ends in the session\'s own chat', async () => {
    const dir = repository();
    const { agent, asked, stopped } = stuck(dir, { chats: { sideChat: true } });
    const { config, say, commit } = await studio(dir, agent, { changeWordsTimeoutMs: 500 });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Fix the flaky kqueue build');
    await config({ mode: 'agent' });
    const committing = commit();
    while (!asked.some((one) => askedForWords(one.text))) await settle();
    // The person's own turn ends while the side chat is still asked, and the
    // session's event for it names the session, not the chat.
    await say('And the docs too');
    const message = await committing;

    expect(message).toContain(' - the agent did not answer, so the session title was used');
    expect(asked.filter((one) => askedForWords(one.text))).toHaveLength(1);
    // The wait ran to the limit and stopped the side chat's turn, rather than
    // ending on the other chat's turn and leaving it running.
    expect(stopped).toHaveLength(1);
  });

  it('reads an answer that arrives when the limit is zero, which is no limit', async () => {
    const dir = repository();
    const { agent } = backing(dir, 'Fix the flaky kqueue build');
    const { config, commit } = await studio(dir, agent, { changeWordsTimeoutMs: 0 });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await config({ mode: 'model', provider: 'voice', model: 'fast' });
    const message = await commit();

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Fix the flaky kqueue build');
    expect(message).not.toContain('session title was used');
  });
});

/*
 * The same setting, on the two other places that write words.
 *
 * `create-pr` commits a dirty tree and then opens a request, and both are the
 * person's words when the person gave any. With no form in front of it - which
 * is what `run('create-pr')` without a `_meta` is - both fall to the setting,
 * and they are two asks rather than one: the commit is written from what is
 * uncommitted, the request from the branch it left behind.
 *
 * This is the whole way round: a client pushes the setting, invokes the
 * operation, and what GitHub was asked to open is read back.
 */
describe('a pull request gets its words the same way', () => {
  it('opens under the session title when the host is left as it was', async () => {
    const dir = wired();
    const { agent } = backing(dir, 'never read');
    const { port, opened } = github();
    const { config, say, run } = await studio(dir, agent, { github: port, directories: onGitHub() });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Port the kqueue build');
    // `session-title` said out loud, which is what a host that was never
    // configured already is: nothing is asked of anybody.
    await config({ mode: 'session-title' });
    await run('create-pr');

    // The title is the session's, and the description is the branch's commits,
    // which is the body the session title has always come with.
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Port the kqueue build');
    expect(opened[0]?.title).toBe('Port the kqueue build');
    expect(opened[0]?.body).toBe('- Port the kqueue build');
  });

  it('opens under what the named model answered, for the commit and for the request', async () => {
    const dir = wired();
    const { agent, asked } = backing(dir, 'Teach the build about libkqueue\n\nBecause the poller races.');
    const { port, opened } = github();
    const { chat, config, say, run } = await studio(dir, agent, { github: port, directories: onGitHub() });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Port the kqueue build');
    await config({ mode: 'model', provider: 'voice', model: 'fast' });
    await run('create-pr');

    // Named after the session title, which is what it always was; committed
    // and opened under the model's words.
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('agent/port-the-kqueue-build');
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Teach the build about libkqueue');
    expect(git(dir, 'log', '-1', '--format=%b')).toBe('Because the poller races.');
    expect(opened).toEqual([{
      title: 'Teach the build about libkqueue',
      body: 'Because the poller races.',
      head: 'agent/port-the-kqueue-build',
      base: 'main',
      draft: false,
    }]);
    // Two asks, each on a session of its own: one for the commit and one for
    // the request. The session's own chat was never asked either time.
    const written = asked.filter((one) => askedForWords(one.text));
    expect(written).toHaveLength(2);
    expect(written.map((one) => one.chat)).not.toContain(chat);
  });

  it('opens under what the session\'s agent answered, and both side chats stay', async () => {
    const dir = wired();
    const { agent, asked } = backing(dir, 'Teach the build about libkqueue\n\nBecause the poller races.', { chats: { sideChat: true } });
    const { port, opened } = github();
    const { p, chat, config, say, run } = await studio(dir, agent, { github: port, directories: onGitHub() });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await say('Port the kqueue build');
    await config({ mode: 'agent' });
    await run('create-pr');

    expect(git(dir, 'log', '-1', '--format=%s')).toBe('Teach the build about libkqueue');
    expect(opened[0]?.title).toBe('Teach the build about libkqueue');
    expect(opened[0]?.body).toBe('Because the poller races.');
    // The person's turn was the one the session was asked for, and the words
    // were written in chats of their own.
    const written = asked.filter((one) => askedForWords(one.text));
    const mine = asked.filter((one) => one.text === 'Port the kqueue build');
    expect(mine).toHaveLength(1);
    expect(written).toHaveLength(2);
    expect(written.map((one) => one.chat)).not.toContain(chat);
    // Both stay, as they do when the agent answers in time - host/76's
    // *Decisions locked in*, "The side chat stays in the session after it
    // answers" - so a client is told the session has two more chats.
    const added = actions(p).filter((one) => one.type === 'session/chatAdded');
    expect(added.map((one) => (one.summary as { resource?: string }).resource)).toEqual(written.map((one) => one.chat));
  });

  it('refuses a forced run with no words at the commit create-pr makes', async () => {
    const dir = wired();
    const { agent } = backing(dir, 'never read');
    const { port, opened } = github();
    const { config, run } = await studio(dir, agent, { github: port, directories: onGitHub() });
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    await config({ mode: 'forced' });

    // The dirty tree is committed first, so the refusal lands there.
    await expect(run('create-pr')).rejects.toThrow('A commit message is required.');
    expect(opened).toEqual([]);
  });

  it('refuses a forced run with no words at the request itself', async () => {
    const dir = wired();
    const { agent } = backing(dir, 'never read');
    const { port, opened } = github();
    const { config, run } = await studio(dir, agent, { github: port, directories: onGitHub() });
    // Off the base branch and committed by hand, so the tree is clean and the
    // commit half has nothing to refuse: what is missing is the title.
    git(dir, 'checkout', '-q', '-b', 'fix/work');
    writeFileSync(join(dir, 'tracked.txt'), 'two\n');
    git(dir, 'commit', '-qam', 'Port the kqueue build');
    await config({ mode: 'forced' });

    await expect(run('create-pr')).rejects.toThrow('A pull request title is required.');
    expect(opened).toEqual([]);
  });
});
