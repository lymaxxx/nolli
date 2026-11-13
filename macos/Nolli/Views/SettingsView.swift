import SwiftUI

struct SettingsView: View {
    @ObservedObject var appState: AppState
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Settings").font(.system(size: 13, weight: .semibold))
                Spacer()
                IconButton(systemName: "xmark", size: 11, help: "Close") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 14).frame(height: 40)
            .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }

            VStack(spacing: 0) {
                PanelSection("OpenStreetMap data") {
                    PropRow(label: "Cache") {
                        NumberInput(value: Binding(
                            get: { Double(appState.settings.cacheDurationDays) },
                            set: { appState.settings.cacheDurationDays = Int($0) }
                        ), range: 1...90, step: 1, unit: "days").frame(width: 90)
                        Spacer()
                    }
                    PropRow(label: "Overpass") {
                        PropTextField(text: $appState.settings.overpassEndpoint)
                    }
                    Hint("If this server is busy, Nolli tries public mirrors automatically.")
                }
                PanelSection("Export defaults") {
                    PropRow(label: "Format") {
                        PropSegments(selection: $appState.settings.defaultExportFormat) {
                            ForEach(ExportFormat.allCases) { Text($0.rawValue).tag($0) }
                        }
                    }
                    PropRow(label: "Size") {
                        NumberInput(value: $appState.settings.defaultWidthMM, range: 10...5000, step: 10, unit: "mm", prefix: "W")
                        NumberInput(value: $appState.settings.defaultHeightMM, range: 10...5000, step: 10, unit: "mm", prefix: "H")
                    }
                    PropRow(label: "DPI") {
                        NumberInput(value: $appState.settings.defaultDPI, range: 36...1200, step: 10).frame(width: 90)
                        Spacer()
                    }
                }
            }
        }
        .frame(width: 400)
    }
}
