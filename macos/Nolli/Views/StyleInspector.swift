import SwiftUI

/// Right panel "Design" tab: shows settings for whatever is selected, or the
/// frame's settings when nothing is (press Esc to get there, like Figma).
struct StyleInspector: View {
    @ObservedObject var appState: AppState

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                switch appState.selectedItem {
                case .none:
                    FrameInspector(appState: appState, camera: appState.camera)
                case .layer(let id):
                    if let layer = appState.layers.first(where: { $0.id == id }) {
                        LayerInspector(layer: layer, appState: appState)
                    }
                case .roadSubLayer(let pid, let sid):
                    if let layer = appState.layers.first(where: { $0.id == pid }),
                       let idx = layer.roadSubLayers.firstIndex(where: { $0.id == sid }) {
                        SubLayerInspector(layer: layer, index: idx, appState: appState)
                    }
                case .labelChild(let pid):
                    if let layer = appState.layers.first(where: { $0.id == pid }) {
                        LabelInspector(layer: layer, appState: appState)
                    }
                case .subtypeLabel(let pid, let sid):
                    if let layer = appState.layers.first(where: { $0.id == pid }),
                       let idx = layer.roadSubLayers.firstIndex(where: { $0.id == sid }) {
                        LabelInspector(layer: layer, appState: appState, subIndex: idx)
                    }
                case .symbolChild(let pid):
                    if let layer = appState.layers.first(where: { $0.id == pid }) {
                        SymbolInspector(layer: layer, appState: appState)
                    }
                }
            }
            // Fixed to the panel: a wide control must never push rows off its edges.
            .frame(width: MC.rightWidth, alignment: .leading)
        }
        // A classic scrollbar would take a gutter out of the panel and push the
        // fixed-width content past its edge. Scrolls by wheel or trackpad.
        .scrollIndicators(.never)
    }
}

// MARK: - Inspector header

