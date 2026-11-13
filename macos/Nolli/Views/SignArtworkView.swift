import SwiftUI
import AppKit

/// Design resolution for sign FRAMING: how many base-zoom artwork pixels one
/// physical inch of sign shows (at artwork scale 1). Print DPI only affects
/// export resolution, never the framed map extent.
let signDesignPPI: Double = 96.0

// MARK: - Sign Artwork View

/// Renders a sign's artwork from the same compiled scene as the main map. A sign
/// always frames the same geographic extent regardless of the size it's shown at,
/// so thumbnail == viewport preview == export.
struct SignArtworkView: View {
    let sign: SignOutput
    let layers: [MapLayer]
    var baseZoom: Double = 15
    var iconLibrary: [SVGIcon] = []
    var artworkScale: Double = 1.0
    var labelsVersion: Int = 0

    var body: some View {
        Canvas { ctx, size in
            guard size.width > 0, size.height > 0 else { return }
            let s = artworkScale > 0 ? artworkScale : 1.0
            let nativePxW = sign.widthMM / 25.4 * signDesignPPI
            let disp = nativePxW > 0 ? Double(size.width) / nativePxW : 1.0
            let proj = MapProjection(
                centerLat:    sign.lat + sign.centerOffsetLat,
                centerLon:    sign.lon + sign.centerOffsetLon,
                zoom:         baseZoom + log2(s * disp),
                viewportSize: size,
                rotation:     sign.rotation
            )
            guard proj.isValid else { return }
            let scene = MainActor.assumeIsolated {
                SceneStore.shared.scene(layers: layers, iconLibrary: iconLibrary, baseZoom: baseZoom,
                                        labelScale: sign.labelScale, iconScale: sign.iconScale,
                                        version: labelsVersion)
            }
            let bg = MainActor.assumeIsolated { AppState.active?.effectiveBackground }
            ctx.withCGContext { cg in
                scene.draw(in: cg, proj: proj, viewport: CGRect(origin: .zero, size: size),
                           options: .init(background: bg))
            }
        }
        .background(Color.white)
        .clipped()
    }
}

// MARK: - Draggable sign preview

/// Drag inside the frame to reposition the map within the sign (the offset is
/// shared across both faces).
struct DraggableSignPreview: View {
    @Binding var sign: SignOutput
    var displayRotation: Double
    let layers: [MapLayer]
    var baseZoom: Double = 15
    var iconLibrary: [SVGIcon] = []
    var artworkScale: Double = 1.0
    var labelsVersion: Int = 0

    @State private var dragStart: (lat: Double, lon: Double)? = nil

    private var faced: SignOutput {
        var s = sign
        s.rotation = displayRotation
        return s
    }

    var body: some View {
        GeometryReader { geo in
            SignArtworkView(sign: faced, layers: layers, baseZoom: baseZoom,
                            iconLibrary: iconLibrary, artworkScale: artworkScale,
                            labelsVersion: labelsVersion)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 2)
                        .onChanged { v in
                            let size = geo.size
                            guard size.width > 0, size.height > 0 else { return }
                            if dragStart == nil {
                                dragStart = (sign.centerOffsetLat, sign.centerOffsetLon)
                            }
                            let start = dragStart!
                            let s = artworkScale > 0 ? artworkScale : 1.0
                            let nativePxW = sign.widthMM / 25.4 * signDesignPPI
                            let disp = nativePxW > 0 ? Double(size.width) / nativePxW : 1.0
                            let proj = MapProjection(
                                centerLat:    sign.lat + start.lat,
                                centerLon:    sign.lon + start.lon,
                                zoom:         baseZoom + log2(s * disp),
                                viewportSize: size,
                                rotation:     displayRotation
                            )
                            let (newLat, newLon) = proj.fromScreen(CGPoint(x: size.width / 2 - v.translation.width,
                                                                           y: size.height / 2 - v.translation.height))
                            sign.centerOffsetLat = newLat - sign.lat
                            sign.centerOffsetLon = newLon - sign.lon
                        }
                        .onEnded { _ in dragStart = nil }
                )
        }
    }
}
