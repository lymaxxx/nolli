import Foundation
import SwiftUI
import AppKit

struct ExportConfig: Codable, Equatable {
    var widthMM: Double = 400
    var heightMM: Double = 400
    var dpi: Double = 300
    var textAsOutlines: Bool = false
    var embedBBoxMeta: Bool = false
    /// SVG only: write the file WITHOUT curved labels and emit a companion
    /// `<name>-labels.jsx` that adds them as live Illustrator type-on-path
    /// (run the script with the opened SVG as the active document).
    var aiLabelsCompanion: Bool = true
}

/// Exports the map as SVG using the SAME Web-Mercator projection and the SAME
/// deterministic label layout as the on-screen renderer, so the file looks
/// exactly like the app. Every curved road label is ONE editable
/// `<text><textPath>` element bound to an invisible guide path (the road
/// offset perpendicular so the baseline lands where the app draws it) —
/// Illustrator/Figma open these as native type-on-path objects.
@MainActor
class SVGExporter {

    private var defs = ""
    private var guideId = 0

    func export(layers: [MapLayer], bbox: BoundingBox, config: ExportConfig,
                baseZoom: Double, labelsVersion: Int,
                iconLibrary: [SVGIcon] = [],
                excludeCurvedLabels: Bool = false,
                background: CodableColor? = nil) -> String {
        defs = ""; guideId = 0

        let W = config.widthMM * config.dpi / 25.4
        let H = config.heightMM * config.dpi / 25.4

        // Zoom that makes the bbox span exactly W px → the artwork is a pure
        // uniform scale of the base-zoom design (WYSIWYG with the editor).
        let fracW = max((bbox.maxLon - bbox.minLon) / 360.0, 1e-12)
        let zoom = log2(W / (256.0 * fracW))
        let proj = MapProjection(centerLat: (bbox.minLat + bbox.maxLat) / 2,
                                 centerLon: (bbox.minLon + bbox.maxLon) / 2,
                                 zoom: zoom,
                                 viewportSize: CGSize(width: W, height: H),
                                 rotation: AppState.active?.artboardRotation ?? 0)
        let scale = pow(2.0, zoom - baseZoom)

        let layout = LabelLayoutCache.shared.layout(
            layers: layers, baseZoom: baseZoom, labelScale: 1.0, version: labelsVersion)

        // Frame background fill (Figma-style), behind everything.
        let bgSVG = background.map {
            "<rect x=\"0\" y=\"0\" width=\"\(fmt(W))\" height=\"\(fmt(H))\" fill=\"\($0.hex)\"/>\n"
        } ?? ""

        // Vector geometry groups: document order = bottom→top, layers[0] is the
        // TOP row. Icons and labels are emitted as their own top groups below.
        var groupSVGs = ""
        for layer in layers.reversed() where layer.isVisible {
            groupSVGs += layerGroup(layer: layer, proj: proj, scale: scale)
        }

        // Icons group (above all geometry), one sub-group per source layer.
        var iconsSVG = ""
        for layer in layers.reversed() where layer.isVisible {
            let inner = symbolGroup(layer: layer, proj: proj, scale: scale,
                                    baseZoom: baseZoom, iconLibrary: iconLibrary)
            guard !inner.isEmpty else { continue }
            iconsSVG += "  <g id=\"\(sanitizeId("icons-\(layer.name)"))\">\n\(inner)  </g>\n"
        }

        // Labels group (topmost), per layer / per road subtype. Curved labels
        // can be left out when a companion Illustrator script will add them as
        // live type-on-path instead (AI's SVG import flattens textPath).
        var labelsSVG = ""
        for layer in layers.reversed() where layer.isVisible {
            labelsSVG += labelGroupsForLayer(layer, layout: layout, proj: proj,
                                             baseZoom: baseZoom, scale: scale,
                                             excludeCurvedLabels: excludeCurvedLabels)
        }

        let meta = config.embedBBoxMeta
            ? "<!-- bbox: \(bbox.minLat),\(bbox.minLon),\(bbox.maxLat),\(bbox.maxLon) -->\n"
            : ""

        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
             width="\(fmt(W))" height="\(fmt(H))"
             viewBox="0 0 \(fmt(W)) \(fmt(H))">
          \(meta)<defs>
        \(defs)  </defs>
        \(bgSVG)\(groupSVGs)<g id="icons">
        \(iconsSVG)</g>
        <g id="labels">
        \(labelsSVG)</g>
        </svg>
        """
    }

    /// Per-layer label sub-groups: roads split into one group per subtype
    /// (`labels-roads-<subtype>`), everything else one group per layer.
    private func labelGroupsForLayer(_ layer: MapLayer, layout: MapLabelLayout,
                                     proj: MapProjection, baseZoom: Double, scale: Double,
                                     excludeCurvedLabels: Bool) -> String {
        var out = ""
        let lineForLayer = layout.lineLabels.filter { $0.layerId == layer.id }
        let pointForLayer = layout.pointLabels.filter { $0.layerId == layer.id }

        if layer.kind == .roads {
            for sub in layer.roadSubLayers {
                let labels = lineForLayer.filter { $0.subId == sub.id }
                var inner = ""
                for l in labels {
                    if excludeCurvedLabels && l.style.lineLabelMode == .curved { continue }
                    inner += emitLineLabel(l, proj: proj, baseZoom: baseZoom, scale: scale)
                }
                guard !inner.isEmpty else { continue }
                out += "  <g id=\"\(sanitizeId("labels-\(layer.name)-\(sub.name)"))\">\n\(inner)  </g>\n"
            }
            return out
        }

        var inner = ""
        for l in lineForLayer {
            if excludeCurvedLabels && l.style.lineLabelMode == .curved { continue }
            inner += emitLineLabel(l, proj: proj, baseZoom: baseZoom, scale: scale)
        }
        for l in pointForLayer {
            inner += emitPointLabel(l, proj: proj, baseZoom: baseZoom, scale: scale)
        }
        guard !inner.isEmpty else { return "" }
        return "  <g id=\"\(sanitizeId("labels-\(layer.name)"))\">\n\(inner)  </g>\n"
    }

    // MARK: - Vector layers

    private func layerGroup(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        let gId = sanitizeId("layer-\(layer.kind.rawValue)-\(layer.id.uuidString.prefix(8))")
        var inner = ""
        switch layer.kind.featureType {
        case .line:    inner = lineGroup(layer: layer, proj: proj, scale: scale)
        case .polygon: inner = polygonGroup(layer: layer, proj: proj, scale: scale)
        case .point:   inner = pointGroup(layer: layer, proj: proj, scale: scale)
        }
        guard !inner.isEmpty else { return "" }
        return "<g id=\"\(gId)\">\n\(inner)</g>\n"
    }

    private func lineGroup(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        var out = ""
        func emit(features: [LineFeature], style: RoadStyle, subId: String) {
            guard !features.isEmpty else { return }
            var inner = ""
            var ds: [(id: String, d: String)] = []
            for f in features {
                let d = pathD(proj.screenPoints(from: f.coordinates))
                guard !d.isEmpty else { continue }
                let pid = sanitizeId("p\(f.id)\(subId.suffix(4))")
                defs += "  <path id=\"\(pid)\" d=\"\(d)\" fill=\"none\"/>\n"
                ds.append((pid, d))
            }
            if style.casingEnabled && style.casingWidth > 0 {
                for (pid, _) in ds {
                    inner += "  <use href=\"#\(pid)\" stroke=\"\(style.casingColor.hex)\" stroke-width=\"\(fmt(style.casingWidth * scale))\" stroke-linecap=\"\(style.lineCap.rawValue)\" stroke-linejoin=\"\(style.lineJoin.rawValue)\" fill=\"none\"/>\n"
                }
            }
            for (pid, _) in ds {
                inner += "  <use href=\"#\(pid)\" stroke=\"\(style.color.hex)\" stroke-width=\"\(fmt(style.width * scale))\" stroke-linecap=\"\(style.lineCap.rawValue)\" stroke-linejoin=\"\(style.lineJoin.rawValue)\" fill=\"none\" opacity=\"\(fmt(style.color.a * style.opacity))\"/>\n"
            }
            out += "<g id=\"\(sanitizeId(subId))\">\n\(inner)</g>\n"
        }

        if layer.kind == .roads {
            // Reversed: top sub-row drawn last → on top (matches the live canvas).
            for sub in layer.roadSubLayers.reversed() where sub.isVisible {
                let style = sub.resolvedLineStyle(master: layer.roadStyle)
                let typeSet = Set(sub.roadTypes)
                let features = layer.lineFeatures.filter {
                    $0.tags["highway"].map { typeSet.contains($0) } == true
                }
                emit(features: features, style: style,
                     subId: "roads-\(sub.name.lowercased())-\(sub.id.uuidString.prefix(6))")
            }
        } else {
            emit(features: layer.lineFeatures, style: layer.roadStyle,
                 subId: "lines-\(layer.id.uuidString.prefix(6))")
        }
        return out
    }

    private func polygonGroup(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        let style = layer.areaStyle
        var out = ""
        for f in layer.polygonFeatures {
            guard !f.outerRing.isEmpty else { continue }
            var d = ""
            for ring in f.rings {
                let pts = proj.screenPoints(from: ring)
                guard pts.count >= 3 else { continue }
                d += pathD(pts) + " Z "
            }
            guard !d.isEmpty else { continue }
            let stroke = style.strokeEnabled && style.strokeWidth > 0
                ? "stroke=\"\(style.strokeColor.hex)\" stroke-width=\"\(fmt(style.strokeWidth * scale))\""
                : "stroke=\"none\""
            out += "  <path d=\"\(d)\" fill=\"\(style.fillColor.hex)\" fill-opacity=\"\(fmt(style.fillColor.a * style.fillOpacity))\" \(stroke) fill-rule=\"evenodd\"/>\n"
        }
        // Unclosed ways in area layers (rivers, canals) draw as lines, as on screen.
        for f in layer.lineFeatures {
            let d = pathD(proj.screenPoints(from: f.coordinates))
            guard !d.isEmpty else { continue }
            out += "  <path d=\"\(d)\" fill=\"none\" stroke=\"\(style.fillColor.hex)\" stroke-opacity=\"\(fmt(style.fillColor.a * style.fillOpacity))\" stroke-width=\"\(fmt(max(style.strokeWidth, 2) * scale))\" stroke-linejoin=\"round\" stroke-linecap=\"round\"/>\n"
        }
        return out
    }

    private func pointGroup(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        let style = layer.poiStyle
        var out = ""
        let r = style.size / 2 * scale
        for f in layer.pointFeatures {
            guard f.coordinate.count >= 2 else { continue }
            let pt = proj.toScreen(lat: f.coordinate[1], lon: f.coordinate[0])
            let common = "fill=\"\(style.fillColor.hex)\" stroke=\"\(style.strokeColor.hex)\" stroke-width=\"\(fmt(style.strokeWidth * scale))\""
            switch style.shape {
            case .circle:
                out += "  <circle cx=\"\(fmt(pt.x))\" cy=\"\(fmt(pt.y))\" r=\"\(fmt(r))\" \(common)/>\n"
            case .square:
                out += "  <rect x=\"\(fmt(pt.x - r))\" y=\"\(fmt(pt.y - r))\" width=\"\(fmt(r*2))\" height=\"\(fmt(r*2))\" \(common)/>\n"
            case .diamond:
                let d = "M \(fmt(pt.x)) \(fmt(pt.y - r)) L \(fmt(pt.x + r)) \(fmt(pt.y)) L \(fmt(pt.x)) \(fmt(pt.y + r)) L \(fmt(pt.x - r)) \(fmt(pt.y)) Z"
                out += "  <path d=\"\(d)\" \(common)/>\n"
            }
        }
        return out
    }

    private func symbolGroup(layer: MapLayer, proj: MapProjection, scale: Double,
                             baseZoom: Double, iconLibrary: [SVGIcon]) -> String {
        let sym = layer.symbolStyle
        guard sym.enabled && sym.isVisible else { return "" }
        let svgData: Data?
        if let d = sym.inlineSVGData { svgData = d }
        else if let iconId = sym.iconId,
                let icon = iconLibrary.first(where: { $0.id == iconId }) { svgData = icon.svgData }
        else { svgData = nil }
        guard let data = svgData else { return "" }
        let b64 = data.base64EncodedString()

        let w = sym.width * scale, h = sym.height * scale
        guard w > 0, h > 0 else { return "" }

        let points: [CGPoint] = LabelLayoutCache.shared.layout(layers: AppState.active?.layers ?? [layer], baseZoom: baseZoom, labelScale: 1)
            .icons.filter { $0.layerId == layer.id }
            .map { proj.toScreen(world: $0.point, worldZoom: baseZoom) }
        guard !points.isEmpty else { return "" }

        var out = ""
        for pt in points {
            var transform = "translate(\(fmt(pt.x)) \(fmt(pt.y)))"
            if sym.rotation != 0 { transform += " rotate(\(fmt(sym.rotation)))" }
            out += "  <image href=\"data:image/svg+xml;base64,\(b64)\" x=\"\(fmt(-w/2))\" y=\"\(fmt(-h/2))\" width=\"\(fmt(w))\" height=\"\(fmt(h))\" opacity=\"\(fmt(sym.opacity))\" transform=\"\(transform)\"/>\n"
        }
        return out
    }

    // MARK: - Labels

    /// Common text attributes; halo is expressed with paint-order so the label
    /// stays a single editable element.
    private func textAttrs(_ ls: LabelStyle, scale: Double) -> String {
        let fontSize = ls.fontSize * scale
        let letterSpacing = ls.tracking / 1000.0 * fontSize
        var attrs = "font-family=\"\(xmlEsc(ls.fontName)), Helvetica, sans-serif\""
        let weight = cssWeight(ls.fontWeight)
        if weight != 400 { attrs += " font-weight=\"\(weight)\"" }
        attrs += " font-size=\"\(fmt(fontSize))\" fill=\"\(ls.color.hex)\""
        let fillOpacity = ls.color.a * ls.opacity
        if fillOpacity < 1 { attrs += " fill-opacity=\"\(fmt(fillOpacity))\"" }
        if letterSpacing != 0 { attrs += " letter-spacing=\"\(fmt(letterSpacing))\"" }
        if ls.wordSpacing != 0 { attrs += " word-spacing=\"\(fmt(ls.wordSpacing / 1000.0 * fontSize))\"" }
        if ls.bufferEnabled && ls.haloWidth > 0 {
            attrs += " stroke=\"\(ls.haloColor.hex)\" stroke-width=\"\(fmt(ls.haloWidth * 2 * scale))\""
            let so = ls.haloColor.a * ls.bufferOpacity
            if so < 1 { attrs += " stroke-opacity=\"\(fmt(so))\"" }
            attrs += " stroke-linejoin=\"round\" stroke-linecap=\"round\" paint-order=\"stroke\""
        }
        return attrs
    }

    private func emitLineLabel(_ label: PlacedLineLabel, proj: MapProjection,
                               baseZoom: Double, scale: Double) -> String {
        let ls = label.style
        let screenPts = label.line.pts.map { proj.toScreen(world: $0, worldZoom: baseZoom) }
        var line = Polyline(screenPts)
        guard line.length > 1, label.line.length > 0 else { return "" }

        var center = line.length * (label.centerDist / label.line.length)
        let metrics = MapSceneRenderer.screenMetrics(text: label.text, style: ls, scale: scale)
        let halfW = metrics.width / 2

        let chord = line.chordAngle(from: center - halfW, to: center + halfW)
        if cos(chord) < 0 {
            line = line.reversed
            center = line.length - center
        }

        switch ls.lineLabelMode {
        case .curved:
            let shift = MapSceneRenderer.baselineShift(ls, metrics: metrics, scale: scale)
            let guide = shift != 0 ? line.offset(by: shift) : line
            let centerOnGuide = guide.length > 0 ? center * (guide.length / line.length) : center
            let startOffset = max(centerOnGuide - halfW, 0)

            guideId += 1
            let gid = "lblguide\(guideId)"
            defs += "  <path id=\"\(gid)\" d=\"\(pathD(guide.pts))\" fill=\"none\"/>\n"
            return "    <text \(textAttrs(ls, scale: scale))><textPath href=\"#\(gid)\" xlink:href=\"#\(gid)\" startOffset=\"\(fmt(startOffset))\">\(xmlEsc(label.text))</textPath></text>\n"

        case .parallel, .horizontal:
            let p = line.point(at: center)
            let angleDeg = ls.lineLabelMode == .parallel
                ? line.chordAngle(from: center - halfW, to: center + halfW) * 180 / .pi : 0
            let shift = MapSceneRenderer.baselineShift(ls, metrics: metrics, scale: scale)
            var transform = "translate(\(fmt(p.x)) \(fmt(p.y)))"
            if angleDeg != 0 { transform += " rotate(\(fmt(angleDeg)))" }
            return "    <text \(textAttrs(ls, scale: scale)) text-anchor=\"middle\" x=\"0\" y=\"\(fmt(-shift))\" transform=\"\(transform)\">\(xmlEsc(label.text))</text>\n"
        }
    }

    private func emitPointLabel(_ label: PlacedPointLabel, proj: MapProjection,
                                baseZoom: Double, scale: Double) -> String {
        let ls = label.style
        let pt = proj.toScreen(world: label.anchor, worldZoom: baseZoom)
        let metrics = MapSceneRenderer.screenMetrics(text: label.text, style: ls, scale: scale)
        // Baseline so the glyph box is vertically centred on the anchor.
        let baselineY = Double(pt.y) + (metrics.ascent - metrics.descent) / 2
        var callout = ""
        if ls.calloutsEnabled {
            let f = proj.toScreen(world: label.featurePoint, worldZoom: baseZoom)
            if hypot(Double(f.x - pt.x), Double(f.y - pt.y)) > ls.calloutMinDistance * scale {
                callout = "    <path d=\"M \(fmt(f.x)) \(fmt(f.y)) L \(fmt(pt.x)) \(fmt(pt.y))\" fill=\"none\" stroke=\"\(ls.calloutColor.hex)\" stroke-width=\"\(fmt(ls.calloutWidth * scale))\"/>\n"
            }
        }
        return callout + "    <text \(textAttrs(ls, scale: scale)) text-anchor=\"middle\" x=\"\(fmt(pt.x))\" y=\"\(fmt(baselineY))\">\(xmlEsc(label.text))</text>\n"
    }

    // MARK: - Utilities

    private func pathD(_ pts: [CGPoint]) -> String {
        guard pts.count >= 2 else { return "" }
        var d = "M \(fmt(pts[0].x)) \(fmt(pts[0].y))"
        for p in pts.dropFirst() { d += " L \(fmt(p.x)) \(fmt(p.y))" }
        return d
    }

    private func cssWeight(_ name: String) -> Int {
        switch name.lowercased() {
        case "ultralight", "ultra light", "extralight", "extra light": return 200
        case "thin":                                                    return 100
        case "light":                                                   return 300
        case "medium":                                                  return 500
        case "semibold", "semi bold", "demibold", "demi":              return 600
        case "bold":                                                    return 700
        case "heavy", "extrabold", "extra bold":                       return 800
        case "black":                                                   return 900
        default:                                                        return 400
        }
    }

    private func fmt(_ v: Double) -> String { String(format: "%.2f", v) }
    private func fmt(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)) }

    private func sanitizeId(_ s: String) -> String {
        String(s.map { c in
            c.isLetter || c.isNumber || c == "-" || c == "_" ? c : "-"
        })
    }

    private func xmlEsc(_ s: String) -> String {
        s.replacingOccurrences(of: "&", with: "&amp;")
         .replacingOccurrences(of: "<", with: "&lt;")
         .replacingOccurrences(of: ">", with: "&gt;")
         .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

// MARK: - Illustrator script (.jsx) exporter

/// Exports the map as an Adobe Illustrator ExtendScript. Running it inside
/// Illustrator (File ▸ Scripts ▸ Other Script…) rebuilds the whole map as
/// native Illustrator objects — including REAL live type-on-path for curved
/// road labels. This is the only way to get editable text-on-path into AI:
/// its SVG importer flattens `textPath` to per-letter point text, and the PDF
/// format has no text-on-path object at all.
///
/// The artboard is sized physically (widthMM × heightMM in points); geometry,
/// stroke widths and font sizes come from the same projection + label layout
/// the app renders with, so the result matches the screen.
struct JSXExportResult {
    var script: String
    /// Icon files to write next to the script (relative name + SVG data) so
    /// the script can place them as linked items.
    var iconFiles: [(name: String, data: Data)] = []
}

@MainActor
class JSXExporter {

    private var iconFiles: [(name: String, data: Data)] = []
    private var iconNames: [Int: String] = [:]   // data hash → file name

    /// Full document export. The artboard is physical (widthMM in points).
    func export(layers: [MapLayer], bbox: BoundingBox, config: ExportConfig,
                baseZoom: Double, labelsVersion: Int,
                iconLibrary: [SVGIcon] = [], background: CodableColor? = nil) -> JSXExportResult {
        iconFiles = []; iconNames = [:]
        // Physical artboard in PostScript points (72/inch).
        let W = config.widthMM / 25.4 * 72.0
        let H = config.heightMM / 25.4 * 72.0
        let (proj, scale) = projection(bbox: bbox, W: W, H: H, baseZoom: baseZoom)
        let layout = LabelLayoutCache.shared.layout(
            layers: layers, baseZoom: baseZoom, labelScale: 1.0, version: labelsVersion)

        var s = helpers()
        s += """
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        var doc = app.documents.add(DocumentColorSpace.RGB, \(fmt(W)), \(fmt(H)));
        var ab = doc.artboards[0].artboardRect;   // [left, top, right, bottom]
        var L0 = ab[0], T0 = ab[1];
        var LYR;

        """

        // Frame background fill, created FIRST so every layer stacks above it.
        if let bg = background {
            s += "LYR = doc.layers.add(); LYR.name = \"Background\";\n"
            let pts = [CGPoint(x: 0, y: 0), CGPoint(x: W, y: 0),
                       CGPoint(x: W, y: H), CGPoint(x: 0, y: H)]
            s += "FS(P(LYR,\(ptsJS(pts)),true),C(\(rgb(bg))),100,null,0);\n"
        }

        // AI's layers.add() inserts at the top of the stack, so creating from
        // the bottom row upward reproduces the app's z-order. Geometry first,
        // then the Icons parent (above geometry), then Labels (topmost). Each
        // gets nested sub-layers via `<parent>.layers.add()`.
        s += "var PAR;\n"
        for layer in layers.reversed() where layer.isVisible {
            s += "LYR = doc.layers.add(); LYR.name = \"\(jsEsc(layer.name))\";\n"
            switch layer.kind.featureType {
            case .polygon: s += polygonJS(layer: layer, proj: proj, scale: scale)
            case .line:    s += lineJS(layer: layer, proj: proj, scale: scale)
            case .point:   s += pointJS(layer: layer, proj: proj, scale: scale)
            }
        }

        // Icons parent + one sub-layer per source layer.
        s += "PAR = doc.layers.add(); PAR.name = \"Icons\";\n"
        for layer in layers.reversed() where layer.isVisible {
            let icons = symbolJS(layer: layer, proj: proj, scale: scale,
                                 baseZoom: baseZoom, iconLibrary: iconLibrary,
                                 layerVar: "LYR")
            guard !icons.isEmpty else { continue }
            s += "LYR = PAR.layers.add(); LYR.name = \"\(jsEsc(layer.name))\";\n"
            s += icons
        }

        // Labels parent + sub-layers per layer / per road subtype.
        s += "PAR = doc.layers.add(); PAR.name = \"Labels\";\n"
        for layer in layers.reversed() where layer.isVisible {
            s += labelLayersJS(layer, layout: layout, proj: proj,
                               baseZoom: baseZoom, scale: scale, curvedOnly: false)
        }

        s += "app.userInteractionLevel = UserInteractionLevel.DISPLAYALERTS;\n"
        s += "alert(\"Nolli import complete.\\nCurved road labels are live type-on-path \\u2014 edit them with the Type tool.\");\n"
        return JSXExportResult(script: s, iconFiles: iconFiles)
    }

    /// Companion script for the SVG export: adds ONLY the curved road labels
    /// as live type-on-path to the CURRENTLY OPEN document (the SVG, which was
    /// exported without them). Uses the same pixel space as the SVG file.
    func exportCurvedLabelsCompanion(layers: [MapLayer], bbox: BoundingBox,
                                     config: ExportConfig, baseZoom: Double,
                                     labelsVersion: Int) -> String {
        let W = config.widthMM * config.dpi / 25.4   // match the SVG's px space
        let H = config.heightMM * config.dpi / 25.4
        let (proj, scale) = projection(bbox: bbox, W: W, H: H, baseZoom: baseZoom)
        let layout = LabelLayoutCache.shared.layout(
            layers: layers, baseZoom: baseZoom, labelScale: 1.0, version: labelsVersion)

        var s = helpers()
        s += """
        // Nolli curved-labels companion. Open the matching SVG export in
        // Illustrator FIRST, then run this script — it adds the curved road
        // labels as live type-on-path into the open document.
        if (app.documents.length === 0) {
            alert("Open the exported SVG first, then run this script.");
        } else {
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        var doc = app.activeDocument;
        var ab = doc.artboards[0].artboardRect;
        var L0 = ab[0], T0 = ab[1];
        var LYR, PAR = doc.layers.add(); PAR.name = "Curved labels";

        """
        for layer in layers.reversed() where layer.isVisible {
            s += labelLayersJS(layer, layout: layout, proj: proj,
                               baseZoom: baseZoom, scale: scale, curvedOnly: true)
        }
        s += """
        app.userInteractionLevel = UserInteractionLevel.DISPLAYALERTS;
        alert("Curved labels added as live type-on-path.");
        }
        """
        return s
    }

    // MARK: Script preamble

    private func projection(bbox: BoundingBox, W: Double, H: Double,
                            baseZoom: Double) -> (MapProjection, Double) {
        let fracW = max((bbox.maxLon - bbox.minLon) / 360.0, 1e-12)
        let zoom = log2(W / (256.0 * fracW))
        let proj = MapProjection(centerLat: (bbox.minLat + bbox.maxLat) / 2,
                                 centerLon: (bbox.minLon + bbox.maxLon) / 2,
                                 zoom: zoom,
                                 viewportSize: CGSize(width: W, height: H),
                                 rotation: AppState.active?.artboardRotation ?? 0)
        return (proj, pow(2.0, zoom - baseZoom))
    }

    private func helpers() -> String {
        """
        // Nolli → Adobe Illustrator export
        // Run via File ▸ Scripts ▸ Other Script… (or drop onto Illustrator).
        // Halo/buffer styling is not transferred — add strokes or appearance
        // effects in Illustrator if needed.
        #target illustrator
        function C(r,g,b){var c=new RGBColor();c.red=r;c.green=g;c.blue=b;return c;}
        function P(l,pts,cl){var a=[];for(var i=0;i<pts.length;i++){a.push([L0+pts[i][0],T0-pts[i][1]]);}var p=l.pathItems.add();p.setEntirePath(a);p.closed=cl;return p;}
        function ST(p,c,w,o,cap){p.filled=false;p.stroked=true;p.strokeColor=c;p.strokeWidth=w;p.opacity=o;p.strokeCap=cap;p.strokeJoin=StrokeJoin.ROUNDENDJOIN;}
        function FS(p,fc,fo,sc,sw){p.filled=true;p.fillColor=fc;p.evenodd=true;p.opacity=fo;if(sc!==null){p.stroked=true;p.strokeColor=sc;p.strokeWidth=sw;}else{p.stroked=false;}}
        function FONT(ca,fn){try{ca.textFont=app.textFonts.getByName(fn);}catch(e){}}
        function TP(l,pts,t0,txt,fs,tr,col,bs,fn){var g=P(l,pts,false);g.filled=false;g.stroked=false;var tf=l.textFrames.pathText(g);tf.contents=txt;var ca=tf.textRange.characterAttributes;ca.size=fs;ca.tracking=tr;ca.fillColor=col;if(bs!==0){ca.baselineShift=bs;}FONT(ca,fn);try{tf.startTValue=t0;tf.endTValue=g.pathPoints.length-1;}catch(e){}return tf;}
        function PT(l,x,y,txt,fs,tr,col,fn,rot){var tf=l.textFrames.pointText([L0+x,T0-y]);tf.contents=txt;var ca=tf.textRange.characterAttributes;ca.size=fs;ca.tracking=tr;ca.fillColor=col;FONT(ca,fn);tf.textRange.paragraphAttributes.justification=Justification.CENTER;if(rot!==0){tf.rotate(rot);}return tf;}
        var SF = File($.fileName).parent ? File($.fileName).parent.fsName : "";
        function IMG(l,rel,cx,cy,w,h,rot,op){try{var p=l.placedItems.add();p.file=new File(SF+"/"+rel);p.width=w;p.height=h;p.position=[L0+cx-w/2,T0-cy+h/2];if(rot!==0){p.rotate(-rot);}p.opacity=op;return p;}catch(e){return null;}}

        """
    }

    // MARK: Vector layers

    private func polygonJS(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        let st = layer.areaStyle
        var out = ""
        let fill = "C(\(rgb(st.fillColor)))"
        let strokeCol = st.strokeEnabled && st.strokeWidth > 0 ? "C(\(rgb(st.strokeColor)))" : "null"
        let fo = fmt(min(st.fillColor.a * st.fillOpacity, 1) * 100)
        let sw = fmt(st.strokeWidth * scale)
        for f in layer.polygonFeatures {
            let rings = f.rings.map { proj.screenPoints(from: $0) }.filter { $0.count >= 3 }
            guard !rings.isEmpty else { continue }
            if rings.count == 1 {
                out += "FS(P(LYR,\(ptsJS(rings[0])),true),\(fill),\(fo),\(strokeCol),\(sw));\n"
            } else {
                out += "var cp=LYR.compoundPathItems.add();\n"
                for ring in rings {
                    out += "FS(P(cp,\(ptsJS(ring)),true),\(fill),\(fo),\(strokeCol),\(sw));\n"
                }
            }
        }
        for f in layer.lineFeatures {
            let pts = proj.screenPoints(from: f.coordinates)
            guard pts.count >= 2 else { continue }
            out += "ST(P(LYR,\(ptsJS(pts)),false),\(fill),\(fmt(max(st.strokeWidth, 2) * scale)),\(fo),StrokeCap.ROUNDENDCAP);\n"
        }
        return out
    }

    private func lineJS(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        var out = ""
        func emit(features: [LineFeature], style: RoadStyle) {
            let cap = aiCap(style.lineCap)
            let main = "C(\(rgb(style.color)))"
            let op = fmt(min(style.color.a * style.opacity, 1) * 100)
            if style.casingEnabled && style.casingWidth > 0 {
                let cas = "C(\(rgb(style.casingColor)))"
                for f in features {
                    let pts = proj.screenPoints(from: f.coordinates)
                    guard pts.count >= 2 else { continue }
                    out += "ST(P(LYR,\(ptsJS(pts)),false),\(cas),\(fmt(style.casingWidth * scale)),100,\(cap));\n"
                }
            }
            for f in features {
                let pts = proj.screenPoints(from: f.coordinates)
                guard pts.count >= 2 else { continue }
                out += "ST(P(LYR,\(ptsJS(pts)),false),\(main),\(fmt(style.width * scale)),\(op),\(cap));\n"
            }
        }
        if layer.kind == .roads {
            // Reversed: top sub-row drawn last (AI paths created later stack above).
            for sub in layer.roadSubLayers.reversed() where sub.isVisible {
                let style = sub.resolvedLineStyle(master: layer.roadStyle)
                let typeSet = Set(sub.roadTypes)
                emit(features: layer.lineFeatures.filter {
                    $0.tags["highway"].map { typeSet.contains($0) } == true
                }, style: style)
            }
        } else {
            emit(features: layer.lineFeatures, style: layer.roadStyle)
        }
        return out
    }

    private func pointJS(layer: MapLayer, proj: MapProjection, scale: Double) -> String {
        let st = layer.poiStyle
        let r = st.size / 2 * scale
        let fill = "C(\(rgb(st.fillColor)))"
        let strokeCol = st.strokeWidth > 0 ? "C(\(rgb(st.strokeColor)))" : "null"
        var out = ""
        for f in layer.pointFeatures {
            guard f.coordinate.count >= 2 else { continue }
            let pt = proj.toScreen(lat: f.coordinate[1], lon: f.coordinate[0])
            switch st.shape {
            case .circle:
                out += "FS(LYR.pathItems.ellipse(T0-(\(fmt(pt.y - r))),L0+(\(fmt(pt.x - r))),\(fmt(r*2)),\(fmt(r*2))),\(fill),100,\(strokeCol),\(fmt(st.strokeWidth * scale)));\n"
            case .square:
                let pts = [CGPoint(x: pt.x-r, y: pt.y-r), CGPoint(x: pt.x+r, y: pt.y-r),
                           CGPoint(x: pt.x+r, y: pt.y+r), CGPoint(x: pt.x-r, y: pt.y+r)]
                out += "FS(P(LYR,\(ptsJS(pts)),true),\(fill),100,\(strokeCol),\(fmt(st.strokeWidth * scale)));\n"
            case .diamond:
                let pts = [CGPoint(x: pt.x, y: pt.y-r), CGPoint(x: pt.x+r, y: pt.y),
                           CGPoint(x: pt.x, y: pt.y+r), CGPoint(x: pt.x-r, y: pt.y)]
                out += "FS(P(LYR,\(ptsJS(pts)),true),\(fill),100,\(strokeCol),\(fmt(st.strokeWidth * scale)));\n"
            }
        }
        return out
    }

    // MARK: Symbol icons (linked SVG files placed by the script)

    private func symbolJS(layer: MapLayer, proj: MapProjection, scale: Double,
                          baseZoom: Double, iconLibrary: [SVGIcon],
                          layerVar: String = "LYR") -> String {
        let sym = layer.symbolStyle
        guard sym.enabled && sym.isVisible else { return "" }
        let svgData: Data?
        if let d = sym.inlineSVGData { svgData = d }
        else if let iconId = sym.iconId,
                let icon = iconLibrary.first(where: { $0.id == iconId }) { svgData = icon.svgData }
        else { svgData = nil }
        guard let data = svgData else { return "" }

        // De-duplicate icon files by content.
        let key = data.hashValue
        let fileName: String
        if let existing = iconNames[key] {
            fileName = existing
        } else {
            fileName = "icon-\(iconFiles.count + 1).svg"
            iconNames[key] = fileName
            iconFiles.append((fileName, data))
        }

        let w = sym.width * scale, h = sym.height * scale
        guard w > 0, h > 0 else { return "" }

        let points: [CGPoint] = LabelLayoutCache.shared.layout(layers: AppState.active?.layers ?? [layer], baseZoom: baseZoom, labelScale: 1)
            .icons.filter { $0.layerId == layer.id }
            .map { proj.toScreen(world: $0.point, worldZoom: baseZoom) }
        var out = ""
        for pt in points {
            out += "IMG(\(layerVar),\"Nolli-icons/\(fileName)\",\(fmt(pt.x)),\(fmt(pt.y)),\(fmt(w)),\(fmt(h)),\(fmt(sym.rotation)),\(fmt(min(sym.opacity, 1) * 100)));\n"
        }
        return out
    }

    // MARK: Labels

    /// Emits a nested AI sub-layer (under the current `PAR`) per layer / per
    /// road subtype, populated with that group's labels. Sets `LYR` to the new
    /// sub-layer before emitting (the label helpers draw into `LYR`).
    private func labelLayersJS(_ layer: MapLayer, layout: MapLabelLayout, proj: MapProjection,
                               baseZoom: Double, scale: Double, curvedOnly: Bool) -> String {
        let lineForLayer = layout.lineLabels.filter { $0.layerId == layer.id }
        let pointForLayer = layout.pointLabels.filter { $0.layerId == layer.id }
        var out = ""

        func subLayer(_ name: String, _ body: String) {
            guard !body.isEmpty else { return }
            out += "LYR = PAR.layers.add(); LYR.name = \"\(jsEsc(name))\";\n\(body)"
        }

        if layer.kind == .roads {
            for sub in layer.roadSubLayers {
                var body = ""
                for l in lineForLayer where l.subId == sub.id {
                    if curvedOnly && l.style.lineLabelMode != .curved { continue }
                    body += lineLabelJS(l, proj: proj, baseZoom: baseZoom, scale: scale)
                }
                subLayer("\(layer.name) — \(sub.name)", body)
            }
            return out
        }

        var body = ""
        for l in lineForLayer {
            if curvedOnly && l.style.lineLabelMode != .curved { continue }
            body += lineLabelJS(l, proj: proj, baseZoom: baseZoom, scale: scale)
        }
        if !curvedOnly {
            for l in pointForLayer {
                body += pointLabelJS(l, proj: proj, baseZoom: baseZoom, scale: scale)
            }
        }
        subLayer(layer.name, body)
        return out
    }

    private func lineLabelJS(_ label: PlacedLineLabel, proj: MapProjection,
                             baseZoom: Double, scale: Double) -> String {
        let ls = label.style
        let screenPts = label.line.pts.map { proj.toScreen(world: $0, worldZoom: baseZoom) }
        var line = Polyline(screenPts)
        guard line.length > 1, label.line.length > 0 else { return "" }
        var center = line.length * (label.centerDist / label.line.length)
        let metrics = MapSceneRenderer.screenMetrics(text: label.text, style: ls, scale: scale)
        let halfW = metrics.width / 2

        let chord = line.chordAngle(from: center - halfW, to: center + halfW)
        if cos(chord) < 0 {
            line = line.reversed
            center = line.length - center
        }
        let shift = MapSceneRenderer.baselineShift(ls, metrics: metrics, scale: scale)
        let font = LabelLayoutEngine.resolvedNSFont(ls).fontName   // PostScript name
        let col = "C(\(rgb(ls.color)))"
        let fs = fmt(ls.fontSize * scale)
        let tr = fmt(ls.tracking)

        switch ls.lineLabelMode {
        case .curved:
            // Native type-on-path: baseline rides the road path itself, the
            // perpendicular position is expressed as AI baseline shift.
            let t0 = tValue(line, at: center - halfW)
            return "TP(LYR,\(ptsJS(line.pts)),\(fmt(t0)),\"\(jsEsc(label.text))\",\(fs),\(tr),\(col),\(fmt(shift)),\"\(jsEsc(font))\");\n"
        case .parallel, .horizontal:
            let p = line.point(at: center)
            let angleDeg = ls.lineLabelMode == .parallel
                ? line.chordAngle(from: center - halfW, to: center + halfW) * 180 / .pi : 0
            // Screen angles are clockwise-positive (y down); AI rotates CCW.
            let baselineY = Double(p.y) - shift
            return "PT(LYR,\(fmt(p.x)),\(fmt(baselineY)),\"\(jsEsc(label.text))\",\(fs),\(tr),\(col),\"\(jsEsc(font))\",\(fmt(-angleDeg)));\n"
        }
    }

    private func pointLabelJS(_ label: PlacedPointLabel, proj: MapProjection,
                              baseZoom: Double, scale: Double) -> String {
        let ls = label.style
        let pt = proj.toScreen(world: label.anchor, worldZoom: baseZoom)
        let metrics = MapSceneRenderer.screenMetrics(text: label.text, style: ls, scale: scale)
        let baselineY = Double(pt.y) + (metrics.ascent - metrics.descent) / 2
        let font = LabelLayoutEngine.resolvedNSFont(ls).fontName
        return "PT(LYR,\(fmt(pt.x)),\(fmt(baselineY)),\"\(jsEsc(label.text))\",\(fmt(ls.fontSize * scale)),\(fmt(ls.tracking)),C(\(rgb(ls.color))),\"\(jsEsc(font))\",0);\n"
    }

    // MARK: Utilities

    /// Illustrator path-text T value (segment index + fraction) for an arc
    /// distance along a polyline — AI parameterises path text per segment.
    private func tValue(_ line: Polyline, at dist: Double) -> Double {
        guard line.cum.count > 1 else { return 0 }
        let d = max(0, min(dist, line.length))
        var i = 1
        while i < line.cum.count && line.cum[i] < d { i += 1 }
        if i >= line.cum.count { return Double(line.cum.count - 1) }
        let segLen = line.cum[i] - line.cum[i-1]
        let frac = segLen > 0 ? (d - line.cum[i-1]) / segLen : 0
        return Double(i - 1) + frac
    }

    private func ptsJS(_ pts: [CGPoint]) -> String {
        "[" + pts.map { "[\(fmt($0.x)),\(fmt($0.y))]" }.joined(separator: ",") + "]"
    }

    private func rgb(_ c: CodableColor) -> String {
        "\(fmt(c.r * 255)),\(fmt(c.g * 255)),\(fmt(c.b * 255))"
    }

    private func aiCap(_ cap: LineCap) -> String {
        switch cap {
        case .butt:   "StrokeCap.BUTTENDCAP"
        case .round:  "StrokeCap.ROUNDENDCAP"
        case .square: "StrokeCap.PROJECTINGENDCAP"
        }
    }

    private func fmt(_ v: Double) -> String { String(format: "%.2f", v) }
    private func fmt(_ v: CGFloat) -> String { String(format: "%.2f", Double(v)) }

    private func jsEsc(_ s: String) -> String {
        var out = ""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\\": out += "\\\\"
            case "\"": out += "\\\""
            case "\n": out += "\\n"
            default:
                if scalar.value < 0x20 || scalar.value > 0x7E {
                    out += String(format: "\\u%04X", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out
    }
}
