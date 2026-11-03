---
title: Review the owner's command check
plans:
  - plans/host/100-p2-a-session-gets-its-owners-command-check/plan.md
---

# Review the owner's command check

I reviewed host/100 p2 on main at `e7b172de` on 2026-10-20. The code does what the plan says, with one security problem.

## Results

1. **Pass.** `getAutoApproval` in `spawn.ts` reads the connection that started the session, and only when that connection's person owns the session. A turn from another window does not widen the rules.
2. **Pass.** A start that no connection asked for, such as an automation, has no rules, so every command asks.
3. **Pass.** `terminalAutoApproveEnabled: false` makes every command ask, and only `approved` returns `not-needed`.
4. **Pass.** The three keys are in `PER_CONNECTION`, so a member pushes them with no grant. `root-config.test.ts` checks that they are kept per connection.
5. **Pass.** `terminalAutoApproveDefaults` takes `vscode` or `none`, defaults to `vscode`, and refuses any other value at start. `config-check.test.ts` covers the three cases.
6. **Pass.** A malformed rule value is skipped: only `true`, `false` and an object with a boolean `approve` count.
7. **Fail.** A member can push a rule key that is a slow regular expression, and the daemon stops while it matches. Task 03 of the plan carries the fix.
8. **Note.** Task 02 named `config.ts:247-258` and `run.ts:732-741`. The key is parsed in `commands/options.ts:572` and passed at `run.ts:845`. The plan refs are out of date, not the code.

## Results by hand

Softov ran the checks with a Claude session from VS Code on 2026-10-20.

- Check 1 failed. `pnpm ls --depth 0` asked under the `vscode` defaults. The session has no owner, so the check never applies. See [the problem](../problems/a-claude-session-from-vs-code-has-no-owner.md).
- Check 2 passed. `rm` on a scratch file asked.
- Check 3 asked, as written. It shows nothing while check 1 fails, because every command asks.
- Check 4 was not run.

My first steps named `ls`. Claude Code approves `ls` and other read-only commands itself, before ahpd is asked, so `ls` cannot show the check. Auto mode also skips ahpd. The steps below use a command that only the defaults approve.

## Results on a test daemon

I ran the four checks on 2026-11-02 at `893051dc`, on a test daemon with its own XDG folders and port 47100. The session was Claude with `haiku`, started over ahpc by alice, an admin.

1. **Pass.** `pnpm ls --depth 0` ran with no question under the `vscode` defaults.
2. **Pass.** `rm scratch.txt` asked. I denied it, and the file stayed.
3. **Pass.** With `--terminal-auto-approve-defaults none`, `pnpm ls --depth 0` asked. This also shows that ahpd, not Claude Code, approved it in check 1.
4. **Changed.** Fork commit `8e6cbbc5` made the terminal keys one value for the whole host, as VS Code has them, and a push needs `config:change`. Result 4 in *Results* no longer holds.
   - bob as a member pushed `{"rm": true}`. The push did not apply, and `rm` asked.
   - bob as an admin pushed `{"rm": true}`. `rm` ran with no question, in alice's session.

## Check by hand

Restart your daemon on `893051dc` or later. Use a new Claude session from VS Code in Ask Before Edits mode, with no terminal rules pushed. Ask the agent to run `pnpm ls --depth 0`. It runs with no question.

## Reply

- Write "pass" or what you saw for the check by hand.
