// Waterly AX helper. Read-only commands: perms, windows, find, focused. ("focus" sets AXFocused; not used in read-only checks.)
import Cocoa
import ApplicationServices
import CoreGraphics

func clean(_ s: String?) -> String? { s.map { String($0.unicodeScalars.filter { !(0x200E...0x200F).contains($0.value) && !(0x202A...0x202E).contains($0.value) }).trimmingCharacters(in: .whitespaces) } }

func sane(_ o: Any) -> Any { if let d = o as? Double { return d.isFinite ? d : NSNull() }; if let d = o as? CGFloat { return d.isFinite ? Double(d) : NSNull() }
  if let a = o as? [Any] { return a.map(sane) }; if let m = o as? [String: Any] { return m.mapValues(sane) }; return o }
func out(_ o: Any) { let d = try! JSONSerialization.data(withJSONObject: sane(o), options: [.sortedKeys]); print(String(data: d, encoding: .utf8)!) }
func attr(_ e: AXUIElement, _ a: String) -> AnyObject? { var v: AnyObject?; return AXUIElementCopyAttributeValue(e, a as CFString, &v) == .success ? v : nil }
func str(_ e: AXUIElement, _ a: String) -> String? { attr(e, a) as? String }
func frame(_ e: AXUIElement) -> [String: Double]? {
  guard let p = attr(e, kAXPositionAttribute), let s = attr(e, kAXSizeAttribute) else { return nil }
  var pt = CGPoint.zero, sz = CGSize.zero
  AXValueGetValue(p as! AXValue, .cgPoint, &pt); AXValueGetValue(s as! AXValue, .cgSize, &sz)
  return ["x": pt.x, "y": pt.y, "w": sz.width, "h": sz.height]
}
func desc(_ e: AXUIElement) -> [String: Any] {
  var d: [String: Any] = [:]
  d["role"] = str(e, kAXRoleAttribute) ?? ""
  if let v = str(e, kAXIdentifierAttribute) { d["identifier"] = v }
  if let v = str(e, kAXDescriptionAttribute) { d["description"] = v }
  if let v = str(e, kAXTitleAttribute) { d["title"] = v }
  if let v = attr(e, kAXValueAttribute) as? String { d["valueLength"] = v.count }
  if let n = attr(e, kAXNumberOfCharactersAttribute) as? Int { d["numChars"] = n } // never dump composer contents
  var s: DarwinBoolean = false
  if AXUIElementIsAttributeSettable(e, kAXValueAttribute as CFString, &s) == .success { d["settable"] = s.boolValue }
  if let f = frame(e) { d["frame"] = f }
  return d
}
func appFor(_ bundle: String) -> NSRunningApplication? { NSRunningApplication.runningApplications(withBundleIdentifier: bundle).first }
func walk(_ e: AXUIElement, _ depth: Int, _ f: (AXUIElement) -> Void) {
  if depth > 40 { return }; f(e)
  for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { walk(c, depth + 1, f) }
}
let a = CommandLine.arguments
guard a.count > 1 else { out(["error": "usage"]); exit(2) }
switch a[1] {
case "perms":
  out(["accessibility": AXIsProcessTrusted(), "screenRecording": CGPreflightScreenCaptureAccess()])
case "windows":
  let bundle = a.count > 2 ? a[2] : nil
  let list = (CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
  var res: [[String: Any]] = []
  for w in list where (w[kCGWindowLayer as String] as? Int) == 0 {
    let pid = w[kCGWindowOwnerPID as String] as! Int32
    let b = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    if let bundle = bundle, b != bundle { continue }
    res.append(["windowId": "\(w[kCGWindowNumber as String] as! Int)", "pid": pid, "bundleId": b,
      "title": w[kCGWindowName as String] as? String ?? "", "bounds": w[kCGWindowBounds as String] ?? [:],
      "onScreen": w[kCGWindowIsOnscreen as String] as? Bool ?? false])
  }
  out(res)
case "find": // find <bundle> <identifier|description> <value>
  guard a.count > 4, let app = appFor(a[2]) else { out(["error": "app not running"]); exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  var hits: [[String: Any]] = []
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] {
    walk(w, 0) { e in
      let v = a[3] == "identifier" ? str(e, kAXIdentifierAttribute) : str(e, kAXDescriptionAttribute)
      if clean(v) == clean(a[4]) { hits.append(desc(e)) }
    }
  }
  out(hits)
case "focused":
  guard a.count > 2, let app = appFor(a[2]) else { out(["error": "app not running"]); exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  let front = NSWorkspace.shared.frontmostApplication
  var r: [String: Any] = ["frontmostBundle": front?.bundleIdentifier ?? "", "frontmostPid": front?.processIdentifier ?? 0]
  if let fe = attr(root, kAXFocusedUIElementAttribute) { r["focusedElement"] = desc(fe as! AXUIElement) }
  if let fw = attr(root, kAXFocusedWindowAttribute) { r["focusedWindowFrame"] = frame(fw as! AXUIElement) ?? [:] }
  out(r)
case "dryrun": // dryrun <bundle> <chatName> <text>  -- paste then clear; NO Return key path exists in this helper
  guard a.count > 4, let app = appFor(a[2]) else { out(["error": "app not running"]); exit(1) }
  let pid = app.processIdentifier, chat = clean(a[3])!, text = a[4]
  let root = AXUIElementCreateApplication(pid)
  var log: [[String: Any]] = []
  func step(_ n: String, _ ok: Bool, _ extra: [String: Any] = [:]) { var d = extra; d["step"] = n; d["ok"] = ok; log.append(d) }
  func finish(_ code: Int32, _ why: String) -> Never { out(["result": why, "log": log]); exit(code) }
  func findOne(_ key: String, _ val: String) -> AXUIElement? {
    var hit: AXUIElement?
    for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in
      if hit == nil, clean(key == "identifier" ? str(e, kAXIdentifierAttribute) : str(e, kAXDescriptionAttribute)) == clean(val) { hit = e } } }
    return hit
  }
  func headerOK() -> Bool { guard let h = findOne("identifier", "NavigationBar_HeaderViewButton") else { return false }
    return [str(h, kAXDescriptionAttribute), str(h, kAXTitleAttribute)].compactMap { clean($0) }.contains(chat) }
  func count(_ e: AXUIElement) -> Int {
    if let n = attr(e, kAXNumberOfCharactersAttribute) as? Int { return n }
    if let v = attr(e, kAXValueAttribute) as? String { return v.count }
    return -1 }
  func focusOK() -> Bool {
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
          let fe = attr(root, kAXFocusedUIElementAttribute) else { return false }
    return str(fe as! AXUIElement, kAXIdentifierAttribute) == "ChatBar_ComposerTextView"
  }
  func key(_ code: CGKeyCode, cmd: Bool) {
    let src = CGEventSource(stateID: .hidSystemState)
    for down in [true, false] { let ev = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
      ev.flags = cmd ? .maskCommand : []; ev.postToPid(pid) }
    usleep(150_000)
  }
  if NSWorkspace.shared.frontmostApplication?.processIdentifier != pid { app.activate(options: []); usleep(500_000) }
  step("frontmost", NSWorkspace.shared.frontmostApplication?.processIdentifier == pid)
  if !(log.last!["ok"] as! Bool) { finish(3, "abort: WhatsApp not frontmost") }
  step("header", headerOK(), ["expected": chat]); if !(log.last!["ok"] as! Bool) { finish(3, "abort: header mismatch") }
  guard let comp = findOne("identifier", "ChatBar_ComposerTextView") else { step("composer", false); finish(3, "abort: no composer") }
  let c0 = count(comp); step("composerEmpty", c0 == 0, ["count": c0]); if c0 != 0 { finish(3, "abort: composer not empty") }
  AXUIElementSetAttributeValue(comp, kAXFocusedAttribute as CFString, kCFBooleanTrue); usleep(200_000)
  step("focus", focusOK()); if !(log.last!["ok"] as! Bool) { finish(3, "abort: focus mismatch") }
  let pb = NSPasteboard.general
  let saved: [[(NSPasteboard.PasteboardType, Data)]] = (pb.pasteboardItems ?? []).map { it in it.types.compactMap { t in it.data(forType: t).map { (t, $0) } } }
  let savedText = pb.string(forType: .string)
  func restore() { pb.clearContents(); let items = saved.map { pairs -> NSPasteboardItem in let i = NSPasteboardItem(); for (t, d) in pairs { i.setData(d, forType: t) }; return i }
    if !items.isEmpty { pb.writeObjects(items) }
    step("clipboardRestored", pb.string(forType: .string) == savedText, ["items": saved.count]) }
  pb.clearContents(); pb.setString(text, forType: .string)
  if !(headerOK() && focusOK()) { step("prePasteCheck", false); restore(); finish(3, "abort: mismatch before paste") }
  key(9, cmd: true); usleep(400_000) // Cmd+V
  let c1 = count(comp); step("pasted", c1 == text.count, ["count": c1, "expected": text.count])
  restore()
  if !(headerOK() && focusOK()) { step("preClearCheck", false); finish(4, "abort before clear: composer may contain test text (NOT sent)") }
  key(0, cmd: true); key(51, cmd: false); usleep(300_000) // Cmd+A, Delete
  let c2 = count(comp); step("cleared", c2 == 0, ["count": c2])
  finish(c2 == 0 && c1 == text.count ? 0 : 5, c2 == 0 ? "dry_run ok, nothing sent" : "composer not empty after clear (NOT sent)")
case "activate": // activate <pid>
  guard a.count > 2, let pid = Int32(a[2]), let app = NSRunningApplication(processIdentifier: pid) else { exit(1) }
  app.activate(options: []); usleep(400_000)
  if let w = (attr(AXUIElementCreateApplication(pid), kAXFocusedWindowAttribute)) { AXUIElementPerformAction(w as! AXUIElement, kAXRaiseAction as CFString) }
  out(["ok": true])
case "focusstate": // frontmost app + CG windowId of its focused window (matched by frame)
  let front = NSWorkspace.shared.frontmostApplication
  var r: [String: Any] = ["bundleId": front?.bundleIdentifier ?? "", "pid": front?.processIdentifier ?? 0, "windowId": NSNull()]
  if let f = front, let fw = attr(AXUIElementCreateApplication(f.processIdentifier), kAXFocusedWindowAttribute), let fr = frame(fw as! AXUIElement) {
    let list = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]) ?? []
    for w in list where (w[kCGWindowOwnerPID as String] as? Int32) == f.processIdentifier && (w[kCGWindowLayer as String] as? Int) == 0 {
      let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
      if abs((b["X"] ?? -1) - fr["x"]!) < 2 && abs((b["Y"] ?? -1) - fr["y"]!) < 2 && abs((b["Width"] ?? -1) - fr["w"]!) < 2 && abs((b["Height"] ?? -1) - fr["h"]!) < 2 {
        r["windowId"] = "\(w[kCGWindowNumber as String] as! Int)"; break } } }
  out(r)
