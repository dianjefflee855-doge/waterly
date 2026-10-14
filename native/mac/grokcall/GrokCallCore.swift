// GrokCallCore.swift — pure, Foundation-only logic for 语音唤醒 GrokBot (Grok Bot voice-call helper; wake word "Waterly").
// No AppKit/AX/Vision here so it compiles and is unit-tested on Linux.
import Foundation

public struct Rect: Equatable {
    public var x, y, w, h: Double
    public init(_ x: Double, _ y: Double, _ w: Double, _ h: Double) { self.x = x; self.y = y; self.w = w; self.h = h }
    public var midX: Double { x + w / 2 }
    public var midY: Double { y + h / 2 }
    public var area: Double { max(0, w) * max(0, h) }
}

// MARK: wake word
public enum WakeMatcher {
    public static func normalize(_ s: String) -> String {
        let lowered = s.lowercased().folding(options: [.diacriticInsensitive, .widthInsensitive], locale: nil)
        let kept = lowered.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == " " ? Character($0) : " " }
        return String(kept).split(separator: " ").joined(separator: " ")
    }
    public static func levenshtein(_ a: String, _ b: String) -> Int {
        let a = Array(a), b = Array(b)
        if a.isEmpty { return b.count }; if b.isEmpty { return a.count }
        var prev = Array(0...b.count), cur = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            cur[0] = i
            for j in 1...b.count { cur[j] = min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a[i-1] == b[j-1] ? 0 : 1)) }
            swap(&prev, &cur)
        }
        return prev[b.count]
    }
    /// True if the transcript contains the wake word (single token or two adjacent tokens joined, edit distance ≤ maxDist (2: tolerates "water lee")).
    /// True if the transcript contains the wake word: a single token within edit distance 1,
    /// or two adjacent tokens joined (e.g. "water lee") within distance 2.
    public static func matches(_ transcript: String, word: String = "waterly") -> Bool {
        let toks = normalize(transcript).split(separator: " ").map(String.init)
        if toks.contains(where: { abs($0.count - word.count) <= 1 && levenshtein($0, word) <= 1 }) { return true }
        guard toks.count > 1 else { return false }
        for i in 0..<(toks.count - 1) {
            let j = toks[i] + toks[i+1]
            if toks[i].count >= 4, abs(j.count - word.count) <= 2, levenshtein(j, word) <= 2 { return true }
        }
        return false
    }
}

// MARK: debounce
public struct Debouncer {
    public let interval: TimeInterval
    public private(set) var last: TimeInterval?
    public init(interval: TimeInterval) { self.interval = interval }
    public mutating func shouldFire(at t: TimeInterval) -> Bool {
        if let l = last, t - l < interval { return false }
        last = t; return true
    }
}

// MARK: candidate scoring (AX elements and OCR boxes share this)
public struct Candidate: Equatable {
    public var role: String       // AX role ("AXButton") or "ocr"
    public var texts: [String]    // title, description, help, identifier, or OCR string
    public var frame: Rect
    public var enabled: Bool
    public init(role: String, texts: [String], frame: Rect, enabled: Bool = true) { self.role = role; self.texts = texts; self.frame = frame; self.enabled = enabled }
}

public enum CallButtonScorer {
    public static let positive: [(String, Double)] = [
        // Real Grok Bot label (AX dump 2026-10-13): AXButton AXDescription="发起语音聊天" (bottom-right of composer).
        ("发起语音聊天", 12), ("语音聊天", 10), ("start voice chat", 10), ("voice chat", 9),
        ("start voice call", 10), ("voice call", 9), ("start call", 8), ("语音通话", 9), ("通话", 6),
        ("call", 5), ("voice", 3), ("phone", 4), ("语音", 3)]
    public static let negative = ["end call", "hang up", "leave call", "挂断", "结束通话", "mute", "静音", "microphone", "dictat", "听写", "语音输入", "voice input"]
    public static let hangupWords = ["end call", "hang up", "leave call", "挂断", "结束通话"]

