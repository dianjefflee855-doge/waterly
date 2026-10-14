// main.swift — 语音唤醒 GrokBot: menu-bar resident helper (macOS 14+).
// Wake word "Waterly" (on-device SFSpeechRecognizer) -> open Grok Bot agent chat -> find the
// voice-call button (AX first, then window screenshot + Vision OCR / template match) -> click -> verify.
// No hard-coded coordinates; no network APIs besides the local `open` URL.
import AppKit
import ApplicationServices
import Speech
import AVFoundation
import Vision
import ScreenCaptureKit

let kGrokBundle = "com.anysphere.sand"
// Your own agent deep link: env GROKCALL_AGENT_URL or `defaults write com.waterly.grokcall agentURL "grokbot://app/v1/agent?id=<YOUR_AGENT_ID>"`
let kAgentURL = ProcessInfo.processInfo.environment["GROKCALL_AGENT_URL"] ?? UserDefaults.standard.string(forKey: "agentURL") ?? "grokbot://app/v1/agent?id=YOUR_AGENT_ID"
let logURL: URL = {
    let dir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Waterly")
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("grokcall.log")
}()
func log(_ s: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
    FileHandle.standardError.write(line.data(using: .utf8)!)
    if let h = try? FileHandle(forWritingTo: logURL) { h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close() }
    else { try? line.data(using: .utf8)!.write(to: logURL) }
}

// MARK: wake word listener (self-healing: restarts on error, audio config change, or stall)
final class WakeListener {
    private var engine = AVAudioEngine()
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var health = ListenerHealth()
    private var generation = 0
    private var watchdog: Timer?
    private var restartPending = false
    var onWake: () -> Void = {}
    private(set) var running = false
    private func now() -> TimeInterval { Date().timeIntervalSince1970 }

    func start() {
        SFSpeechRecognizer.requestAuthorization { st in
            DispatchQueue.main.async {
                guard st == .authorized else { log("speech auth denied: \(st.rawValue)"); return }
                guard self.recognizer?.supportsOnDeviceRecognition == true else { log("on-device recognition unavailable; refusing to use server"); return }
                self.running = true
                NotificationCenter.default.addObserver(self, selector: #selector(self.configChanged), name: .AVAudioEngineConfigurationChange, object: nil)
                self.watchdog?.invalidate()
                self.watchdog = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
                self.restart(reason: "start")
            }
        }
    }
    func stop() {
        running = false; watchdog?.invalidate(); watchdog = nil
        NotificationCenter.default.removeObserver(self, name: .AVAudioEngineConfigurationChange, object: nil)
        teardown()
    }
    @objc private func configChanged(_ n: Notification) { DispatchQueue.main.async { self.scheduleRestart(after: 0.5, reason: "audio configuration changed") } }
    private func tick() {
        guard running, !restartPending else { return }
        if health.stalled(at: now(), engineRunning: engine.isRunning) { scheduleRestart(after: health.failed(), reason: "stalled (no audio)") }
    }
    private func scheduleRestart(after d: TimeInterval, reason: String) {
        guard running, !restartPending else { return }
        restartPending = true; log("listener restart in \(d)s: \(reason)")
        DispatchQueue.main.asyncAfter(deadline: .now() + d) { self.restartPending = false; self.restart(reason: reason) }
    }
    private func teardown() {
        generation += 1
        task?.cancel(); task = nil; request?.endAudio(); request = nil
        engine.inputNode.removeTap(onBus: 0); engine.stop()
    }
    private func restart(reason: String) {
        guard running else { return }
        teardown()
        engine = AVAudioEngine()          // fresh engine picks up the current input device after a call
        let gen = generation
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.requiresOnDeviceRecognition = true
        req.shouldReportPartialResults = true
        req.contextualStrings = ["Waterly"]
        request = req
        let node = engine.inputNode
        let fmt = node.outputFormat(forBus: 0)
        guard fmt.channelCount > 0, fmt.sampleRate > 0 else { scheduleRestart(after: health.failed(), reason: "no input device format"); return }
        node.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak self] b, _ in
            req.append(b)
            DispatchQueue.main.async { if let s = self, s.generation == gen { s.health.audio(at: s.now()) } }
        }
        engine.prepare()
        do { try engine.start() } catch { log("audio engine start failed: \(error)"); scheduleRestart(after: health.failed(), reason: "engine start failed"); return }
        health.restarted(at: now())
        log("listening (\(reason))")
        task = recognizer?.recognitionTask(with: req) { [weak self] res, err in
            DispatchQueue.main.async {
                guard let self, self.generation == gen else { return }
                if let r = res, WakeMatcher.matches(r.bestTranscription.formattedString) {
                    self.onWake(); self.scheduleRestart(after: 0.3, reason: "after wake")   // clear transcript
                    return
                }
                if let err { self.scheduleRestart(after: self.health.failed(), reason: "recognizer error: \(err.localizedDescription)") }
                else if res?.isFinal ?? false { self.scheduleRestart(after: 0.3, reason: "final result") }
            }
        }
        // recognition tasks cap around 1 min; recycle periodically
        DispatchQueue.main.asyncAfter(deadline: .now() + 50) { [weak self] in
            guard let self, self.generation == gen else { return }
            self.scheduleRestart(after: 0, reason: "recycle")
        }
    }
}

