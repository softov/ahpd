/**
 * A piece whose actions a call makes.
 *
 * Each action reads a different part of the context, so a case can tell what
 * the engine built: `echo` reads `auth` and `propsValue`, `remember` and
 * `recall` read the connector's `store`, `env` reads the engine's environment,
 * `read` reads the file a `FILE` prop was turned into, `write` writes into the
 * call's folder, `context` answers the run and the step, `pause` and `wait` ask
 * for a waitpoint, `fail` throws, `crash` ends the engine, and `slow` answers
 * after the timeout a call gives up at.
 */
export const runnable = {
  displayName: 'Runnable',
  description: 'A piece whose calls a test makes.',
  auth: { type: 'SECRET_TEXT', displayName: 'API Key', required: true },
  _actions: {
    echo: {
      name: 'echo',
      displayName: 'Echo',
      description: 'Answers the text it got, and the auth it ran with.',
      props: { text: { type: 'SHORT_TEXT', displayName: 'Text', required: true } },
      run: async (context) => ({ text: context.propsValue.text, auth: context.auth }),
    },
    read: {
      name: 'read',
      displayName: 'Read',
      description: 'Answers what the file it was given is.',
      props: { file: { type: 'FILE', displayName: 'File', required: true } },
      run: async (context) => {
        const file = context.propsValue.file;
        return {
          filename: file.filename,
          extension: file.extension ?? null,
          size: file.data.length,
          text: file.data.toString('utf8'),
          base64: file.base64,
        };
      },
    },
    write: {
      name: 'write',
      displayName: 'Write',
      description: 'Writes a file into the call folder, and answers where it went.',
      props: {
        name: { type: 'SHORT_TEXT', displayName: 'Name', required: true },
        text: { type: 'SHORT_TEXT', displayName: 'Text', required: true },
      },
      run: async (context) => ({
        path: await context.files.write({
          fileName: context.propsValue.name,
          data: Buffer.from(context.propsValue.text, 'utf8'),
        }),
      }),
    },
    remember: {
      name: 'remember',
      displayName: 'Remember',
      description: 'Keeps the text in the connector store, and answers what was there.',
      props: { text: { type: 'SHORT_TEXT', displayName: 'Text', required: true } },
      run: async (context) => {
        const before = await context.store.get('text');
        await context.store.put('text', context.propsValue.text);
        return { before };
      },
    },
    recall: {
      name: 'recall',
      displayName: 'Recall',
      description: 'Answers the text the connector kept.',
      props: {},
      run: async (context) => ({ text: await context.store.get('text') }),
    },
    env: {
      name: 'env',
      displayName: 'Env',
      description: 'Answers the daemon token the engine can read, if any, and its home and path.',
      props: {},
      run: async () => ({ token: process.env.AHPD_TOKEN ?? null, home: process.env.HOME ?? null, path: process.env.PATH ?? null }),
    },
    context: {
      name: 'context',
      displayName: 'Context',
      description: 'Answers what the run and the step are.',
      props: {},
      run: async (context) => ({ canPause: context.run.canPause, step: context.step.name, agent: 'agent' in context }),
    },
    pause: {
      name: 'pause',
      displayName: 'Pause',
      description: 'Asks for a waitpoint.',
      props: {},
      run: async (context) => await context.run.createWaitpoint({ type: 'WEBHOOK' }),
    },
    wait: {
      name: 'wait',
      displayName: 'Wait',
      description: 'Waits on a waitpoint.',
      props: {},
      run: async (context) => { context.run.waitForWaitpoint('waitpoint-1'); return {}; },
    },
    fail: {
      name: 'fail',
      displayName: 'Fail',
      description: 'Throws an error.',
      props: {},
      run: async () => { throw new Error('the action failed'); },
    },
    crash: {
      name: 'crash',
      displayName: 'Crash',
      description: 'Ends the process it runs in.',
      props: {},
      run: async () => { process.exit(3); },
    },
    slow: {
      name: 'slow',
      displayName: 'Slow',
      description: 'Answers after a while.',
      props: {},
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { late: true };
      },
    },
  },
  _triggers: {},
};