    public static func score(_ c: Candidate, window: Rect) -> Double {
        guard c.enabled else { return 0 }
        let joined = c.texts.map { WakeMatcher.normalize($0) }.joined(separator: " | ")
        if negative.contains(where: { joined.contains($0) }) { return 0 }
        var s = 0.0
        for (k, w) in positive where joined.contains(k) { s = max(s, w) }
        if s == 0 { return 0 }
        // Only clickable AX roles (message text that mentions "通话" must never win); OCR boxes allowed.
        if c.role == "AXButton" { s += 2 } else if c.role == "ocr" { s += 0 } else { return 0 }
        // Prefer elements inside the window, small (button-like); the call button sits in the header (upper part).
        if window.area > 0 {
            let inside = c.frame.midX >= window.x && c.frame.midX <= window.x + window.w && c.frame.midY >= window.y && c.frame.midY <= window.y + window.h
            if !inside { return 0 }
            let rel = c.frame.area / window.area
            if rel > 0.05 { s -= 3 }
            let relY = (c.frame.midY - window.y) / window.h
            if relY < 0.2 { s += 1 }
        }
        return max(0, s)
    }
    public static func best(_ cs: [Candidate], window: Rect, minScore: Double = 5) -> Candidate? {
        let scored = cs.map { ($0, score($0, window: window)) }.filter { $0.1 >= minScore }
        return scored.max { a, b in a.1 != b.1 ? a.1 < b.1 : a.0.frame.area > b.0.frame.area }?.0
    }
    /// In a call iff a real hang-up *control* is visible: a short-labelled, button-sized AXButton/OCR box.
    /// Chat history ("End call: '再见' or '挂断 · 00:48" event chips, my own messages mentioning 挂断) must not count,
    /// and if the 发起语音聊天 button is still there we are definitely not in a call.
    public static func looksInCall(_ cs: [Candidate]) -> Bool {
        if cs.contains(where: { isStartButton($0) }) { return false }
        return cs.contains { c in
            guard c.role == "AXButton" || c.role == "ocr", c.frame.w <= 120, c.frame.h <= 80 else { return false }
            let j = c.texts.map { WakeMatcher.normalize($0) }.filter { !$0.isEmpty }
            return j.contains { t in t.count <= 20 && hangupWords.contains { t.contains($0) } }
        }
    }
    public static func isStartButton(_ c: Candidate) -> Bool {
        c.role == "AXButton" && c.enabled && c.texts.contains { let t = WakeMatcher.normalize($0); return t == "发起语音聊天" || t == "start voice chat" }
    }
    /// After clicking: the call counts as started if a hang-up control appeared OR the start button disappeared.
    public static func callStarted(after cs: [Candidate]) -> Bool { looksInCall(cs) || !cs.contains(where: { isStartButton($0) }) }
}

// MARK: template matching (grayscale NCC on small images; Vision does OCR, this is the icon fallback)
public struct Gray { public let w: Int, h: Int; public let px: [Double]
    public init(w: Int, h: Int, px: [Double]) { precondition(px.count == w*h); self.w = w; self.h = h; self.px = px }
    public subscript(x: Int, y: Int) -> Double { px[y*w + x] } }

public enum TemplateMatcher {
    /// Normalized cross-correlation over all positions (stride). Returns best score [-1,1] and top-left.
    public static func match(_ img: Gray, _ tpl: Gray, stride: Int = 1) -> (score: Double, x: Int, y: Int)? {
        guard tpl.w <= img.w, tpl.h <= img.h, tpl.w > 0, tpl.h > 0 else { return nil }
        let n = Double(tpl.w * tpl.h)
        let tm = tpl.px.reduce(0, +) / n
        let tdev = tpl.px.map { $0 - tm }
        let tnorm = sqrt(tdev.reduce(0) { $0 + $1*$1 })
        var best: (Double, Int, Int) = (-2, 0, 0)
        var y = 0
        while y <= img.h - tpl.h {
            var x = 0
            while x <= img.w - tpl.w {
                var sum = 0.0
                for ty in 0..<tpl.h { for tx in 0..<tpl.w { sum += img[x+tx, y+ty] } }
                let m = sum / n
                var num = 0.0, inorm = 0.0
                for ty in 0..<tpl.h { for tx in 0..<tpl.w {
                    let d = img[x+tx, y+ty] - m; num += d * tdev[ty*tpl.w + tx]; inorm += d*d } }
                let den = sqrt(inorm) * tnorm
                let s = den > 1e-9 ? num / den : 0
                if s > best.0 { best = (s, x, y) }
                x += stride
            }
            y += stride
        }
        return (best.0, best.1, best.2)
    }
}

