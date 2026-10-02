---
title: The decide function, the draft's four steps
status: todo
depends: [task-01-the-policy-row-and-the-policies-port.md]
layer: "sdk"
refs:
  - "[code://packages/sdk/src/scopes.ts#L42-L64](../../../../packages/sdk/src/scopes.ts#L42-L64) - `membership` and `covers`, the grammar a policy scope is written in the same shape as"
  - "[code://packages/sdk/src/types/users.ts#L40-L102](../../../../packages/sdk/src/types/users.ts#L40-L102) - `Principal`, whose `can` answers `*:*` and whose `memberships` say what work may be charged where"
  - "[code://packages/sdk/src/scopes.ts#L13-L24](../../../../packages/sdk/src/scopes.ts#L13-L24) - `Scope` and `ScopeAnswer`, what a request's team and project are spelled as"
  - "code://packages/sdk/src/policies.ts - the row, its windows and the `Policies` port `decide` reads, written by task 01"
  - "[code://packages/sdk/src/index.ts#L53-L67](../../../../packages/sdk/src/index.ts#L53-L67) - where `decide` is exported"
  - "[code://packages/sdk/test/scopes.test.ts](../../../../packages/sdk/test/scopes.test.ts) - the shape a test over this vocabulary is written in"
  - "file:///github/ahp-review/prospect/ahp-user-rules.md - steps 1 to 4 of \"Each check runs the same steps\", the row shape, the match grammar, and the examples the checklist names"
---

## Objective

`@ahpd/sdk` exports one `decide` that answers whether a person may use one thing, for the three kinds a policy has, with the same four steps whatever is asked: a `*:*` holder is allowed, candidates are the active rows of that kind whose scope holds the person and whose match holds the request, any matching deny wins, and no candidate at all is a refusal.
It is one function, so the `model` kind a proxy call is checked against is decided here too, and nothing in this task calls it: the checks at session creation and at a turn's start are task 04.

## Files

- `CREATE: packages/sdk/src/decide.ts` - `Asked` (the request: `model`, `proxy`, `agent`, `computer`), `Decision` (`allowed` with the `candidates` of that kind, or `allowed: false` with the `refusal` sentence and the same candidates), and `decide(store, principal, scope, kind, asked, at?)`.
- `CREATE: packages/sdk/test/decide.test.ts` - the draft's setup as data, and the examples the plan's checklist names.
- `UPDATE: packages/sdk/src/index.ts:53-67` - `decide` and the two types beside it.

## Steps

1. Write the signature as `decide(store, principal, scope, kind, asked, at?)`, all of it awaited, with `at` defaulting to `new Date()`. A test that fixes the clock and a caller that does not are then the same call, and the draft's cases are all dated.
2. Step 1: a principal whose `can('*:*')` is true is allowed at once, with no candidates. A root connection is not here: a root connection has no `Principal` at all, and the plan's second table gives that case to task 04, so do not test for one.
3. Step 2, the candidates, in this order and with nothing read that is not needed: the row is of the kind asked, it is active now (`at` at or after `from` and before `until`, on the ends task 01 stored), its scope holds, and its match holds. A row naming a type the request does not name does not have that type checked, which is what makes an `agent` row with `model:` values a candidate at a session's creation, where no model is asked yet, as the draft's example 15 says. A row that names no type the request asks cannot match at all, so an `agent` row of `model:` values alone allows no harness.
4. The scope holds when the row is `all`, or `user:<id>` with that person, or `team:<team>` with the request's team, or `project:<team>:<project>` with the request's team and project both. A request that names no team and no project is held by `all` and `user:` rows alone, which is how the draft's erin, in no team, is allowed by `M1` and by nothing else.
5. The match holds when every value type the row names and the request names matches, and values of one type are alternatives. Match one value as the draft writes its globs: `*` stands for any run of characters within the value, including none, the value is matched whole, and no other character is special. So `deepseek/*` matches `deepseek/deepseek-v4.1-flash` and not `anthropic/fable-5`, `agent:*` matches `claude` and `acp:something`, and `model:*` matches any model. A value type the row does not name is unconstrained, so a `model` row with no `proxy:` values allows any provider, as the draft's example 37 says.
6. Step 3: among the candidates, any `effect: 'deny'` refuses, and the refusal names that row's `id`. Step 4: a kind with no candidate at all refuses, and the sentence names the kind and what was asked. Write the two sentences here, once, and hold to them: a deny reads as the policy's id and then the request, and no candidate reads as there being no policy that allows the kind for what was asked. Policy/02 will add a limit to the same sentence, so keep the row and the request in named parts of it rather than in one string.
7. Answer with the candidates either way, not only on a refusal, so policy/02 charges from the same read this plan already made and the check is not run twice.
8. Do not read `pool`, `cap` or `limits` and do not ask the `usage` port anything: this plan stores limits and enforces none of them. Add no `kind` beyond the three the row names, and no caller.

## Validation

- `CREATE: packages/sdk/test/decide.test.ts`, holding the draft's setup as a fixture: the store with `M1` to `M6`, `A1` to `A6` and `C1` to `C3` as the draft writes them, and a principal per person (`alice`, `bob`, `carol` in `backend` with `billing` default, `carol` also in `data`, `dave` holding `*:*`, `erin` in no team), each with `can` built from a grant set the test states. Fix `at` at 2026-10-20, the draft's today.
- The cases, each asserted as the allow or the refusal and the sentence: the plan's checklist names 15, 16, 19, 21, 22, 26 and 27, and 26 is asserted as a policy that allows and a refusal that is not this plan's, because the machine has no cofold. Add the `model` kind, which nothing here calls, with 1, 2, 9 and 10, and 35 as the `proxy:` half: a `deepseek` call through `openrouter` has no candidate and is refused where the same call through `local-vllm` is allowed.
- The windows: `A6` is not a candidate on 2026-10-20 and is one on 2026-10-23, and the same call decides the same both ways apart from it, which is the draft's example 28 without its limits. A row whose `until` has passed is not a candidate on 2026-11-01, the draft's example 30.
- The refusals say what refused them: a deny names its id, and no candidate names the kind and what was asked. A test asserts the sentence contains the id rather than the whole string, so policy/02 can add a limit to it.
- `pnpm exec vitest run packages/sdk/test/decide.test.ts`
- `pnpm typecheck`, `pnpm boundary`

## Resume

Nothing done yet.
