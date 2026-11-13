import SwiftUI

// Nolli redesign tokens. Light values come from the .pen file.
// Dark mode is NOT designed yet: define dark variants in an asset catalog
// (or Color(light:dark:)) before shipping, and prefer system colors where noted.

enum MC {
    enum Color {
        // Interactive accent. Replace the system-accent usage with this one blue.
        static let accent       = SwiftUI.Color(hex: 0x2563EB)
        static let accentSoft   = SwiftUI.Color(hex: 0xEAF1FF) // selected row, selected card
        static let warnBackground = SwiftUI.Color(hex: 0xFFF6E5)
        static let warnForeground = SwiftUI.Color(hex: 0x9A5B00)
        static let ok           = SwiftUI.Color(hex: 0x16A34A) // "Saved" dot only
        static let destructive  = SwiftUI.Color(hex: 0xE7000B) // Revert All, delete
        static let hairline     = SwiftUI.Color(hex: 0xECECEE)
        static let border       = SwiftUI.Color(hex: 0xE5E5E5)
        static let field        = SwiftUI.Color(hex: 0xF4F4F5)
        static let text         = SwiftUI.Color(hex: 0x18181B)
        static let textSecondary = SwiftUI.Color(hex: 0x71717A)
        static let textTertiary = SwiftUI.Color(hex: 0xA1A1AA)
        static let panel        = SwiftUI.Color.white
    }

    enum Size {
        static let leftPanelWidth: CGFloat = 256
        static let rightPanelWidth: CGFloat = 300
        static let toolbarHeight: CGFloat = 52
        static let statusBarHeight: CGFloat = 24
        static let layerRowHeight: CGFloat = 34
        static let controlHeight: CGFloat = 26
        static let propertyLabelWidth: CGFloat = 70
        static let sectionPaddingX: CGFloat = 14
        static let sectionPaddingY: CGFloat = 12
        static let radiusControl: CGFloat = 6
        static let radiusRow: CGFloat = 8
        static let radiusCard: CGFloat = 10
        static let radiusSheet: CGFloat = 14
        static let sheetWidth: CGFloat = 420
    }

    enum Font {
        // Design file uses Inter as a stand-in. In the app use the system font (SF Pro).
        static let body = SwiftUI.Font.system(size: 12)
        static let bodyEmphasis = SwiftUI.Font.system(size: 12, weight: .semibold)
        static let rowTitle = SwiftUI.Font.system(size: 13, weight: .medium)
        static let inspectorTitle = SwiftUI.Font.system(size: 14, weight: .semibold)
        static let caption = SwiftUI.Font.system(size: 11)
        static let overline = SwiftUI.Font.system(size: 11, weight: .semibold) // use .tracking(0.6), uppercase
    }
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}