// MARK: state machine
public enum Phase: Equatable { case idle, opening, waitingWindow, locating, clicking, verifying, inCall, failed(String) }
public enum Event: Equatable { case wake, opened, windowReady, located, notFound, clicked, verified, notVerified, timeout, reset }

public struct CallFlow {
    public private(set) var phase: Phase = .idle
    public private(set) var attempt = 0
    public let maxAttempts: Int
    public let backoff: [TimeInterval]
    public init(maxAttempts: Int = 3, backoff: [TimeInterval] = [1, 2, 4]) { self.maxAttempts = maxAttempts; self.backoff = backoff }
    public var busy: Bool { switch phase { case .idle, .inCall, .failed: return false; default: return true } }
    public func delayBeforeRetry() -> TimeInterval { backoff.isEmpty ? 0 : backoff[min(max(attempt - 1, 0), backoff.count - 1)] }

    /// Returns true if the event was accepted.
    @discardableResult public mutating func handle(_ e: Event) -> Bool {
        switch (phase, e) {
        case (_, .reset): phase = .idle; attempt = 0
        case (.idle, .wake), (.failed, .wake), (.inCall, .wake):
            if case .inCall = phase { return false }   // already in a call: ignore
            phase = .opening; attempt = 1
        case (.opening, .opened): phase = .waitingWindow
        case (.waitingWindow, .windowReady): phase = .locating
        case (.locating, .located): phase = .clicking
        case (.clicking, .clicked): phase = .verifying
        case (.verifying, .verified): phase = .inCall
        case (.locating, .notFound), (.verifying, .notVerified), (.waitingWindow, .timeout), (.verifying, .timeout), (.opening, .timeout):
            if attempt < maxAttempts { attempt += 1; phase = (phase == .waitingWindow || phase == .opening) ? .opening : .locating }
            else { phase = .failed(describe(e)) }
        default: return false
        }
        return true
    }
    private func describe(_ e: Event) -> String {
        switch e { case .notFound: return "call button not found"; case .notVerified: return "call did not start"; default: return "timeout" }
    }
}

// MARK: listener health (pure; drives restarts of the wake-word listener)
public struct ListenerHealth {
    public let backoff: [TimeInterval]
    public let stallAfter: TimeInterval
    public private(set) var failures = 0
    public private(set) var lastAudio: TimeInterval
    public init(backoff: [TimeInterval] = [0.5, 1, 2, 5, 10], stallAfter: TimeInterval = 4, now: TimeInterval = 0) {
        self.backoff = backoff; self.stallAfter = stallAfter; self.lastAudio = now }
    /// Audio buffer arrived: the pipeline is alive.
    public mutating func audio(at t: TimeInterval) { lastAudio = t; failures = 0 }
    /// Recognizer/engine error: returns the delay before restarting.
    public mutating func failed() -> TimeInterval { let d = backoff[min(failures, backoff.count - 1)]; failures += 1; return d }
    /// Called by a watchdog timer; true if no audio for `stallAfter` seconds (engine silently stopped, e.g. mic grabbed by a call).
    public func stalled(at t: TimeInterval, engineRunning: Bool) -> Bool { !engineRunning || t - lastAudio > stallAfter }
    public mutating func restarted(at t: TimeInterval) { lastAudio = t }
}

extension CallFlow {
    /// After a finished run (success or failure) the flow must accept the next wake word.
    public mutating func settle() { switch phase { case .inCall, .failed: handle(.reset); default: break } }
}