case "focuselem": // focuselem <pid> identifier|description <value>
  guard a.count > 4, let pid = Int32(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(pid); var hit: AXUIElement?
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in
    if hit == nil, clean(a[3] == "identifier" ? str(e, kAXIdentifierAttribute) : str(e, kAXDescriptionAttribute)) == clean(a[4]) { hit = e } } }
  guard let h = hit else { out(["ok": false]); exit(1) }
  out(["ok": AXUIElementSetAttributeValue(h, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success])
case "focusedelem": // focusedelem <pid>
  guard a.count > 2, let pid = Int32(a[2]) else { exit(1) }
  if let fe = attr(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute) { out(desc(fe as! AXUIElement)) } else { out([String: Any]()) }
case "clipsave": // clipsave <file>
  let items = (NSPasteboard.general.pasteboardItems ?? []).map { it in Dictionary(uniqueKeysWithValues: it.types.compactMap { t in it.data(forType: t).map { (t.rawValue, $0.base64EncodedString()) } }) }
  try! JSONSerialization.data(withJSONObject: items).write(to: URL(fileURLWithPath: a[2])); out(["items": items.count])
case "cliprestore": // cliprestore <file>
  let items = (try? JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: a[2])))) as? [[String: String]] ?? []
  let pb = NSPasteboard.general; pb.clearContents()
  pb.writeObjects(items.map { d in let i = NSPasteboardItem(); for (t, v) in d { i.setData(Data(base64Encoded: v)!, forType: NSPasteboard.PasteboardType(t)) }; return i })
  out(["items": items.count])
