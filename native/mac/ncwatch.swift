// ncwatch: watch Notification Center banners via Accessibility (AXObserver + 1s poll fallback). Read-only:
// never clicks banners, never reads any DB/files. Emits JSON lines: {ts, kind:"banner", texts, desc, ids}.
// Usage: ncwatch [seconds]
import Cocoa
import ApplicationServices
setvbuf(stdout, nil, _IOLBF, 0)
let secs = Double(CommandLine.arguments.dropFirst().first ?? "300") ?? 300
func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil }
func str(_ e: AXUIElement, _ a: String) -> String? { attr(e, a) as? String }
func out(_ o: Any) { if let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) { print(s) } }
guard let nc = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.notificationcenterui").first else { out(["error": "notificationcenterui not running"]); exit(1) }
let root = AXUIElementCreateApplication(nc.processIdentifier)
var seen = Set<String>()
func collect(_ e: AXUIElement, _ d: Int, _ texts: inout [String], _ descs: inout [String], _ ids: inout [String]) {
  if d > 14 { return }
  let role = str(e, kAXRoleAttribute) ?? ""
  if role == "AXStaticText", let v = str(e, kAXValueAttribute), !v.isEmpty { texts.append(v) }
  if let s = str(e, kAXDescriptionAttribute), !s.isEmpty { descs.append(s) }
  if let i = str(e, kAXIdentifierAttribute), !i.isEmpty { ids.append(i) }
  for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { collect(c, d + 1, &texts, &descs, &ids) }
}
// a banner = an element whose subtree has static texts; group at AXGroup/AXButton level carrying AXDescription
let dump = CommandLine.arguments.contains("--dump"); var lastDump = ""
func dumpTree() { var lines: [String] = []
  func rec(_ e: AXUIElement, _ d: Int) { if d > 16 { return }
    lines.append(String(repeating: " ", count: d) + [str(e, kAXRoleAttribute) ?? "", str(e, kAXSubroleAttribute) ?? "", str(e, kAXIdentifierAttribute) ?? "", str(e, kAXDescriptionAttribute) ?? "", str(e, kAXTitleAttribute) ?? "", (attr(e, kAXValueAttribute) as? String) ?? ""].joined(separator: " | "))
    for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { rec(c, d + 1) } }
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { rec(w, 0) }
  let s = lines.joined(separator: "\n"); if s != lastDump && !s.isEmpty { lastDump = s; out(["kind": "dump", "ts": ISO8601DateFormatter().string(from: Date()), "tree": lines]) } }
func scan(_ why: String) { if dump { dumpTree() }
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] {
    var stack: [(AXUIElement, Int)] = [(w, 0)]
    while let (e, d) = stack.popLast() {
      let role = str(e, kAXRoleAttribute) ?? ""; let sub = str(e, kAXSubroleAttribute) ?? ""
      let isBanner = sub == "AXNotificationCenterBanner" || sub == "AXNotificationCenterAlert" || (role == "AXGroup" && (str(e, kAXDescriptionAttribute) ?? "").contains(",") && d > 2)
      if isBanner { var t: [String] = [], ds: [String] = [], ids: [String] = []; collect(e, 0, &t, &ds, &ids)
        let key = (ds.first ?? "") + "|" + t.joined(separator: "|")
        if !seen.contains(key) { seen.insert(key); out(["ts": ISO8601DateFormatter().string(from: Date()), "kind": "banner", "via": why, "subrole": sub, "texts": t, "desc": ds, "ids": ids]) }
        continue }
      if d < 12 { for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { stack.append((c, d + 1)) } }
    }
  }
}
var obs: AXObserver?
AXObserverCreate(nc.processIdentifier, { _, _, n, _ in scan(n as String) }, &obs)
if let o = obs { for n in [kAXWindowCreatedNotification, kAXCreatedNotification, kAXUIElementDestroyedNotification, kAXLayoutChangedNotification] { AXObserverAddNotification(o, root, n as CFString, nil) }
  CFRunLoopAddSource(CFRunLoopGetCurrent(), AXObserverGetRunLoopSource(o), .defaultMode) }
let trusted = AXIsProcessTrusted()
out(["kind": "start", "pid": nc.processIdentifier, "observer": obs != nil, "trusted": trusted])
// under launchd AX trust belongs to this binary itself: if untrusted, exit non-zero (KeepAlive retries) after a pause
if !trusted { sleep(60); exit(4) }
Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in scan("poll") }
Timer.scheduledTimer(withTimeInterval: secs, repeats: false) { _ in out(["kind": "end"]); exit(0) }
scan("init"); RunLoop.main.run()