// MARK: AX helpers
func axAttr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil }
func axFrame(_ e: AXUIElement) -> Rect? {
    guard let p = axAttr(e, kAXPositionAttribute), let s = axAttr(e, kAXSizeAttribute) else { return nil }
    var pt = CGPoint.zero, sz = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &pt); AXValueGetValue(s as! AXValue, .cgSize, &sz)
    return Rect(pt.x, pt.y, sz.width, sz.height)
}
func axCollect(_ root: AXUIElement, depth: Int = 0, into out: inout [(AXUIElement, Candidate)]) {
    guard depth < 40, out.count < 4000 else { return }
    let role = axAttr(root, kAXRoleAttribute) as? String ?? ""
    let texts = [kAXTitleAttribute, kAXDescriptionAttribute, kAXHelpAttribute, "AXIdentifier", kAXValueAttribute]
        .compactMap { axAttr(root, $0) as? String }.filter { !$0.isEmpty }
    if let f = axFrame(root), !texts.isEmpty {
        let en = (axAttr(root, kAXEnabledAttribute) as? Bool) ?? true
        out.append((root, Candidate(role: role, texts: texts, frame: f, enabled: en)))
    }
    for c in (axAttr(root, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { axCollect(c, depth: depth + 1, into: &out) }
}

// MARK: Grok Bot window
struct GrokWindow { let app: NSRunningApplication; let ax: AXUIElement; let frame: Rect; let windowID: CGWindowID? }
func findGrokWindow() -> GrokWindow? {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: kGrokBundle).first else { return nil }
    let axApp = AXUIElementCreateApplication(app.processIdentifier)
    let win = (axAttr(axApp, kAXFocusedWindowAttribute) as! AXUIElement?) ?? (axAttr(axApp, kAXWindowsAttribute) as? [AXUIElement])?.first
    guard let w = win, let f = axFrame(w) else { return nil }
    let infos = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    // pick the largest normal-layer window of Grok Bot (it also owns small layer-0 helper windows)
    func area(_ d: [String: Any]) -> Double { let b = d[kCGWindowBounds as String] as? [String: Double] ?? [:]; return (b["Width"] ?? 0) * (b["Height"] ?? 0) }
    let wid = infos.filter { ($0[kCGWindowOwnerPID as String] as? pid_t) == app.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }
        .max { area($0) < area($1) }?[kCGWindowNumber as String] as? CGWindowID
    return GrokWindow(app: app, ax: w, frame: f, windowID: wid)
}

// MARK: visual fallback
func captureWindow(_ id: CGWindowID) async -> CGImage? {
    do {
        let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
        guard let w = content.windows.first(where: { $0.windowID == id }) else { return nil }
        let cfg = SCStreamConfiguration()
        cfg.width = Int(w.frame.width * 2); cfg.height = Int(w.frame.height * 2); cfg.showsCursor = false
        return try await SCScreenshotManager.captureImage(contentFilter: SCContentFilter(desktopIndependentWindow: w), configuration: cfg)
    } catch { log("screen capture failed (Screen Recording permission?): \(error)"); return nil }
}
/// OCR candidates in screen coordinates.
func ocrCandidates(_ img: CGImage, window: Rect) -> [Candidate] {
    let req = VNRecognizeTextRequest(); req.recognitionLevel = .accurate; req.recognitionLanguages = ["zh-Hans", "en-US"]
    try? VNImageRequestHandler(cgImage: img).perform([req])
    return (req.results ?? []).compactMap { o in
        guard let s = o.topCandidates(1).first?.string else { return nil }
        let b = o.boundingBox // normalized, origin bottom-left
        return Candidate(role: "ocr", texts: [s], frame: Rect(window.x + b.minX * window.w, window.y + (1 - b.maxY) * window.h, b.width * window.w, b.height * window.h))
    }
}
func toGray(_ img: CGImage, scale: Double) -> Gray? {
    let w = max(1, Int(Double(img.width) * scale)), h = max(1, Int(Double(img.height) * scale))
    var buf = [UInt8](repeating: 0, count: w * h)
    guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: 0) else { return nil }
    ctx.interpolationQuality = .medium; ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
    return Gray(w: w, h: h, px: buf.map { Double($0) / 255 })
}
/// Icon template of the voice-chat button (the orange waveform circle has no text, so OCR can't see it).
/// Override: ~/Library/Application Support/Waterly/grokcall_button.png; default: bundled Resources/grokcall_button.png (captured at 2x).
func templateCandidate(_ img: CGImage, window: Rect) -> Candidate? {
    let user = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Waterly/grokcall_button.png")
    let url = FileManager.default.fileExists(atPath: user.path) ? user : (Bundle.main.url(forResource: "grokcall_button", withExtension: "png") ?? user)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let tplImg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
    let scale = 0.25   // downsample both for speed
    guard let g = toGray(img, scale: scale), let t = toGray(tplImg, scale: scale), let m = TemplateMatcher.match(g, t, stride: 1), m.score > 0.8 else { return nil }
    let sx = window.w / Double(g.w), sy = window.h / Double(g.h)
    log("template match score \(m.score)")
    return Candidate(role: "ocr", texts: ["voice call"], frame: Rect(window.x + Double(m.x) * sx, window.y + Double(m.y) * sy, Double(t.w) * sx, Double(t.h) * sy))
}
func click(at p: CGPoint) {
    let src = CGEventSource(stateID: .hidSystemState)
    for t in [CGEventType.leftMouseDown, .leftMouseUp] { CGEvent(mouseEventSource: src, mouseType: t, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap); usleep(40_000) }
}

