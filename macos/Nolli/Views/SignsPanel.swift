import SwiftUI
import UniformTypeIdentifiers

/// Right panel "Signs" tab: the list of signs, the selected sign's settings and
/// a live preview of each face.
struct SignsPanel: View {
    @ObservedObject var appState: AppState
    @State private var exportError: String? = nil

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                listSection
                if let id = appState.selectedSignId,
                   let idx = appState.signOutputs.firstIndex(where: { $0.id == id }) {
                    detail(idx: idx)
                }
            }
            .frame(width: MC.rightWidth, alignment: .leading)
        }
        .scrollIndicators(.never)
        .alert("Export Error", isPresented: Binding(
            get: { exportError != nil }, set: { if !$0 { exportError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(exportError ?? "")
        }
    }

    private var listSection: some View {
        PanelSection("Signs", trailing: {
            if !appState.signOutputs.isEmpty {
                IconButton(systemName: "square.and.arrow.up.on.square", size: 10, help: "Export all signs as PDF") { exportAll() }
            }
            IconButton(systemName: appState.isPlacingSign ? "xmark" : "plus", size: 10,
                       active: appState.isPlacingSign,
                       help: appState.isPlacingSign ? "Cancel" : "Place a new sign on the map") {
                appState.isPlacingSign.toggle()
            }
        }) {
            if appState.signOutputs.isEmpty {
                Hint("Press + and click the map to place a sign.")
            } else {
                VStack(spacing: 0) {
                    ForEach(appState.signOutputs) { sign in
                        SignRow(sign: sign, isSelected: appState.selectedSignId == sign.id,
                                onSelect: { appState.selectedSignId = sign.id },
                                onDelete: {
                                    appState.signOutputs.removeAll { $0.id == sign.id }
                                    if appState.selectedSignId == sign.id { appState.selectedSignId = nil }
                                    appState.documentChanged()
                                })
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func detail(idx: Int) -> some View {
        let binding = $appState.signOutputs[idx]
        let sign = appState.signOutputs[idx]

        PanelSection("Sign") {
            PropRow(label: "Name") { PropTextField(text: binding.name) }
            PropSlider(label: "Facing", value: binding.rotation, range: 0...360, unit: "°")
            PropToggle(label: "Double-sided", isOn: binding.isDoubleSided)
            if sign.isDoubleSided {
                PropSlider(label: "Back facing", value: binding.backRotation, range: 0...360, unit: "°")
            }
        }
        PanelSection("Size") {
            PropRow(label: "Size") {
                NumberInput(value: binding.widthMM, range: 10...5000, step: 10, unit: "mm", prefix: "W")
                NumberInput(value: binding.heightMM, range: 10...5000, step: 10, unit: "mm", prefix: "H")
            }
            PropRow(label: "DPI") {
                NumberInput(value: binding.dpi, range: 36...1200, step: 10).frame(width: 70)
                Spacer()
            }
            PropSlider(label: "Labels ×", value: binding.labelScale, range: 0.25...3, hard: 0.05...20, step: 0.05, digits: 2)
            PropSlider(label: "Icons ×", value: binding.iconScale, range: 0.25...3, hard: 0.05...20, step: 0.05, digits: 2)
        }
        PanelSection("Preview", trailing: {
            if sign.centerOffsetLat != 0 || sign.centerOffsetLon != 0 {
                IconButton(systemName: "scope", size: 10, help: "Centre on the sign again") {
                    binding.wrappedValue.centerOffsetLat = 0
                    binding.wrappedValue.centerOffsetLon = 0
                }
            }
        }) {
            preview(binding: binding, rotation: sign.rotation, label: "Front", side: .front)
            if sign.isDoubleSided {
                preview(binding: binding, rotation: sign.backRotation, label: "Back", side: .back)
            }
            SecondaryButton(title: "Export PNG…", systemImage: "square.and.arrow.up") { exportSign(sign) }
        }
    }

    @ViewBuilder
    private func preview(binding: Binding<SignOutput>, rotation: Double, label: String, side: SignSide) -> some View {
        let sign = binding.wrappedValue
        let shown = appState.viewportSignSide == side
        VStack(spacing: 4) {
            HStack {
                Text(label).font(MC.body).foregroundStyle(MC.secondary)
                Spacer()
                IconButton(systemName: shown ? "eye.fill" : "eye", size: 10, active: shown,
                           help: shown ? "Back to the map" : "Show large in the main view") {
                    appState.viewportSignSide = shown ? nil : side
                }
            }
            DraggableSignPreview(sign: binding, displayRotation: rotation, layers: appState.layers,
                                 baseZoom: appState.baseZoom, iconLibrary: appState.iconLibrary,
                                 artworkScale: appState.signArtworkScale, labelsVersion: appState.labelsVersion)
                .aspectRatio(sign.widthMM / max(sign.heightMM, 1), contentMode: .fit)
                .overlay(Rectangle().strokeBorder(shown ? Color.accentColor : MC.hairline, lineWidth: shown ? 2 : 1))
                .help("Drag to reposition the map within the sign")
        }
    }

    private func exportSign(_ sign: SignOutput) {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.png]
        panel.nameFieldStringValue = "\(sign.name).png"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try SignExporter.exportPNG(sign: sign, layers: appState.layers, baseZoom: appState.baseZoom,
                                       iconLibrary: appState.iconLibrary, artworkScale: appState.signArtworkScale,
                                       labelsVersion: appState.labelsVersion, to: url)
        } catch { exportError = error.localizedDescription }
    }

    private func exportAll() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = "Signs.pdf"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try SignExporter.exportAllPDF(signs: appState.signOutputs, layers: appState.layers,
                                          baseZoom: appState.baseZoom, iconLibrary: appState.iconLibrary,
                                          artworkScale: appState.signArtworkScale,
                                          labelsVersion: appState.labelsVersion, to: url)
        } catch { exportError = error.localizedDescription }
    }
}

private struct SignRow: View {
    let sign: SignOutput
    let isSelected: Bool
    let onSelect: () -> Void
    let onDelete: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "signpost.right").font(.system(size: 11)).foregroundStyle(MC.secondary).frame(width: 16)
            Text(sign.name).font(MC.body).lineLimit(1)
            Spacer()
            if hovering {
                IconButton(systemName: "trash", size: 10, help: "Delete sign", action: onDelete)
            } else {
                Text("\(Int(sign.rotation))°").font(.system(size: 10)).foregroundStyle(MC.tertiary)
            }
        }
        .padding(.horizontal, 6)
        .frame(height: MC.rowHeight)
        .background(RoundedRectangle(cornerRadius: 5).fill(isSelected ? MC.selected : (hovering ? MC.hover : .clear)))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture(perform: onSelect)
    }
}