struct InspectorHeader: View {
    let title: String
    var subtitle: String? = nil
    var back: (() -> Void)? = nil
    var body: some View {
        HStack(spacing: 6) {
            if let back {
                IconButton(systemName: "chevron.left", size: 10, help: "Back", action: back)
                    .padding(.leading, -6)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                if let subtitle {
                    Text(subtitle).font(.system(size: 10)).foregroundStyle(MC.secondary).lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }
    }
}

// MARK: - Frame (nothing selected)

private struct FrameInspector: View {
    @ObservedObject var appState: AppState
    @ObservedObject var camera: MapCamera

    var body: some View {
        InspectorHeader(title: "Frame", subtitle: "Applies to the whole map")

        PanelSection("Background", trailing: {
            Toggle("", isOn: Binding(
                get: { appState.artboardBackgroundEnabled },
                set: { appState.artboardBackgroundEnabled = $0; appState.documentChanged() }
            )).labelsHidden().toggleStyle(.switch).controlSize(.mini)
        }) {
            if appState.artboardBackgroundEnabled {
                ColorRow(label: "Fill", color: Binding(
                    get: { appState.artboardBackground },
                    set: { appState.artboardBackground = $0; appState.documentChanged() }
                ))
            } else {
                Hint("No fill: the map tiles show behind your layers.")
            }
        }

        PanelSection("Map tiles", trailing: {
            Toggle("", isOn: $appState.settings.showTileBackground)
                .labelsHidden().toggleStyle(.switch).controlSize(.mini)
        }) {
            if appState.settings.showTileBackground {
                PropRow(label: "Opacity") {
                    Slider(value: $appState.settings.tileOpacity, in: 0...1).controlSize(.mini)
                    PercentInput(value: $appState.settings.tileOpacity).frame(width: 52)
                }
                Hint("Reference only: tiles are never exported.")
            }
        }

        PanelSection("View") {
            PropSlider(label: "Rotation", value: Binding(
                get: { camera.rotation },
                set: { camera.set(lat: camera.centerLat, lon: camera.centerLon, rotation: $0) }
            ), range: -180...180, step: 1, digits: 1, unit: "°")
            Hint("Option-drag the map or twist two fingers on the trackpad. Exports use this rotation.")
            PropToggle(label: "North arrow", isOn: $appState.showNorthArrow)
            if appState.showNorthArrow {
                PropRow(label: "Position") {
                    PropPicker(selection: $appState.northArrowPosition) {
                        ForEach(NorthArrowPosition.allCases) { Text($0.displayName).tag($0) }
                    }
                }
            }
        }

        PanelSection("Design scale") {
            PropRow(label: "Base zoom") {
                NumberInput(value: Binding(
                    get: { appState.baseZoom },
                    set: { appState.baseZoom = $0.rounded(); appState.documentChanged() }
                ), range: 1...22, step: 1).frame(width: 58)
                Spacer()
                Button("Use \(Int(camera.zoom.rounded()))") {
                    appState.baseZoom = camera.zoom.rounded()
                    appState.documentChanged()
                }
                .controlSize(.small)
            }
            Hint("Line widths, text and icons are 1:1 at this zoom, and scale with the map like vector artwork.")
        }

        PanelSection("Signs") {
            PropSlider(label: "Artwork ×", value: Binding(
                get: { appState.signArtworkScale },
                set: { appState.signArtworkScale = $0; appState.isDirty = true }
            ), range: 0.1...5, hard: 0.05...20, step: 0.05, digits: 2)
            PropRow(label: "New size") {
                NumberInput(value: $appState.settings.defaultWidthMM, range: 10...5000, step: 10, prefix: "W")
                NumberInput(value: $appState.settings.defaultHeightMM, range: 10...5000, step: 10, prefix: "H")
            }
            PropRow(label: "New DPI") {
                NumberInput(value: $appState.settings.defaultDPI, range: 36...1200, step: 10).frame(width: 58)
                Spacer()
            }
        }
    }
}

// MARK: - Layer

private struct LayerInspector: View {
    @ObservedObject var layer: MapLayer
    @ObservedObject var appState: AppState

    private func area<T>(_ kp: WritableKeyPath<AreaStyle, T>) -> Binding<T> {
        Binding(get: { layer.areaStyle[keyPath: kp] },
                set: { layer.areaStyle[keyPath: kp] = $0; appState.documentChanged() })
    }
    private func poi<T>(_ kp: WritableKeyPath<POIStyle, T>) -> Binding<T> {
        Binding(get: { layer.poiStyle[keyPath: kp] },
                set: { layer.poiStyle[keyPath: kp] = $0; appState.documentChanged() })
    }

    var body: some View {
        InspectorHeader(title: layer.name, subtitle: layer.kind.displayName)

        switch layer.kind.featureType {
        case .line:
            LineStyleSections(layer: layer, subIndex: nil, appState: appState)
        case .polygon:
            PanelSection("Fill") {
                ColorRow(label: "Color", color: area(\.fillColor), opacity: area(\.fillOpacity))
            }
            PanelSection("Stroke", trailing: {
                Toggle("", isOn: area(\.strokeEnabled)).labelsHidden().toggleStyle(.switch).controlSize(.mini)
            }) {
                if layer.areaStyle.strokeEnabled {
                    ColorRow(label: "Color", color: area(\.strokeColor))
                    PropSlider(label: "Width", value: area(\.strokeWidth), range: 0.1...8, hard: 0...100, step: 0.1, digits: 1)
                }
            }
        case .point:
            PanelSection("Marker") {
                PropRow(label: "Shape") {
                    PropSegments(selection: poi(\.shape)) {
                        ForEach(MarkerShape.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                }
                PropSlider(label: "Size", value: poi(\.size), range: 1...32, hard: 0.5...200, step: 0.5, digits: 1)
                ColorRow(label: "Fill", color: poi(\.fillColor))
                ColorRow(label: "Stroke", color: poi(\.strokeColor))
                PropSlider(label: "Stroke w", value: poi(\.strokeWidth), range: 0...6, hard: 0...50, step: 0.1, digits: 1)
            }
        }

        PanelSection("Labels", trailing: {
            IconButton(systemName: layer.labelStyle.enabled ? "chevron.right" : "plus", size: 10,
                       help: layer.labelStyle.enabled ? "Edit labels" : "Add labels") {
                if !layer.labelStyle.enabled {
                    layer.labelStyle.enabled = true
                    layer.syncSubLabelStyles()
                    appState.documentChanged()
                }
                appState.selectedItem = .labelChild(parentId: layer.id)
            }
        }) { EmptyView() }

        if layer.kind.featureType != .line {
            PanelSection("Icons", trailing: {
                IconButton(systemName: layer.symbolStyle.enabled ? "chevron.right" : "plus", size: 10,
                           help: layer.symbolStyle.enabled ? "Edit icons" : "Add icons") {
                    if !layer.symbolStyle.enabled {
                        layer.symbolStyle.enabled = true
                        appState.documentChanged()
                    }
                    appState.selectedItem = .symbolChild(parentId: layer.id)
                }
            }) { EmptyView() }
        }

        if layer.hasManualEdits {
            PanelSection("Manual edits") {
                Hint("Moved labels, moved icons or reshaped geometry on this layer.")
                SecondaryButton(title: "Reset to Layer Settings", systemImage: "arrow.uturn.backward") {
                    layer.resetManualEdits()
                    appState.documentChanged()
                }
            }
        }
    }
}

// MARK: - Road subtype

private struct SubLayerInspector: View {
    @ObservedObject var layer: MapLayer
    let index: Int
    @ObservedObject var appState: AppState

    var body: some View {
        if layer.roadSubLayers.indices.contains(index) {
            InspectorHeader(title: layer.roadSubLayers[index].name, subtitle: "\(layer.name) · line style") {
                appState.selectedItem = .layer(layer.id)
            }
            LineStyleSections(layer: layer, subIndex: index, appState: appState)
            PanelSection("Road types") {
                Hint(layer.roadSubLayers[index].roadTypes.joined(separator: ", "))
            }
            PanelSection("Labels", trailing: {
                IconButton(systemName: "chevron.right", size: 10, help: "Edit this road type's labels") {
                    appState.selectedItem = .subtypeLabel(parentId: layer.id, subId: layer.roadSubLayers[index].id)
                }
            }) { EmptyView() }
        }
    }
}

/// Line style editor used for a whole line layer (the master) and for one road
/// subtype, where each field inherits from the master until it's changed.
private struct LineStyleSections: View {
    @ObservedObject var layer: MapLayer
    let subIndex: Int?
    @ObservedObject var appState: AppState

    private var style: RoadStyle {
        if let i = subIndex { return layer.roadSubLayers[i].customStyle }
        return layer.roadStyle
    }
    private func isOver(_ key: String) -> Bool {
        guard let i = subIndex else { return false }
        return layer.roadSubLayers[i].lineOverrides?.contains(key) ?? false
    }
    private func reset(_ key: String) -> () -> Void {
        { [layer] in
            guard let i = subIndex else { return }
            layer.roadSubLayers[i].lineOverrides?.remove(key)
            layer.syncSubLineStyles()
            appState.documentChanged()
        }
    }
    private func b<T>(_ kp: WritableKeyPath<RoadStyle, T>, _ key: String) -> Binding<T> {
        Binding(
            get: { style[keyPath: kp] },
            set: { v in
                if let i = subIndex {
                    layer.roadSubLayers[i].customStyle[keyPath: kp] = v
                    var ov = layer.roadSubLayers[i].lineOverrides ?? []
                    ov.insert(key)
                    layer.roadSubLayers[i].lineOverrides = ov
                } else {
                    layer.roadStyle[keyPath: kp] = v
                    layer.syncSubLineStyles()
                }
                appState.documentChanged()
            })
    }

    var body: some View {
        if subIndex != nil, !(layer.roadSubLayers[subIndex!].lineOverrides ?? []).isEmpty {
            PanelSection("Inheritance") {
                Hint("Fields with a blue dot are this road type's own; everything else follows \(layer.name).")
                SecondaryButton(title: "Reset All to \(layer.name)", systemImage: "arrow.uturn.backward") {
                    layer.roadSubLayers[subIndex!].lineOverrides = []
                    layer.syncSubLineStyles()
                    appState.documentChanged()
                }
            }
        }
        PanelSection("Stroke") {
            ColorRow(label: "Color", color: b(\.color, "color"), opacity: b(\.opacity, "opacity"),
                     overridden: isOver("color") || isOver("opacity"),
                     onReset: { reset("color")(); reset("opacity")() })
            PropSlider(label: "Width", value: b(\.width, "width"), range: 0.1...16, hard: 0...200, step: 0.1, digits: 1,
                       overridden: isOver("width"), onReset: reset("width"))
            PropRow(label: "Caps", overridden: isOver("lineCap"), onReset: reset("lineCap")) {
                PropSegments(selection: b(\.lineCap, "lineCap")) {
                    ForEach(LineCap.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
            }
            PropRow(label: "Joins", overridden: isOver("lineJoin"), onReset: reset("lineJoin")) {
                PropSegments(selection: b(\.lineJoin, "lineJoin")) {
                    ForEach(LineJoin.allCases) { Text($0.rawValue.capitalized).tag($0) }
                }
            }
        }
        PanelSection("Casing", trailing: {
            Toggle("", isOn: b(\.casingEnabled, "casingEnabled")).labelsHidden().toggleStyle(.switch).controlSize(.mini)
        }) {
            if style.casingEnabled {
                ColorRow(label: "Color", color: b(\.casingColor, "casingColor"),
                         overridden: isOver("casingColor"), onReset: reset("casingColor"))
                PropSlider(label: "Width", value: b(\.casingWidth, "casingWidth"), range: 0.1...24, hard: 0...200, step: 0.1, digits: 1,
                           overridden: isOver("casingWidth"), onReset: reset("casingWidth"))
            }
        }
    }
}
