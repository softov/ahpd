# Where to look things up

Two things outside this repository decide whether it is correct, and neither is
a dependency: nothing here imports them and nothing here builds against them.
They are read.

For what this host actually does with what they say, see
[docs/AHP.md](docs/AHP.md).

## The specification

<https://microsoft.github.io/agent-host-protocol/>

Prose, and the authority on what an action means. The pages worth knowing:
`specification/session-channel`, `specification/chat-channel`, and
`reference/session` for `SessionState` field by field.

The prose is not the whole answer. Twice now the shape that mattered was in the
repository behind it rather than on the site - `_meta`'s well-known keys are
documented nowhere and are visible in a conformance case, and the changeset
scoping is a comment in a types file.

## The reference host

VS Code is the other implementation of this protocol, and the only one to check
a design against. It is checked out locally, sparse, because the whole of VS
Code is not the point:

```bash
git clone --filter=blob:none --sparse --depth 1 \
  https://github.com/microsoft/vscode.git /github/externals/vscode
cd /github/externals/vscode
git sparse-checkout set src/vs/platform/agentHost
```

35 MB, and `git pull` updates it. It is **MIT-licensed**: read it for the
design, and keep the prose here ours. Nothing has been copied and nothing
should be.

**Last read against:** VS Code `8e35945b` (2026-09-12) and the protocol
repository at `a21274d` (2026-09-12), on 2026-09-13. What each pass found and
what it asked of this repository is [UPSTREAM.md](UPSTREAM.md); the next pass
starts from these two revisions rather than from wherever the clone was left.
`git log <that>..HEAD -- src/vs/platform/agentHost` is the list, and
`common/state/protocol/` is the directory to read first, because it is the
wire. The `.md` files there were reflowed to one-line paragraphs in September
2026, so read them with `git diff --word-diff`; a plain diff of one is the
whole file.

What is in it, and why each part earned its keep here:

| path | what it settled |
| --- | --- |
| `AGENTS.md` | 54 KB on the multi-chat architecture: which layer owns a session, and what a provider is given rather than allowed to read |
| `common/changesetUri.ts` | that a changeset is a **scope** - `uncommitted`, `session`, `turn/<id>`, `compare/<a>/<b>` - nested under the session URI so disposal is a prefix scan. It ended an argument here about deriving diffs from tool calls *or* from git: the answer is both, and neither is the unit |
| `node/agentHostChangesetService.ts` | 77 KB of how one is computed and kept fresh, with `…FileMonitorCoordinator.ts` beside it |
| `node/claude/` | the same job this daemon does - the Claude Agent SDK behind AHP. `claudeFileEditObserver.ts` is 6.6 KB and is the per-turn half of a changeset |
| `types/test-cases/` (in the protocol repo, not here) | conformance cases. `reducers/135-session-metachanged-sets-meta.json` is where `_meta.git.branch` came from |

Read it when a design question has an answer somebody has already had to find.
Do not read it to decide what this daemon should be: it is an editor's host,
and this one is deliberately not.

## What this repository is building

`.project/` is the record of what is planned, decided and set aside, and it
is read before code is proposed. [`.project/plans/index.md`](.project/plans/index.md)
is the entry: one row per plan, and a reference file per domain
(`plans/<domain>/00-<domain>.md`) saying what exists today. A plan is a
folder with a `plan.md`, one file per task, and `implemented.md` once it is
built. Every decision is a file under `decisions/`; a plan only links them,
and a choice with no file is not a decision. What is not planned yet is one
file each under `ideas/`, and a plan starts from one of them.

The format is specai 0.1, and the rules are in the `do-spec` skill under
[`.agents/skills/do-spec/`](.agents/skills/do-spec/SKILL.md): frontmatter on
every file, a path is an identity and nothing is moved, and every plan,
task and decision names the code it is about as `code://<path>`, which is
how to find what has been decided about a file:
`rg -n "code://packages/server/src/main.ts" .project/`.

## Ports, if you are writing one

`createHost` imports no filesystem, no subprocess and no `git` - each arrives
as a port, so a host that has none of them refuses what it cannot answer rather
than failing part-way through it.

[`src/git.ts`](src/git.ts) is the smallest one and the one to copy: seventy
lines, one cache, and a comment on every decision that is not obvious.
[`src/changes.ts`](src/changes.ts) is the largest, and shows the part a port
sometimes has to do for itself - serving content the filesystem cannot, because
what a file *used to be* is not a file on disk.
