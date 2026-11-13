import SwiftUI
import UniformTypeIdentifiers

struct ExportSheet: View {
    @ObservedObject var appState: AppState
    @Binding var isPresented: Bool
    @State private var config = ExportConfig()
    @State private var format: ExportFormat = .svg
    @State private var isExporting = false
    @State private var errorMessage: String? = nil

    /// Height that matches the selected area's shape at the current width.
    private var fittedHeight: Double? {
        guard let b = appState.boundingBox else { return nil }
        return config.widthMM / b.mercatorAspect
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Export Map").font(.system(size: 13, weight: .semibold))
                Spacer()
                IconButton(systemName: "xmark", size: 11, help: "Close") { isPresented = false }
            }
            .padding(.horizontal, 14).frame(height: 40)
            .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }

            PanelSection("Format") {
                PropSegments(selection: $format) {
                    ForEach(ExportFormat.allCases) { Text($0.rawValue).tag($0) }
                }
                switch format {
                case .svg:
                    PropToggle(label: "Editable curved text for Illustrator", isOn: $config.aiLabelsCompanion)
                    Hint(config.aiLabelsCompanion
                         ? "Writes the SVG without curved labels plus a “…-labels.jsx” beside it. Open the SVG in Illustrator, then run the script (File ▸ Scripts ▸ Other Script): road names are added as live type on a path, in their own layers."
                         : "Curved labels stay in the SVG as text on a path. Illustrator breaks these up on import; Inkscape and Affinity keep them.")
                    PropToggle(label: "Embed bounding box as a comment", isOn: $config.embedBBoxMeta)
                case .pdf:
                    Hint("Vector PDF with real text, identical to the screen. PDF has no editable text on a path; for that, use Illustrator.")
                case .jsx:
                    Hint("A script that builds the whole map in Illustrator (File ▸ Scripts ▸ Other Script): named layers, Icons and Labels groups on top, placed icons (keep the Nolli-icons folder beside the script), and live type on a path.")
                }
            }

            PanelSection("Artboard", trailing: {
                if fittedHeight != nil {
                    Button("Fit to Area") { if let h = fittedHeight { config.heightMM = h.rounded() } }
                        .controlSize(.mini)
                }
            }) {
                PropRow(label: "Size") {
                    NumberInput(value: $config.widthMM, range: 10...10000, step: 10, unit: "mm", prefix: "W")
                    NumberInput(value: $config.heightMM, range: 10...10000, step: 10, unit: "mm", prefix: "H")
                }
                if format != .jsx {
                    PropRow(label: "DPI") {
                        NumberInput(value: $config.dpi, range: 36...1200, step: 10).frame(width: 70)
                        Text("\(Int(config.widthMM * config.dpi / 25.4)) × \(Int(config.heightMM * config.dpi / 25.4)) px")
                            .font(.system(size: 10)).foregroundStyle(MC.secondary)
                        Spacer()
                    }
                }
            }

            if let err = errorMessage {
                Text(err).font(MC.body).foregroundStyle(.red).padding(.horizontal, 14).padding(.top, 8)
            }

            HStack {
                if appState.boundingBox == nil {
                    Hint("Select an area first: exports cover the bounding box.")
                }
                Spacer()
                Button("Cancel") { isPresented = false }
                    .keyboardShortcut(.escape)
                Button(isExporting ? "Exporting…" : "Export…") { doExport() }
                    .keyboardShortcut(.return)
                    .buttonStyle(.borderedProminent)
                    .disabled(isExporting || appState.boundingBox == nil)
            }
            .controlSize(.small)
            .padding(14)
        }
        .frame(width: 420)
        .onAppear {
            config = ExportConfig(
                widthMM: appState.settings.defaultWidthMM,
                heightMM: appState.settings.defaultHeightMM,
                dpi: appState.settings.defaultDPI
            )
            format = appState.settings.defaultExportFormat
            if let h = fittedHeight { config.heightMM = h.rounded() }
        }
    }

    private func doExport() {
        guard let bbox = appState.boundingBox else { return }

        let panel = NSSavePanel()
        panel.nameFieldStringValue = "nolli-export.\(format.fileExtension)"

        switch format {
        case .svg: panel.allowedContentTypes = [UTType(filenameExtension: "svg") ?? .xml]
        case .pdf: panel.allowedContentTypes = [.pdf]
        case .jsx: panel.allowedContentTypes = [UTType(filenameExtension: "jsx") ?? .plainText]
        }

        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            isExporting = true
            errorMessage = nil

            Task { @MainActor in
                do {
                    switch format {
                    case .svg:
                        let svg = SVGExporter().export(layers: appState.layers, bbox: bbox, config: config,
                                                       baseZoom: appState.baseZoom,
                                                       labelsVersion: appState.labelsVersion,
                                                       iconLibrary: appState.iconLibrary,
                                                       excludeCurvedLabels: config.aiLabelsCompanion,
                                                       background: appState.effectiveBackground)
                        try svg.write(to: url, atomically: true, encoding: .utf8)
                        if config.aiLabelsCompanion {
                            let jsx = JSXExporter().exportCurvedLabelsCompanion(
                                layers: appState.layers, bbox: bbox, config: config,
                                baseZoom: appState.baseZoom,
                                labelsVersion: appState.labelsVersion)
                            let base = url.deletingPathExtension().lastPathComponent
                            let jsxURL = url.deletingLastPathComponent()
                                .appendingPathComponent("\(base)-labels.jsx")
                            try jsx.write(to: jsxURL, atomically: true, encoding: .utf8)
                        }
                    case .pdf:
                        let pdfData = PDFExporter().export(layers: appState.layers, bbox: bbox, config: config,
                                                           baseZoom: appState.baseZoom,
                                                           labelsVersion: appState.labelsVersion,
                                                           iconLibrary: appState.iconLibrary,
                                                           background: appState.effectiveBackground)
                        try pdfData.write(to: url)
                    case .jsx:
                        let result = JSXExporter().export(layers: appState.layers, bbox: bbox, config: config,
                                                          baseZoom: appState.baseZoom,
                                                          labelsVersion: appState.labelsVersion,
                                                          iconLibrary: appState.iconLibrary,
                                                          background: appState.effectiveBackground)
                        try result.script.write(to: url, atomically: true, encoding: .utf8)
                        if !result.iconFiles.isEmpty {
                            let dir = url.deletingLastPathComponent()
                                .appendingPathComponent("Nolli-icons", isDirectory: true)
                            try FileManager.default.createDirectory(at: dir,
                                                                    withIntermediateDirectories: true)
                            for icon in result.iconFiles {
                                try icon.data.write(to: dir.appendingPathComponent(icon.name))
                            }
                        }
                    }
                    isPresented = false
                } catch {
                    errorMessage = error.localizedDescription
                }
                isExporting = false
            }
        }
    }
}
