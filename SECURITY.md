# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Use GitHub's
[private vulnerability reporting](../../security/advisories/new) for this repository.
Include steps to reproduce and the affected component (Electron client, native helpers, relay, web client).
We aim to acknowledge reports within 7 days.

## Security model (short)

- **No central server, no built-in secrets.** Builds contain no API key and no relay key. Each user brings their own LLM key and deploys their own relay and web client.
- **Local secrets.** The LLM API key and optional relay registration key live only in `~/.config/waterly/config.json` (mode 0600), are used only by the Electron main process and are never sent to the renderer, the relay or the phone.
- **End-to-end encryption.** Mac ↔ phone traffic is encrypted with ECDH P-256 + HKDF + AES-GCM; keys are exchanged at pairing and verified with a 6-digit safety number. The relay only forwards ciphertext.
- **Relay auth.** One-time pairing codes (5 min), per-device tokens stored as SHA-256 hashes, expiry + rotation, instant revocation from the Mac, per-account isolation, optional `REGISTRATION_KEY`, `ALLOWED_ORIGINS` CORS allow-list.
- **Human in the loop.** Every send requires an explicit confirmation; remote sends from the phone go through the same approval path on the Mac.
- **Out of scope:** a compromised Mac (equivalent to you), a malicious relay when you skip the safety-number check, and account bans by chat platforms (see [DISCLAIMER.md](DISCLAIMER.md)).

## For contributors

Never commit keys, `.env` files, chat logs, screenshots of real conversations, personal paths or machine identifiers. CI-style check before opening a PR:

```bash
gitleaks detect --source . --no-banner
```
