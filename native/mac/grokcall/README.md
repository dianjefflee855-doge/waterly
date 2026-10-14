# 语音唤醒 GrokBot (standalone menu-bar helper, macOS 14+)

「Waterly」 is only the wake word. Source dir/log name stay `grokcall`; bundle id stays `com.waterly.grokcall` so macOS permission grants persist. App: `GrokBotWake.app`.

Say "Waterly" and it opens the Grok Bot agent chat and starts a voice call. It is OFF by default; turn it on from the menu bar (W / W●).

Flow: on-device `SFSpeechRecognizer` (`requiresOnDeviceRecognition`, refuses if unsupported) → `WakeMatcher` → `Debouncer` (8 s) → `open grokbot://app/v1/agent?id=…` → wait for a `com.anysphere.sand` window →
1. AX tree scan (title/description/help/identifier/value) scored by `CallButtonScorer`, then `AXPress` (falls back to a click at the element center)
2. else a ScreenCaptureKit window screenshot, then Vision OCR (zh-Hans/en) + optional NCC template (`~/Library/Application Support/Waterly/grokcall_button.png`) → click the center of the match
→ verify: a hang-up/end-call control appears (AX, then OCR). `CallFlow` retries 3× with 1/2/4 s backoff. Failures are logged to `~/Library/Logs/Waterly/grokcall.log` and the helper beeps.
No hard-coded coordinates.

Permissions (System Settings → Privacy & Security): Microphone, Speech Recognition, **Accessibility** (AX read + press + synthetic click), **Screen Recording** (only for the visual fallback). Builds are ad-hoc signed with a stable designated requirement (`identifier "com.waterly.grokcall"`) so grants persist across rebuilds.

Real target (AX dump on MacBook Air, 2026-10-13): `AXButton`, AXDescription `发起语音聊天`, DOM class `sand-prompt-send`, 28×28 pt at the bottom-right of the composer, next to `开始语音输入` (dictation, excluded). It is an icon only (orange waveform), so OCR cannot see it; the visual fallback uses the bundled template `grokcall_button.png` (NCC 0.94 on a real screenshot; next-best 0.70; threshold 0.8).

Build: `./build.sh` (needs Xcode CLT). Pure-logic tests: `./build.sh test` (also runs on Linux).

## Configure your own agent link

No agent id is built in. Point the helper at your own agent before first use:

```bash
defaults write com.waterly.grokcall agentURL "grokbot://app/v1/agent?id=<YOUR_AGENT_ID>"
# or run with env GROKCALL_AGENT_URL=...
```
