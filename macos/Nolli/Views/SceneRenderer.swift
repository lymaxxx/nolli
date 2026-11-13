import SwiftUI
import AppKit
import CoreText

// MARK: - Compiled scene

/// An immutable, ready-to-draw description of the whole map in artwork space
/// (world pixels at the base zoom, relative to `origin`). Built on the main
/// actor whenever the document changes, then drawn from any thread: the live
/// map, sign previews, PNG and PDF all draw this one object through a single
/// CTM, which is why they can't disagree with each other.
final class CompiledScene: @unchecked Sendable {
    struct Cell {
        let path: CGPath
        let bounds: CGRect
    }

    struct Batch {
        var cells: [Cell]
        var fill: CGColor? = nil
        var evenOdd = false
        var stroke: CGColor? = nil
        var lineWidth: CGFloat = 1
        var cap: CGLineCap = .round
        var join: CGLineJoin = .round
    }

    struct IconBatch {
        let image: CGImage
        let size: CGSize
        let rotation: Double
        let opacity: Double
        let layerId: UUID
        let items: [(id: Int64, point: CGPoint)]
    }

    struct GlyphInstance {
        let glyph: CGGlyph
        let font: CTFont
        let transform: CGAffineTransform   // local → glyph space (y-up glyph)
    }

    struct Run {
        let path: CGPath
        let glyphs: [GlyphInstance]
    }

    struct Label {
        let key: String
        let layerId: UUID
        let subId: UUID?
        let featureId: Int64
        let index: Int
        let style: LabelStyle
        let bounds: CGRect
        /// Road labels: the reading direction flips when the view rotates.
        let forward: Run
        let reverse: Run?
        let chord: Double
        /// Horizontal/point labels stay upright; drawn around `anchor`.
        let upright: Bool
        let anchor: CGPoint
        let callout: CGPoint?
    }

    var origin: CGPoint = .zero
    var baseZoom: Double = 15
    var batches: [Batch] = []
    var icons: [IconBatch] = []
    var labels: [Label] = []
    /// Placed road labels by key: the edit overlay needs their street geometry.
    var placedLines: [String: PlacedLineLabel] = [:]

    struct Options {
        var background: CodableColor? = nil
        /// Real text glyphs (PDF) instead of filled outlines (screen).
        var textAsGlyphs = false
        var excludeLabel: String? = nil
        var excludeIcon: String? = nil
        var deviceScale: CGFloat = 1
    }

