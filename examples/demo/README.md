# A host with something on every screen

[`examples/notes`](../notes) with models, customizations, automations, a turn that runs and a turn that fails, and no model behind any of it.
A client pointed at it has something to draw on every screen.
ahpc draws its docs pictures from it.

```bash
pnpm install
pnpm demo -- --port 9210 --path /tmp/demo      # from source, restarts on save
pnpm demo:bun -- --port 9210 --path /tmp/demo  # the same, on Bun

# then, from anywhere
ahpc --host ws://127.0.0.1:9210
```

`--path` is the folder the host serves and the notes are written to. It is `./demo` when left out.

## What it says back

```
read <name>            reads a note. Leave the name out and it asks which
write <name> <text>    writes a note. It asks before it does
slow                   streams one line a second for a minute
fail                   ends the turn with an error
```

Everything except `slow` and `fail` goes to the `notes` session as it is.
A cancel stops `slow`.

## What it adds to notes

| | |
| --- | --- |
| Models | `demo-fast`, `demo-large` and `demo-small`. A turn on any of them is the same `notes` turn |
| Customizations | a skill, `summarize`, and a prompt, `tidy`. Neither does anything |
| Automations | held in memory, as `memoryAutomations` holds them. A restart forgets them |
| Agent | `Agent Demo`, with the fields a new session offers: `Agent Mode`, `Ask before` and `Tone`. The mode changes nothing in a turn |
| Worktrees | a git folder offers isolation and branch, as on the daemon. A worktree goes beside its repository |
| Status | running while `slow` streams, and in error after `fail` until the next turn |
| Terminals | under a pseudoterminal, as the daemon's are, so a shell shows its prompt. Where `node-pty` does not load, on pipes |
