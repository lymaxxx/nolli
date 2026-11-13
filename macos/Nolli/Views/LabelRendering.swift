import Foundation
import CoreGraphics
import CoreText
import AppKit

// MARK: - Polyline helpers (shared by layout, renderer and exporters)

/// Arc-length parameterised polyline with point/tangent sampling.
struct Polyline {
    let pts: [CGPoint]
    let cum: [Double]          // cumulative distance at each vertex
    var length: Double { cum.last ?? 0 }

    init(_ rawPts: [CGPoint]) {
        // Drop near-duplicate consecutive points — zero-length segments break
        // offsetting (degenerate normals) and glyph angle sampling.
        var cleaned: [CGPoint] = []
        cleaned.reserveCapacity(rawPts.count)
        for p in rawPts {
            if let last = cleaned.last,
               abs(Double(p.x - last.x)) < 0.01, abs(Double(p.y - last.y)) < 0.01 { continue }
            cleaned.append(p)
        }
        self.pts = cleaned
        var c: [Double] = [0]
        c.reserveCapacity(cleaned.count)
        for i in 0..<max(cleaned.count - 1, 0) {
            let dx = Double(cleaned[i+1].x - cleaned[i].x), dy = Double(cleaned[i+1].y - cleaned[i].y)
            c.append(c[i] + (dx*dx + dy*dy).squareRoot())
        }
        self.cum = c
    }

    /// Point at arc distance `d` (clamped to the path).
    func point(at d: Double) -> CGPoint {
        guard pts.count >= 2 else { return pts.first ?? .zero }
        let d = max(0, min(d, length))
        var lo = 1, hi = cum.count - 1
        while lo < hi {                       // binary search first cum ≥ d
            let mid = (lo + hi) / 2
            if cum[mid] >= d { hi = mid } else { lo = mid + 1 }
        }
        let segLen = cum[lo] - cum[lo-1]
        let t = segLen > 0 ? (d - cum[lo-1]) / segLen : 0
        let p1 = pts[lo-1], p2 = pts[lo]
        return CGPoint(x: p1.x + CGFloat(t) * (p2.x - p1.x),
                       y: p1.y + CGFloat(t) * (p2.y - p1.y))
    }

    /// Chord angle (radians) over the span [d0, d1] — the stable "tangent"
    /// used for glyph rotation (matches SVG textPath behaviour closely).
    func chordAngle(from d0: Double, to d1: Double) -> Double {
        let a = point(at: d0), b = point(at: d1)
        return atan2(Double(b.y - a.y), Double(b.x - a.x))
    }

    var reversed: Polyline { Polyline(pts.reversed()) }

    /// Arc distance of the point on the polyline nearest to `p` — used to
    /// project a drag cursor onto the line (slide-along label editing).
    func nearestDistance(to p: CGPoint) -> Double {
        guard pts.count >= 2 else { return 0 }
        var best = 0.0, bestD2 = Double.greatestFiniteMagnitude
        for i in 0..<pts.count - 1 {
            let a = pts[i], b = pts[i+1]
            let abx = Double(b.x - a.x), aby = Double(b.y - a.y)
            let apx = Double(p.x - a.x), apy = Double(p.y - a.y)
            let len2 = abx * abx + aby * aby
            let t = len2 > 0 ? max(0, min(1, (apx * abx + apy * aby) / len2)) : 0
            let qx = Double(a.x) + abx * t, qy = Double(a.y) + aby * t
            let d2 = (Double(p.x) - qx) * (Double(p.x) - qx)
                   + (Double(p.y) - qy) * (Double(p.y) - qy)
            if d2 < bestD2 { bestD2 = d2; best = cum[i] + (len2).squareRoot() * t }
        }
        return best
    }

    /// Arc distances of interior vertices whose turn angle exceeds
    /// `maxAngleDeg` — "sharp bends" that curved labels must not cross.
    func sharpVertexDistances(maxAngleDeg: Double) -> [Double] {
        guard pts.count >= 3 else { return [] }
        var out: [Double] = []
        for i in 1..<pts.count - 1 {
            let a1 = atan2(Double(pts[i].y - pts[i-1].y), Double(pts[i].x - pts[i-1].x))
            let a2 = atan2(Double(pts[i+1].y - pts[i].y), Double(pts[i+1].x - pts[i].x))
            var delta = abs(a2 - a1) * 180 / .pi
            if delta > 180 { delta = 360 - delta }
            if delta > maxAngleDeg { out.append(cum[i]) }
        }
        return out
    }