case "clipset": // clipset <text>  -- verified by changeCount (no read-back: macOS 26+ paste privacy may block reads)
  let pb0 = NSPasteboard.general; let before = pb0.changeCount; pb0.clearContents(); let set = pb0.setString(a[2], forType: .string); let after = pb0.changeCount
  out(["ok": set && after > before, "set": set, "before": before, "after": after])
case "clipcount": // changeCount only (never reads contents)
  out(["changeCount": NSPasteboard.general.changeCount])
case "screenlocked": // CGSession: screen locked / console user
  let d = (CGSessionCopyCurrentDictionary() as? [String: Any]) ?? [:]
  out(["locked": (d["CGSSessionScreenIsLocked"] as? Bool) ?? false, "onConsole": (d["kCGSSessionOnConsoleKey"] as? Bool) ?? true])
case "key": // key <pid> <combo>  e.g. Cmd+V, Cmd+A, Delete. Return/Enter refused unless --allow-send.
  guard a.count > 3, let pid = Int32(a[2]) else { exit(1) }
  let parts = a[3].split(separator: "+").map(String.init); let k = parts.last!.lowercased()
  let codes: [String: CGKeyCode] = ["v": 9, "a": 0, "delete": 51, "return": 36, "enter": 76]
  guard let code = codes[k] else { out(["error": "unsupported key"]); exit(2) }
  if (code == 36 || code == 76) && !a.contains("--allow-send") { out(["error": "send key refused"]); exit(3) }
  let src = CGEventSource(stateID: .hidSystemState)
  for down in [true, false] { let ev = CGEvent(keyboardEventSource: src, virtualKey: code, keyDown: down)!
    ev.flags = parts.contains("Cmd") ? .maskCommand : []; ev.postToPid(pid) }
  usleep(200_000); out(["ok": true])