    /// Draws into a y-down context whose user space is view points.
    func draw(in cg: CGContext, proj: MapProjection, viewport: CGRect, options: Options = .init()) {
        if let bg = options.background {
            cg.setFillColor(bg.cgColor)
            cg.fill(viewport)
        }
        let t = proj.artworkTransform(baseZoom: baseZoom, origin: origin)
        let s = pow(2.0, proj.zoom - baseZoom)
        let cull = viewport.applying(t.inverted())

        cg.saveGState()
        cg.concatenate(t)
        cg.setLineJoin(.round)

        for b in batches {
            if let fill = b.fill {
                cg.setFillColor(fill)
                for c in b.cells where c.bounds.intersects(cull) {
                    cg.addPath(c.path)
                    cg.fillPath(using: b.evenOdd ? .evenOdd : .winding)
                }
            }
            if let stroke = b.stroke, b.lineWidth > 0 {
                cg.setStrokeColor(stroke)
                cg.setLineWidth(b.lineWidth)
                cg.setLineCap(b.cap)
                cg.setLineJoin(b.join)
                let pad = b.lineWidth
                for c in b.cells where c.bounds.insetBy(dx: -pad, dy: -pad).intersects(cull) {
                    cg.addPath(c.path)
                    cg.strokePath()
                }
            }
        }

        // Icons sit above all geometry and stay upright as the view rotates.
        let rad = proj.rotation * .pi / 180
        for batch in icons {
            let w = batch.size.width, h = batch.size.height
            for item in batch.items {
                guard cull.insetBy(dx: -max(w, h), dy: -max(w, h)).contains(item.point) else { continue }
                if options.excludeIcon == "\(batch.layerId)|\(item.id)" { continue }
                cg.saveGState()
                cg.setAlpha(CGFloat(batch.opacity))
                cg.translateBy(x: item.point.x, y: item.point.y)
                cg.rotate(by: CGFloat(rad + batch.rotation * .pi / 180))
                cg.scaleBy(x: 1, y: -1)
                cg.draw(batch.image, in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
                cg.restoreGState()
            }
        }

        // Labels on top of everything.
        for label in labels {
            guard label.bounds.intersects(cull), label.key != options.excludeLabel else { continue }
            Self.draw(label: label, in: cg, rotation: proj.rotation, scale: s, options: options)
        }
        cg.restoreGState()
    }

    /// Draws one label; the context's CTM must already be artwork → screen.
    static func draw(label: Label, in cg: CGContext, rotation: Double, scale s: Double, options: Options) {
        let ls = label.style
        let rad = rotation * .pi / 180
        cg.saveGState()
        if let target = label.callout {
            drawCallout(cg, from: label.anchor, to: target, ls: ls)
        }
        let run: Run
        if label.upright {
            cg.translateBy(x: label.anchor.x, y: label.anchor.y)
            cg.rotate(by: CGFloat(rad))
            run = label.forward
        } else {
            run = cos(label.chord - rad) < 0 ? (label.reverse ?? label.forward) : label.forward
        }

        if ls.bufferEnabled && ls.haloWidth > 0 {
            let halo = CGColor(red: ls.haloColor.r, green: ls.haloColor.g, blue: ls.haloColor.b,
                               alpha: ls.haloColor.a * ls.bufferOpacity)
            cg.setStrokeColor(halo)
            cg.setLineWidth(CGFloat(ls.haloWidth * 2))
            cg.setLineJoin(cgJoin(ls.bufferJoinStyle))
            cg.setLineCap(.round)
            if options.textAsGlyphs {
                cg.setTextDrawingMode(.stroke)
                drawGlyphs(run, in: cg)
            } else {
                cg.addPath(run.path)
                cg.strokePath()
            }
        }
        if ls.shadowEnabled {
            let k = CGFloat(s) * options.deviceScale
            cg.setShadow(offset: CGSize(width: CGFloat(ls.shadowOffsetX) * k,
                                        height: -CGFloat(ls.shadowOffsetY) * k),
                         blur: CGFloat(ls.shadowBlur) * k,
                         color: CGColor(red: ls.shadowColor.r, green: ls.shadowColor.g, blue: ls.shadowColor.b,
                                        alpha: ls.shadowColor.a * ls.shadowOpacity))
        }
        cg.setFillColor(CGColor(red: ls.color.r, green: ls.color.g, blue: ls.color.b,
                                alpha: ls.color.a * ls.opacity))
        if options.textAsGlyphs {
            cg.setTextDrawingMode(.fill)
            drawGlyphs(run, in: cg)
        } else {
            cg.addPath(run.path)
            cg.fillPath()
        }
        cg.restoreGState()
    }

    private static func drawGlyphs(_ run: Run, in cg: CGContext) {
        cg.textMatrix = .identity
        for g in run.glyphs {
            cg.saveGState()
            cg.concatenate(g.transform)
            var glyph = g.glyph
            var pos = CGPoint.zero
            CTFontDrawGlyphs(g.font, &glyph, &pos, 1, cg)
            cg.restoreGState()
        }
    }

    private static func drawCallout(_ cg: CGContext, from a: CGPoint, to b: CGPoint, ls: LabelStyle) {
        cg.saveGState()
        cg.setStrokeColor(ls.calloutColor.cgColor)
        cg.setLineWidth(CGFloat(ls.calloutWidth))
        cg.setLineCap(.round)
        cg.move(to: b)
        switch ls.calloutStyle {
        case .simpleLine, .balloon:
            cg.addLine(to: a)
        case .manhattan:
            cg.addLine(to: CGPoint(x: b.x, y: a.y))
            cg.addLine(to: a)
        case .curved:
            cg.addQuadCurve(to: a, control: CGPoint(x: b.x, y: a.y))
        }
        cg.strokePath()
        if ls.calloutStyle == .balloon {
            cg.setFillColor(ls.calloutColor.cgColor)
            let r = CGFloat(ls.calloutWidth) * 2
            cg.fillEllipse(in: CGRect(x: b.x - r, y: b.y - r, width: r * 2, height: r * 2))
        }
        cg.restoreGState()
    }

    static func cgJoin(_ j: LineJoin) -> CGLineJoin {
        switch j { case .miter: .miter; case .round: .round; case .bevel: .bevel }
    }
}

// MARK: - Compiler

@MainActor
final class SceneStore {
    static let shared = SceneStore()

