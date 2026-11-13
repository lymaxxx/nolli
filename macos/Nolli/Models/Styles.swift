import SwiftUI
import AppKit

// MARK: - Helpers

struct CodableColor: Equatable, Codable, Hashable {
    var r: Double; var g: Double; var b: Double; var a: Double = 1.0

    init(r: Double, g: Double, b: Double, a: Double = 1.0) {
        self.r = r; self.g = g; self.b = b; self.a = a
    }

    init(_ color: Color) {
        let ns = NSColor(color).usingColorSpace(.sRGB) ?? .black
        r = ns.redComponent; g = ns.greenComponent; b = ns.blueComponent; a = ns.alphaComponent
    }

    var color: Color { Color(red: r, green: g, blue: b, opacity: a) }
    var nsColor: NSColor { NSColor(red: r, green: g, blue: b, alpha: a) }
    var cgColor: CGColor { CGColor(red: r, green: g, blue: b, alpha: a) }
    var hex: String { String(format: "#%02X%02X%02X", Int(r*255), Int(g*255), Int(b*255)) }
}

// MARK: - Enums

enum LineCap: String, CaseIterable, Identifiable, Codable {
    case butt, round, square
    var id: String { rawValue }
    var cgLineCap: CGLineCap {
        switch self { case .butt: .butt; case .round: .round; case .square: .square }
    }
}

enum LineJoin: String, CaseIterable, Identifiable, Codable {
    case miter, round, bevel
    var id: String { rawValue }
}

enum MarkerShape: String, CaseIterable, Identifiable, Codable {
    case circle, square, diamond
    var id: String { rawValue }
}

enum LabelPlacement: String, CaseIterable, Identifiable, Codable {
    case alongPath = "along_path"
    case center
    case topLeft = "top_left"
    case top
    case topRight = "top_right"
    case left
    case right
    case bottomLeft = "bottom_left"
    case bottom
    case bottomRight = "bottom_right"

    // Deprecated aliases kept so old project files decode. `above`/`below`
    // map to `top`/`bottom`; not surfaced in `allCases` UI (filtered below).
    case above
    case below

    var id: String { rawValue }

    /// Cases offered in the placement UI (excludes deprecated aliases).
    static var selectableCases: [LabelPlacement] {
        [.alongPath, .center, .topLeft, .top, .topRight, .left, .right, .bottomLeft, .bottom, .bottomRight]
    }

    /// Normalise deprecated aliases to their canonical case.
    var normalized: LabelPlacement {
        switch self {
        case .above: return .top
        case .below: return .bottom
        default: return self
        }
    }

    var displayName: String {
        switch self {
        case .alongPath: "Along path"
        case .center: "Center"
        case .topLeft: "Top left"
        case .top, .above: "Top"
        case .topRight: "Top right"
        case .left: "Left"
        case .right: "Right"
        case .bottomLeft: "Bottom left"
        case .bottom, .below: "Bottom"
        case .bottomRight: "Bottom right"
        }
    }

    /// Unit direction the label is pushed relative to the feature anchor.
    /// x: -1 left, +1 right; y: -1 up, +1 down (screen coords). `center` &
    /// `alongPath` have no directional offset.
    var unitDirection: (dx: Double, dy: Double) {
        switch normalized {
        case .alongPath, .center: return (0, 0)
        case .topLeft:     return (-1, -1)
        case .top:         return (0, -1)
        case .topRight:    return (1, -1)
        case .left:        return (-1, 0)
        case .right:       return (1, 0)
        case .bottomLeft:  return (-1, 1)
        case .bottom:      return (0, 1)
        case .bottomRight: return (1, 1)
        case .above:       return (0, -1)
        case .below:       return (0, 1)
        }
    }
}

enum LabelTypeCase: String, CaseIterable, Identifiable, Codable {
    case asStored = "as_stored"
    case uppercase = "uppercase"
    case titleCase = "title_case"
    case lowercase = "lowercase"
    case sentenceCase = "sentence_case"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .asStored: "As stored"
        case .uppercase: "ALL UPPERCASE"
        case .titleCase: "Title Case"
        case .lowercase: "all lowercase"
        case .sentenceCase: "Sentence case"
        }
    }
}