    /// Offsets the whole polyline perpendicular by `dist` (positive = to the
    /// LEFT of travel direction, which is visually "up" for left-to-right text
    /// in screen coordinates). Uses averaged vertex normals, miter-clamped.
    func offset(by dist: Double) -> Polyline {
        guard pts.count >= 2, dist != 0 else { return self }
        var normals: [CGVector] = []
        normals.reserveCapacity(pts.count - 1)
        for i in 0..<pts.count - 1 {
            let dx = Double(pts[i+1].x - pts[i].x), dy = Double(pts[i+1].y - pts[i].y)
            let len = (dx*dx + dy*dy).squareRoot()
            if len > 0 {
                normals.append(CGVector(dx: dy / len, dy: -dx / len))   // left of travel (screen y-down)
            } else {
                normals.append(CGVector(dx: 0, dy: 0))
            }
        }
        var out: [CGPoint] = []
        out.reserveCapacity(pts.count)
        for i in 0..<pts.count {
            var n: CGVector
            if i == 0 { n = normals[0] }
            else if i == pts.count - 1 { n = normals[normals.count - 1] }
            else {
                n = CGVector(dx: (normals[i-1].dx + normals[i].dx) / 2,
                             dy: (normals[i-1].dy + normals[i].dy) / 2)
                let l = (Double(n.dx * n.dx + n.dy * n.dy)).squareRoot()
                // Miter scale so joint offset distance stays correct, clamped.
                if l > 0.05 {
                    let scale = min(1.0 / l, 2.0)
                    n = CGVector(dx: n.dx * CGFloat(scale), dy: n.dy * CGFloat(scale))
                } else { n = normals[i-1] }
            }
            out.append(CGPoint(x: pts[i].x + n.dx * CGFloat(dist),
                               y: pts[i].y + n.dy * CGFloat(dist)))
        }
        return Polyline(out)
    }
}

// MARK: - Glyph metrics (CoreText)

/// One positioned glyph of a laid-out single-line string. `x` is the pen
/// position of the glyph's leading edge, `advance` its typographic advance —
/// both include font kerning and the style's tracking, exactly the cumulative
/// advance model SVG `textPath` uses.
struct GlyphMetric {
    let glyph: CGGlyph
    let font: CTFont
    let x: Double
    let advance: Double
}

struct TextMetrics {
    let glyphs: [GlyphMetric]
    let width: Double
    let ascent: Double
    let descent: Double

    /// Lays out `text` with `font` and `tracking` (points). Kerning comes from
    /// the font via CoreText so screen/PDF/SVG renderings agree. `wordSpacingPt`
    /// adds extra advance after every space character.
    init(text: String, font: NSFont, trackingPt: Double, wordSpacingPt: Double = 0) {
        let attr = NSMutableAttributedString(string: text,
                                             attributes: [.font: font, .kern: trackingPt])
        if wordSpacingPt != 0 {
            let ns = text as NSString
            for i in 0..<ns.length where ns.character(at: i) == 32 {
                attr.addAttribute(.kern, value: trackingPt + wordSpacingPt,
                                  range: NSRange(location: i, length: 1))
            }
        }
        let line = CTLineCreateWithAttributedString(attr)
        var asc: CGFloat = 0, desc: CGFloat = 0, lead: CGFloat = 0
        let w = CTLineGetTypographicBounds(line, &asc, &desc, &lead)
        var out: [GlyphMetric] = []
        let runs = CTLineGetGlyphRuns(line) as! [CTRun]
        for run in runs {
            let count = CTRunGetGlyphCount(run)
            guard count > 0 else { continue }
            var glyphs = [CGGlyph](repeating: 0, count: count)
            var positions = [CGPoint](repeating: .zero, count: count)
            var advances = [CGSize](repeating: .zero, count: count)
            CTRunGetGlyphs(run, CFRangeMake(0, 0), &glyphs)
            CTRunGetPositions(run, CFRangeMake(0, 0), &positions)
            CTRunGetAdvances(run, CFRangeMake(0, 0), &advances)
            let runAttrs = CTRunGetAttributes(run) as! [NSAttributedString.Key: Any]
            let runFont = (runAttrs[.font] as! NSFont) as CTFont
            for i in 0..<count {
                out.append(GlyphMetric(glyph: glyphs[i], font: runFont,
                                       x: Double(positions[i].x),
                                       advance: Double(advances[i].width)))
            }
        }
        // The trailing glyph's advance includes the added tracking — drop it
        // from the visual width so centring doesn't drift right.
        glyphs = out
        width = max(w - trackingPt, 0)
        ascent = Double(asc)
        descent = Double(desc)
    }
}

// MARK: - Placed labels (artwork space)

/// A line (road) label placed along its street. Geometry is in ARTWORK SPACE:
/// Web-Mercator world pixels at the project base zoom. The placement is
/// zoom-invariant — the live map, sign artwork and every export render this
/// exact layout, only uniformly scaled.
struct PlacedLineLabel {
    let layerId: UUID
    let subId: UUID?               // road subtype (nil for non-road lines)
    let featureId: Int64           // stitched chain id
    let text: String
    var style: LabelStyle          // resolved per-subtype; fontSize includes labelScale
    let line: Polyline             // artwork-space polyline
    let centerDist: Double         // label centre, arc distance along `line`
    let width: Double              // typographic width in artwork units
    var pinned: Bool = false
}