    private struct Key: Hashable {
        let version: Int
        let baseZoom: Double
        let labelScale: Double
        let iconScale: Double
    }

    private struct LayerGeometry {
        let version: Int
        let baseZoom: Double
        let origin: CGPoint
        var byTypes: [String: [CompiledScene.Cell]] = [:]
        var polygons: [CompiledScene.Cell] = []
        var multiRing: [CompiledScene.Cell] = []
        var strayLines: [CompiledScene.Cell] = []
        var points: [(point: CGPoint, id: Int64)] = []
    }

    private var scenes: [Key: CompiledScene] = [:]
    private var order: [Key] = []
    private var geometry: [UUID: LayerGeometry] = [:]
    private var origin: CGPoint?
    private var originZoom: Double = -1

    func scene(layers: [MapLayer], iconLibrary: [SVGIcon], baseZoom: Double,
               labelScale: Double = 1, iconScale: Double = 1, version: Int) -> CompiledScene {
        let key = Key(version: version, baseZoom: baseZoom, labelScale: labelScale, iconScale: iconScale)
        if let hit = scenes[key] { return hit }
        let scene = compile(layers: layers, iconLibrary: iconLibrary, baseZoom: baseZoom,
                            labelScale: labelScale, iconScale: iconScale, version: version)
        scenes[key] = scene
        order.append(key)
        while order.count > 8 { scenes.removeValue(forKey: order.removeFirst()) }
        return scene
    }

    private func sceneOrigin(layers: [MapLayer], baseZoom: Double) -> CGPoint {
        if let origin, originZoom == baseZoom { return origin }
        var found: CGPoint?
        search: for l in layers {
            if let c = l.lineFeatures.first?.coordinates.first, c.count >= 2 {
                found = MapProjection.world(lat: c[1], lon: c[0], zoom: baseZoom); break search
            }
            if let c = l.polygonFeatures.first?.outerRing.first, c.count >= 2 {
                found = MapProjection.world(lat: c[1], lon: c[0], zoom: baseZoom); break search
            }
            if let c = l.pointFeatures.first?.coordinate, c.count >= 2 {
                found = MapProjection.world(lat: c[1], lon: c[0], zoom: baseZoom); break search
            }
        }
        guard let f = found else { return .zero }
        origin = CGPoint(x: f.x.rounded(), y: f.y.rounded())
        originZoom = baseZoom
        geometry = [:]
        return origin!
    }

