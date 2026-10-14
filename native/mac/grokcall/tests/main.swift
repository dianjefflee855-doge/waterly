// tests/main.swift — dependency-free test runner for GrokCallCore (runs on Linux & macOS).
// Build: swiftc GrokCallCore.swift tests/main.swift -o build/core-tests && build/core-tests
import Foundation

var failures = 0, passes = 0
func check(_ cond: Bool, _ msg: String, line: Int = #line) {
    if cond { passes += 1 } else { failures += 1; print("FAIL line \(line): \(msg)") }
}

// wake word
check(WakeMatcher.matches("Hey Waterly"), "plain")
check(WakeMatcher.matches("WATERLY!"), "caps+punct")
check(WakeMatcher.matches("water lee"), "split tokens, 1 edit")
check(WakeMatcher.matches("waterley open"), "1 insertion")
check(WakeMatcher.matches("Waterly，你好"), "chinese punct")
check(!WakeMatcher.matches("water the plants"), "water ≠ waterly")
check(!WakeMatcher.matches("butterfly"), "far word")
check(!WakeMatcher.matches("watering the lawn"), "watering")
check(!WakeMatcher.matches("waiter please"), "waiter")
check(!WakeMatcher.matches(""), "empty")
check(WakeMatcher.levenshtein("kitten", "sitting") == 3, "levenshtein")

// debounce
var d = Debouncer(interval: 5)
check(d.shouldFire(at: 0), "first fires")
check(!d.shouldFire(at: 2), "within window blocked")
check(!d.shouldFire(at: 4.9), "still blocked")
check(d.shouldFire(at: 5.1), "after window fires")

// scorer
let win = Rect(0, 0, 1000, 800)
let call = Candidate(role: "AXButton", texts: ["", "Start voice call"], frame: Rect(900, 20, 32, 32))
let mic = Candidate(role: "AXButton", texts: ["Dictation", "voice input microphone"], frame: Rect(800, 740, 32, 32))
let hang = Candidate(role: "AXButton", texts: ["End call"], frame: Rect(500, 700, 40, 40))
let txt = Candidate(role: "AXStaticText", texts: ["we talked about a voice call yesterday"], frame: Rect(100, 300, 700, 300))
let outside = Candidate(role: "AXButton", texts: ["Voice call"], frame: Rect(1200, 20, 32, 32))
let disabled = Candidate(role: "AXButton", texts: ["Voice call"], frame: Rect(900, 20, 32, 32), enabled: false)
check(CallButtonScorer.best([mic, hang, txt, call, outside, disabled], window: win) == call, "picks call button")
check(CallButtonScorer.score(hang, window: win) == 0, "hang-up rejected")
check(CallButtonScorer.score(mic, window: win) == 0, "mic/dictation rejected")
check(CallButtonScorer.score(outside, window: win) == 0, "outside window rejected")
check(CallButtonScorer.score(txt, window: win) < CallButtonScorer.score(call, window: win), "big text penalized")
check(CallButtonScorer.best([mic, hang], window: win) == nil, "nothing found -> nil")
let ocrZh = Candidate(role: "ocr", texts: ["语音通话"], frame: Rect(880, 10, 60, 20))
check(CallButtonScorer.best([ocrZh, txt], window: win) == ocrZh, "OCR chinese label")
check(CallButtonScorer.looksInCall([hang]), "in-call detection")
check(!CallButtonScorer.looksInCall([call, mic]), "not in call")

// template matching
var px = [Double](repeating: 0, count: 20*15)
let tplPx: [Double] = [1,0,1, 0,1,0, 1,1,0]
for ty in 0..<3 { for tx in 0..<3 { px[(9+ty)*20 + (13+tx)] = tplPx[ty*3+tx] } }
let img = Gray(w: 20, h: 15, px: px), tpl = Gray(w: 3, h: 3, px: tplPx)
if let m = TemplateMatcher.match(img, tpl) {
    check(m.x == 13 && m.y == 9, "template location \(m.x),\(m.y)")
    check(m.score > 0.99, "template score \(m.score)")
} else { check(false, "template nil") }
check(TemplateMatcher.match(tpl, img) == nil, "tpl larger than image")