/// A point or polygon label. `anchor` is its artwork-space centre, including
/// placement, icon binding and manual offsets; `featurePoint` is the feature
/// itself (the far end of a callout).
struct PlacedPointLabel {
    let layerId: UUID
    let featureId: Int64
    let text: String
    var style: LabelStyle
    let anchor: CGPoint
    let featurePoint: CGPoint
}

/// A symbol icon that survived collision resolution.
struct PlacedIcon {
    let layerId: UUID
    let featureId: Int64
    let point: CGPoint             // artwork-space centre (incl. manual offset)
}

struct MapLabelLayout {
    var lineLabels: [PlacedLineLabel] = []
    var pointLabels: [PlacedPointLabel] = []
    var icons: [PlacedIcon] = []
}

// MARK: - Layout engine

/// Deterministic, zoom- and rotation-independent placement (QGIS-style):
/// • priority = layer order (top row first), road subtypes in their list order
/// • icons claim their space first; hand-pinned labels next; then the rest
/// • curved labels only occupy spans with no bend sharper than "Max angle";
///   they slide along the road to dodge bends and collisions, and are dropped
///   when nothing fits
/// • "Repeat distance" = minimum gap between labels with the same text
/// • "Margin" keeps an invisible clear border around each label
@MainActor
enum LabelLayoutEngine {

    private struct LineJob {
        let layerId: UUID
        let subId: UUID?
        let chainId: Int64
        let text: String
        let metrics: TextMetrics
        let style: LabelStyle
        let line: Polyline
        let along: Double
        let pins: [Double]?
    }

    private static var metricsCache: [String: TextMetrics] = [:]

    static func metrics(text: String, style ls: LabelStyle) -> TextMetrics {
        let key = "\(text)|\(ls.fontName)|\(ls.fontWeight)|\(ls.fontSize)|\(ls.tracking)|\(ls.wordSpacing)"
        if let hit = metricsCache[key] { return hit }
        let m = TextMetrics(text: text, font: resolvedNSFont(ls),
                            trackingPt: ls.tracking / 1000.0 * ls.fontSize,
                            wordSpacingPt: ls.wordSpacing / 1000.0 * ls.fontSize)
        if metricsCache.count > 20_000 { metricsCache.removeAll() }
        metricsCache[key] = m
        return m
    }

    static func compute(layers: [MapLayer], baseZoom: Double, labelScale: Double) -> MapLabelLayout {
        var layout = MapLabelLayout()
        var obstacles: [CGRect] = []
        var sameText: [String: [CGPoint]] = [:]

        // Icons first: they are the most visually fixed things on a map.
        for layer in layers where layer.isVisible {
            placeIcons(layer, baseZoom: baseZoom, layout: &layout, obstacles: &obstacles)
        }

        // Gather line jobs per layer up front so hand-placed labels anywhere on
        // the map reserve their space before any automatic label is considered.
        var jobsByLayer: [UUID: [LineJob]] = [:]
        for layer in layers where layer.isVisible && !layer.lineFeatures.isEmpty {
            jobsByLayer[layer.id] = lineJobs(layer, baseZoom: baseZoom, labelScale: labelScale)
        }
        for layer in layers where layer.isVisible {
            for job in jobsByLayer[layer.id] ?? [] {
                guard let pins = job.pins else { continue }
                for d in pins {
                    let half = job.metrics.width / 2
                    let c = min(max(d, min(half, job.line.length / 2)),
                                max(job.line.length - half, job.line.length / 2))
                    obstacles.append(contentsOf: spanBoxes(line: job.line, centerDist: c, width: job.metrics.width,
                                                           halfHeight: perpendicularExtent(job.style, metrics: job.metrics)))
                    sameText[job.text, default: []].append(job.line.point(at: c))
                    layout.lineLabels.append(PlacedLineLabel(
                        layerId: job.layerId, subId: job.subId, featureId: job.chainId, text: job.text,
                        style: job.style, line: job.line, centerDist: c, width: job.metrics.width, pinned: true))
                }
            }
        }

        // Layer order = priority: index 0 is the top row and claims space first.
        for layer in layers where layer.isVisible {
            // A layer can hold several kinds of feature: Pedestrian Zones has areas
            // and streets, Water has lakes and rivers. Areas and points go first.
            placePointLayer(layer, baseZoom: baseZoom, labelScale: labelScale,
                            layout: &layout, obstacles: &obstacles)
            for job in jobsByLayer[layer.id] ?? [] where job.pins == nil {
                placeAlong(job, layout: &layout, obstacles: &obstacles, sameText: &sameText)
            }
        }
        return layout
    }

    // MARK: Icons

    /// Lat/lon anchor for each symbol-bearing feature of the layer.
    static func symbolAnchors(layer: MapLayer) -> [(id: Int64, lat: Double, lon: Double)] {
        let sym = layer.symbolStyle
        switch layer.kind.featureType {
        case .polygon:
            return layer.polygonFeatures.compactMap { f in
                guard let ring = f.rings.first, !ring.isEmpty else { return nil }
                let latlon: [Double]
                switch sym.anchorPoint {
                case .geometricCenter: latlon = PolygonCenter.vertexMean(ring)
                case .centroid:        latlon = PolygonCenter.areaCentroid(ring)
                case .visualCenter:    latlon = PolygonCenter.visualCenter(ring)
                }
                return (f.id, latlon[0], latlon[1])
            }
        case .point:
            return layer.pointFeatures.compactMap { f in
                f.coordinate.count >= 2 ? (f.id, f.coordinate[1], f.coordinate[0]) : nil
            }
        case .line:
            return []
        }
    }