enum LineLabelMode: String, CaseIterable, Identifiable, Codable {
    case curved, horizontal, parallel
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .curved: "Curved"
        case .horizontal: "Horizontal"
        case .parallel: "Parallel"
        }
    }
}

enum LinePosition: String, CaseIterable, Identifiable, Codable {
    case above, on, below
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .above: "Above line"
        case .on: "On line"
        case .below: "Below line"
        }
    }
}

enum LabelOverlapMode: String, CaseIterable, Identifiable, Codable {
    case never = "never"
    case allowIfRequired = "allow_if_required"
    case allow = "allow"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .never: "Never overlap"
        case .allowIfRequired: "Allow if required"
        case .allow: "Allow"
        }
    }
}

enum CalloutStyle: String, CaseIterable, Identifiable, Codable {
    case simpleLine = "simple_line"
    case manhattan
    case curved
    case balloon
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .simpleLine: "Simple line"
        case .manhattan: "Manhattan"
        case .curved: "Curved"
        case .balloon: "Balloon"
        }
    }
}

enum NorthArrowPosition: String, CaseIterable, Identifiable, Codable {
    case topLeft    = "top_left"
    case topRight   = "top_right"
    case bottomLeft = "bottom_left"
    case bottomRight = "bottom_right"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .topLeft:     "Top left"
        case .topRight:    "Top right"
        case .bottomLeft:  "Bottom left"
        case .bottomRight: "Bottom right"
        }
    }
}

// MARK: - Road style

struct RoadStyle: Equatable, Codable, Hashable {
    var color: CodableColor = .init(r: 0.2, g: 0.2, b: 0.2)
    var width: Double = 2.0
    var opacity: Double = 1.0
    var lineCap: LineCap = .round
    var lineJoin: LineJoin = .round
    var dashEnabled: Bool = false
    var casingEnabled: Bool = false
    var casingColor: CodableColor = .init(r: 1, g: 1, b: 1)
    var casingWidth: Double = 4.0

}

// MARK: - Area style

struct AreaStyle: Equatable, Codable {
    var fillColor: CodableColor = .init(r: 0.784, g: 0.902, b: 0.784)
    var fillOpacity: Double = 0.8
    var strokeEnabled: Bool = true
    var strokeColor: CodableColor = .init(r: 0.647, g: 0.839, b: 0.647)
    var strokeWidth: Double = 1.0

}

// MARK: - POI style

struct POIStyle: Equatable, Codable {
    var shape: MarkerShape = .circle
    var size: Double = 8.0
    var fillColor: CodableColor = .init(r: 0.898, g: 0.224, b: 0.208)
    var strokeColor: CodableColor = .init(r: 1, g: 1, b: 1)
    var strokeWidth: Double = 1.5

}

// MARK: - Label style

struct LabelStyle: Equatable, Codable, Hashable {
    // ── Source ──────────────────────────────────────────────────────────────
    var enabled: Bool = false
    var isVisible: Bool = true          // child-layer eye toggle (independent of enabled)
    var tagKey: String = "name"
    var fallbackTagKey: String = "name:en"

    // ── Typography ──────────────────────────────────────────────────────────
    var fontName: String = "Helvetica Neue"
    var fontWeight: String = "Regular"
    var fontSize: Double = 9.0
    var opacity: Double = 1.0
    var color: CodableColor = .init(r: 0.2, g: 0.2, b: 0.2)
    var haloColor: CodableColor = .init(r: 1, g: 1, b: 1)
    var haloWidth: Double = 1.5

    // ── Formatting ──────────────────────────────────────────────────────────
    var typeCase: LabelTypeCase = .asStored
    var tracking: Double = 20.0
    var wordSpacing: Double = 0

    // ── Point / polygon placement ───────────────────────────────────────────
    var placement: LabelPlacement = .center
    var offsetX: Double = 0
    var offsetY: Double = 0

    // ── Line label placement ────────────────────────────────────────────────
    var lineLabelMode: LineLabelMode = .curved
    var linePosition: LinePosition = .above
    var distanceFromLine: Double = 2.0
    var repeatInterval: Double = 200
    var minSpacing: Double = 6
    var maxCharAngle: Double = 25.0

