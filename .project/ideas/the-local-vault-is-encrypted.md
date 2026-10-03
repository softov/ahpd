---
title: The local vault is encrypted, with a key the daemon is given at start
created: 2026-10-03
---

The host's own vault is one plain JSON file, `vault.json`, mode 0600, in the configuration directory ([the decision](../decisions/the-local-vault-is-a-plain-file-until-it-is-encrypted.md), built by [vault/01 p1](../plans/vault/01-secrets-live-in-a-vault-p1-the-vault-and-its-local-file/plan.md)).
Encrypting it was decided on 2026-10-02 and set aside on 2026-10-03, so the vault comes first and the encryption after.
Source: Softov, 2026-10-03: "to the valt now. crypt lattter".

## What it would add

- **A copied file is not a leak.** A backup, a copied configuration directory or a file committed by mistake carries ciphertext, not tokens.
- **A key the disk does not hold.** The secrets are readable only by a daemon given the key, not by anything that can read the configuration directory.
- **The same shape for a shared store.** A [postgresql vault](a-postgresql-store.md) several hosts read needs the same answer to where the key lives.

## Questions it must answer first

- **Cipher and key form.**
  Proposed: scrypt (N 2^15, r 8, p 1, a 16-byte random salt kept in the file) to a 32-byte key, and AES-256-GCM with a fresh 12-byte IV per write, from `node:crypto` with no new dependency.
  The other proposal is a raw 32-byte key with no key derivation, and Softov leaned to a raw key.
- **How the key reaches a detached daemon.**
  Proposed: `AHPD_VAULT_KEY` in the child's environment, read once by `ahpd run` and deleted from `process.env` at once, so no session's shell or plugin inherits it.
- **A key typed at a terminal.**
  Proposed: `ahpd start` asks without echo when there is no variable, a terminal and a `vault.json`, before it spawns the child.
  Nothing is asked without a terminal, so a service starts locked rather than blocking.
  Whether a typed passphrase exists at all depends on the key form.
- **Restart.**
  `ahpd restart` respawns from a daemon that deleted the variable, so the running daemon has to hand the restarted child the key it holds, or the restart comes up locked and says so.
- **A locked state.**
  Without the key the vault is locked: a secret resolves to nothing, whatever names one says the vault is locked, and the startup line says `vault open`, `vault locked: <why>` or `vault none`.
  Whether the port grows a `locked()` member for it, or a locked vault only throws, is part of this.
- **Unlocking later.**
  Whether `ahpd vault unlock` exists for a daemon that started locked, or a locked daemon is only restarted with the key.
- **The plain file already written.**
  How an existing plain `vault.json` becomes an encrypted one the first time a key is given.
