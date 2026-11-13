import SwiftUI
import UniformTypeIdentifiers

struct SymbolInspector: View {
    @ObservedObject var layer: MapLayer
    @ObservedObject var appState: AppState

    private func bind<T>(_ kp: WritableKeyPath<SymbolStyle, T>) -> Binding<T> {
        Binding(
            get: { layer.symbolStyle[keyPath: kp] },
            set: { layer.symbolStyle[keyPath: kp] = $0; appState.documentChanged() }
        )
    }

    private var sym: SymbolStyle { layer.symbolStyle }

    var body: some View {
        InspectorHeader(title: "\(layer.name) icons") { appState.selectedItem = .layer(layer.id) }

        PanelSection("Icons on", trailing: {
            Toggle("", isOn: bind(\.enabled)).labelsHidden().toggleStyle(.switch).controlSize(.mini)
        }) { EmptyView() }

        if sym.enabled {
            PanelSection("Icon") {
                if !appState.iconLibrary.isEmpty {
                    PropRow(label: "Library") {
                        PropPicker(selection: bind(\.iconId)) {
                            Text("None").tag(Optional<UUID>.none)
                            ForEach(appState.iconLibrary) { Text($0.name).tag(Optional($0.id)) }
                        }
                    }
                }
                HStack(spacing: 8) {
                    if let data = resolvedSVGData {
                        SVGPreview(svgData: data)
                            .frame(width: 32, height: 32)
                            .background(RoundedRectangle(cornerRadius: 5).fill(MC.field))
                    }
                    SecondaryButton(title: sym.inlineSVGData != nil ? "Replace SVG…" : "Import SVG…",
                                    systemImage: "square.and.arrow.down") { importSVG() }
                }
            }
            PanelSection("Appearance") {
                PropRow(label: "Size") {
                    NumberInput(value: widthBinding, range: 1...1000, step: 1, digits: 1, prefix: "W")
                    NumberInput(value: heightBinding, range: 1...1000, step: 1, digits: 1, prefix: "H")
                    IconButton(systemName: sym.lockAspect ? "lock" : "lock.open", size: 10, active: sym.lockAspect,
                               help: "Lock aspect ratio") { layer.symbolStyle.lockAspect.toggle() }
                }
                PropSlider(label: "Rotation", value: bind(\.rotation), range: -180...180, unit: "°")
                PropRow(label: "Opacity") {
                    Slider(value: bind(\.opacity), in: 0...1).controlSize(.mini)
                    PercentInput(value: bind(\.opacity)).frame(width: 52)
                }
            }
            PanelSection("Placement") {
                PropRow(label: "Anchor") {
                    PropPicker(selection: bind(\.anchorPoint)) {
                        ForEach(SymbolAnchor.allCases) { Text($0.displayName).tag($0) }
                    }
                }
                PropToggle(label: "Allow overlap", isOn: bind(\.allowOverlapWithOtherLayers))
                if !sym.allowOverlapWithOtherLayers {
                    PropSlider(label: "Margin", value: bind(\.collisionMargin), range: 0...40, hard: 0...500)
                }
            }
            if layer.labelStyle.enabled {
                PanelSection("Text beside icon", trailing: {
                    Toggle("", isOn: bind(\.bindToLabels)).labelsHidden().toggleStyle(.switch).controlSize(.mini)
                }) {
                    if sym.bindToLabels {
                        PropRow(label: "Layout") {
                            PropPicker(selection: bind(\.labelLayout)) {
                                ForEach(LabelLayout.allCases) { Text($0.displayName).tag($0) }
                            }
                        }
                        PropSlider(label: "Gap", value: bind(\.iconTextGap), range: 0...24, hard: 0...200, step: 0.5, digits: 1)
                        if sym.labelLayout == .iconLeft || sym.labelLayout == .iconRight {
                            PropRow(label: "Align") {
                                PropPicker(selection: bind(\.textAlignment)) {
                                    ForEach(LabelTextAlignment.allCases) { Text($0.displayName).tag($0) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private var resolvedSVGData: Data? {
        sym.inlineSVGData ?? appState.iconLibrary.first(where: { $0.id == sym.iconId })?.svgData
    }

    private var widthBinding: Binding<Double> {
        Binding(get: { sym.width }, set: { w in
            if sym.lockAspect, sym.width > 0 { layer.symbolStyle.height = sym.height * w / sym.width }
            layer.symbolStyle.width = w
            appState.documentChanged()
        })
    }

    private var heightBinding: Binding<Double> {
        Binding(get: { sym.height }, set: { h in
            if sym.lockAspect, sym.height > 0 { layer.symbolStyle.width = sym.width * h / sym.height }
            layer.symbolStyle.height = h
            appState.documentChanged()
        })
    }

    private func importSVG() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "svg") ?? .data]
        guard panel.runModal() == .OK, let url = panel.url, let data = try? Data(contentsOf: url) else { return }
        layer.symbolStyle.inlineSVGData = data
        layer.symbolStyle.iconId = nil
        appState.documentChanged()
    }
}