    private func compile(layers: [MapLayer], iconLibrary: [SVGIcon], baseZoom: Double,
                         labelScale: Double, iconScale: Double, version: Int) -> CompiledScene {
        let scene = CompiledScene()
        let origin = sceneOrigin(layers: layers, baseZoom: baseZoom)
        scene.origin = origin
        scene.baseZoom = baseZoom

        // Geometry: bottom of the panel first, so index 0 paints last (on top).
        for layer in layers.reversed() where layer.isVisible {
            switch layer.kind.featureType {
            case .polygon: compilePolygons(layer, into: scene)
            case .line:    compileLines(layer, into: scene)
            case .point:   compilePoints(layer, into: scene)
            }
        }

        let layout = LabelLayoutCache.shared.layout(layers: layers, baseZoom: baseZoom,
                                                    labelScale: labelScale, version: version)
        // Icons, in the same bottom-to-top order.
        for layer in layers.reversed() where layer.isVisible {
            let sym = layer.symbolStyle
            guard sym.enabled, sym.isVisible, let data = svgData(for: sym, library: iconLibrary),
                  let image = SVGRaster.cgImage(from: data) else { continue }
            let items = layout.icons.filter { $0.layerId == layer.id }.map {
                (id: $0.featureId, point: CGPoint(x: $0.point.x - origin.x, y: $0.point.y - origin.y))
            }
            guard !items.isEmpty else { continue }
            scene.icons.append(.init(image: image,
                                     size: CGSize(width: sym.width * iconScale, height: sym.height * iconScale),
                                     rotation: sym.rotation, opacity: sym.opacity,
                                     layerId: layer.id, items: items))
        }

        var perChain: [String: Int] = [:]
        for placed in layout.lineLabels {
            let chainKey = "\(placed.layerId)|\(placed.featureId)"
            let index = perChain[chainKey, default: 0]
            perChain[chainKey] = index + 1
            let label = LabelBuilder.build(placed, index: index, center: placed.centerDist, origin: origin)
            scene.labels.append(label)
            scene.placedLines[label.key] = placed
        }
        for placed in layout.pointLabels {
            scene.labels.append(LabelBuilder.build(placed, origin: origin))
        }
        return scene
    }

    private func svgData(for sym: SymbolStyle, library: [SVGIcon]) -> Data? {
        if let d = sym.inlineSVGData { return d }
        if let id = sym.iconId { return library.first { $0.id == id }?.svgData }
        return nil
    }

    // MARK: Geometry cache

    /// Features are merged into spatial cells, so a map with tens of thousands
    /// of features still only issues a few hundred draw calls, and cells outside
    /// the view are skipped outright.
    private static let cellSize: CGFloat = 768

    private func cells(_ paths: [(path: CGPath, bounds: CGRect)]) -> [CompiledScene.Cell] {
        struct K: Hashable { let x: Int; let y: Int }
        var grid: [K: (CGMutablePath, CGRect)] = [:]
        for p in paths where !p.bounds.isNull {
            let k = K(x: Int(floor(p.bounds.midX / Self.cellSize)), y: Int(floor(p.bounds.midY / Self.cellSize)))
            if var e = grid[k] {
                e.0.addPath(p.path)
                e.1 = e.1.union(p.bounds)
                grid[k] = e
            } else {
                let m = CGMutablePath()
                m.addPath(p.path)
                grid[k] = (m, p.bounds)
            }
        }
        return grid.values.map { .init(path: $0.0, bounds: $0.1) }
    }

    private func linePath(_ coords: [[Double]], baseZoom: Double, origin: CGPoint) -> (CGPath, CGRect)? {
        let m = CGMutablePath()
        var started = false
        for c in coords where c.count >= 2 {
            let w = MapProjection.world(lat: c[1], lon: c[0], zoom: baseZoom)
            let p = CGPoint(x: w.x - origin.x, y: w.y - origin.y)
            if started { m.addLine(to: p) } else { m.move(to: p); started = true }
        }
        guard started else { return nil }
        return (m, m.boundingBoxOfPath)
    }