case "layout": // layout <bundle>: role/identifier/frame of large or identified elements, no text
  guard a.count > 2, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var res: [[String: Any]] = []
  if let w = attr(root, kAXFocusedWindowAttribute) ?? (attr(root, kAXWindowsAttribute) as? [AXUIElement])?.first {
    let wf = frame(w as! AXUIElement) ?? [:]; res.append(["role": "window", "frame": wf])
    walk(w as! AXUIElement, 0) { e in
      guard let f = frame(e) else { return }
      let id = str(e, kAXIdentifierAttribute), role = str(e, kAXRoleAttribute) ?? ""
      if (id != nil && !id!.isEmpty) || (f["w"]! * f["h"]! > 40000 && ["AXScrollArea","AXList","AXTable","AXGroup","AXSplitGroup","AXOutline","AXCollection"].contains(role)) {
        var d: [String: Any] = ["role": role, "frame": f]; if let id = id { d["identifier"] = id }; res.append(d) } } }
  out(res)
case "subtree": // subtree <bundle> <identifier> <maxDepth>: texts included (caller must redact before display)
  guard a.count > 4, let app = appFor(a[2]), let md = Int(a[4]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var top: AXUIElement?
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if top == nil, str(e, kAXIdentifierAttribute) == a[3] { top = e } } }
  guard let t = top else { out([]); exit(1) }
  var res: [[String: Any]] = []
  func rec(_ e: AXUIElement, _ d: Int) { if d > md { return }
    var x = desc(e); x["depth"] = d; if let v = attr(e, kAXValueAttribute) as? String { x["value"] = v }; res.append(x)
    for c in (attr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] { rec(c, d + 1) } }
  rec(t, 0); out(res)
case "press": // press <bundle> <identifier> <exactDescription>: AXPress a unique element (used to open a chat list cell)
  guard a.count > 4, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var hits: [AXUIElement] = []
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in
    if str(e, kAXIdentifierAttribute) == a[3] && clean(str(e, kAXDescriptionAttribute)) == clean(a[4]) && str(e, kAXRoleAttribute) == "AXButton" { hits.append(e) } } }
  guard hits.count == 1 else { out(["ok": false, "matches": hits.count]); exit(1) }
  if str(hits[0], kAXRoleAttribute) == "AXStaticText" { out(["ok": true, "alreadyOpen": true]); exit(0) } // selected cell = current chat
  out(["ok": AXUIElementPerformAction(hits[0], kAXPressAction as CFString) == .success])
