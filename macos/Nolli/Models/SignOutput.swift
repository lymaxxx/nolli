import Foundation

/// Identifies a face of a sign for viewport preview.
enum SignSide: Equatable { case front, back }

struct SignOutput: Identifiable, Codable {
    var id: UUID = UUID()
    var name: String = "Sign"
    var lat: Double
    var lon: Double
    var rotation: Double = 0          // degrees CW from north
    var isDoubleSided: Bool = false
    var backRotation: Double = 180
    var widthMM: Double = 400
    var heightMM: Double = 400
    var dpi: Double = 300

    // Per-sign rendering controls. All signs render at the project-wide base
    // scale (AppState.baseZoom); these are optional multipliers on top.
    var labelScale: Double = 1.0      // multiplier for all label font sizes
    var iconScale: Double = 1.0       // multiplier for all symbol sizes

    // View-center offset (degrees) from the sign's anchor location. Lets the
    // user drag the framed map within the sign so it need not be exactly
    // centered on the sign's lat/lon. Defaults keep old files centered.
    var centerOffsetLat: Double = 0
    var centerOffsetLon: Double = 0
}
