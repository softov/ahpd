/*
 * The SDK's `startup`, over a test's own fake `query`.
 *
 * `startup({ options })` spawns a CLI with its options before anything is said
 * to it and answers a warm query, whose `query(prompt)` binds the prompt the
 * CLI then reads and answers the `Query` (sdk.d.ts L9714-L9721, L10091-L10108,
 * 0.3.301). So the fake's CLI is made at once, with the options a session
 * starts it on, and the prompt reaches it when the session binds one.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * mocks that are.
 */

type Made = { close?: () => void; [Symbol.asyncDispose]?: () => Promise<void> };
type FakeQuery = (params: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => unknown;

/** A fake SDK module with the `startup` its `query` makes a CLI for, whatever prompt the fake reads. */
export const warmed = <T extends { query: (params: never) => unknown }>(fake: T): T & { startup: (params: { options: Record<string, unknown> }) => Promise<unknown> } => ({
  ...fake,
  startup: (params) => {
    let bind: (prompt: AsyncIterable<unknown>) => void = () => {};
    const given = new Promise<AsyncIterable<unknown>>((resolve) => { bind = resolve; });
    async function* prompt(): AsyncGenerator<unknown> {
      yield* await given;
    }
    const made = (fake.query as FakeQuery)({ prompt: prompt(), options: params.options }) as Made;
    return Promise.resolve({
      query: (bound: AsyncIterable<unknown>) => {
        bind(bound);
        return made;
      },
      close: () => { made.close?.(); },
      [Symbol.asyncDispose]: async () => {
        made.close?.();
        await made[Symbol.asyncDispose]?.();
      },
    });
  },
});
