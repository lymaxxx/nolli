import Foundation
import AppKit
import CoreGraphics

/// Exports the map as a vector PDF by running the SAME `MapSceneRenderer` +
/// deterministic label layout the app paints with — so the PDF is identical to
/// the screen and to the SVG export. Labels are real positioned text glyphs
/// (selectable/searchable); note that the PDF format has no editable
/// "type on a path" object — for re-editing curved labels in Illustrator use
/// the SVG export.
@MainActor
class PDFExporter {

    func export(layers: [MapLayer], bbox: BoundingBox, config: ExportConfig,
                baseZoom: Double, labelsVersion: Int,
                iconLibrary: [SVGIcon] = [], background: CodableColor? = nil) -> Data {
        let W = config.widthMM * config.dpi / 25.4
        let H = config.heightMM * config.dpi / 25.4
        let rect = CGRect(x: 0, y: 0, width: W, height: H)

        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData) else {
            return data as Data
        }
        var mediaBox = rect
        guard let ctx = CGContext(consumer: consumer, mediaBox: &mediaBox, nil) else {
            return data as Data
        }

        // Same projection math as SVGExporter: bbox spans exactly W px.
        let fracW = max((bbox.maxLon - bbox.minLon) / 360.0, 1e-12)
        let zoom = log2(W / (256.0 * fracW))
        let proj = MapProjection(centerLat: (bbox.minLat + bbox.maxLat) / 2,
                                 centerLon: (bbox.minLon + bbox.maxLon) / 2,
                                 zoom: zoom,
                                 viewportSize: CGSize(width: W, height: H),
                                 rotation: AppState.active?.artboardRotation ?? 0)

        ctx.beginPDFPage(nil)
        // Flip to screen orientation (PDF origin is bottom-left).
        ctx.translateBy(x: 0, y: H)
        ctx.scaleBy(x: 1, y: -1)

        let scene = SceneStore.shared.scene(layers: layers, iconLibrary: iconLibrary, baseZoom: baseZoom,
                                            version: labelsVersion)
        scene.draw(in: ctx, proj: proj, viewport: rect,
                   options: .init(background: background, textAsGlyphs: true))

        ctx.endPDFPage()
        ctx.closePDF()
        return data as Data
    }
}