    // ── Overlap / priority ──────────────────────────────────────────────────
    var overlapMode: LabelOverlapMode = .never
    var showAllLabels: Bool = false
    var priority: Int = 5

    // Text style library link (nil = no link / detached)
    var textStyleId: UUID? = nil

    // ── Buffer (halo) ────────────────────────────────────────────────────────
    var bufferEnabled: Bool = false
    var bufferOpacity: Double = 1.0
    var bufferJoinStyle: LineJoin = .round

    // ── Shadow ───────────────────────────────────────────────────────────────
    var shadowEnabled: Bool = false
    var shadowColor: CodableColor = .init(r: 0, g: 0, b: 0)
    var shadowOpacity: Double = 0.3
    var shadowBlur: Double = 2.0
    var shadowOffsetX: Double = 1.0
    var shadowOffsetY: Double = 1.0

    // ── Callouts ─────────────────────────────────────────────────────────────
    var calloutsEnabled: Bool = false
    var calloutStyle: CalloutStyle = .simpleLine
    var calloutColor: CodableColor = .init(r: 0.533, g: 0.533, b: 0.533)
    var calloutWidth: Double = 0.5
    var calloutMinDistance: Double = 4.0

    // Kept for project-file backward compatibility; UI uses typeCase instead
    var uppercase: Bool = false
}

// MARK: - Per-field inheritance (Figma-style overrides)

/// Generic helpers: a Codable style is treated as a flat [codingKey: value]
/// dictionary so a parent style can be merged into a child field by field.
enum Inheritance {
    static func dict<T: Encodable>(_ v: T) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(v),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return obj
    }

    static func changedKeys<T: Encodable>(_ a: T, _ b: T) -> Set<String> {
        let da = dict(a), db = dict(b)
        return Set(Set(da.keys).union(db.keys).filter { !jsonEqual(da[$0], db[$0]) })
    }

    static func merge<T: Codable>(_ child: T, from master: T, pinned: Set<String>) -> T {
        var d = dict(child)
        for (k, v) in dict(master) where !pinned.contains(k) { d[k] = v }
        guard let data = try? JSONSerialization.data(withJSONObject: d),
              let out = try? JSONDecoder().decode(T.self, from: data) else { return child }
        return out
    }
}

// MARK: - LabelStyle per-field inheritance helpers

extension LabelStyle {
    /// The style encoded as a flat `[codingKey: jsonValue]` dictionary. Keys are
    /// the synthesized property names ("fontName", "typeCase", "fontSize"…).
    /// Used to merge a master style into a subtype field-by-field without
    /// hand-writing copy code for every property.
    func fieldDict() -> [String: Any] {
        guard let data = try? JSONEncoder().encode(self),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return [:] }
        return obj
    }

    /// Rebuilds a style from a `fieldDict()`-shaped dictionary.
    init?(fieldDict: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: fieldDict),
              let decoded = try? JSONDecoder().decode(LabelStyle.self, from: data)
        else { return nil }
        self = decoded
    }

    /// Coding keys whose values differ between two styles — used to migrate an
    /// old deep-copied custom subtype style into a set of pinned overrides.
    static func changedKeys(from a: LabelStyle, to b: LabelStyle) -> Set<String> {
        let da = a.fieldDict(), db = b.fieldDict()
        var keys = Set<String>()
        for key in Set(da.keys).union(db.keys) {
            if !jsonEqual(da[key], db[key]) { keys.insert(key) }
        }
        return keys
    }

    /// Returns a copy of `self` with every field NOT in `pinned` overwritten by
    /// the matching field of `master` (Figma-style per-field inheritance).
    func inheriting(from master: LabelStyle, pinned: Set<String>) -> LabelStyle {
        var dict = fieldDict()
        let masterDict = master.fieldDict()
        for (key, value) in masterDict where !pinned.contains(key) {
            dict[key] = value
        }
        return LabelStyle(fieldDict: dict) ?? self
    }
}