case "openchat": // openchat <bundle> <exactName>: AXPress the unique chat-list cell whose description == name
  guard a.count > 3, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var list: AXUIElement?
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if list == nil, str(e, kAXIdentifierAttribute) == "ChatListView_TableView" { list = e } } }
  guard let l = list else { out(["ok": false, "error": "no list"]); exit(1) }
  let hits = ((attr(l, kAXChildrenAttribute) as? [AXUIElement]) ?? []).filter { ["AXButton", "AXStaticText"].contains(str($0, kAXRoleAttribute) ?? "") && clean(str($0, kAXDescriptionAttribute)) == clean(a[3]) }
  guard hits.count == 1 else { out(["ok": false, "matches": hits.count]); exit(1) }
  if str(hits[0], kAXRoleAttribute) == "AXStaticText" { out(["ok": true, "alreadyOpen": true]); exit(0) } // selected cell = current chat
  out(["ok": AXUIElementPerformAction(hits[0], kAXPressAction as CFString) == .success])
case "screen": // main screen visible frame (AX/top-left coords)
  let sc = NSScreen.main!; let full = sc.frame, vis = sc.visibleFrame
  out(["x": vis.minX, "y": full.maxY - vis.maxY, "w": vis.width, "h": vis.height, "fullW": full.width, "fullH": full.height])
case "setframe": // setframe <bundle> x y w h : move/resize the app's main (largest) AX window
  guard a.count > 6, let app = appFor(a[2]), let x = Double(a[3]), let y = Double(a[4]), let w = Double(a[5]), let h = Double(a[6]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  let wins = ((attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []).sorted { (frame($0)?["w"] ?? 0) * (frame($0)?["h"] ?? 0) > (frame($1)?["w"] ?? 0) * (frame($1)?["h"] ?? 0) }
  guard let win = wins.first else { out(["ok": false]); exit(1) }
  var p = CGPoint(x: x, y: y), sz = CGSize(width: w, height: h)
  let r1 = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, AXValueCreate(.cgPoint, &p)!)
  let r2 = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, AXValueCreate(.cgSize, &sz)!)
  usleep(600_000)
  out(["ok": r1 == .success && r2 == .success, "frame": frame(win) ?? [:]])
