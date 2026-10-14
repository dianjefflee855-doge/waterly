// Usage: node dist/tools/waCheck.js <chatName> [text]   -- dryRun only; Return is refused at bridge and helper level.
import { MacPlatformBridge } from '../platform/mac/MacPlatformBridge';
import { identifyWhatsAppWindow, sendWhatsApp, locateComposer, WHATSAPP_AX } from '../adapters/whatsapp';
(async () => {
  const chat = process.argv[2], text = process.argv[3] ?? '[Waterly试运行，不会发送]';
  const b = new MacPlatformBridge(undefined, { allowSend: false });
  if (process.env.WATERLY_STEAL_FOCUS === '1') { // test: another app grabs focus right after raise
    const orig = b.raise.bind(b);
    b.raise = async (id: string) => { await orig(id); require('child_process').execFileSync('open', ['-a', 'Finder']); await new Promise(r => setTimeout(r, 800)); };
  }
  const win = identifyWhatsAppWindow(await b.enumerateWindows(WHATSAPP_AX.bundleIds));
  if (!win) { console.log(JSON.stringify({ result: 'no_window' })); return; }
  const before = (await locateComposer(b, win)).numChars;
  if (before !== 0) { console.log(JSON.stringify({ result: 'abort_composer_not_empty', before })); return; }
  try {
    const r = await sendWhatsApp(b, b, win, chat, text, { dryRun: true });
    const pasted = (await locateComposer(b, win)).numChars;
    // clear only if still focused on composer in the right chat
    const f = await b.focusedElement(win.windowId);
    if ((await b.getFocus()).windowId === win.windowId && f?.identifier === 'ChatBar_ComposerTextView') {
      await b.pressKey('Cmd+A'); await b.pressKey('Delete');
    }
    const after = (await locateComposer(b, win)).numChars;
    console.log(JSON.stringify({ result: r, before, pasted, expected: [...text].length, after }));
  } catch (e: any) {
    const after = (await locateComposer(b, win)).numChars;
    console.log(JSON.stringify({ result: 'aborted', code: e.code, message: e.message, after }));
  }
})();