// MARK: controller
@MainActor final class Controller {
    var flow = CallFlow(maxAttempts: 3, backoff: [1, 2, 4])
    var debounce = Debouncer(interval: 8)
    var onStatus: (String) -> Void = { _ in }

    func trigger() {
        guard debounce.shouldFire(at: Date().timeIntervalSince1970) else { log("debounced"); return }
        guard !flow.busy else { log("busy, ignore"); return }
        if let w = findGrokWindow(), isInCall(w) { status("already in a call; ignoring wake"); return }
        flow.handle(.reset); flow.handle(.wake)
        Task { await run() }
    }
    func status(_ s: String) { log(s); onStatus(s) }

    func isInCall(_ w: GrokWindow) -> Bool { var all: [(AXUIElement, Candidate)] = []; axCollect(w.ax, into: &all); return CallButtonScorer.looksInCall(all.map { $0.1 }) }

    func run() async {
        while true {
            switch flow.phase {
            case .opening:
                status("opening Grok Bot (attempt \(flow.attempt))")
                let p = Process(); p.executableURL = URL(fileURLWithPath: "/usr/bin/open"); p.arguments = [kAgentURL]
                do { try p.run(); p.waitUntilExit(); flow.handle(p.terminationStatus == 0 ? .opened : .timeout) } catch { flow.handle(.timeout) }
            case .waitingWindow:
                // Without Accessibility we can't read the window or press the button: fail fast and tell the user.
                if !AXIsProcessTrusted() {
                    status("FAILED: 需要辅助功能权限 (Accessibility) — opening System Settings")
                    NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")!)
                    NSSound.beep(); flow.handle(.reset); return
                }
                var ok = false
                for _ in 0..<20 { if let w = findGrokWindow(), w.app.isActive || w.app.activate() { ok = true; _ = w; break }; try? await Task.sleep(nanoseconds: 250_000_000) }
                try? await Task.sleep(nanoseconds: 800_000_000)   // let the chat view render
                flow.handle(ok ? .windowReady : .timeout)
            case .locating, .clicking:
                guard let w = findGrokWindow() else { flow.handle(.notFound); break }
                if isInCall(w) { status("call already active"); flow.handle(.located); flow.handle(.clicked); flow.handle(.verified); break }
                var axs: [(AXUIElement, Candidate)] = []; axCollect(w.ax, into: &axs)
                if let best = CallButtonScorer.best(axs.map { $0.1 }, window: w.frame), let el = axs.first(where: { $0.1 == best })?.0 {
                    status("AX found call button: \(best.texts)"); flow.handle(.located)
                    if AXUIElementPerformAction(el, kAXPressAction as CFString) != .success { click(at: CGPoint(x: best.frame.midX, y: best.frame.midY)) }
                    flow.handle(.clicked)
                } else if let id = w.windowID, let img = await captureWindow(id) {
                    let cands = ocrCandidates(img, window: w.frame) + [templateCandidate(img, window: w.frame)].compactMap { $0 }
                    if let best = CallButtonScorer.best(cands, window: w.frame) {
                        status("visual found call button: \(best.texts) @\(Int(best.frame.midX)),\(Int(best.frame.midY))"); flow.handle(.located)
                        click(at: CGPoint(x: best.frame.midX, y: best.frame.midY)); flow.handle(.clicked)
                    } else { status("call button not found (AX \(axs.count) els, OCR \(cands.count) boxes)"); flow.handle(.notFound) }
                } else { status("no AX match and screenshot unavailable"); flow.handle(.notFound) }
                if case .locating = flow.phase { try? await Task.sleep(nanoseconds: UInt64(flow.delayBeforeRetry() * 1e9)) }
            case .verifying:
                var ok = false
                for _ in 0..<12 { try? await Task.sleep(nanoseconds: 500_000_000)
                    if let w = findGrokWindow() { var all: [(AXUIElement, Candidate)] = []; axCollect(w.ax, into: &all)
                        if CallButtonScorer.callStarted(after: all.map { $0.1 }) { ok = true; break } } }
                if !ok, let w = findGrokWindow(), let id = w.windowID, let img = await captureWindow(id) {
                    ok = CallButtonScorer.looksInCall(ocrCandidates(img, window: w.frame))
                }
                flow.handle(ok ? .verified : .notVerified)
                if case .locating = flow.phase { try? await Task.sleep(nanoseconds: UInt64(flow.delayBeforeRetry() * 1e9)) }
            case .inCall: status("call started ✅"); flow.settle(); return
            case .failed(let why): status("FAILED: \(why)"); NSSound.beep(); flow.settle(); return
            case .idle: return
            }
        }
    }
}

