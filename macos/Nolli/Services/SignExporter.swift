import SwiftUI
import AppKit
import UniformTypeIdentifiers

// MARK: - Sign Exporter

/// Renders sign artworks to raster images (PNG) and VECTOR PDF files. Both go
/// through the same `MapSceneRenderer` + label layout as the on-screen
/// previews, so exports match the app exactly.
@MainActor
struct SignExporter {

    // MARK: - Single sign image

    /// Renders one sign face to an NSImage at full DPI resolution.
    static func renderImage(sign: SignOutput,
                            layers: [MapLayer],
                            baseZoom: Double,
                            iconLibrary: [SVGIcon] = [],
                            artworkScale: Double = 1.0,
                            labelsVersion: Int = 0,
                            rotation: Double? = nil) -> NSImage? {
        let pxW = CGFloat(sign.widthMM  / 25.4 * sign.dpi)
        let pxH = CGFloat(sign.heightMM / 25.4 * sign.dpi)

        var s = sign
        if let r = rotation { s.rotation = r }

        let view = SignArtworkView(sign: s, layers: layers, baseZoom: baseZoom,
                                   iconLibrary: iconLibrary, artworkScale: artworkScale,
                                   labelsVersion: labelsVersion)
            .frame(width: pxW, height: pxH)

        let renderer = ImageRenderer(content: view)
        renderer.scale = 1.0
        return renderer.nsImage
    }

    // MARK: - Export single sign as PNG

    static func exportPNG(sign: SignOutput, layers: [MapLayer], baseZoom: Double,
                          iconLibrary: [SVGIcon] = [], artworkScale: Double = 1.0,
                          labelsVersion: Int = 0, to url: URL) throws {
        guard let image = renderImage(sign: sign, layers: layers, baseZoom: baseZoom,
                                      iconLibrary: iconLibrary, artworkScale: artworkScale,
                                      labelsVersion: labelsVersion),
              let tiffData = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiffData),
              let pngData = rep.representation(using: .png, properties: [:]) else {
            throw SignExportError.renderFailed
        }
        try pngData.write(to: url)

        if sign.isDoubleSided {
            guard let backImage = renderImage(sign: sign, layers: layers, baseZoom: baseZoom,
                                              iconLibrary: iconLibrary, artworkScale: artworkScale,
                                              labelsVersion: labelsVersion,
                                              rotation: sign.backRotation),
                  let tiffData2 = backImage.tiffRepresentation,
                  let rep2 = NSBitmapImageRep(data: tiffData2),
                  let pngData2 = rep2.representation(using: .png, properties: [:]) else { return }
            let backSibling = url.deletingLastPathComponent()
                .appendingPathComponent(url.deletingPathExtension().lastPathComponent + "_back.png")
            try pngData2.write(to: backSibling)
        }
    }

    // MARK: - Export all signs as multi-page VECTOR PDF

    static func exportAllPDF(signs: [SignOutput], layers: [MapLayer], baseZoom: Double,
                             iconLibrary: [SVGIcon] = [], artworkScale: Double = 1.0,
                             labelsVersion: Int = 0, to url: URL) throws {
        guard !signs.isEmpty else { throw SignExportError.noSigns }

        let pdfData = NSMutableData()
        guard let consumer = CGDataConsumer(data: pdfData as CFMutableData) else {
            throw SignExportError.renderFailed
        }
        // Use the first sign's page size for the document mediaBox; each page
        // sets its own box below.
        var docBox = CGRect(x: 0, y: 0,
                            width: signs[0].widthMM / 25.4 * signs[0].dpi,
                            height: signs[0].heightMM / 25.4 * signs[0].dpi)
        guard let ctx = CGContext(consumer: consumer, mediaBox: &docBox, nil) else {
            throw SignExportError.renderFailed
        }

        var drewAnything = false
        for sign in signs {
            drawPage(ctx, sign: sign, rotation: sign.rotation, layers: layers,
                     baseZoom: baseZoom, iconLibrary: iconLibrary,
                     artworkScale: artworkScale, labelsVersion: labelsVersion)
            drewAnything = true
            if sign.isDoubleSided {
                drawPage(ctx, sign: sign, rotation: sign.backRotation, layers: layers,
                         baseZoom: baseZoom, iconLibrary: iconLibrary,
                         artworkScale: artworkScale, labelsVersion: labelsVersion)
            }
        }
        ctx.closePDF()
        guard drewAnything else { throw SignExportError.renderFailed }

        try (pdfData as Data).write(to: url)
    }

    /// Draws one sign face as a vector PDF page (white background, same scene
    /// + label layout as the on-screen preview at artwork scale).
    private static func drawPage(_ ctx: CGContext, sign: SignOutput, rotation: Double,
                                 layers: [MapLayer], baseZoom: Double,
                                 iconLibrary: [SVGIcon], artworkScale: Double,
                                 labelsVersion: Int) {
        let W = sign.widthMM  / 25.4 * sign.dpi
        let H = sign.heightMM / 25.4 * sign.dpi
        guard W > 0, H > 0 else { return }
        var box = CGRect(x: 0, y: 0, width: W, height: H)

        let pageInfo = [kCGPDFContextMediaBox as String: NSData(bytes: &box, length: MemoryLayout<CGRect>.size)]
        ctx.beginPDFPage(pageInfo as CFDictionary)
        ctx.saveGState()
        // Flip to screen orientation.
        ctx.translateBy(x: 0, y: H)
        ctx.scaleBy(x: 1, y: -1)

        ctx.setFillColor(CGColor.white)
        ctx.fill(box)

        // Frame extent is defined at the design PPI; print DPI only raises the
        // page pixel density (same crop as previews, higher resolution).
        let s = (artworkScale > 0 ? artworkScale : 1.0) * (sign.dpi / signDesignPPI)
        let proj = MapProjection(
            centerLat:    sign.lat + sign.centerOffsetLat,
            centerLon:    sign.lon + sign.centerOffsetLon,
            zoom:         baseZoom + log2(s),
            viewportSize: CGSize(width: W, height: H),
            rotation:     rotation
        )
        if proj.isValid {
            let scene = SceneStore.shared.scene(layers: layers, iconLibrary: iconLibrary, baseZoom: baseZoom,
                                                labelScale: sign.labelScale, iconScale: sign.iconScale,
                                                version: labelsVersion)
            scene.draw(in: ctx, proj: proj, viewport: box,
                       options: .init(background: AppState.active?.effectiveBackground, textAsGlyphs: true))
        }
        ctx.restoreGState()
        ctx.endPDFPage()
    }
}

// MARK: - Errors

enum SignExportError: LocalizedError {
    case renderFailed
    case noSigns

    var errorDescription: String? {
        switch self {
        case .renderFailed: return "Failed to render sign artwork."
        case .noSigns:      return "No signs to export."
        }
    }
}
