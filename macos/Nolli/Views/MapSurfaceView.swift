import SwiftUI
import AppKit
import Combine

// MARK: - SwiftUI wrapper

struct MapSurface: NSViewRepresentable {
    let appState: AppState

    func makeNSView(context: Context) -> MapSurfaceNSView { MapSurfaceNSView(appState: appState) }
    func updateNSView(_ nsView: MapSurfaceNSView, context: Context) {}
}

// MARK: - The map surface

/// The one and only map view. Tiles, vector geometry, icons and labels are all
/// rasterized together from a single camera snapshot on a background queue; the
/// result is a GPU layer. While the camera moves, that layer is transformed
/// immediately (so gestures run at display rate regardless of how much is on the
/// map) and a fresh raster replaces it as soon as it's ready. Because everything
/// lives in one bitmap, tiles and vectors physically cannot separate.
///
/// Handles, markers and rubber bands are drawn by a thin overlay view from the
/// same camera in the same display cycle.
@MainActor
final class MapSurfaceNSView: NSView {
    private let appState: AppState
    private var camera: MapCamera { appState.camera }
    private let contentLayer = CALayer()
    private let overlay = MapOverlayView()
    private var bag = Set<AnyCancellable>()

    // Raster pipeline
    private let rasterQueue = DispatchQueue(label: "nolli.raster", qos: .userInteractive)
    private var rasterBusy = false
    private var rasterWanted = false
    private var rasterProjection: MapProjection?
    private var excludeLabel: String?
    private var excludeIcon: String?
    private var scene: CompiledScene?
    private var sceneDirty = true
    private var moving = false
    private var settleWork: DispatchWorkItem?
    private let perf = ProcessInfo.processInfo.environment["NOLLI_PERF"] != nil

    // Animation
    private var link: CADisplayLink?
    private var zoomEase: (target: Double, anchor: CGPoint)?
    private var flight: (start: CameraTarget, end: CameraTarget, t0: CFTimeInterval, duration: CFTimeInterval)?

    // Gestures
    private enum Drag {
        case none
        case pan(last: CGPoint)
        case rotate(lastAngle: Double)
        case rubberBand(start: CGPoint, current: CGPoint)
        case sign(id: UUID)
        case curvedLabel(placed: PlacedLineLabel, label: CompiledScene.Label, dist: Double)
        case freeLabel(label: CompiledScene.Label, start: CGPoint, delta: CGVector)
        case icon(layerId: UUID, featureId: Int64, start: CGPoint, delta: CGVector)
        case vertex(handle: VertexHandle, point: CGPoint)
    }
    private var drag: Drag = .none
    private var spaceHeld = false
    private var rotationAccum = 0.0
    private var rotationEngaged = false
    private var keyMonitor: Any?

    // Edit mode
    struct ActiveFeature: Equatable {
        enum Kind { case line, polygon, point }
        let layerId: UUID
        let kind: Kind
        let id: Int64
    }
    struct VertexHandle {
        let ring: Int
        let index: Int
        let lat: Double
        let lon: Double
    }
    private var activeFeature: ActiveFeature?
    private var selectedLabelKey: String?