case "listscroll": // listscroll <bundle> info | set <0..1> | wheel <dy-pixels>   (chat list only)
  guard a.count > 3, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var list: AXUIElement?
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if list == nil, str(e, kAXIdentifierAttribute) == "ChatListView_TableView" { list = e } } }
  guard let l = list else { out(["ok": false, "error": "no list"]); exit(1) }
  // nearest AXScrollArea ancestor (or the list itself) and its vertical scroll bar
  var area: AXUIElement? = l; var hops = 0
  while let cur = area, str(cur, kAXRoleAttribute) != "AXScrollArea", hops < 6 { area = attr(cur, kAXParentAttribute).map { $0 as! AXUIElement }; hops += 1 }
  if let ar = area, str(ar, kAXRoleAttribute) != "AXScrollArea" { area = nil }
  let bar = area.flatMap { attr($0, kAXVerticalScrollBarAttribute) }.map { $0 as! AXUIElement }
  var settable: DarwinBoolean = false
  if let b = bar { AXUIElementIsAttributeSettable(b, kAXValueAttribute as CFString, &settable) }
  let lf = frame(l) ?? [:]
  switch a[3] {
  case "actions": // AX actions on list, its ancestors and last child
    func acts(_ e: AXUIElement) -> [String] { var n: CFArray?; AXUIElementCopyActionNames(e, &n); return (n as? [String]) ?? [] }
    var res: [[String: Any]] = []; var cur: AXUIElement? = l; var d = 0
    while let c = cur, d < 6 { res.append(["up": d, "role": str(c, kAXRoleAttribute) ?? "", "id": str(c, kAXIdentifierAttribute) ?? "", "actions": acts(c)]); cur = attr(c, kAXParentAttribute).map { $0 as! AXUIElement }; d += 1 }
    if let last = ((attr(l, kAXChildrenAttribute) as? [AXUIElement]) ?? []).last { res.append(["lastChild": true, "role": str(last, kAXRoleAttribute) ?? "", "actions": acts(last)]) }
    out(res)
  case "tovisible": // AXScrollToVisible on last (or first with arg 'first') child
    let kids = (attr(l, kAXChildrenAttribute) as? [AXUIElement]) ?? []
    guard let k = (a.count > 4 && a[4] == "first") ? kids.first : kids.last else { exit(1) }
    let r = AXUIElementPerformAction(k, "AXScrollToVisible" as CFString); usleep(400_000); out(["ok": r == .success])
  case "hidwheel": // wheel via HID tap with cursor temporarily over the list, then cursor restored
    guard a.count > 4, let dy = Int32(a[4]) else { exit(1) }
    let af = area.flatMap { frame($0) } ?? lf
    let pt = CGPoint(x: af["x"]! + af["w"]! / 2, y: af["y"]! + min(af["h"]! / 2, 300))
    let saved = CGEvent(source: nil)!.location
    CGWarpMouseCursorPosition(pt); usleep(80_000)
    var left = dy; let step: Int32 = dy > 0 ? 120 : -120
    while left != 0 { let d = abs(left) < abs(step) ? left : step
      CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -d, wheel2: 0, wheel3: 0)!.post(tap: .cghidEventTap); left -= d; usleep(30_000) }
    usleep(300_000); CGWarpMouseCursorPosition(saved); out(["ok": true, "barValue": -1])
  case "page": // page down|up via AXScrollDownByPage / AXScrollUpByPage on the list
    guard a.count > 4 else { exit(1) }
    let r = AXUIElementPerformAction(l, (a[4] == "up" ? "AXScrollUpByPage" : "AXScrollDownByPage") as CFString); usleep(350_000)
    out(["ok": r == .success, "barValue": -1])
  case "info":
    out(["scrollArea": area != nil, "bar": bar != nil, "barValue": bar.flatMap { attr($0, kAXValueAttribute) as? Double } ?? -1, "barSettable": settable.boolValue, "listFrame": lf, "areaFrame": area.flatMap { frame($0) } ?? [:]])
  case "set":
    guard let b = bar, settable.boolValue, a.count > 4, let v = Double(a[4]) else { out(["ok": false, "error": "bar not settable"]); exit(1) }
    let r = AXUIElementSetAttributeValue(b, kAXValueAttribute as CFString, NSNumber(value: v)); usleep(350_000)
    out(["ok": r == .success, "barValue": attr(b, kAXValueAttribute) as? Double ?? -1])
  case "wheel":
    guard a.count > 4, let dy = Int32(a[4]) else { exit(1) }
    let af = area.flatMap { frame($0) } ?? lf
    let pt = CGPoint(x: af["x"]! + af["w"]! / 2, y: af["y"]! + min(af["h"]! / 2, 300))
    var left = dy; let step: Int32 = dy > 0 ? 120 : -120
    while left != 0 { let d = abs(left) < abs(step) ? left : step
      let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -d, wheel2: 0, wheel3: 0)!
      ev.location = pt; ev.postToPid(app.processIdentifier); left -= d; usleep(30_000) }
    usleep(400_000); out(["ok": true, "barValue": bar.flatMap { attr($0, kAXValueAttribute) as? Double } ?? -1])
  default: exit(2)
  }
case "appattr": // appattr <bundle> <AXEnhancedUserInterface|AXManualAccessibility> [true|false]  (get or set)
  guard a.count > 3, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  if a.count > 4 { let r = AXUIElementSetAttributeValue(root, a[3] as CFString, (a[4] == "true" ? kCFBooleanTrue : kCFBooleanFalse)!); usleep(800_000); out(["set": r.rawValue]) }
  else { out(["value": (attr(root, a[3]) as? Bool).map { $0 as Any } ?? NSNull()]) }
case "childcount": // childcount <bundle>: children per window (no text)
  guard a.count > 2, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier)
  out(((attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? []).map { w -> [String: Any] in
    var n = 0; walk(w, 0) { _ in n += 1 }; return ["frame": frame(w) ?? [:], "direct": ((attr(w, kAXChildrenAttribute) as? [AXUIElement]) ?? []).count, "total": n] })
case "clickat": // clickat <pid> <screenX> <screenY> : left click posted to the app (used only to open chats / focus composer)
  guard a.count > 4, let pid = Int32(a[2]), let x = Double(a[3]), let y = Double(a[4]) else { exit(1) }
  let p = CGPoint(x: x, y: y)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] { let ev = CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!; ev.postToPid(pid); usleep(60_000) }
  usleep(300_000); out(["ok": true])