    private func layerGeometry(_ layer: MapLayer, baseZoom: Double, origin: CGPoint) -> LayerGeometry {
        if let g = geometry[layer.id], g.version == layer.geometryVersion,
           g.baseZoom == baseZoom, g.origin == origin { return g }
        var g = LayerGeometry(version: layer.geometryVersion, baseZoom: baseZoom, origin: origin)
        if layer.kind.featureType == .polygon {
            var single: [(CGPath, CGRect)] = [], multi: [CompiledScene.Cell] = []
            for f in layer.polygonFeatures {
                let m = CGMutablePath()
                for ring in f.rings {
                    var started = false
                    for c in ring where c.count >= 2 {
                        let w = MapProjection.world(lat: c[1], lon: c[0], zoom: baseZoom)
                        let p = CGPoint(x: w.x - origin.x, y: w.y - origin.y)
                        if started { m.addLine(to: p) } else { m.move(to: p); started = true }
                    }
                    if started { m.closeSubpath() }
                }
                if m.isEmpty { continue }
                if f.rings.count > 1 { multi.append(.init(path: m, bounds: m.boundingBoxOfPath)) }
                else { single.append((m, m.boundingBoxOfPath)) }
            }
            g.polygons = cells(single.map { (path: $0.0, bounds: $0.1) })
            g.multiRing = multi
            // Unclosed ways in area layers (rivers, canals) draw as lines.
            g.strayLines = cells(layer.lineFeatures.compactMap {
                linePath($0.coordinates, baseZoom: baseZoom, origin: origin).map { (path: $0.0, bounds: $0.1) }
            })
        }
        if layer.kind.featureType == .point {
            g.points = layer.pointFeatures.compactMap { f in
                guard f.coordinate.count >= 2 else { return nil }
                let w = MapProjection.world(lat: f.coordinate[1], lon: f.coordinate[0], zoom: baseZoom)
                return (CGPoint(x: w.x - origin.x, y: w.y - origin.y), f.id)
            }
        }
        geometry[layer.id] = g
        return g
    }

    private func roadCells(_ layer: MapLayer, types: [String]?, baseZoom: Double, origin: CGPoint) -> [CompiledScene.Cell] {
        var g = layerGeometry(layer, baseZoom: baseZoom, origin: origin)
        let key = types?.joined(separator: ",") ?? "*"
        if let hit = g.byTypes[key] { return hit }
        let set = types.map(Set.init)
        let parts = layer.lineFeatures.compactMap { f -> (path: CGPath, bounds: CGRect)? in
            if let set, !(f.tags["highway"].map { set.contains($0) } ?? false) { return nil }
            return linePath(f.coordinates, baseZoom: baseZoom, origin: origin).map { (path: $0.0, bounds: $0.1) }
        }
        let c = cells(parts)
        g.byTypes[key] = c
        geometry[layer.id] = g
        return c
    }

    private func compileLines(_ layer: MapLayer, into scene: CompiledScene) {
        func add(_ cells: [CompiledScene.Cell], _ style: RoadStyle) {
            guard !cells.isEmpty else { return }
            if style.casingEnabled && style.casingWidth > 0 {
                scene.batches.append(.init(cells: cells, stroke: style.casingColor.cgColor,
                                           lineWidth: CGFloat(style.casingWidth),
                                           cap: style.lineCap.cgLineCap, join: CompiledScene.cgJoin(style.lineJoin)))
            }
            let color = style.color.cgColor.copy(alpha: CGFloat(style.color.a * style.opacity)) ?? style.color.cgColor
            scene.batches.append(.init(cells: cells, stroke: color, lineWidth: CGFloat(style.width),
                                       cap: style.lineCap.cgLineCap, join: CompiledScene.cgJoin(style.lineJoin)))
        }
        if layer.kind == .roads {
            // Top sub-row paints last → on top: rendering follows the hierarchy.
            for sub in layer.roadSubLayers.reversed() where sub.isVisible {
                add(roadCells(layer, types: sub.roadTypes, baseZoom: scene.baseZoom, origin: scene.origin),
                    sub.resolvedLineStyle(master: layer.roadStyle))
            }
        } else {
            add(roadCells(layer, types: nil, baseZoom: scene.baseZoom, origin: scene.origin), layer.roadStyle)
        }
    }

