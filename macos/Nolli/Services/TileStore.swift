import Foundation
import CoreGraphics
import ImageIO

/// Native OpenStreetMap raster tile loader. Decoded tiles live in a bounded
/// memory cache; responses go through a disk URLCache that honours the tile
/// server's cache headers (as the OSM tile usage policy asks).
final class TileStore: @unchecked Sendable {
    static let shared = TileStore()
    static let maxZoom = 19

    private final class Box { let image: CGImage; init(_ i: CGImage) { image = i } }

    private let memory = NSCache<NSString, Box>()
    private let lock = NSLock()
    private var inflight = Set<String>()
    private var pending: [(z: Int, x: Int, y: Int)] = []
    private var active = 0
    private let maxActive = 4
    private let session: URLSession

    /// Called (on the main queue) whenever a new tile becomes available.
    var onTile: (@Sendable () -> Void)?

    private init() {
        memory.countLimit = 1024
        let cfg = URLSessionConfiguration.default
        cfg.httpMaximumConnectionsPerHost = maxActive
        cfg.urlCache = URLCache(memoryCapacity: 16 << 20, diskCapacity: 512 << 20,
                                directory: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)
                                    .first?.appendingPathComponent("NolliTiles"))
        cfg.requestCachePolicy = .useProtocolCachePolicy
        cfg.httpAdditionalHeaders = ["User-Agent": "Nolli/1.0 (macOS wayfinding map editor)"]
        session = URLSession(configuration: cfg)
    }

    private func key(_ z: Int, _ x: Int, _ y: Int) -> String { "\(z)/\(x)/\(y)" }

    func cached(z: Int, x: Int, y: Int) -> CGImage? {
        memory.object(forKey: key(z, x, y) as NSString)?.image
    }

    /// Queues a download; newest requests go first, so tiles for where the
    /// camera is NOW win over ones it has already left.
    func request(z: Int, x: Int, y: Int) {
        let k = key(z, x, y)
        lock.lock()
        defer { lock.unlock() }
        guard !inflight.contains(k) else { return }
        inflight.insert(k)
        pending.append((z, x, y))
        if pending.count > 96 {
            let dropped = pending.removeFirst()
            inflight.remove(key(dropped.z, dropped.x, dropped.y))
        }
        pump()
    }

    private func pump() {            // lock held
        while active < maxActive, let next = pending.popLast() {
            active += 1
            start(next.z, next.x, next.y)
        }
    }

    private func start(_ z: Int, _ x: Int, _ y: Int) {
        let k = key(z, x, y)
        guard let url = URL(string: "https://tile.openstreetmap.org/\(k).png") else { return }
        session.dataTask(with: url) { [weak self] data, response, _ in
            guard let self else { return }
            var image: CGImage? = nil
            if let data, (response as? HTTPURLResponse)?.statusCode == 200,
               let src = CGImageSourceCreateWithData(data as CFData, nil) {
                image = CGImageSourceCreateImageAtIndex(
                    src, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
            }
            if let image { self.memory.setObject(Box(image), forKey: k as NSString) }
            self.lock.lock()
            self.inflight.remove(k)
            self.active -= 1
            self.pump()
            self.lock.unlock()
            if image != nil, let cb = self.onTile { DispatchQueue.main.async { cb() } }
        }.resume()
    }

    // MARK: - Drawing

    /// Draws the tile basemap for `proj` into a y-down context. Missing tiles
    /// fall back to a scaled parent so nothing flashes blank while loading.
    func draw(in cg: CGContext, proj: MapProjection, viewport: CGRect, opacity: Double) {
        let z = max(0, min(Self.maxZoom, Int((proj.zoom).rounded())))
        let scale = pow(2.0, proj.zoom - Double(z))
        let n = 1 << z
        let centre = MapProjection.world(lat: proj.centerLat, lon: proj.centerLon, zoom: Double(z))
        let rad = proj.rotation * .pi / 180

        // tile-pixel space → screen
        var t = CGAffineTransform(translationX: proj.viewportSize.width / 2, y: proj.viewportSize.height / 2)
        t = t.rotated(by: -rad).scaledBy(x: scale, y: scale)
            .translatedBy(x: -centre.x, y: -centre.y)
        let inv = t.inverted()
        let corners = [CGPoint(x: viewport.minX, y: viewport.minY), CGPoint(x: viewport.maxX, y: viewport.minY),
                       CGPoint(x: viewport.minX, y: viewport.maxY), CGPoint(x: viewport.maxX, y: viewport.maxY)]
            .map { $0.applying(inv) }
        let minX = Int(floor(corners.map(\.x).min()! / 256)), maxX = Int(floor(corners.map(\.x).max()! / 256))
        let minY = max(0, Int(floor(corners.map(\.y).min()! / 256)))
        let maxY = min(n - 1, Int(floor(corners.map(\.y).max()! / 256)))
        guard minY <= maxY, maxX - minX < 64, maxY - minY < 64 else { return }

        cg.saveGState()
        cg.concatenate(t)
        cg.setAlpha(CGFloat(opacity))
        cg.setShouldAntialias(false)
        cg.interpolationQuality = abs(scale - 1) < 0.001 && rad == 0 ? .none : .medium

        // Centre-out so the visible middle loads first.
        var coords: [(Int, Int)] = []
        for y in minY...maxY { for x in minX...maxX { coords.append((x, y)) } }
        let cx = centre.x / 256, cy = centre.y / 256
        coords.sort { hypot(Double($0.0) - cx, Double($0.1) - cy) > hypot(Double($1.0) - cx, Double($1.1) - cy) }

        for (x, y) in coords {
            let wx = ((x % n) + n) % n
            let rect = CGRect(x: CGFloat(x) * 256, y: CGFloat(y) * 256, width: 256, height: 256)
            if let img = cached(z: z, x: wx, y: y) {
                drawTile(cg, img, in: rect, source: nil)
                continue
            }
            request(z: z, x: wx, y: y)
            var pz = z - 1, px = wx, py = y, depth = 1
            while pz >= 0, depth <= 5 {
                px >>= 1; py >>= 1
                if let img = cached(z: pz, x: px, y: py) {
                    let sz = 256.0 / Double(1 << depth)
                    let sx = Double(wx & ((1 << depth) - 1)) * sz
                    let sy = Double(y & ((1 << depth) - 1)) * sz
                    drawTile(cg, img, in: rect, source: CGRect(x: sx, y: sy, width: sz, height: sz))
                    break
                }
                pz -= 1; depth += 1
            }
        }
        cg.restoreGState()
    }

    private func drawTile(_ cg: CGContext, _ img: CGImage, in rect: CGRect, source: CGRect?) {
        var image = img
        if let source, let cropped = img.cropping(to: source) { image = cropped }
        cg.saveGState()
        cg.translateBy(x: rect.minX, y: rect.maxY)
        cg.scaleBy(x: 1, y: -1)
        cg.draw(image, in: CGRect(x: -0.25, y: -0.25, width: rect.width + 0.5, height: rect.height + 0.5))
        cg.restoreGState()
    }
}