/// Loose equality for the JSON scalars/containers produced by `fieldDict()`.
private func jsonEqual(_ a: Any?, _ b: Any?) -> Bool {
    switch (a, b) {
    case (nil, nil): return true
    case let (x?, y?):
        if let nx = x as? NSNumber, let ny = y as? NSNumber { return nx == ny }
        if let sx = x as? String, let sy = y as? String { return sx == sy }
        // Fall back to serialized comparison for nested colour dicts etc.
        let dx = try? JSONSerialization.data(withJSONObject: [x], options: .sortedKeys)
        let dy = try? JSONSerialization.data(withJSONObject: [y], options: .sortedKeys)
        return dx == dy
    default: return false
    }
}

// MARK: - Color scheme (whole-map palette preset)

/// A saved palette: every color slot of every layer captured at once, keyed by
/// "<kind>|<layer name>[|sub:<subtype>]|<slot>" so it survives project
/// save/load (layer UUIDs change on load) and applies to matching layers.
struct MapColorScheme: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var name: String
    var colors: [String: CodableColor] = [:]
}

// MARK: - Text style (reusable typography preset)

struct TextStyle: Identifiable, Codable, Equatable {
    var id: UUID = UUID()
    var name: String
    var fontName: String = "Helvetica Neue"
    var fontWeight: String = "Regular"
    var fontSize: Double = 9.0
    var opacity: Double = 1.0
    var color: CodableColor = .init(r: 0.2, g: 0.2, b: 0.2)
    var haloColor: CodableColor = .init(r: 1, g: 1, b: 1)
    var haloWidth: Double = 1.5
    var typeCase: LabelTypeCase = .asStored
    var tracking: Double = 20.0
    var wordSpacing: Double = 0

    func apply(to style: inout LabelStyle) {
        style.fontName = fontName; style.fontWeight = fontWeight; style.fontSize = fontSize
        style.opacity = opacity; style.color = color; style.haloColor = haloColor
        style.haloWidth = haloWidth; style.typeCase = typeCase
        style.tracking = tracking; style.wordSpacing = wordSpacing
        style.textStyleId = id
    }

    mutating func capture(from style: LabelStyle) {
        fontName = style.fontName; fontWeight = style.fontWeight; fontSize = style.fontSize
        opacity = style.opacity; color = style.color; haloColor = style.haloColor
        haloWidth = style.haloWidth; typeCase = style.typeCase
        tracking = style.tracking; wordSpacing = style.wordSpacing
    }
}

// MARK: - Symbol enums

enum SymbolAnchor: String, CaseIterable, Identifiable, Codable {
    case geometricCenter = "geometric_center"
    case visualCenter    = "visual_center"
    case centroid        = "centroid"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .geometricCenter: "Geometric centre"
        case .visualCenter:    "Visual centre"
        case .centroid:        "Centroid"
        }
    }
}

enum LabelLayout: String, CaseIterable, Identifiable, Codable {
    case iconLeft  = "icon_left"
    case iconRight = "icon_right"
    case iconAbove = "icon_above"
    case iconBelow = "icon_below"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .iconLeft:  "Icon left of text"
        case .iconRight: "Icon right of text"
        case .iconAbove: "Icon above text"
        case .iconBelow: "Icon below text"
        }
    }
}

enum LabelTextAlignment: String, CaseIterable, Identifiable, Codable {
    case verticalCenter = "vertical_center"
    case alignTop       = "align_top"
    case alignBottom    = "align_bottom"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .verticalCenter: "Vertically centred"
        case .alignTop:       "Align to top"
        case .alignBottom:    "Align to bottom"
        }
    }
}

// MARK: - Symbol style

struct SymbolStyle: Equatable, Codable {
    var enabled: Bool = false
    var isVisible: Bool = true

    // Icon source: either from component library or ad-hoc inline SVG data
    var iconId: UUID? = nil             // component library ID
    var inlineSVGData: Data? = nil      // ad-hoc imported SVG

    // Base settings
    var width: Double = 24
    var height: Double = 24
    var lockAspect: Bool = true
    var rotation: Double = 0
    var opacity: Double = 1.0
    var blendMode: String = "normal"

    // Placement
    var anchorPoint: SymbolAnchor = .geometricCenter
    var collisionMargin: Double = 8
    var allowOverlapWithOtherLayers: Bool = false

    // Label binding
    var bindToLabels: Bool = false
    var labelLayout: LabelLayout = .iconLeft
    var iconTextGap: Double = 4
    var textAlignment: LabelTextAlignment = .verticalCenter
}