    private func compilePolygons(_ layer: MapLayer, into scene: CompiledScene) {
        let g = layerGeometry(layer, baseZoom: scene.baseZoom, origin: scene.origin)
        let st = layer.areaStyle
        let fill = st.fillColor.cgColor.copy(alpha: CGFloat(st.fillColor.a * st.fillOpacity)) ?? st.fillColor.cgColor
        let stroke = st.strokeEnabled && st.strokeWidth > 0 ? st.strokeColor.cgColor : nil
        if !g.polygons.isEmpty {
            scene.batches.append(.init(cells: g.polygons, fill: fill, stroke: stroke,
                                       lineWidth: CGFloat(st.strokeWidth)))
        }
        if !g.multiRing.isEmpty {
            scene.batches.append(.init(cells: g.multiRing, fill: fill, evenOdd: true, stroke: stroke,
                                       lineWidth: CGFloat(st.strokeWidth)))
        }
        if !g.strayLines.isEmpty {
            scene.batches.append(.init(cells: g.strayLines, stroke: fill,
                                       lineWidth: CGFloat(max(st.strokeWidth, 2))))
        }
    }

    private func compilePoints(_ layer: MapLayer, into scene: CompiledScene) {
        let g = layerGeometry(layer, baseZoom: scene.baseZoom, origin: scene.origin)
        guard !g.points.isEmpty else { return }
        let st = layer.poiStyle
        let r = CGFloat(st.size / 2)
        let parts = g.points.map { item -> (path: CGPath, bounds: CGRect) in
            let pt = item.point
            let rect = CGRect(x: pt.x - r, y: pt.y - r, width: r * 2, height: r * 2)
            let p = CGMutablePath()
            switch st.shape {
            case .circle:  p.addEllipse(in: rect)
            case .square:  p.addRect(rect)
            case .diamond:
                p.move(to: CGPoint(x: pt.x, y: pt.y - r))
                p.addLine(to: CGPoint(x: pt.x + r, y: pt.y))
                p.addLine(to: CGPoint(x: pt.x, y: pt.y + r))
                p.addLine(to: CGPoint(x: pt.x - r, y: pt.y))
                p.closeSubpath()
            }
            return (p, rect)
        }
        scene.batches.append(.init(cells: cells(parts), fill: st.fillColor.cgColor,
                                   stroke: st.strokeWidth > 0 ? st.strokeColor.cgColor : nil,
                                   lineWidth: CGFloat(st.strokeWidth)))
    }

    func invalidateAll() {
        scenes = [:]; order = []; geometry = [:]; origin = nil
    }
}

// MARK: - Label geometry

@MainActor
enum LabelBuilder {
    private static var glyphPaths: [String: CGPath] = [:]

    private static func glyphPath(_ font: CTFont, _ glyph: CGGlyph) -> CGPath? {
        let key = "\(CTFontCopyPostScriptName(font))@\(CTFontGetSize(font))#\(glyph)"
        if let hit = glyphPaths[key] { return hit }
        guard let p = CTFontCreatePathForGlyph(font, glyph, nil) else { return nil }
        if glyphPaths.count > 8000 { glyphPaths.removeAll() }
        glyphPaths[key] = p
        return p
    }

    private static func run(_ glyphs: [CompiledScene.GlyphInstance]) -> CompiledScene.Run {
        let m = CGMutablePath()
        for g in glyphs {
            if let p = glyphPath(g.font, g.glyph) { m.addPath(p, transform: g.transform) }
        }
        return .init(path: m, glyphs: glyphs)
    }

