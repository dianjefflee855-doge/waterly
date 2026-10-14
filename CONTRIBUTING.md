# Contributing to Waterly

感谢你的贡献！Thanks for helping out.

## Ground rules

1. **No secrets, no personal data.** Don't commit API keys, `.env`, real chat content, real contact names, personal paths (`/Users/<name>`), machine ids or screenshots of real chats. Use the synthetic fixtures in `fixtures/` and demo data.
2. **Human in the loop stays.** Changes must keep: auto-reply off by default, drafts only, every send confirmed by the user, clipboard as the default send mode.
3. **No cracking or injection.** Waterly must not read chat apps' local databases, patch/inject into chat clients, or bypass platform protections. PRs that do will be closed.
4. **Don't copy other products'** code, prompts or branding.

## Development

```bash
npm install
npm run build && npm test          # Electron client (TypeScript + vitest)
npm run native                     # macOS helpers (Swift, needs Xcode CLT)
cd relay && npm install && npm test   # relay (Node ≥ 22, wrangler)
```

Some tests need a real Mac, OCR sidecar or a live LLM key and are skipped or expected to fail elsewhere (OCR / e2e). Live LLM tests run only with `MINIMAX_LIVE=1` and your own key in the environment.

## Pull requests

- Keep PRs focused; describe what changed and how you tested it.
- Run `gitleaks detect --source .` before pushing.
- UI text is Chinese-first; English strings are welcome alongside.
- By contributing you agree your work is released under the [MIT License](LICENSE).
