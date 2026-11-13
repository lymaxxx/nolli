// Writes the macOS app's label layout as JSON, so the web app's layout can be
// compared with it (see README.md in this folder).
//
// NOT COMPILED. This was written without a Mac to build it on. It is kept
// outside `macos/` on purpose, so it cannot break the app's build until you
// choose to add it. To use it:
//
//   1. Copy this file to macos/Nolli/Services/LayoutDump.swift.
//   2. Add it to macos/Nolli.xcodeproj/project.pbxproj (four places, as in
//      CLAUDE.md). The swiftc fallback in scripts/build.sh needs no entry.
//   3. At the end of `open(url:)` in DocumentActions.swift, after the load
//      succeeds, add:
//          if let out = ProcessInfo.processInfo.environment["NOLLI_DUMP_LAYOUT"] {
//              try? dumpLabelLayout(to: URL(fileURLWithPath: out))
//          }
//   4. Build, then run:  NOLLI_DUMP_LAYOUT=/tmp/layout.json build/Nolli.app/Contents/MacOS/Nolli /path/to/Project.mapcraft
//
// If it does not compile, the fix is likely a property name; the types used are
// PlacedLineLabel, PlacedPointLabel and PlacedIcon in LabelRendering.swift.

import Foundation
import CoreGraphics

@MainActor
extension AppState {
    /// Writes the current label layout, in artwork space, as JSON.
    func dumpLabelLayout(to url: URL) throws {
        let layout = LabelLayoutEngine.compute(layers: layers, baseZoom: baseZoom, labelScale: 1)
        func pt(_ p: CGPoint) -> [Double] { [Double(p.x), Double(p.y)] }

        let lineLabels: [[String: Any]] = layout.lineLabels.map { l in
            var d: [String: Any] = [
                "layerId": l.layerId.uuidString,
                "featureId": Int(l.featureId),
                "text": l.text,
                "centerDist": l.centerDist,
                "width": l.width,
                "pinned": l.pinned,
                "fontSize": l.style.fontSize,
                "line": l.line.pts.map(pt),
            ]
            if let s = l.subId { d["subId"] = s.uuidString }
            return d
        }
        let pointLabels: [[String: Any]] = layout.pointLabels.map { l in
            [
                "layerId": l.layerId.uuidString,
                "featureId": Int(l.featureId),
                "text": l.text,
                "anchor": pt(l.anchor),
                "featurePoint": pt(l.featurePoint),
            ]
        }
        let icons: [[String: Any]] = layout.icons.map { i in
            [
                "layerId": i.layerId.uuidString,
                "featureId": Int(i.featureId),
                "point": pt(i.point),
            ]
        }
        let root: [String: Any] = [
            "version": 1,
            "baseZoom": baseZoom,
            "labelScale": 1.0,
            "lineLabels": lineLabels,
            "pointLabels": pointLabels,
            "icons": icons,
        ]
        let data = try JSONSerialization.data(withJSONObject: root, options: [.prettyPrinted, .sortedKeys])
        try data.write(to: url)
    }
}