    private static func placeIcons(_ layer: MapLayer, baseZoom: Double,
                                   layout: inout MapLabelLayout, obstacles: inout [CGRect]) {
        let sym = layer.symbolStyle
        guard sym.enabled, sym.isVisible, sym.inlineSVGData != nil || sym.iconId != nil else { return }
        for a in symbolAnchors(layer: layer) {
            var p = MapProjection.world(lat: a.lat, lon: a.lon, zoom: baseZoom)
            let moved = layer.symbolOffsets[a.id]
            if let off = moved { p.x += off.dx; p.y += off.dy }
            let box = CGRect(x: Double(p.x) - sym.width / 2, y: Double(p.y) - sym.height / 2,
                             width: sym.width, height: sym.height)
            if moved == nil, !sym.allowOverlapWithOtherLayers {
                let m = max(sym.collisionMargin, 0)
                let inflated = box.insetBy(dx: -m, dy: -m)
                if obstacles.contains(where: { $0.intersects(inflated) }) { continue }
            }
            obstacles.append(box)
            layout.icons.append(PlacedIcon(layerId: layer.id, featureId: a.id, point: p))
        }
    }

    // MARK: Line layers

    private static func isClosed(_ f: LineFeature) -> Bool {
        f.coordinates.count >= 4 && f.coordinates.first == f.coordinates.last
    }

    private static func lineJobs(_ layer: MapLayer, baseZoom: Double, labelScale: Double) -> [LineJob] {
        // Buckets honour road-subtype order: a higher subtype wins space.
        var buckets: [(style: LabelStyle, features: [LineFeature], subId: UUID?)] = []
        if layer.kind == .roads {
            // The master Labels row gates the whole road category; each subtype's
            // own flags refine within it.
            guard layer.labelStyle.enabled, layer.labelStyle.isVisible else { return [] }
            for sub in layer.roadSubLayers where sub.isVisible {
                let typeSet = Set(sub.roadTypes)
                let feats = layer.lineFeatures.filter {
                    $0.tags["highway"].map { typeSet.contains($0) } == true
                }
                buckets.append((sub.labelStyle ?? layer.labelStyle, feats, sub.id))
            }
        } else {
            // A street that is also mapped as a named area gets one label, on the
            // area. Outlines in a point layer are labelled at their centre instead.
            let ls = layer.labelStyle
            let areaNames = Set(layer.polygonFeatures.compactMap { resolvedText($0.tags, ls) })
            let isPointLayer = layer.kind.featureType == .point
            let feats = layer.lineFeatures.filter { f in
                if isPointLayer, isClosed(f) { return false }
                return resolvedText(f.tags, ls).map { !areaNames.contains($0) } ?? false
            }
            buckets.append((ls, feats, nil))
        }

        var jobs: [LineJob] = []
        for (rawLS, features, subId) in buckets {
            guard rawLS.enabled, rawLS.isVisible else { continue }
            var ls = rawLS
            ls.fontSize *= labelScale

            // Same-named ways sharing endpoints become one street, so the label
            // centres on the real road and repeats space along its whole length.
            var groups: [String: [(id: Int64, pts: [CGPoint])]] = [:]
            var order: [String] = []
            for f in features {
                guard let text = resolvedText(f.tags, ls) else { continue }
                let world = f.coordinates.compactMap { c -> CGPoint? in
                    c.count >= 2 ? MapProjection.world(lat: c[1], lon: c[0], zoom: baseZoom) : nil
                }
                guard world.count >= 2 else { continue }
                if groups[text] == nil { order.append(text) }
                groups[text, default: []].append((f.id, world))
            }

            for text in order {
                let m = metrics(text: text, style: ls)
                guard m.width > 0 else { continue }
                for chain in stitch(groups[text] ?? []) {
                    var pts = chain.pts
                    if ls.lineLabelMode != .curved, let off = layer.labelOffsets[chain.id], off != .zero {
                        pts = pts.map { CGPoint(x: $0.x + off.dx, y: $0.y + off.dy) }
                    }
                    let line = Polyline(pts)
                    let pins = layer.labelPins[chain.id]
                    guard line.length > m.width + 4 || (pins != nil && line.length > 1) else { continue }
                    jobs.append(LineJob(layerId: layer.id, subId: subId, chainId: chain.id, text: text,
                                        metrics: m, style: ls, line: line,
                                        along: layer.labelAlongOffsets[chain.id] ?? 0, pins: pins))
                }
            }
        }
        return jobs
    }