    /// Glyphs following `line`, the road offset so the baseline lands where the
    /// line-position setting wants it. Local = artwork − origin.
    private static func curvedRun(line: Polyline, center: Double, metrics m: TextMetrics, ls: LabelStyle,
                                  origin: CGPoint) -> CompiledScene.Run {
        let shift = MapSceneRenderer.baselineShift(ls, metrics: m, scale: 1)
        let guide = shift != 0 ? line.offset(by: shift) : line
        let onGuide = guide.length > 0 && line.length > 0 ? center * (guide.length / line.length) : center
        let start = onGuide - m.width / 2
        let minWin = ls.fontSize * 0.6
        var out: [CompiledScene.GlyphInstance] = []
        for g in m.glyphs where g.advance > 0.01 {
            let mid = start + g.x + g.advance / 2
            let p = guide.point(at: mid)
            let half = max(g.advance, minWin) / 2
            let a = guide.chordAngle(from: mid - half, to: mid + half)
            var t = CGAffineTransform(translationX: p.x - origin.x, y: p.y - origin.y)
            t = t.rotated(by: CGFloat(a)).scaledBy(x: 1, y: -1)
                .translatedBy(x: CGFloat(-g.advance / 2), y: 0)
            out.append(.init(glyph: g.glyph, font: g.font, transform: t))
        }
        return run(out)
    }

    /// One straight line of text centred on (0,0), or placed by `base` transform.
    private static func straightRun(metrics m: TextMetrics, baselineY: Double,
                                    base: CGAffineTransform = .identity) -> CompiledScene.Run {
        let x0 = -m.width / 2
        var out: [CompiledScene.GlyphInstance] = []
        for g in m.glyphs {
            let t = base.scaledBy(x: 1, y: -1).translatedBy(x: CGFloat(x0 + g.x), y: CGFloat(baselineY))
            out.append(.init(glyph: g.glyph, font: g.font, transform: t))
        }
        return run(out)
    }

    /// Builds a road label at an arbitrary centre distance (also used live while
    /// a label is being dragged along its street).
    static func build(_ placed: PlacedLineLabel, index: Int, center: Double, origin: CGPoint) -> CompiledScene.Label {
        let ls = placed.style
        let m = LabelLayoutEngine.metrics(text: placed.text, style: ls)
        let line = placed.line
        let halfW = m.width / 2
        let chord = line.chordAngle(from: center - halfW, to: center + halfW)
        let c = line.point(at: center)
        let local = CGPoint(x: c.x - origin.x, y: c.y - origin.y)
        let shift = MapSceneRenderer.baselineShift(ls, metrics: m, scale: 1)

        let forward: CompiledScene.Run, reverse: CompiledScene.Run?
        var upright = false
        switch ls.lineLabelMode {
        case .curved:
            forward = curvedRun(line: line, center: center, metrics: m, ls: ls, origin: origin)
            reverse = curvedRun(line: line.reversed, center: line.length - center, metrics: m, ls: ls, origin: origin)
        case .parallel:
            let t = CGAffineTransform(translationX: local.x, y: local.y)
            forward = straightRun(metrics: m, baselineY: shift, base: t.rotated(by: CGFloat(chord)))
            reverse = straightRun(metrics: m, baselineY: shift, base: t.rotated(by: CGFloat(chord + .pi)))
        case .horizontal:
            upright = true
            forward = straightRun(metrics: m, baselineY: shift)
            reverse = nil
        }
        let r = CGFloat(halfW + m.ascent + m.descent + ls.distanceFromLine + ls.haloWidth * 2 + 4)
        let box: CGRect
        if ls.lineLabelMode == .curved {
            box = forward.path.boundingBoxOfPath.union(reverse?.path.boundingBoxOfPath ?? .null)
                .insetBy(dx: -CGFloat(ls.haloWidth + 2), dy: -CGFloat(ls.haloWidth + 2))
        } else {
            box = CGRect(x: local.x - r, y: local.y - r, width: r * 2, height: r * 2)
        }
        return .init(key: "\(placed.layerId)|\(placed.featureId)|\(index)", layerId: placed.layerId,
                     subId: placed.subId, featureId: placed.featureId, index: index, style: ls, bounds: box,
                     forward: forward, reverse: reverse, chord: chord, upright: upright,
                     anchor: local, callout: nil)
    }

