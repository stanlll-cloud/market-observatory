import Cocoa
import WebKit

private let DEFAULT_SERVER = "http://127.0.0.1:8766"
private let SERVER_KEY = "obs_selected_server_pub"
private let CUSTOM_SERVER_KEY = "obs_custom_server"
private let ZOOM_KEY = "obs_mac_page_zoom"

private struct ServerNode {
    let title: String
    let url: String
}

final class ObservatoryAppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverMenu: NSMenu?
    private var serverMenuItems: [NSMenuItem] = []
    private var keyMonitor: Any?
    private var backendProcess: Process?

    private var customServerURL: String {
        (UserDefaults.standard.string(forKey: CUSTOM_SERVER_KEY) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func currentServerNodes() -> [ServerNode] {
        var nodes = [
            ServerNode(title: "💻 本地独立引擎 (127.0.0.1:8766)", url: DEFAULT_SERVER)
        ]
        let custom = customServerURL
        if !custom.isEmpty && custom != DEFAULT_SERVER {
            nodes.append(ServerNode(title: "🌐 自定义线路 (\(custom))", url: custom))
        }
        return nodes
    }

    private var currentBaseURL: String {
        let saved = (UserDefaults.standard.string(forKey: SERVER_KEY) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return saved.isEmpty ? DEFAULT_SERVER : saved
    }

    private var currentZoom: CGFloat {
        let saved = UserDefaults.standard.double(forKey: ZOOM_KEY)
        if saved <= 0 { return 1.0 }
        return min(2.0, max(0.6, CGFloat(saved)))
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.appearance = NSAppearance(named: .darkAqua)

        let screenRect = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let initW = min(1480.0, screenRect.width * 0.92)
        let initH = min(920.0, screenRect.height * 0.90)
        let rect = NSRect(
            x: screenRect.midX - initW / 2,
            y: screenRect.midY - initH / 2,
            width: initW,
            height: initH
        )

        window = NSWindow(
            contentRect: rect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "观势 · Market Observatory"
        window.minSize = NSSize(width: 900, height: 560)
        window.backgroundColor = NSColor(red: 5/255.0, green: 12/255.0, blue: 10/255.0, alpha: 1.0)
        window.setFrameAutosaveName("MarketObservatoryMainWindow")

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")

        let ucc = config.userContentController
        ucc.add(self, name: "obsNative")
        let bridgeScript = WKUserScript(
            source: "window.__IS_OBS_MAC_APP = true;",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        ucc.addUserScript(bridgeScript)

        webView = WKWebView(frame: window.contentView?.bounds ?? rect, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.pageZoom = currentZoom
        updateWindowTitle(zoom: currentZoom)

        window.contentView?.addSubview(webView)
        buildMenus()
        installZoomKeyMonitor()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        showBootSplashIfLocal()
        ensureLocalBackendIfNeeded { [weak self] in
            self?.loadEndpoint(path: "")
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let monitor = keyMonitor {
            NSEvent.removeMonitor(monitor)
            keyMonitor = nil
        }
        if let proc = backendProcess, proc.isRunning {
            proc.terminate()
            backendProcess = nil
        }
    }

    private func installZoomKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self = self else { return event }
            let mods = event.modifierFlags.intersection([.command, .option, .control])
            guard mods == .command else { return event }

            let chars = event.charactersIgnoringModifiers ?? ""
            let code = event.keyCode
            // '=' (24), '+' (Shift+= or chars), Numpad '+' (69)
            if chars == "=" || chars == "+" || code == 24 || code == 69 {
                self.zoomIn()
                return nil
            }
            // '-' (27), '_', Numpad '-' (78)
            if chars == "-" || chars == "_" || code == 27 || code == 78 {
                self.zoomOut()
                return nil
            }
            // '0' (29), Numpad '0' (82)
            if chars == "0" || code == 29 || code == 82 {
                self.zoomReset()
                return nil
            }
            return event
        }
    }

    private func updateWindowTitle(zoom: CGFloat) {
        let pct = Int(round(zoom * 100.0))
        window.title = pct == 100
            ? "观势 · Market Observatory"
            : "观势 · Market Observatory (\(pct)%)"
    }

    private func applyZoom(_ rawZoom: CGFloat) {
        let clamped = min(2.0, max(0.6, rawZoom))
        let rounded = (round(clamped * 20.0) / 20.0)
        UserDefaults.standard.set(Double(rounded), forKey: ZOOM_KEY)
        webView.pageZoom = rounded
        updateWindowTitle(zoom: rounded)
        let pct = Int(round(rounded * 100.0))
        webView.evaluateJavaScript("window.__onNativeZoom && window.__onNativeZoom(\(pct));", completionHandler: nil)
    }

    private func applyWindowResolution(width: CGFloat, height: CGFloat, maximize: Bool = false) {
        guard let visible = (window.screen ?? NSScreen.main)?.visibleFrame else { return }
        if maximize {
            window.setFrame(visible, display: true, animate: true)
            return
        }
        let targetW = min(max(width, window.minSize.width), visible.width)
        let targetH = min(max(height, window.minSize.height), visible.height)
        let rect = NSRect(
            x: visible.midX - targetW / 2.0,
            y: visible.midY - targetH / 2.0,
            width: targetW,
            height: targetH
        )
        window.setFrame(rect, display: true, animate: true)
    }

    private func isLocalBackendURL(_ urlStr: String) -> Bool {
        return urlStr.contains("127.0.0.1:8766") || urlStr.contains("localhost:8766")
    }

    private func showBootSplashIfLocal() {
        guard isLocalBackendURL(currentBaseURL) else { return }
        let html = """
        <html><body style="background:#050c0a;color:#e6f4ef;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;">
          <div style="font-size:20px;font-weight:700;color:#34d399;margin-bottom:8px;">观势 · Market Observatory</div>
          <div style="font-size:13px;color:#93b5a9;">正在启动内置量化看盘引擎...</div>
        </div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }

    private func isLocalHealthReady() -> Bool {
        guard let url = URL(string: "http://127.0.0.1:8766/api/health") else { return false }
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        let cfg = URLSessionConfiguration.ephemeral
        cfg.connectionProxyDictionary = [:]
        cfg.timeoutIntervalForRequest = 0.8
        cfg.timeoutIntervalForResource = 0.8
        let session = URLSession(configuration: cfg)
        var req = URLRequest(url: url)
        req.timeoutInterval = 0.8
        session.dataTask(with: req) { data, response, _ in
            if let http = response as? HTTPURLResponse, http.statusCode == 200,
               let data = data,
               let text = String(data: data, encoding: .utf8),
               text.contains("ok") {
                ok = true
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 1.0)
        session.invalidateAndCancel()
        return ok
    }

    private func ensureLocalBackendIfNeeded(completion: @escaping () -> Void) {
        guard isLocalBackendURL(currentBaseURL) else {
            DispatchQueue.main.async(execute: completion)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            if self.isLocalHealthReady() {
                DispatchQueue.main.async(execute: completion)
                return
            }
            if let serverExec = Bundle.main.resourceURL?.appendingPathComponent("obs-server/obs-server"),
               FileManager.default.isExecutableFile(atPath: serverExec.path) {
                if self.backendProcess == nil || !(self.backendProcess?.isRunning ?? false) {
                    let proc = Process()
                    proc.executableURL = serverExec
                    proc.arguments = ["--server-only", "--port", "8766"]
                    proc.currentDirectoryURL = serverExec.deletingLastPathComponent()
                    do {
                        try proc.run()
                        self.backendProcess = proc
                    } catch {
                        // Fall through to let WebView display connection message if needed
                    }
                }
                for _ in 0..<30 {
                    if self.isLocalHealthReady() {
                        break
                    }
                    Thread.sleep(forTimeInterval: 0.2)
                }
            }
            DispatchQueue.main.async(execute: completion)
        }
    }

    private func loadEndpoint(path: String) {
        let base = currentBaseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let full = path.isEmpty ? "\(base)/" : "\(base)\(path)"
        if let url = URL(string: full) {
            var req = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20)
            req.setValue("MarketObservatoryMac/1.1", forHTTPHeaderField: "User-Agent")
            webView.load(req)
        }
    }

    private func buildMenus() {
        let mainMenu = NSMenu()

        // App Menu
        let appMenuItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于 观势 · Market Observatory", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏观势", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出观势", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // Edit Menu (enables Cmd+C/V/X/A in WKWebView inputs)
        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // View Menu
        let viewMenuItem = NSMenuItem()
        let viewMenu = NSMenu(title: "看盘视图")
        viewMenu.addItem(withTitle: "📊 深度看盘台", action: #selector(goWorkbench), keyEquivalent: "1")
        viewMenu.addItem(withTitle: "⚡ 量化选股雷达", action: #selector(goRadar), keyEquivalent: "2")
        viewMenu.addItem(withTitle: "📅 避雷日历", action: #selector(goCalendar), keyEquivalent: "3")
        viewMenu.addItem(withTitle: "🏦 美股 ETF 计划", action: #selector(goEtfPlan), keyEquivalent: "4")
        viewMenu.addItem(withTitle: "🔍 快速搜票 / 切周期 (⌘K)", action: #selector(openCmdK), keyEquivalent: "k")
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "🔄 刷新当前行情", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // Zoom & Resolution Menu
        let dispMenuItem = NSMenuItem()
        let dispMenu = NSMenu(title: "缩放与分辨率")
        dispMenu.addItem(withTitle: "放大界面 (+)", action: #selector(zoomIn), keyEquivalent: "=")
        dispMenu.addItem(withTitle: "缩小界面 (-)", action: #selector(zoomOut), keyEquivalent: "-")
        dispMenu.addItem(withTitle: "实际大小 (100%)", action: #selector(zoomReset), keyEquivalent: "0")
        dispMenu.addItem(.separator())
        dispMenu.addItem(withTitle: "紧凑笔记本 1280 × 800", action: #selector(res1280), keyEquivalent: "")
        dispMenu.addItem(withTitle: "标准桌面 1440 × 900", action: #selector(res1440), keyEquivalent: "")
        dispMenu.addItem(withTitle: "2K 宽屏工作站 1728 × 1080", action: #selector(res1728), keyEquivalent: "")
        dispMenu.addItem(withTitle: "4K 超宽巨幕 2200 × 1280", action: #selector(res2200), keyEquivalent: "")
        dispMenu.addItem(withTitle: "铺满当前屏幕", action: #selector(resMaximize), keyEquivalent: "")
        dispMenuItem.submenu = dispMenu
        mainMenu.addItem(dispMenuItem)

        // Server Menu
        let srvMenuItem = NSMenuItem()
        let srvMenu = NSMenu(title: "数据线路")
        self.serverMenu = srvMenu
        rebuildServerMenu()
        srvMenuItem.submenu = srvMenu
        mainMenu.addItem(srvMenuItem)

        // Window Menu
        let winMenuItem = NSMenuItem()
        let winMenu = NSMenu(title: "窗口")
        winMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        winMenu.addItem(withTitle: "进入全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        winMenuItem.submenu = winMenu
        mainMenu.addItem(winMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc private func showAbout() {
        let alert = NSAlert()
        alert.messageText = "观势 · Market Observatory"
        alert.informativeText = "缠论结构 · 均线扣抵 · 量化选股雷达 · 宏观财报日历\n快捷键: ⌘+放大 / ⌘-缩小 / ⌘0重置\n当前数据线路: \(currentBaseURL)"
        alert.runModal()
    }

    @objc private func goWorkbench() {
        webView.evaluateJavaScript("if(window.__switchObsView){window.__switchObsView('workbench');}else{window.location.href='/';}", completionHandler: nil)
    }
    @objc private func goRadar() {
        webView.evaluateJavaScript("if(window.__switchObsView){window.__switchObsView('radar');}else{window.location.href='/?view=radar';}", completionHandler: nil)
    }
    @objc private func goCalendar() {
        webView.evaluateJavaScript("if(window.__switchObsView){window.__switchObsView('calendar');}else{window.location.href='/?view=calendar';}", completionHandler: nil)
    }
    @objc private func goEtfPlan() {
        webView.evaluateJavaScript("if(window.__switchObsView){window.__switchObsView('etf_plan');}else{window.location.href='/?view=etf_plan';}", completionHandler: nil)
    }
    @objc private func openCmdK() {
        webView.evaluateJavaScript("window.__openCmdK && window.__openCmdK();", completionHandler: nil)
    }
    @objc private func reloadPage() { webView.reload() }

    @objc private func zoomIn() { applyZoom(currentZoom + 0.10) }
    @objc private func zoomOut() { applyZoom(currentZoom - 0.10) }
    @objc private func zoomReset() { applyZoom(1.0) }

    @objc private func res1280() { applyWindowResolution(width: 1280, height: 800) }
    @objc private func res1440() { applyWindowResolution(width: 1440, height: 900) }
    @objc private func res1728() { applyWindowResolution(width: 1728, height: 1080) }
    @objc private func res2200() { applyWindowResolution(width: 2200, height: 1280) }
    @objc private func resMaximize() { applyWindowResolution(width: 0, height: 0, maximize: true) }

    private func rebuildServerMenu() {
        guard let srvMenu = serverMenu else { return }
        srvMenu.removeAllItems()
        serverMenuItems.removeAll()
        let activeURL = currentBaseURL
        let nodes = currentServerNodes()
        for (idx, node) in nodes.enumerated() {
            let item = NSMenuItem(title: node.title, action: #selector(selectServer(_:)), keyEquivalent: "")
            item.tag = idx
            item.state = (node.url == activeURL) ? .on : .off
            srvMenu.addItem(item)
            serverMenuItems.append(item)
        }
        srvMenu.addItem(.separator())
        srvMenu.addItem(withTitle: "🌐 设置自定义云端服务器...", action: #selector(promptCustomServer), keyEquivalent: "")
    }

    @objc private func selectServer(_ sender: NSMenuItem) {
        let idx = sender.tag
        let nodes = currentServerNodes()
        guard idx >= 0 && idx < nodes.count else { return }
        let selected = nodes[idx].url
        UserDefaults.standard.set(selected, forKey: SERVER_KEY)
        rebuildServerMenu()
        showBootSplashIfLocal()
        ensureLocalBackendIfNeeded { [weak self] in
            self?.loadEndpoint(path: "")
        }
    }

    @objc private func promptCustomServer() {
        let alert = NSAlert()
        alert.messageText = "设置自定义云端服务器"
        alert.informativeText = "输入你部署的「观势」服务端地址（例如 https://your-domain.com 或 http://IP:8766）："
        alert.addButton(withTitle: "连接并使用")
        alert.addButton(withTitle: "取消")
        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 340, height: 24))
        input.placeholderString = "http://127.0.0.1:8766"
        input.stringValue = customServerURL.isEmpty ? currentBaseURL : customServerURL
        alert.accessoryView = input
        if alert.runModal() == .alertFirstButtonReturn {
            let raw = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !raw.isEmpty else { return }
            let normalized = raw.hasPrefix("http://") || raw.hasPrefix("https://") ? raw : "http://\(raw)"
            UserDefaults.standard.set(normalized, forKey: CUSTOM_SERVER_KEY)
            UserDefaults.standard.set(normalized, forKey: SERVER_KEY)
            rebuildServerMenu()
            loadEndpoint(path: "")
        }
    }

    // Receive zoom & resolution requests from frontend web UI
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "obsNative", let body = message.body as? [String: Any] else { return }
        let action = body["action"] as? String ?? ""
        if action == "setZoom", let pct = (body["pct"] as? NSNumber)?.doubleValue {
            applyZoom(CGFloat(pct / 100.0))
        } else if action == "stepZoom", let delta = (body["delta"] as? NSNumber)?.doubleValue {
            applyZoom(currentZoom + CGFloat(delta / 100.0))
        } else if action == "setResolution" {
            let maxFlag = body["maximize"] as? Bool ?? false
            let w = (body["width"] as? NSNumber)?.doubleValue ?? 1440
            let h = (body["height"] as? NSNumber)?.doubleValue ?? 900
            applyWindowResolution(width: CGFloat(w), height: CGFloat(h), maximize: maxFlag)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let zoom = currentZoom
        webView.pageZoom = zoom
        updateWindowTitle(zoom: zoom)
        let pct = Int(round(zoom * 100.0))
        webView.evaluateJavaScript("window.__IS_OBS_MAC_APP = true; window.__onNativeZoom && window.__onNativeZoom(\(pct));", completionHandler: nil)
    }

    // Handle external links or download files cleanly in browser
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url {
            let path = url.path.lowercased()
            if path.hasSuffix(".dmg") || path.hasSuffix(".exe") || path.hasSuffix(".zip") || path.hasSuffix(".mobileconfig") || path.hasPrefix("/downloads/") {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let html = """
        <html><body style="background:#050c0a;color:#e6f4ef;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
        <div style="text-align:center;max-width:460px;padding:24px;border:1px solid #183c32;border-radius:12px;background:#0a1714;">
          <h2 style="margin:0 0 10px;color:#ffd400;">行情线路连接受阻</h2>
          <p style="color:#93b5a9;font-size:13px;line-height:1.6;">无法连接至 <b>\(currentBaseURL)</b><br/>\(error.localizedDescription)</p>
          <p style="color:#7ca094;font-size:12px;">可在顶部菜单栏「数据线路」切换为本地独立引擎或自定义云端服务器，或按 ⌘R 重试。</p>
        </div></body></html>
        """
        webView.loadHTMLString(html, baseURL: nil)
    }
}

let app = NSApplication.shared
let delegate = ObservatoryAppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