    /// Stitches ways that share endpoints into longer chains, reversing as
    /// needed. Only continues through a junction when the street keeps going
    /// roughly straight, so a label never gets routed around a T-junction.
    private static func stitch(_ ways: [(id: Int64, pts: [CGPoint])]) -> [(id: Int64, pts: [CGPoint])] {
        var chains = ways
        guard chains.count > 1 else { return chains }
        let eps = 0.05
        func close(_ a: CGPoint, _ b: CGPoint) -> Bool {
            abs(Double(a.x - b.x)) < eps && abs(Double(a.y - b.y)) < eps
        }
        func smooth(_ a: [CGPoint], _ b: [CGPoint]) -> Bool {   // a's end flows into b's start
            guard a.count >= 2, b.count >= 2 else { return true }
            let p = a[a.count - 2], q = a[a.count - 1], r = b[1]
            let a1 = atan2(Double(q.y - p.y), Double(q.x - p.x))
            let a2 = atan2(Double(r.y - q.y), Double(r.x - q.x))
            var d = abs(a2 - a1) * 180 / .pi
            if d > 180 { d = 360 - d }
            return d < 60
        }
        var merged = true
        while merged && chains.count > 1 {
            merged = false
            outer: for i in 0..<chains.count {
                for j in (i + 1)..<chains.count {
                    let a = chains[i].pts, b = chains[j].pts
                    guard let af = a.first, let al = a.last, let bf = b.first, let bl = b.last else { continue }
                    let br = Array(b.reversed()), ar = Array(a.reversed())
                    var joined: [CGPoint]? = nil
                    if close(al, bf), smooth(a, b)       { joined = a + b.dropFirst() }
                    else if close(al, bl), smooth(a, br) { joined = a + br.dropFirst() }
                    else if close(af, bl), smooth(b, a)  { joined = b + a.dropFirst() }
                    else if close(af, bf), smooth(ar, b) { joined = ar + b.dropFirst() }
                    if let np = joined {
                        chains[i] = (chains[i].id, np)
                        chains.remove(at: j)
                        merged = true
                        break outer
                    }
                }
            }
        }
        return chains
    }

    private static func placeAlong(_ job: LineJob, layout: inout MapLabelLayout,
                                   obstacles: inout [CGRect], sameText: inout [String: [CGPoint]]) {
        let line = job.line, ls = job.style, metrics = job.metrics, text = job.text
        let L = line.length
        let w = metrics.width
        let halfW = w / 2
        let anchor = min(max(L / 2 + job.along, min(halfW, L / 2)), max(L - halfW, L / 2))

        // Valid spans: gaps between sharp bends (curved mode only).
        let intervals: [(Double, Double)]
        if ls.lineLabelMode == .curved {
            var bounds = [0.0] + line.sharpVertexDistances(maxAngleDeg: ls.maxCharAngle) + [L]
            bounds.sort()
            var ivs: [(Double, Double)] = []
            for i in 0..<bounds.count - 1 where bounds[i+1] - bounds[i] >= w {
                ivs.append((bounds[i], bounds[i+1]))
            }
            intervals = ivs
        } else {
            intervals = L >= w ? [(0, L)] : []
        }
        guard !intervals.isEmpty else { return }

        // Desired centres: the anchor, then outwards every repeat step.
        let rep = max(ls.repeatInterval, w + 8)
        var desired: [Double] = [anchor]
        var k = 1.0
        while true {
            let lo = anchor - k * rep, hi = anchor + k * rep
            var any = false
            if lo - halfW >= 0 { desired.append(lo); any = true }
            if hi + halfW <= L { desired.append(hi); any = true }
            if !any { break }
            k += 1
        }

        let margin = max(ls.minSpacing, 0)
        let perpExtent = perpendicularExtent(ls, metrics: metrics)
        let ignore = ls.showAllLabels || ls.overlapMode == .allow

        func commit(_ c: Double, _ boxes: [CGRect]) {
            obstacles.append(contentsOf: boxes)
            sameText[text, default: []].append(line.point(at: c))
            layout.lineLabels.append(PlacedLineLabel(
                layerId: job.layerId, subId: job.subId, featureId: job.chainId, text: text,
                style: ls, line: line, centerDist: c, width: w))
        }

        for (index, d) in desired.enumerated() {
            guard let iv = intervals.min(by: {
                distanceToInterval(d, $0) < distanceToInterval(d, $1)
            }) else { break }
            let cMin = iv.0 + halfW, cMax = iv.1 - halfW
            guard cMin <= cMax else { continue }
            let base = min(max(d, cMin), cMax)

            // Slide along the road to dodge bends and collisions.
            let step = max(w / 4, ls.fontSize)
            var candidates: [Double] = [base]
            var s = step
            while s < (iv.1 - iv.0), candidates.count <= 32 {
                if base + s <= cMax { candidates.append(base + s) }
                if base - s >= cMin { candidates.append(base - s) }
                s += step
            }

            var placed = false
            for c in candidates {
                let centerPt = line.point(at: c)
                if let prev = sameText[text],
                   prev.contains(where: { hypot(Double($0.x - centerPt.x), Double($0.y - centerPt.y)) < rep }) {
                    continue
                }
                if ls.lineLabelMode == .curved,
                   !glyphAnglesOK(line: line, centerDist: c, metrics: metrics,
                                  fontSize: ls.fontSize, maxDeg: ls.maxCharAngle) {
                    continue
                }
                let boxes = spanBoxes(line: line, centerDist: c, width: w, halfHeight: perpExtent)
                if !ignore {
                    let pad = ls.overlapMode == .allowIfRequired ? 0 : margin
                    let inflated = boxes.map { $0.insetBy(dx: -pad, dy: -pad) }
                    if inflated.contains(where: { box in obstacles.contains { $0.intersects(box) } }) {
                        continue
                    }
                }
                commit(c, boxes)
                placed = true
                break
            }
            // "Allow if required": a street's first label appears even if it has
            // to overlap something, as long as no clear spot exists.
            if !placed, index == 0, ls.overlapMode == .allowIfRequired {
                let clearOfSame = !(sameText[text]?.contains {
                    hypot(Double($0.x - line.point(at: base).x), Double($0.y - line.point(at: base).y)) < rep
                } ?? false)
                if clearOfSame {
                    commit(base, spanBoxes(line: line, centerDist: base, width: w, halfHeight: perpExtent))
                }
            }
        }
    }

