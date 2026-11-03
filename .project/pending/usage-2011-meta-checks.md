---
title: Check a key's meta on a real proxy call
plans:
  - plans/usage/20261029-2011-a-record-names-its-key-and-meta/plan.md
---

# Check a key's meta on a real proxy call

usage/20261029-2011 is on main. A person's key carries `--meta` entries, a call adds its own with `X-AHP-Meta`, and the usage record holds both. The header is read only for a person's key, not for the deployment token: on 2026-11-03 `X-AHP-Meta: bad` with the deployment token got 200.

## Set up

Do the *Set up* of [proxy-04-move-config-dev.md](proxy-04-move-config-dev.md), so `httpApi` is on. Then, in a second terminal, mint a key for a person in `~/.config/ahpd/users.json`, and keep the secret it prints:

```bash
cd /github/ahpd
ahpd() { node --conditions development --import ./scripts/dev.mjs packages/server/src/main.ts "$@" --config-file /home/softov/.config/ahpd/config-dev.json; }
ahpd token mint --user <person> --grant proxy:write --label meta-check --meta env=prod
```

## Steps

1. Call a model with the key in place of `<secret>`, and a model from `/v1/models` in place of `<model>`:

```bash
curl -s http://127.0.0.1:37537/v1/chat/completions -H 'Authorization: Bearer <secret>' -H 'X-AHP-Meta: client=pi' -H 'Content-Type: application/json' -d '{"model":"<model>","messages":[{"role":"user","content":"Say ok."}]}'
```

2. Check that the last usage record holds `token`, `env=prod` and `client=pi`:

```bash
tail -1 ~/.config/ahpd/usage/$(date +%Y-%m)-model.jsonl
```

3. Call again with `-H 'X-AHP-Meta: bad'`, and check that the answer is 400.
4. Remove the key with `ahpd token rm <id> --user <person>`.

## Reply

Write "pass", or say which step stopped.