case "wheelat": // wheelat <pid> <screenX> <screenY> <dy>
  guard a.count > 5, let pid = Int32(a[2]), let x = Double(a[3]), let y = Double(a[4]), let dy = Int32(a[5]) else { exit(1) }
  var left = dy; let step: Int32 = dy > 0 ? 120 : -120
  while left != 0 { let d = abs(left) < abs(step) ? left : step
    let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -d, wheel2: 0, wheel3: 0)!
    ev.location = CGPoint(x: x, y: y); ev.postToPid(pid); left -= d; usleep(30_000) }
  usleep(400_000); out(["ok": true])
case "hidwheelat": // hidwheelat <screenX> <screenY> <dy> : system wheel with pointer briefly over (x,y), pointer restored
  guard a.count > 4, let x = Double(a[2]), let y = Double(a[3]), let dy = Int32(a[4]) else { exit(1) }
  let saved = CGEvent(source: nil)!.location
  CGWarpMouseCursorPosition(CGPoint(x: x, y: y)); usleep(80_000)
  var left = dy; let step: Int32 = dy > 0 ? 120 : -120
  while left != 0 { let d = abs(left) < abs(step) ? left : step
    CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1, wheel1: -d, wheel2: 0, wheel3: 0)!.post(tap: .cghidEventTap); left -= d; usleep(30_000) }
  usleep(250_000); CGWarpMouseCursorPosition(saved); usleep(300_000); out(["ok": true])
case "hidclickat": // hidclickat <screenX> <screenY> : system-level left click, pointer restored afterwards
  guard a.count > 3, let x = Double(a[2]), let y = Double(a[3]) else { exit(1) }
  let saved = CGEvent(source: nil)!.location; let p = CGPoint(x: x, y: y)
  CGWarpMouseCursorPosition(p); usleep(60_000)
  for t in [CGEventType.leftMouseDown, .leftMouseUp] { CGEvent(mouseEventSource: nil, mouseType: t, mouseCursorPosition: p, mouseButton: .left)!.post(tap: .cghidEventTap); usleep(70_000) }
  usleep(150_000); CGWarpMouseCursorPosition(saved); usleep(250_000); out(["ok": true])
case "axpress": // axpress <bundle> <identifier> : AXPress the unique element with this identifier (reports actions if unsupported)
  guard a.count > 3, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var hits: [AXUIElement] = []
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if str(e, kAXIdentifierAttribute) == a[3] { hits.append(e) } } }
  guard hits.count == 1 else { out(["ok": false, "matches": hits.count]); exit(0) }
  var n: CFArray?; AXUIElementCopyActionNames(hits[0], &n); let acts = (n as? [String]) ?? []
  if !acts.contains("AXPress") { out(["ok": false, "actions": acts, "frame": frame(hits[0]) ?? [:]]); exit(0) }
  out(["ok": AXUIElementPerformAction(hits[0], kAXPressAction as CFString) == .success, "actions": acts])
case "axfocus": // axfocus <bundle> <identifier> : set AXFocused on unique element
  guard a.count > 3, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var hits: [AXUIElement] = []
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if str(e, kAXIdentifierAttribute) == a[3] { hits.append(e) } } }
  guard hits.count == 1 else { out(["ok": false, "matches": hits.count]); exit(0) }
  out(["ok": AXUIElementSetAttributeValue(hits[0], kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success])
case "elemactions": // elemactions <bundle> <identifier>
  guard a.count > 3, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var res: [[String: Any]] = []
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if str(e, kAXIdentifierAttribute) == a[3] {
    var n: CFArray?; AXUIElementCopyActionNames(e, &n); var names: CFArray?; AXUIElementCopyAttributeNames(e, &names)
    res.append(["actions": (n as? [String]) ?? [], "attrs": (names as? [String]) ?? []]) } } }
  out(res)
case "axaction": // axaction <bundle> <identifier> <AXActionName>
  guard a.count > 4, let app = appFor(a[2]) else { exit(1) }
  let root = AXUIElementCreateApplication(app.processIdentifier); var hits: [AXUIElement] = []
  for w in (attr(root, kAXWindowsAttribute) as? [AXUIElement]) ?? [] { walk(w, 0) { e in if str(e, kAXIdentifierAttribute) == a[3] { hits.append(e) } } }
  guard hits.count == 1 else { out(["ok": false, "matches": hits.count]); exit(0) }
  let r = AXUIElementPerformAction(hits[0], a[4] as CFString); usleep(350_000); out(["ok": r == .success, "err": r.rawValue])
default: out(["error": "unknown or disabled command"]); exit(2)
}