    /// How far (perpendicular) the drawn text extends from the guide line —
    /// used to size collision boxes.
    private static func perpendicularExtent(_ ls: LabelStyle, metrics: TextMetrics) -> Double {
        let h = metrics.ascent + metrics.descent
        switch ls.linePosition {
        case .on:             return h / 2 + 1
        case .above, .below:  return ls.distanceFromLine + h * 0.75 + 1
        }
    }

    private static func distanceToInterval(_ d: Double, _ iv: (Double, Double)) -> Double {
        if d < iv.0 { return iv.0 - d }
        if d > iv.1 { return d - iv.1 }
        return 0
    }

    /// Collision boxes sampled along the label span.
    private static func spanBoxes(line: Polyline, centerDist: Double,
                                  width: Double, halfHeight: Double) -> [CGRect] {
        let start = centerDist - width / 2
        let sampleStep = max(halfHeight * 1.2, 4.0)
        var boxes: [CGRect] = []
        var d = 0.0
        while d <= width {
            let p = line.point(at: start + d)
            boxes.append(CGRect(x: Double(p.x) - halfHeight, y: Double(p.y) - halfHeight,
                                width: halfHeight * 2, height: halfHeight * 2))
            d += sampleStep
        }
        return boxes
    }

    /// Adjacent glyph chord angles must not differ more than `maxDeg`. Angles are
    /// sampled over at least ~0.6 em so tiny vertices don't make glyphs jitter
    /// (the same window the renderer rotates with).
    private static func glyphAnglesOK(line: Polyline, centerDist: Double,
                                      metrics: TextMetrics, fontSize: Double,
                                      maxDeg: Double) -> Bool {
        let start = centerDist - metrics.width / 2
        let minWin = fontSize * 0.6
        var prev: Double? = nil
        for g in metrics.glyphs where g.advance > 0.1 {
            let mid = start + g.x + g.advance / 2
            let half = max(g.advance, minWin) / 2
            let a = line.chordAngle(from: mid - half, to: mid + half) * 180 / .pi
            if let p = prev {
                var delta = abs(a - p)
                if delta > 180 { delta = 360 - delta }
                if delta > maxDeg { return false }
            }
            prev = a
        }
        return true
    }

    // MARK: Point / polygon layers