// state machine: happy path
var f = CallFlow()
check(f.handle(.wake) && f.phase == .opening && f.attempt == 1, "wake")
f.handle(.opened); f.handle(.windowReady); f.handle(.located); f.handle(.clicked)
check(f.phase == .verifying && f.busy, "verifying")
f.handle(.verified); check(f.phase == .inCall && !f.busy, "in call")
check(!f.handle(.wake), "wake ignored during call")
// retries then failure
var g = CallFlow(maxAttempts: 3, backoff: [1, 2, 4])
g.handle(.wake); g.handle(.opened); g.handle(.windowReady)
g.handle(.notFound); check(g.phase == .locating && g.attempt == 2 && g.delayBeforeRetry() == 2, "retry 2")
g.handle(.notFound); check(g.attempt == 3 && g.delayBeforeRetry() == 4, "retry 3")
g.handle(.notFound); check(g.phase == .failed("call button not found"), "fails after max")
check(g.handle(.wake) && g.phase == .opening, "new wake after failure")
// window timeout re-opens
var h = CallFlow(); h.handle(.wake); h.handle(.opened); h.handle(.timeout)
check(h.phase == .opening && h.attempt == 2, "window timeout reopens")
check(!h.handle(.clicked), "invalid event rejected")
h.handle(.reset); check(h.phase == .idle && h.attempt == 0, "reset")

// real Grok Bot AX labels (dump from MacBook Air)
let realWin = Rect(256, 38, 1320, 1000)
let realVoice = Candidate(role: "AXButton", texts: ["发起语音聊天"], frame: Rect(1513, 1003, 28, 28))
let realMic = Candidate(role: "AXButton", texts: ["开始语音输入"], frame: Rect(1477, 1003, 28, 28))
let realMsg = Candidate(role: "AXGroup", texts: ["Waterly Grok Bot 语音通话自动触发的小程序初版写完了"], frame: Rect(590, 493, 560, 304))
let realNew = Candidate(role: "AXButton", texts: ["新建聊天"], frame: Rect(432, 50, 36, 36))
check(CallButtonScorer.best([realMic, realMsg, realNew, realVoice], window: realWin) == realVoice, "real: picks 发起语音聊天")
check(CallButtonScorer.score(realMic, window: realWin) == 0, "real: 语音输入 rejected")
check(CallButtonScorer.score(realMsg, window: realWin) == 0, "real: chat message group rejected")

// listener health
var lh = ListenerHealth(backoff: [0.5, 1, 2], stallAfter: 4, now: 0)
check(lh.failed() == 0.5 && lh.failed() == 1 && lh.failed() == 2 && lh.failed() == 2, "backoff caps")
lh.audio(at: 10); check(lh.failures == 0, "audio resets failures")
check(!lh.stalled(at: 12, engineRunning: true), "fresh audio not stalled")
check(lh.stalled(at: 15, engineRunning: true), "no audio 5s -> stalled (mic grabbed by call)")
check(lh.stalled(at: 11, engineRunning: false), "engine stopped -> stalled")
lh.restarted(at: 20); check(!lh.stalled(at: 22, engineRunning: true), "restart gives grace period")
// flow settles after success so the next wake works
var sf = CallFlow(); sf.handle(.wake); sf.handle(.opened); sf.handle(.windowReady); sf.handle(.located); sf.handle(.clicked); sf.handle(.verified)
sf.settle(); check(sf.phase == .idle && sf.handle(.wake), "wake accepted after call ended")

// false positives seen live 2026-10-13 20:21
let chip = Candidate(role: "AXButton", texts: ["Alex · End call: '再见' or '挂断 · 00:48"], frame: Rect(856, 92, 383, 24))
let msgHang = Candidate(role: "AXStaticText", texts: ["挂断的话，像刚才那样说「再见」就能结束通话"], frame: Rect(590, 400, 560, 40))
check(!CallButtonScorer.looksInCall([chip, msgHang, realVoice]), "history chip / message mentioning 挂断 is not a call")
check(!CallButtonScorer.looksInCall([chip, msgHang]), "chip alone is not a call")
let realHang = Candidate(role: "AXButton", texts: ["挂断"], frame: Rect(1500, 1000, 40, 40))
check(CallButtonScorer.looksInCall([chip, realHang]), "short hang-up button is a call")
check(CallButtonScorer.callStarted(after: [chip, realMic]), "start button gone after click -> started")
check(!CallButtonScorer.callStarted(after: [chip, realVoice]), "start button still there -> not started")

print("\(passes) passed, \(failures) failed")
exit(failures == 0 ? 0 : 1)
