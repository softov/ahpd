---
title: Copilot goes through the CLI
created: 2026-09-06
moved: 2026-09-18
---

VS Code does not: it exchanges a GitHub token at `api.github.com/copilot_internal/v2/token` and posts to `api.individual.githubcopilot.com/chat/completions`, or the `business` or `enterprise` host named by the plan in the token response, with `Copilot-Integration-Id` and `X-Initiator` headers on it. The shipped `@github/copilot` bundle does the same thing. It is OpenAI-shaped, so it would be an auth provider inside `@ahpd/agent-openai` rather than a backend of its own, and `Agent.protectedResources` with `Start.credentials` is already the seam the token belongs in.

The integration id is the reason not to. It is allowlisted to editor integrations, sending one that was issued to somebody else is outside Copilot's acceptable use, and what that costs is the account rather than a `403`. `copilot --acp` is GitHub's own programmatic surface and gives the whole agent, tools and approvals and sessions included. GitHub Models at `models.github.ai/inference` is the documented way to reach a raw model with a personal access token, on its own quota rather than a Copilot subscription, and drops into the OpenAI backend unchanged. Asking GitHub for an integration id is the third answer, and the only one that makes the direct path a real option.