    private static func placePointLayer(_ layer: MapLayer, baseZoom: Double, labelScale: Double,
                                        layout: inout MapLabelLayout,
                                        obstacles: inout [CGRect]) {
        var ls = layer.labelStyle
        guard ls.enabled, ls.isVisible else { return }
        ls.fontSize *= labelScale
        let sym = layer.symbolStyle
        let bound = sym.enabled && sym.isVisible && sym.bindToLabels
        let iconPoints = Dictionary(layout.icons.filter { $0.layerId == layer.id }.map { ($0.featureId, $0.point) },
                                    uniquingKeysWith: { a, _ in a })

        func place(featureId: Int64, lat: Double, lon: Double, tags: [String: String]) {
            guard let text = resolvedText(tags, ls) else { return }
            let m = metrics(text: text, style: ls)
            guard m.width > 0 else { return }
            let feature = MapProjection.world(lat: lat, lon: lon, zoom: baseZoom)
            let h = m.ascent + m.descent
            var anchor = feature
            let ownIcon = iconPoints[featureId]
            if bound, let icon = ownIcon {
                // Text sits beside its icon per the Label Binding settings.
                anchor = icon
                let gx = sym.width / 2 + sym.iconTextGap + m.width / 2
                let gy = sym.height / 2 + sym.iconTextGap + h / 2
                switch sym.labelLayout {
                case .iconLeft:  anchor.x += CGFloat(gx)
                case .iconRight: anchor.x -= CGFloat(gx)
                case .iconAbove: anchor.y += CGFloat(gy)
                case .iconBelow: anchor.y -= CGFloat(gy)
                }
                if sym.labelLayout == .iconLeft || sym.labelLayout == .iconRight {
                    let extra = (sym.height - h) / 2
                    switch sym.textAlignment {
                    case .alignTop:       anchor.y -= CGFloat(extra)
                    case .alignBottom:    anchor.y += CGFloat(extra)
                    case .verticalCenter: break
                    }
                }
            } else {
                var dir = ls.placement.unitDirection
                var gapX = m.width / 2 + max(ls.fontSize * 0.4, 4)
                var gapY = h / 2 + max(ls.fontSize * 0.3, 3)
                if let icon = ownIcon {
                    // Clear the feature's icon; a centred label goes under it.
                    anchor = icon
                    gapX += sym.width / 2
                    gapY += sym.height / 2
                    if dir.dx == 0, dir.dy == 0 { dir = (dx: 0, dy: 1) }
                }
                anchor.x += CGFloat(dir.dx * gapX + ls.offsetX)
                anchor.y += CGFloat(dir.dy * gapY - ls.offsetY)
            }
            let moved = layer.labelOffsets[featureId]
            if let off = moved { anchor.x += off.dx; anchor.y += off.dy }
            let pad = max(ls.bufferEnabled ? ls.haloWidth : 0, 1.0)
            let box = CGRect(x: Double(anchor.x) - m.width / 2 - pad, y: Double(anchor.y) - h / 2 - pad,
                             width: m.width + pad * 2, height: h + pad * 2)
            if moved == nil, !(ls.showAllLabels || ls.overlapMode == .allow) {
                let mg = ls.overlapMode == .allowIfRequired ? 0 : max(ls.minSpacing, 0)
                let inflated = box.insetBy(dx: -mg, dy: -mg)
                // A label never competes with its own icon.
                let ownBox = ownIcon.map {
                    CGRect(x: Double($0.x) - sym.width / 2, y: Double($0.y) - sym.height / 2,
                           width: sym.width, height: sym.height)
                }
                if ls.overlapMode != .allowIfRequired,
                   obstacles.contains(where: { $0 != ownBox && $0.intersects(inflated) }) { return }
            }
            obstacles.append(box)
            layout.pointLabels.append(PlacedPointLabel(
                layerId: layer.id, featureId: featureId, text: text, style: ls,
                anchor: anchor, featurePoint: feature))
        }

        for f in layer.polygonFeatures {
            guard !f.tags.isEmpty, !f.outerRing.isEmpty else { continue }
            let c = PolygonCenter.areaCentroid(f.outerRing)   // [lat, lon]
            place(featureId: f.id, lat: c[0], lon: c[1], tags: f.tags)
        }
        for f in layer.pointFeatures {
            guard f.coordinate.count >= 2 else { continue }
            place(featureId: f.id, lat: f.coordinate[1], lon: f.coordinate[0], tags: f.tags)
        }
        if layer.kind.featureType == .point {
            for f in layer.lineFeatures where isClosed(f) {
                let c = PolygonCenter.areaCentroid(f.coordinates)
                place(featureId: f.id, lat: c[0], lon: c[1], tags: f.tags)
            }
        }
    }

    // MARK: Style helpers (shared with renderers/exporters)

    static func resolvedText(_ tags: [String: String], _ ls: LabelStyle) -> String? {
        let raw = tags[ls.tagKey] ?? tags[ls.fallbackTagKey] ?? ""
        guard !raw.isEmpty else { return nil }
        switch ls.typeCase {
        case .asStored:  return raw
        case .uppercase: return raw.uppercased()
        case .lowercase: return raw.lowercased()
        case .titleCase:
            return raw.components(separatedBy: " ")
                .map { $0.isEmpty ? "" : $0.prefix(1).uppercased() + $0.dropFirst() }
                .joined(separator: " ")
        case .sentenceCase:
            return raw.prefix(1).uppercased() + raw.dropFirst()
        }
    }

    static func resolvedNSFont(_ ls: LabelStyle) -> NSFont {
        let w = nsWeight(ls.fontWeight)
        if ls.fontName.isEmpty { return .systemFont(ofSize: ls.fontSize, weight: w) }
        // The weight picker lists the family's real face names ("Medium",
        // "Bold Italic"…), so match the exact face first.
        if let members = NSFontManager.shared.availableMembers(ofFontFamily: ls.fontName) {
            for m in members where (m[1] as? String)?.caseInsensitiveCompare(ls.fontWeight) == .orderedSame {
                if let ps = m[0] as? String, let f = NSFont(name: ps, size: ls.fontSize) { return f }
            }
        }
        if let f = NSFontManager.shared.font(withFamily: ls.fontName, traits: [],
                                             weight: fontManagerWeight(ls.fontWeight),
                                             size: ls.fontSize) {
            return f
        }
        return NSFont(name: ls.fontName, size: ls.fontSize)
            ?? .systemFont(ofSize: ls.fontSize, weight: w)
    }