// MARK: menu bar app
@MainActor final class AppDelegate: NSObject, NSApplicationDelegate {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    let listener = WakeListener(); let ctl = Controller()
    let toggle = NSMenuItem(title: "语音唤醒 GrokBot: listening for wake word “Waterly”", action: #selector(toggleListen), keyEquivalent: "")
    let statusLine = NSMenuItem(title: "Idle", action: nil, keyEquivalent: "")
    var enabled = UserDefaults.standard.object(forKey: "enabled") as? Bool ?? false   // OFF by default

    func applicationDidFinishLaunching(_ n: Notification) {
        item.button?.title = "W"
        let m = NSMenu(); toggle.target = self; m.addItem(toggle); m.addItem(statusLine)
        let test = NSMenuItem(title: "Test: start call now", action: #selector(testNow), keyEquivalent: ""); test.target = self; m.addItem(test)
        m.addItem(.separator()); m.addItem(NSMenuItem(title: "Quit 语音唤醒 GrokBot", action: #selector(NSApp.terminate(_:)), keyEquivalent: "q"))
        item.menu = m
        listener.onWake = { [weak self] in log("wake word heard"); self?.ctl.trigger() }
        ctl.onStatus = { [weak self] s in self?.statusLine.title = String(s.prefix(60)) }
        if !AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary) { log("Accessibility not granted yet") }
        // Show permission state in the menu so a missing grant is visible, not silent.
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { if !AXIsProcessTrusted() { self?.statusLine.title = "⚠️ 需要辅助功能权限" } else if self?.statusLine.title.hasPrefix("⚠️") == true { self?.statusLine.title = "Ready" } }
        }
        apply()
    }
    func apply() { toggle.state = enabled ? .on : .off; item.button?.title = enabled ? "W●" : "W"; enabled ? listener.start() : listener.stop() }
    @objc func toggleListen() { enabled.toggle(); UserDefaults.standard.set(enabled, forKey: "enabled"); apply() }
    @objc func testNow() { ctl.trigger() }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let delegate: AppDelegate = MainActor.assumeIsolated { AppDelegate() }
app.delegate = delegate
app.run()