    init(appState: AppState) {
        self.appState = appState
        super.init(frame: .zero)
        wantsLayer = true
        layerContentsRedrawPolicy = .never
        layer?.backgroundColor = NSColor(calibratedWhite: 0.93, alpha: 1).cgColor
        contentLayer.anchorPoint = .zero
        contentLayer.position = .zero
        contentLayer.contentsGravity = .resize
        contentLayer.minificationFilter = .linear
        contentLayer.magnificationFilter = .linear
        contentLayer.actions = ["contents": NSNull(), "transform": NSNull(), "bounds": NSNull(),
                                "position": NSNull(), "opacity": NSNull()]
        layer?.addSublayer(contentLayer)

        overlay.owner = self
        overlay.frame = bounds
        overlay.autoresizingMask = [.width, .height]
        addSubview(overlay)

        camera.changed.sink { [weak self] in self?.cameraChanged() }.store(in: &bag)
        camera.animate.sink { [weak self] in self?.fly(to: $0) }.store(in: &bag)

        appState.$labelsVersion.dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async { self?.sceneDirty = true; self?.requestRaster(); self?.overlay.needsDisplay = true }
        }.store(in: &bag)
        appState.$settings.dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async { self?.requestRaster() }
        }.store(in: &bag)

        func redrawOverlay<P: Publisher>(_ p: P) where P.Failure == Never {
            p.sink { [weak self] _ in
                DispatchQueue.main.async { self?.overlay.needsDisplay = true; self?.updateCursor() }
            }.store(in: &bag)
        }
        redrawOverlay(appState.$canvasMode)
        redrawOverlay(appState.$boundingBox)
        redrawOverlay(appState.$signOutputs)
        redrawOverlay(appState.$selectedSignId)
        redrawOverlay(appState.$isPlacingSign)
        redrawOverlay(appState.$showNorthArrow)
        redrawOverlay(appState.$northArrowPosition)
        appState.$selectedItem.sink { [weak self] _ in
            DispatchQueue.main.async {
                self?.activeFeature = nil
                self?.selectedLabelKey = nil
                self?.overlay.needsDisplay = true
            }
        }.store(in: &bag)

        TileStore.shared.onTile = { [weak self] in
            DispatchQueue.main.async { self?.requestRaster() }
        }

        installKeyMonitor()
    }

    required init?(coder: NSCoder) { fatalError() }

    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        layer?.isGeometryFlipped = true
        updateTrackingAreas()
        syncSize()
        requestRaster()
        // The map owns the keyboard at launch, so tool shortcuts work right away
        // instead of the first text field grabbing focus.
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.window?.makeFirstResponder(self)
        }
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        requestRaster()
    }

    override func setFrameSize(_ newSize: NSSize) {
        super.setFrameSize(newSize)
        syncSize()
    }

    private func syncSize() {
        guard bounds.width > 0, bounds.height > 0 else { return }
        if camera.viewSize != bounds.size { camera.viewSize = bounds.size }
        applyLayerTransform()
        overlay.needsDisplay = true
        requestRaster()
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited,
                                                              .activeInKeyWindow, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    // MARK: Camera → layers

    /// While the camera moves, the existing bitmap is simply transformed by the
    /// GPU. A new raster is needed only once the bitmap runs out (panned past the
    /// overscan, or zoomed in far enough to look soft); the sharp final frame
    /// comes when motion stops.
    private func cameraChanged() {
        applyLayerTransform()
        overlay.needsDisplay = true
        moving = true
        settleWork?.cancel()
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.moving = false
                self?.requestRaster()
            }
        }
        settleWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.09, execute: work)
        if rasterExhausted() { requestRaster() }
    }

    private func rasterExhausted() -> Bool {
        guard let rp = rasterProjection else { return true }
        let cur = camera.projection
        if abs(cur.zoom - rp.zoom) > 0.5 { return true }
        let base = scene?.baseZoom ?? 15, origin = scene?.origin ?? .zero
        let toRaster = cur.artworkTransform(baseZoom: base, origin: origin).inverted()
            .concatenating(rp.artworkTransform(baseZoom: base, origin: origin))
        let limit = CGRect(origin: .zero, size: rp.viewportSize)
        for c in [CGPoint.zero, CGPoint(x: bounds.width, y: 0),
                  CGPoint(x: 0, y: bounds.height), CGPoint(x: bounds.width, y: bounds.height)] {
            if !limit.contains(c.applying(toRaster)) { return true }
        }
        return false
    }

    private func applyLayerTransform() {
        guard let rp = rasterProjection else { return }
        let base = scene?.baseZoom ?? 15, origin = scene?.origin ?? .zero
        let cur = camera.projection.artworkTransform(baseZoom: base, origin: origin)
        let snap = rp.artworkTransform(baseZoom: base, origin: origin)
        // raster-bitmap point → artwork → current screen.
        let m = snap.inverted().concatenating(cur)
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        contentLayer.setAffineTransform(m)
        CATransaction.commit()
    }

    // MARK: Raster pipeline

    private func currentScene() -> CompiledScene {
        if sceneDirty || scene == nil {
            let t0 = CACurrentMediaTime()
            scene = SceneStore.shared.scene(layers: appState.layers, iconLibrary: appState.iconLibrary,
                                            baseZoom: appState.baseZoom, version: appState.labelsVersion)
            sceneDirty = false
            if perf { Self.log(String(format: "compile %.1f ms", (CACurrentMediaTime() - t0) * 1000)) }
        }
        return scene!
    }

    func requestRaster() {
        rasterWanted = true
        pumpRaster()
    }

    private func pumpRaster() {
        guard rasterWanted, !rasterBusy, bounds.width > 0, bounds.height > 0, window != nil else { return }
        rasterWanted = false
        rasterBusy = true

        let scene = currentScene()
        let view = camera.projection
        // Overscan so panning and zooming out reveal real content, not blank.
        let over = (max(bounds.width, bounds.height) * 0.25).rounded()
        let size = CGSize(width: bounds.width + over * 2, height: bounds.height + over * 2)
        let proj = MapProjection(centerLat: view.centerLat, centerLon: view.centerLon, zoom: view.zoom,
                                 viewportSize: size, rotation: view.rotation)
        // Mid-gesture frames only need to keep up; the final one is full resolution.
        let fullPx = window?.backingScaleFactor ?? 2
        let px = moving ? min(fullPx, 1) : fullPx
        let showTiles = appState.settings.showTileBackground
        let tileOpacity = appState.settings.tileOpacity
        var options = CompiledScene.Options()
        options.background = appState.effectiveBackground
        options.excludeLabel = excludeLabel
        options.excludeIcon = excludeIcon
        options.deviceScale = px
        let perf = self.perf

        rasterQueue.async { [weak self] in
            let t0 = CACurrentMediaTime()
            let w = Int(size.width * px), h = Int(size.height * px)
            var image: CGImage?
            if let cg = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue
                                    | CGBitmapInfo.byteOrder32Little.rawValue) {
                cg.translateBy(x: 0, y: CGFloat(h))
                cg.scaleBy(x: px, y: -px)
                let rect = CGRect(origin: .zero, size: size)
                cg.setFillColor(CGColor(gray: 0.93, alpha: 1))
                cg.fill(rect)
                if showTiles, options.background == nil || (options.background?.a ?? 1) < 1 {
                    TileStore.shared.draw(in: cg, proj: proj, viewport: rect, opacity: tileOpacity)
                }
                scene.draw(in: cg, proj: proj, viewport: rect, options: options)
                image = cg.makeImage()
            }
            let ms = (CACurrentMediaTime() - t0) * 1000
            DispatchQueue.main.async {
                guard let self else { return }
                if perf { Self.log(String(format: "raster %.1f ms (%dx%d)", ms, w, h)) }
                self.present(image, proj: proj, size: size)
                self.rasterBusy = false
                self.pumpRaster()
            }
        }
    }

    private func present(_ image: CGImage?, proj: MapProjection, size: CGSize) {
        guard let image else { return }
        rasterProjection = proj
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        contentLayer.bounds = CGRect(origin: .zero, size: size)
        contentLayer.contents = image
        applyLayerTransform()
        CATransaction.commit()
    }

    // MARK: Animation

    private func startLink() {
        guard link == nil else { return }
        let l = displayLink(target: self, selector: #selector(tick))
        l.add(to: .main, forMode: .common)
        link = l
    }

    private func stopLinkIfIdle() {
        if zoomEase == nil, flight == nil { link?.invalidate(); link = nil }
    }

    func fly(to target: CameraTarget) {
        zoomEase = nil
        let start = CameraTarget(lat: camera.centerLat, lon: camera.centerLon,
                                 zoom: camera.zoom, rotation: camera.rotation)
        flight = (start, target, CACurrentMediaTime(), 0.32)
        startLink()
    }

    @objc private func tick() {
        if let f = flight {
            let t = min(1, (CACurrentMediaTime() - f.t0) / f.duration)
            let e = t * t * (3 - 2 * t)
            let a = MapProjection.world(lat: f.start.lat, lon: f.start.lon, zoom: 0)
            let b = MapProjection.world(lat: f.end.lat, lon: f.end.lon, zoom: 0)
            let c = MapProjection.latLon(world: CGPoint(x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e), zoom: 0)
            var rot: Double? = nil
            if let rs = f.start.rotation, let re = f.end.rotation {
                rot = rs + MapCamera.normalized(re - rs) * e
            }
            camera.set(lat: c.lat, lon: c.lon, zoom: f.start.zoom + (f.end.zoom - f.start.zoom) * e, rotation: rot)
            if t >= 1 { flight = nil }
        }
        if let z = zoomEase {
            let d = z.target - camera.zoom
            if abs(d) < 0.002 {
                camera.zoom(to: z.target, around: z.anchor)
                zoomEase = nil
            } else {
                camera.zoom(to: camera.zoom + d * 0.28, around: z.anchor)
            }
        }
        stopLinkIfIdle()
    }

    // MARK: Trackpad & wheel

    override func scrollWheel(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let zoomKey = event.modifierFlags.contains(.command) || event.modifierFlags.contains(.control)
        if event.hasPreciseScrollingDeltas {
            if zoomKey {
                camera.zoom(to: camera.zoom + event.scrollingDeltaY * 0.01, around: p)
            } else {
                // Two-finger drag pans, like Figma. Pinch zooms.
                flight = nil; zoomEase = nil
                camera.pan(by: CGVector(dx: event.scrollingDeltaX, dy: event.scrollingDeltaY))
            }
        } else {
            let base = zoomEase?.target ?? camera.zoom
            let next = max(MapCamera.minZoom, min(MapCamera.maxZoom, base + event.scrollingDeltaY * 0.12))
            zoomEase = (next, p)
            startLink()
        }
    }

    override func magnify(with event: NSEvent) {
        flight = nil; zoomEase = nil
        let p = convert(event.locationInWindow, from: nil)
        camera.zoom(to: camera.zoom + log2(max(0.2, 1 + event.magnification)), around: p)
    }

    override func rotate(with event: NSEvent) {
        if event.phase == .began { rotationAccum = 0; rotationEngaged = false }
        // A small dead zone keeps a plain pinch from nudging the map's rotation.
        rotationAccum += Double(event.rotation)
        if !rotationEngaged, abs(rotationAccum) > 8 { rotationEngaged = true }
        if rotationEngaged {
            camera.rotate(by: Double(event.rotation), around: convert(event.locationInWindow, from: nil))
        }
    }

    // MARK: Mouse

    private var isPanTool: Bool { spaceHeld || appState.canvasMode == .pan }

    override func mouseMoved(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        let g = camera.projection.fromScreen(p)
        camera.mouse = (g.lat, g.lon)
        updateCursor(at: p)
    }

    override func mouseExited(with event: NSEvent) {
        camera.mouse = nil
    }

    private func updateCursor(at point: CGPoint? = nil) {
        let p = point ?? (window.map { convert($0.mouseLocationOutsideOfEventStream, from: nil) } ?? .zero)
        guard bounds.contains(p) else { return }
        if case .pan = drag { NSCursor.closedHand.set(); return }
        if appState.isPlacingSign || (appState.canvasMode == .selectArea && !spaceHeld) {
            NSCursor.crosshair.set(); return
        }
        if signHit(at: p) != nil || (appState.canvasMode == .edit && !spaceHeld && handleHit(at: p) != nil) {
            NSCursor.pointingHand.set(); return
        }
        if isPanTool { NSCursor.openHand.set() } else { NSCursor.arrow.set() }
    }

    override func mouseDown(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        guard bounds.contains(p) else { return }
        window?.makeFirstResponder(self)     // commits any field being edited
        flight = nil; zoomEase = nil

        if appState.isPlacingSign {
            let g = camera.projection.fromScreen(p)
            var sign = SignOutput(name: "Sign \(appState.signOutputs.count + 1)", lat: g.lat, lon: g.lon)
            sign.widthMM = appState.settings.defaultWidthMM
            sign.heightMM = appState.settings.defaultHeightMM
            sign.dpi = appState.settings.defaultDPI
            appState.signOutputs.append(sign)
            appState.selectedSignId = sign.id
            appState.isPlacingSign = false
            appState.documentChanged()
            return
        }
        if !spaceHeld, let id = signHit(at: p) {
            appState.selectedSignId = id
            drag = .sign(id: id)
            return
        }
        if event.modifierFlags.contains(.option) {
            drag = .rotate(lastAngle: angleFromCenter(p))
            return
        }
        if spaceHeld { drag = .pan(last: p); updateCursor(at: p); return }

        switch appState.canvasMode {
        case .pan:
            drag = .pan(last: p)
            updateCursor(at: p)
        case .selectArea:
            drag = .rubberBand(start: p, current: p)
        case .edit:
            editMouseDown(at: p, event: event)
        }
    }

    override func mouseDragged(with event: NSEvent) {
        let p = convert(event.locationInWindow, from: nil)
        switch drag {
        case .none:
            break
        case .pan(let last):
            camera.pan(by: CGVector(dx: p.x - last.x, dy: p.y - last.y))
            drag = .pan(last: p)
        case .rotate(let last):
            let a = angleFromCenter(p)
            camera.rotate(by: last - a)
            drag = .rotate(lastAngle: a)
        case .rubberBand(let start, _):
            drag = .rubberBand(start: start, current: p)
        case .sign(let id):
            let g = camera.projection.fromScreen(p)
            if let i = appState.signOutputs.firstIndex(where: { $0.id == id }) {
                appState.signOutputs[i].lat = g.lat
                appState.signOutputs[i].lon = g.lon
            }
        case .curvedLabel(let placed, let label, _):
            let d = artworkDistance(on: placed, cursor: p)
            drag = .curvedLabel(placed: placed, label: label, dist: d)
        case .freeLabel(let label, let start, _):
            drag = .freeLabel(label: label, start: start, delta: CGVector(dx: p.x - start.x, dy: p.y - start.y))
        case .icon(let l, let f, let start, _):
            drag = .icon(layerId: l, featureId: f, start: start, delta: CGVector(dx: p.x - start.x, dy: p.y - start.y))
        case .vertex(let h, _):
            drag = .vertex(handle: h, point: p)
        }
        overlay.needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        defer {
            drag = .none
            overlay.needsDisplay = true
            updateCursor()
        }
        switch drag {
        case .rubberBand(let a, let b):
            finishRubberBand(a, b)
        case .sign:
            appState.documentChanged()
        case .curvedLabel(let placed, let label, let dist):
            commitCurved(placed: placed, label: label, dist: dist)
        case .freeLabel(let label, _, let delta):
            commitFree(label: label, delta: delta)
        case .icon(let l, let f, _, let delta):
            commitIcon(layerId: l, featureId: f, delta: delta)
        case .vertex(let h, let point):
            commitVertex(h, point: point)
        default:
            break
        }
    }

    private func angleFromCenter(_ p: CGPoint) -> Double {
        atan2(Double(p.y - bounds.midY), Double(p.x - bounds.midX)) * 180 / .pi
    }

    private func finishRubberBand(_ a: CGPoint, _ b: CGPoint) {
        guard abs(a.x - b.x) > 6, abs(a.y - b.y) > 6 else { return }
        let proj = camera.projection
        let corners = [a, b, CGPoint(x: a.x, y: b.y), CGPoint(x: b.x, y: a.y)].map { proj.fromScreen($0) }
        appState.boundingBox = BoundingBox(minLat: corners.map(\.lat).min()!, minLon: corners.map(\.lon).min()!,
                                           maxLat: corners.map(\.lat).max()!, maxLon: corners.map(\.lon).max()!)
        appState.canvasMode = .pan
        appState.statusMessage = "Area selected. Add a layer, then press Fetch."
    }

    // MARK: Keyboard

    private func installKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
            guard let self, self.window?.isKeyWindow == true else { return event }
            // Never steal keystrokes from a text field being typed in.
            if self.window?.firstResponder is NSText { return event }
            if self.window?.attachedSheet != nil { return event }
            let chars = event.charactersIgnoringModifiers?.lowercased() ?? ""
            let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.type == .keyUp {
                if chars == " " { self.spaceHeld = false; self.updateCursor() }
                return event
            }
            guard mods.isDisjoint(with: [.command, .control, .option]) else { return event }
            switch event.keyCode {
            case 53:                         // Esc
                self.handleEscape()
                return nil
            case 51, 117:                    // Delete
                if self.deleteSelectedLabel() { return nil }
                return event
            default:
                break
            }
            switch chars {
            case " ":
                self.spaceHeld = true
                self.updateCursor()
                return nil
            case "h", "v": self.appState.canvasMode = .pan; return nil
            case "e": self.appState.canvasMode = .edit; return nil
            case "b": self.appState.canvasMode = .selectArea; return nil
            case "=", "+": self.zoomStep(+1); return nil
            case "-": self.zoomStep(-1); return nil
            default: return event
            }
        }
    }

    func zoomStep(_ delta: Double) {
        let p = CGPoint(x: bounds.midX, y: bounds.midY)
        zoomEase = (max(MapCamera.minZoom, min(MapCamera.maxZoom, (zoomEase?.target ?? camera.zoom) + delta)), p)
        startLink()
    }

    private func handleEscape() {
        if appState.isPlacingSign { appState.isPlacingSign = false; return }
        if case .none = drag {} else { drag = .none; overlay.needsDisplay = true; return }
        if selectedLabelKey != nil { selectedLabelKey = nil; overlay.needsDisplay = true; return }
        if activeFeature != nil { activeFeature = nil; overlay.needsDisplay = true; return }
        if appState.canvasMode == .selectArea { appState.canvasMode = .pan; return }
        appState.selectedItem = nil
    }

    // MARK: Hit testing

    private func signHit(at p: CGPoint) -> UUID? {
        let proj = camera.projection
        return appState.signOutputs.first {
            let s = proj.toScreen(lat: $0.lat, lon: $0.lon)
            return hypot(s.x - p.x, s.y - p.y) < 11
        }?.id
    }

    private var editLayer: MapLayer? {
        guard appState.canvasMode == .edit, let id = appState.selectedLayerId else { return nil }
        return appState.layers.first { $0.id == id }
    }

    /// Labels and icons the current selection lets you move.
    private func editableLabels() -> [CompiledScene.Label] {
        guard let layer = editLayer, let scene else { return [] }
        switch appState.selectedItem {
        case .labelChild:
            return scene.labels.filter { $0.layerId == layer.id }
        case .subtypeLabel(_, let sub):
            return scene.labels.filter { $0.layerId == layer.id && $0.subId == sub }
        default:
            return []
        }
    }

    private func editableIcons() -> (batch: CompiledScene.IconBatch, layer: MapLayer)? {
        guard let layer = editLayer, let scene, case .symbolChild = appState.selectedItem,
              let batch = scene.icons.first(where: { $0.layerId == layer.id }) else { return nil }
        return (batch, layer)
    }

    private func artworkTransform() -> CGAffineTransform {
        guard let scene else { return .identity }
        return camera.projection.artworkTransform(baseZoom: scene.baseZoom, origin: scene.origin)
    }

    private enum HandleHit {
        case label(CompiledScene.Label)
        case icon(Int64, CGPoint)
        case vertex(VertexHandle)
    }

    private func handleHit(at p: CGPoint) -> HandleHit? {
        let t = artworkTransform()
        for label in editableLabels().reversed() {
            let s = label.anchor.applying(t)
            if hypot(s.x - p.x, s.y - p.y) < 10 { return .label(label) }
        }
        if let (batch, _) = editableIcons() {
            for item in batch.items.reversed() {
                let s = item.point.applying(t)
                if hypot(s.x - p.x, s.y - p.y) < 10 { return .icon(item.id, s) }
            }
        }
        let proj = camera.projection
        for v in vertexHandles().reversed() {
            let s = proj.toScreen(lat: v.lat, lon: v.lon)
            if hypot(s.x - p.x, s.y - p.y) < 8 { return .vertex(v) }
        }
        return nil
    }

    private func vertexHandles() -> [VertexHandle] {
        guard let f = activeFeature, let layer = editLayer, layer.id == f.layerId else { return [] }
        switch f.kind {
        case .line:
            guard let feat = layer.lineFeatures.first(where: { $0.id == f.id }) else { return [] }
            return feat.coordinates.enumerated().compactMap { i, c in
                c.count >= 2 ? VertexHandle(ring: 0, index: i, lat: c[1], lon: c[0]) : nil
            }
        case .polygon:
            guard let feat = layer.polygonFeatures.first(where: { $0.id == f.id }) else { return [] }
            var out: [VertexHandle] = []
            for (ri, ring) in feat.rings.enumerated() {
                let closed = ring.count > 1 && ring.first == ring.last
                for (i, c) in ring.enumerated() where c.count >= 2 {
                    if closed && i == ring.count - 1 { continue }
                    out.append(VertexHandle(ring: ri, index: i, lat: c[1], lon: c[0]))
                }
            }
            return out
        case .point:
            guard let feat = layer.pointFeatures.first(where: { $0.id == f.id }), feat.coordinate.count >= 2 else { return [] }
            return [VertexHandle(ring: 0, index: 0, lat: feat.coordinate[1], lon: feat.coordinate[0])]
        }
    }

    /// The feature of the selected layer (or road subtype) under the cursor.
    private func featureHit(at p: CGPoint) -> ActiveFeature? {
        guard let layer = editLayer else { return nil }
        var types: Set<String>? = nil
        if case .roadSubLayer(_, let sub) = appState.selectedItem {
            types = layer.roadSubLayers.first { $0.id == sub }.map { Set($0.roadTypes) }
        } else if case .layer = appState.selectedItem {
            types = nil
        } else {
            return nil
        }
        let proj = camera.projection
        var best: (d: CGFloat, f: ActiveFeature)? = nil
        for f in layer.lineFeatures {
            if let types, !(f.tags["highway"].map { types.contains($0) } ?? false) { continue }
            let pts = proj.screenPoints(from: f.coordinates)
            guard pts.count >= 2 else { continue }
            for i in 0..<pts.count - 1 {
                let d = Self.distance(p, pts[i], pts[i + 1])
                if d < 7, d < (best?.d ?? .infinity) {
                    best = (d, .init(layerId: layer.id, kind: .line, id: f.id))
                }
            }
        }
        for f in layer.pointFeatures where f.coordinate.count >= 2 {
            let s = proj.toScreen(lat: f.coordinate[1], lon: f.coordinate[0])
            let d = hypot(s.x - p.x, s.y - p.y)
            if d < 10, d < (best?.d ?? .infinity) { best = (d, .init(layerId: layer.id, kind: .point, id: f.id)) }
        }
        if let best { return best.f }
        let g = proj.fromScreen(p)
        for f in layer.polygonFeatures.reversed() where !f.outerRing.isEmpty {
            if Self.inside(lat: g.lat, lon: g.lon, ring: f.outerRing) {
                return .init(layerId: layer.id, kind: .polygon, id: f.id)
            }
        }
        return nil
    }

    private static func distance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let dx = b.x - a.x, dy = b.y - a.y
        let len2 = dx * dx + dy * dy
        guard len2 > 0 else { return hypot(p.x - a.x, p.y - a.y) }
        let t = max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
        return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    }

    private static func inside(lat: Double, lon: Double, ring: [[Double]]) -> Bool {
        var inside = false
        var j = ring.count - 1
        for i in ring.indices {
            let xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]
            if (yi > lat) != (yj > lat), lon < (xj - xi) * (lat - yi) / (yj - yi) + xi { inside.toggle() }
            j = i
        }
        return inside
    }

    // MARK: Edit interactions

    private func editMouseDown(at p: CGPoint, event: NSEvent) {
        switch handleHit(at: p) {
        case .label(let label):
            selectedLabelKey = label.key
            if let placed = scene?.placedLines[label.key], label.style.lineLabelMode == .curved {
                drag = .curvedLabel(placed: placed, label: label, dist: placed.centerDist)
            } else {
                drag = .freeLabel(label: label, start: p, delta: .zero)
            }
            hideFromRaster(label: label.key)
            return
        case .icon(let id, _):
            if let layer = editLayer {
                drag = .icon(layerId: layer.id, featureId: id, start: p, delta: .zero)
                hideFromRaster(icon: "\(layer.id)|\(id)")
            }
            return
        case .vertex(let v):
            drag = .vertex(handle: v, point: p)
            return
        case .none:
            break
        }
        selectedLabelKey = nil
        if let hit = featureHit(at: p) {
            activeFeature = hit
            overlay.needsDisplay = true
            return
        }
        activeFeature = nil
        overlay.needsDisplay = true
        drag = .pan(last: p)     // empty canvas in edit mode still pans
    }

    private func hideFromRaster(label: String? = nil, icon: String? = nil) {
        excludeLabel = label
        excludeIcon = icon
        requestRaster()
    }

    private func artworkDistance(on placed: PlacedLineLabel, cursor: CGPoint) -> Double {
        guard let scene else { return placed.centerDist }
        let local = cursor.applying(artworkTransform().inverted())
        let world = CGPoint(x: local.x + scene.origin.x, y: local.y + scene.origin.y)
        let half = placed.width / 2
        let L = placed.line.length
        return min(max(placed.line.nearestDistance(to: world), min(half, L / 2)), max(L - half, L / 2))
    }

    private func commitCurved(placed: PlacedLineLabel, label: CompiledScene.Label, dist: Double) {
        hideFromRaster()
        guard let scene, let layer = appState.layers.first(where: { $0.id == placed.layerId }) else { return }
        var pins = scene.labels
            .filter { $0.layerId == placed.layerId && $0.featureId == placed.featureId }
            .sorted { $0.index < $1.index }
            .compactMap { scene.placedLines[$0.key]?.centerDist }
        if label.index < pins.count { pins[label.index] = dist } else { pins.append(dist) }
        layer.labelPins[placed.featureId] = pins
        appState.editSessionDirty = true
        appState.documentChanged()
    }

    private func commitFree(label: CompiledScene.Label, delta: CGVector) {
        hideFromRaster()
        guard delta != .zero, let scene, let layer = appState.layers.first(where: { $0.id == label.layerId }) else { return }
        let d = camera.projection.worldDelta(fromScreenDelta: delta, worldZoom: scene.baseZoom)
        let prev = layer.labelOffsets[label.featureId] ?? .zero
        layer.labelOffsets[label.featureId] = CGVector(dx: prev.dx + d.dx, dy: prev.dy + d.dy)
        appState.editSessionDirty = true
        appState.documentChanged()
    }

    private func commitIcon(layerId: UUID, featureId: Int64, delta: CGVector) {
        hideFromRaster()
        guard delta != .zero, let scene, let layer = appState.layers.first(where: { $0.id == layerId }) else { return }
        let d = camera.projection.worldDelta(fromScreenDelta: delta, worldZoom: scene.baseZoom)
        let prev = layer.symbolOffsets[featureId] ?? .zero
        layer.symbolOffsets[featureId] = CGVector(dx: prev.dx + d.dx, dy: prev.dy + d.dy)
        appState.editSessionDirty = true
        appState.documentChanged()
    }

    private func commitVertex(_ h: VertexHandle, point: CGPoint) {
        guard let f = activeFeature, let layer = appState.layers.first(where: { $0.id == f.layerId }) else { return }
        let g = camera.projection.fromScreen(point)
        let newCoord = [g.lon, g.lat]
        let old = [h.lon, h.lat]
        switch f.kind {
        case .line:
            guard let i = layer.lineFeatures.firstIndex(where: { $0.id == f.id }) else { return }
            if layer.originalLineGeometry[f.id] == nil { layer.originalLineGeometry[f.id] = layer.lineFeatures[i].coordinates }
            layer.lineFeatures[i].coordinates[h.index] = newCoord
            // Junction nodes shared with other ways of this layer move together,
            // so reshaping a road never tears it away from its neighbours.
            for j in layer.lineFeatures.indices where j != i {
                for k in layer.lineFeatures[j].coordinates.indices where layer.lineFeatures[j].coordinates[k] == old {
                    let fid = layer.lineFeatures[j].id
                    if layer.originalLineGeometry[fid] == nil { layer.originalLineGeometry[fid] = layer.lineFeatures[j].coordinates }
                    layer.lineFeatures[j].coordinates[k] = newCoord
                }
            }
        case .polygon:
            guard let i = layer.polygonFeatures.firstIndex(where: { $0.id == f.id }) else { return }
            if layer.originalPolygonGeometry[f.id] == nil { layer.originalPolygonGeometry[f.id] = layer.polygonFeatures[i].rings }
            let closed = layer.polygonFeatures[i].rings[h.ring].first == layer.polygonFeatures[i].rings[h.ring].last
            layer.polygonFeatures[i].rings[h.ring][h.index] = newCoord
            if closed, h.index == 0 {
                let last = layer.polygonFeatures[i].rings[h.ring].count - 1
                layer.polygonFeatures[i].rings[h.ring][last] = newCoord
            }
        case .point:
            guard let i = layer.pointFeatures.firstIndex(where: { $0.id == f.id }) else { return }
            if layer.originalPointGeometry[f.id] == nil { layer.originalPointGeometry[f.id] = layer.pointFeatures[i].coordinate }
            layer.pointFeatures[i].coordinate = newCoord
        }
        appState.editSessionDirty = true
        appState.documentChanged()
    }

    /// Delete on a selected road label removes that one label (the rest of the
    /// street's labels stay where they are).
    private func deleteSelectedLabel() -> Bool {
        guard appState.canvasMode == .edit, let key = selectedLabelKey, let scene,
              let label = scene.labels.first(where: { $0.key == key }),
              let layer = appState.layers.first(where: { $0.id == label.layerId }),
              scene.placedLines[key] != nil else { return false }
        var pins = scene.labels
            .filter { $0.layerId == label.layerId && $0.featureId == label.featureId }
            .sorted { $0.index < $1.index }
            .compactMap { scene.placedLines[$0.key]?.centerDist }
        if label.index < pins.count { pins.remove(at: label.index) }
        layer.labelPins[label.featureId] = pins
        selectedLabelKey = nil
        appState.editSessionDirty = true
        appState.documentChanged()
        return true
    }

    // MARK: Overlay drawing

    func drawOverlay(in cg: CGContext) {
        let proj = camera.projection
        guard proj.isValid else { return }
        drawBoundingBox(cg, proj)
        if appState.canvasMode == .edit { drawEdit(cg, proj) }
        drawSigns(cg, proj)
        if case .rubberBand(let a, let b) = drag {
            let r = CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))
            cg.setFillColor(NSColor.controlAccentColor.withAlphaComponent(0.12).cgColor)
            cg.fill(r)
            cg.setStrokeColor(NSColor.controlAccentColor.cgColor)
            cg.setLineWidth(1)
            cg.stroke(r)
        }
        if appState.showNorthArrow { drawNorthArrow(cg, proj) }
    }

    private func drawBoundingBox(_ cg: CGContext, _ proj: MapProjection) {
        guard let b = appState.boundingBox else { return }
        let c = [(b.minLat, b.minLon), (b.minLat, b.maxLon), (b.maxLat, b.maxLon), (b.maxLat, b.minLon)]
            .map { proj.toScreen(lat: $0.0, lon: $0.1) }
        cg.saveGState()
        cg.setStrokeColor(NSColor.controlAccentColor.cgColor)
        cg.setLineWidth(1)
        cg.setLineDash(phase: 0, lengths: [5, 4])
        cg.addLines(between: c + [c[0]])
        cg.strokePath()
        cg.restoreGState()
    }

    private func drawNode(_ cg: CGContext, at p: CGPoint, radius r: CGFloat, fill: NSColor, square: Bool = false) {
        let rect = CGRect(x: p.x - r, y: p.y - r, width: r * 2, height: r * 2)
        cg.setShadow(offset: CGSize(width: 0, height: -0.5), blur: 2, color: CGColor(gray: 0, alpha: 0.35))
        cg.setFillColor(fill.cgColor)
        if square { cg.fill(rect) } else { cg.fillEllipse(in: rect) }
        cg.setShadow(offset: .zero, blur: 0, color: nil)
        cg.setStrokeColor(NSColor.white.cgColor)
        cg.setLineWidth(1.5)
        if square { cg.stroke(rect) } else { cg.strokeEllipse(in: rect) }
    }

    private func drawEdit(_ cg: CGContext, _ proj: MapProjection) {
        guard let scene else { return }
        let t = artworkTransform()
        let accent = NSColor.controlAccentColor

        // Label nodes: centre of the string. The one being dragged is drawn live
        // here; its raster copy is hidden until the drop re-lays things out.
        for label in editableLabels() {
            var dragged = false
            switch drag {
            case .curvedLabel(_, let l, _) where l.key == label.key: dragged = true
            case .freeLabel(let l, _, _) where l.key == label.key: dragged = true
            default: break
            }
            if dragged { continue }
            let s = label.anchor.applying(t)
            guard bounds.insetBy(dx: -20, dy: -20).contains(s) else { continue }
            drawNode(cg, at: s, radius: label.key == selectedLabelKey ? 6 : 5, fill: accent)
        }
        let opts = CompiledScene.Options(deviceScale: window?.backingScaleFactor ?? 2)
        let scale = pow(2.0, proj.zoom - scene.baseZoom)
        switch drag {
        case .curvedLabel(let placed, let label, let dist):
            // Show the street it's sliding along.
            let local = placed.line.pts.map { CGPoint(x: $0.x - scene.origin.x, y: $0.y - scene.origin.y).applying(t) }
            cg.saveGState()
            cg.setStrokeColor(accent.withAlphaComponent(0.55).cgColor)
            cg.setLineWidth(2)
            cg.setLineCap(.round)
            if local.count >= 2 { cg.addLines(between: local); cg.strokePath() }
            cg.restoreGState()
            let live = LabelBuilder.build(placed, index: label.index, center: dist, origin: scene.origin)
            cg.saveGState()
            cg.concatenate(t)
            CompiledScene.draw(label: live, in: cg, rotation: proj.rotation, scale: scale, options: opts)
            cg.restoreGState()
            drawNode(cg, at: live.anchor.applying(t), radius: 6, fill: accent)
        case .freeLabel(let label, _, let delta):
            cg.saveGState()
            cg.translateBy(x: delta.dx, y: delta.dy)
            cg.concatenate(t)
            CompiledScene.draw(label: label, in: cg, rotation: proj.rotation, scale: scale, options: opts)
            cg.restoreGState()
            let s = label.anchor.applying(t)
            drawNode(cg, at: CGPoint(x: s.x + delta.dx, y: s.y + delta.dy), radius: 6, fill: accent)
        default:
            break
        }

        // Icon nodes.
        if let (batch, _) = editableIcons() {
            let rad = proj.rotation * .pi / 180
            for item in batch.items {
                var s = item.point.applying(t)
                if case .icon(_, let f, _, let delta) = drag, f == item.id {
                    s.x += delta.dx; s.y += delta.dy
                    let w = batch.size.width * scale, h = batch.size.height * scale
                    cg.saveGState()
                    cg.translateBy(x: s.x, y: s.y)
                    cg.rotate(by: CGFloat(batch.rotation * .pi / 180))
                    cg.scaleBy(x: 1, y: -1)
                    cg.setAlpha(CGFloat(batch.opacity))
                    cg.draw(batch.image, in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
                    cg.restoreGState()
                    _ = rad
                }
                guard bounds.insetBy(dx: -20, dy: -20).contains(s) else { continue }
                drawNode(cg, at: s, radius: 5, fill: .systemPurple)
            }
        }

        // Selected feature: outline + one square per vertex.
        guard let f = activeFeature, let layer = editLayer, layer.id == f.layerId else { return }
        var movedPoint: CGPoint? = nil
        var movedHandle: VertexHandle? = nil
        if case .vertex(let h, let p) = drag { movedPoint = p; movedHandle = h }
        func screen(_ c: [Double], ring: Int, index: Int, closedCount: Int?) -> CGPoint {
            if let h = movedHandle, h.ring == ring,
               h.index == index || (closedCount != nil && h.index == 0 && index == closedCount! - 1),
               let m = movedPoint { return m }
            return proj.toScreen(lat: c[1], lon: c[0])
        }
        cg.saveGState()
        cg.setStrokeColor(accent.cgColor)
        cg.setLineWidth(1.5)
        switch f.kind {
        case .line:
            if let feat = layer.lineFeatures.first(where: { $0.id == f.id }) {
                let pts = feat.coordinates.enumerated().map { screen($1, ring: 0, index: $0, closedCount: nil) }
                if pts.count >= 2 { cg.addLines(between: pts); cg.strokePath() }
            }
        case .polygon:
            if let feat = layer.polygonFeatures.first(where: { $0.id == f.id }) {
                for (ri, ring) in feat.rings.enumerated() {
                    let closed = ring.first == ring.last
                    let pts = ring.enumerated().map { screen($1, ring: ri, index: $0, closedCount: closed ? ring.count : nil) }
                    if pts.count >= 2 { cg.addLines(between: pts); cg.closePath(); cg.strokePath() }
                }
            }
        case .point:
            break
        }
        cg.restoreGState()
        for v in vertexHandles() {
            var s = proj.toScreen(lat: v.lat, lon: v.lon)
            if let h = movedHandle, h.ring == v.ring, h.index == v.index, let m = movedPoint { s = m }
            drawNode(cg, at: s, radius: 3.5, fill: .white, square: true)
            cg.setStrokeColor(accent.cgColor)
            cg.setLineWidth(1)
            cg.stroke(CGRect(x: s.x - 3.5, y: s.y - 3.5, width: 7, height: 7))
        }
    }

    private func drawSigns(_ cg: CGContext, _ proj: MapProjection) {
        for sign in appState.signOutputs {
            let p = proj.toScreen(lat: sign.lat, lon: sign.lon)
            guard bounds.insetBy(dx: -30, dy: -30).contains(p) else { continue }
            let selected = sign.id == appState.selectedSignId
            let color = selected ? NSColor.controlAccentColor : NSColor.systemOrange
            func needle(_ heading: Double, length: CGFloat, alpha: CGFloat) {
                // A sign's heading is geographic: it turns with the map.
                let a = (heading - proj.rotation) * .pi / 180
                cg.setStrokeColor(color.withAlphaComponent(alpha).cgColor)
                cg.setLineWidth(2.5)
                cg.setLineCap(.round)
                cg.move(to: p)
                cg.addLine(to: CGPoint(x: p.x + CGFloat(sin(a)) * length, y: p.y - CGFloat(cos(a)) * length))
                cg.strokePath()
            }
            needle(sign.rotation, length: 20, alpha: 1)
            if sign.isDoubleSided { needle(sign.backRotation, length: 14, alpha: 0.55) }
            drawNode(cg, at: p, radius: 5, fill: color)
        }
    }

    private func drawNorthArrow(_ cg: CGContext, _ proj: MapProjection) {
        let pad: CGFloat = 40
        let c: CGPoint
        switch appState.northArrowPosition {
        case .topLeft:     c = CGPoint(x: pad, y: pad)
        case .topRight:    c = CGPoint(x: bounds.width - pad, y: pad)
        case .bottomLeft:  c = CGPoint(x: pad, y: bounds.height - pad)
        case .bottomRight: c = CGPoint(x: bounds.width - pad, y: bounds.height - pad)
        }
        cg.saveGState()
        cg.setFillColor(CGColor(gray: 1, alpha: 0.9))
        cg.fillEllipse(in: CGRect(x: c.x - 18, y: c.y - 18, width: 36, height: 36))
        cg.translateBy(x: c.x, y: c.y)
        cg.rotate(by: CGFloat(-proj.rotation * .pi / 180))
        cg.setFillColor(NSColor.systemRed.cgColor)
        cg.move(to: CGPoint(x: 0, y: -13)); cg.addLine(to: CGPoint(x: 5, y: 2)); cg.addLine(to: CGPoint(x: -5, y: 2))
        cg.closePath(); cg.fillPath()
        cg.setFillColor(CGColor(gray: 0.35, alpha: 1))
        cg.move(to: CGPoint(x: 0, y: 13)); cg.addLine(to: CGPoint(x: 5, y: 2)); cg.addLine(to: CGPoint(x: -5, y: 2))
        cg.closePath(); cg.fillPath()
        cg.restoreGState()
    }

    private static func log(_ s: String) {
        FileHandle.standardError.write(Data("[perf] \(s)\n".utf8))
    }

    deinit {
        if let keyMonitor { NSEvent.removeMonitor(keyMonitor) }
    }
}

// MARK: - Overlay view

/// Transparent, click-through view that draws handles and markers.
final class MapOverlayView: NSView {
    weak var owner: MapSurfaceNSView?

    override var isFlipped: Bool { true }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        guard let cg = NSGraphicsContext.current?.cgContext else { return }
        MainActor.assumeIsolated { owner?.drawOverlay(in: cg) }
    }
}