    static func fontManagerWeight(_ name: String) -> Int {
        switch name.lowercased() {
        case "ultralight", "ultra light", "extralight", "extra light": return 1
        case "thin":                                                    return 2
        case "light":                                                   return 3
        case "medium":                                                  return 6
        case "semibold", "semi bold", "demibold", "demi":              return 8
        case "bold":                                                    return 9
        case "heavy", "extrabold", "extra bold":                       return 10
        case "black":                                                   return 11
        default:                                                        return 5
        }
    }

    static func nsWeight(_ name: String) -> NSFont.Weight {
        switch name.lowercased() {
        case "ultralight", "ultra light", "extralight", "extra light": return .ultraLight
        case "thin":                                                    return .thin
        case "light":                                                   return .light
        case "medium":                                                  return .medium
        case "semibold", "semi bold", "demibold", "demi":              return .semibold
        case "bold":                                                    return .bold
        case "heavy", "extrabold", "extra bold":                       return .heavy
        case "black":                                                   return .black
        default:                                                        return .regular
        }
    }
}

// MARK: - Layout cache

/// Memoises layouts by what actually affects placement, so changing a road
/// colour or a building fill doesn't re-run label placement. Colours and other
/// paint-only values are refreshed onto the cached result.
@MainActor
final class LabelLayoutCache {
    static let shared = LabelLayoutCache()

    private var store: [Int: MapLabelLayout] = [:]
    private var order: [Int] = []

    /// `version` is accepted for call-site clarity; the key is content-based.
    func layout(layers: [MapLayer], baseZoom: Double,
                labelScale: Double, version: Int = 0) -> MapLabelLayout {
        var h = Hasher()
        h.combine(baseZoom); h.combine(labelScale)
        func placement(_ ls: LabelStyle) -> LabelStyle {
            var s = ls
            s.color = .init(r: 0, g: 0, b: 0); s.haloColor = s.color; s.shadowColor = s.color
            s.calloutColor = s.color; s.opacity = 1; s.bufferOpacity = 1; s.shadowOpacity = 1
            s.textStyleId = nil
            return s
        }
        for layer in layers {
            h.combine(layer.id); h.combine(layer.isVisible); h.combine(layer.geometryVersion)
            h.combine(placement(layer.labelStyle))
            for sub in layer.roadSubLayers {
                h.combine(sub.id); h.combine(sub.isVisible); h.combine(sub.roadTypes)
                if let ls = sub.labelStyle { h.combine(placement(ls)) }
            }
            for k in layer.labelOffsets.keys.sorted() {
                h.combine(k); h.combine(layer.labelOffsets[k]!.dx); h.combine(layer.labelOffsets[k]!.dy)
            }
            for k in layer.symbolOffsets.keys.sorted() {
                h.combine(k); h.combine(layer.symbolOffsets[k]!.dx); h.combine(layer.symbolOffsets[k]!.dy)
            }
            for k in layer.labelPins.keys.sorted() { h.combine(k); h.combine(layer.labelPins[k]!) }
            for k in layer.labelAlongOffsets.keys.sorted() { h.combine(k); h.combine(layer.labelAlongOffsets[k]!) }
            let sym = layer.symbolStyle
            h.combine(sym.enabled); h.combine(sym.isVisible); h.combine(sym.width); h.combine(sym.height)
            h.combine(sym.iconId); h.combine(sym.inlineSVGData != nil); h.combine(sym.anchorPoint.rawValue)
            h.combine(sym.collisionMargin); h.combine(sym.allowOverlapWithOtherLayers)
            h.combine(sym.bindToLabels); h.combine(sym.labelLayout.rawValue)
            h.combine(sym.iconTextGap); h.combine(sym.textAlignment.rawValue)
        }
        let key = h.finalize()

        var result: MapLabelLayout
        if let hit = store[key] {
            result = hit
        } else {
            result = LabelLayoutEngine.compute(layers: layers, baseZoom: baseZoom, labelScale: labelScale)
            store[key] = result
            order.append(key)
            while order.count > 12 { store.removeValue(forKey: order.removeFirst()) }
        }

        // Fresh paint values.
        var byLayer: [UUID: MapLayer] = [:]
        for l in layers { byLayer[l.id] = l }
        for i in result.lineLabels.indices {
            guard let l = byLayer[result.lineLabels[i].layerId] else { continue }
            var ls = result.lineLabels[i].subId
                .flatMap { sid in l.roadSubLayers.first { $0.id == sid }?.labelStyle } ?? l.labelStyle
            ls.fontSize *= labelScale
            result.lineLabels[i].style = ls
        }
        for i in result.pointLabels.indices {
            guard let l = byLayer[result.pointLabels[i].layerId] else { continue }
            var ls = l.labelStyle
            ls.fontSize *= labelScale
            result.pointLabels[i].style = ls
        }
        return result
    }
}