    static func build(_ placed: PlacedPointLabel, origin: CGPoint) -> CompiledScene.Label {
        let ls = placed.style
        let m = LabelLayoutEngine.metrics(text: placed.text, style: ls)
        let local = CGPoint(x: placed.anchor.x - origin.x, y: placed.anchor.y - origin.y)
        let feature = CGPoint(x: placed.featurePoint.x - origin.x, y: placed.featurePoint.y - origin.y)
        let forward = straightRun(metrics: m, baselineY: -(m.ascent - m.descent) / 2)
        let r = CGFloat(m.width / 2 + m.ascent + m.descent + ls.haloWidth * 2 + 2)
        var box = CGRect(x: local.x - r, y: local.y - r, width: r * 2, height: r * 2)
        var callout: CGPoint? = nil
        if ls.calloutsEnabled,
           hypot(Double(local.x - feature.x), Double(local.y - feature.y)) > ls.calloutMinDistance {
            callout = feature
            box = box.union(CGRect(origin: feature, size: .zero))
        }
        return .init(key: "\(placed.layerId)|\(placed.featureId)|0", layerId: placed.layerId, subId: nil,
                     featureId: placed.featureId, index: 0, style: ls, bounds: box, forward: forward,
                     reverse: nil, chord: 0, upright: true, anchor: local, callout: callout)
    }
}

// MARK: - Exporter helpers

@MainActor
enum MapSceneRenderer {
    /// Where the text BASELINE sits perpendicular to the line. Positive = left of
    /// travel = visually above for left-to-right text. `.on` centres the glyph
    /// box on the line.
    static func baselineShift(_ ls: LabelStyle, metrics: TextMetrics, scale: Double) -> Double {
        switch ls.linePosition {
        case .above: return ls.distanceFromLine * scale + metrics.descent
        case .on:    return -(metrics.ascent - metrics.descent) / 2
        case .below: return -(ls.distanceFromLine * scale + metrics.ascent)
        }
    }

    /// Glyph metrics at a render scale (font metrics are linear in size).
    static func screenMetrics(text: String, style: LabelStyle, scale: Double) -> TextMetrics {
        var ls = style
        ls.fontSize *= scale
        return LabelLayoutEngine.metrics(text: text, style: ls)
    }
}

// MARK: - SVG rasterization

/// Rasterizes SVG data for drawing on the map (macOS's NSImage parses SVG).
enum SVGRaster {
    nonisolated(unsafe) private static var cache: [Int: NSImage] = [:]
    nonisolated(unsafe) private static var cgCache: [Int: CGImage] = [:]
    nonisolated(unsafe) private static let lock = NSLock()

    static func image(from data: Data) -> NSImage? {
        let key = data.hashValue
        lock.lock(); defer { lock.unlock() }
        if let cached = cache[key] { return cached }
        guard let img = NSImage(data: data) else { return nil }
        cache[key] = img
        return img
    }

    static func cgImage(from data: Data) -> CGImage? {
        let key = data.hashValue
        lock.lock()
        if let cached = cgCache[key] { lock.unlock(); return cached }
        lock.unlock()
        guard let img = image(from: data) else { return nil }
        // Large enough to stay crisp when zoomed in on a Retina display.
        let size = img.size.width > 0 ? img.size : CGSize(width: 64, height: 64)
        let k = max(1, 256 / max(size.width, size.height))
        let px = CGSize(width: max(size.width * k, 8), height: max(size.height * k, 8))
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                                         pixelsWide: Int(px.width), pixelsHigh: Int(px.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                                         isPlanar: false, colorSpaceName: .deviceRGB,
                                         bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        img.draw(in: CGRect(origin: .zero, size: px))
        NSGraphicsContext.restoreGraphicsState()
        guard let cgImg = rep.cgImage else { return nil }
        lock.lock()
        cgCache[key] = cgImg
        lock.unlock()
        return cgImg
    }
}
