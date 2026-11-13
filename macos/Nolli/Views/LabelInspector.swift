import SwiftUI
import AppKit

struct LabelInspector: View {
    @ObservedObject var layer: MapLayer
    @ObservedObject var appState: AppState
    /// When set, edits `layer.roadSubLayers[subIndex]`'s labels: every field
    /// inherits from the layer's master labels until it's changed here.
    var subIndex: Int? = nil

    @State private var showSaveStyleAlert = false
    @State private var newStyleName = ""

    private let availableTags = ["name", "name:en", "ref", "addr:housenumber", "alt_name", "short_name", "old_name"]

    private var hasLines: Bool { layer.kind == .roads || !layer.lineFeatures.isEmpty }
    private var hasSpots: Bool {
        layer.kind != .roads
            && (!layer.polygonFeatures.isEmpty || !layer.pointFeatures.isEmpty || layer.lineFeatures.isEmpty)
    }

    /// Plain-language answer to "why don't I see my labels?".
    private var placementSummary: String? {
        guard subIndex == nil, layer.isVisible, ls.enabled else { return nil }
        var names = Set<String>()
        for f in layer.lineFeatures { if let t = LabelLayoutEngine.resolvedText(f.tags, ls) { names.insert(t) } }
        for f in layer.polygonFeatures { if let t = LabelLayoutEngine.resolvedText(f.tags, ls) { names.insert(t) } }
        for f in layer.pointFeatures { if let t = LabelLayoutEngine.resolvedText(f.tags, ls) { names.insert(t) } }
        if layer.lineFeatures.isEmpty, layer.polygonFeatures.isEmpty, layer.pointFeatures.isEmpty {
            return "Nothing fetched yet for this layer."
        }
        if names.isEmpty { return "None of these features have a “\(ls.tagKey)” tag in OpenStreetMap, so there is nothing to label." }
        let layout = LabelLayoutCache.shared.layout(layers: appState.layers, baseZoom: appState.baseZoom, labelScale: 1)
        var shown = Set(layout.lineLabels.filter { $0.layerId == layer.id }.map(\.text))
        shown.formUnion(layout.pointLabels.filter { $0.layerId == layer.id }.map(\.text))
        let base = "\(shown.count) of \(names.count) names on the map."
        return shown.count < names.count ? base + " The rest don't fit: try a smaller margin, or move this layer up." : base
    }

    private var ls: LabelStyle {
        if let i = subIndex, layer.roadSubLayers.indices.contains(i) {
            return layer.roadSubLayers[i].labelStyle ?? layer.labelStyle
        }
        return layer.labelStyle
    }

    private var linkedStyle: TextStyle? {
        guard let id = ls.textStyleId else { return nil }
        return appState.textStyles.first { $0.id == id }
    }

    private func bind<T>(_ kp: WritableKeyPath<LabelStyle, T>) -> Binding<T> {
        Binding(
            get: { self.ls[keyPath: kp] },
            set: { newValue in
                if let i = subIndex {
                    var style = layer.roadSubLayers[i].labelStyle ?? layer.labelStyle
                    style[keyPath: kp] = newValue
                    layer.roadSubLayers[i].labelStyle = style
                    if let key = Self.codingKey[kp] {
                        var ov = layer.roadSubLayers[i].labelOverrides ?? []
                        ov.insert(key)
                        layer.roadSubLayers[i].labelOverrides = ov
                    }
                } else {
                    layer.labelStyle[keyPath: kp] = newValue
                    layer.syncSubLabelStyles()
                }
                appState.documentChanged()
            }
        )
    }

    /// Overridden state + reset action for one field (nil on the master).
    private func over<T>(_ kp: WritableKeyPath<LabelStyle, T>) -> Bool {
        guard let i = subIndex, let key = Self.codingKey[kp] else { return false }
        return layer.roadSubLayers[i].labelOverrides?.contains(key) ?? false
    }
    private func reset<T>(_ kp: WritableKeyPath<LabelStyle, T>) -> () -> Void {
        {
            guard let i = subIndex, let key = Self.codingKey[kp] else { return }
            layer.roadSubLayers[i].labelOverrides?.remove(key)
            layer.syncSubLabelStyles()
            appState.documentChanged()
        }
    }

    private func slider(_ title: String, _ kp: WritableKeyPath<LabelStyle, Double>, range: ClosedRange<Double>,
                        hard: ClosedRange<Double>? = nil, step: Double = 1, digits: Int = 0, unit: String = "") -> some View {
        PropSlider(label: title, value: bind(kp), range: range, hard: hard, step: step, digits: digits, unit: unit,
                   overridden: over(kp), onReset: reset(kp))
    }

    private func color(_ title: String, _ kp: WritableKeyPath<LabelStyle, CodableColor>,
                       opacity: WritableKeyPath<LabelStyle, Double>? = nil) -> some View {
        ColorRow(label: title, color: bind(kp), opacity: opacity.map { bind($0) },
                 overridden: over(kp) || (opacity.map { over($0) } ?? false),
                 onReset: { reset(kp)(); if let opacity { reset(opacity)() } })
    }

    private func onOff(_ kp: WritableKeyPath<LabelStyle, Bool>) -> some View {
        Toggle("", isOn: bind(kp)).labelsHidden().toggleStyle(.switch).controlSize(.mini)
    }

    var body: some View {
        if let i = subIndex, layer.roadSubLayers.indices.contains(i) {
            InspectorHeader(title: "\(layer.roadSubLayers[i].name) labels",
                            subtitle: "Inherits from \(layer.name) labels") {
                appState.selectedItem = .labelChild(parentId: layer.id)
            }
        } else {
            InspectorHeader(title: "\(layer.name) labels",
                            subtitle: layer.kind == .roads ? "Master: applies to all road types" : nil) {
                appState.selectedItem = .layer(layer.id)
            }
        }

        PanelSection(subIndex == nil ? "Labels on" : "Label this road type", trailing: { onOff(\.enabled) }) {
            if let placementSummary { Hint(placementSummary) }
            if subIndex != nil, !pinnedKeys.isEmpty {
                Hint("Blue dots mark this road type's own settings. Click a dot to go back to the master.")
                SecondaryButton(title: "Reset All to Master", systemImage: "arrow.uturn.backward") {
                    layer.roadSubLayers[subIndex!].labelOverrides = []
                    layer.syncSubLabelStyles()
                    appState.documentChanged()
                }
            }
        }

        if ls.enabled {
            if subIndex == nil { styleLibrarySection }
            textSection
            placementSection
            bufferSection
            shadowSection
            if hasSpots { calloutsSection }
            sourceSection
        }
    }

    private var pinnedKeys: Set<String> {
        guard let i = subIndex else { return [] }
        return layer.roadSubLayers[i].labelOverrides ?? []
    }

    // MARK: Text style library

    private var styleLibrarySection: some View {
        PanelSection("Text style", trailing: {
            IconButton(systemName: "plus", size: 10, help: "Save as a reusable text style") {
                newStyleName = linkedStyle?.name ?? ""
                showSaveStyleAlert = true
            }
        }) {
            if !appState.textStyles.isEmpty || linkedStyle != nil {
                PropPicker(selection: Binding(
                    get: { layer.labelStyle.textStyleId },
                    set: { newId in
                        if let id = newId, let ts = appState.textStyles.first(where: { $0.id == id }) {
                            ts.apply(to: &layer.labelStyle)
                        } else {
                            layer.labelStyle.textStyleId = nil
                        }
                        layer.syncSubLabelStyles()
                        appState.documentChanged()
                    }
                )) {
                    Text("None").tag(Optional<UUID>.none)
                    ForEach(appState.textStyles) { Text($0.name).tag(Optional($0.id)) }
                }
            }
        }
        .alert("Save Text Style", isPresented: $showSaveStyleAlert) {
            TextField("Style name", text: $newStyleName)
            Button("Save") { saveNewStyle() }
            Button("Cancel", role: .cancel) {}
        }
    }

    private func saveNewStyle() {
        guard !newStyleName.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        if let id = layer.labelStyle.textStyleId,
           let idx = appState.textStyles.firstIndex(where: { $0.id == id }) {
            appState.textStyles[idx].capture(from: layer.labelStyle)
            appState.textStyles[idx].name = newStyleName
            for l in appState.layers where l.labelStyle.textStyleId == id && l.id != layer.id {
                appState.textStyles[idx].apply(to: &l.labelStyle)
                l.syncSubLabelStyles()
            }
        } else {
            var ts = TextStyle(name: newStyleName)
            ts.capture(from: layer.labelStyle)
            appState.textStyles.append(ts)
            layer.labelStyle.textStyleId = ts.id
        }
        appState.documentChanged()
    }

    // MARK: Text

    private var textSection: some View {
        PanelSection("Text") {
            PropRow(label: "Font", overridden: over(\.fontName), onReset: reset(\.fontName)) {
                FontPickerButton(family: bind(\.fontName))
            }
            PropRow(label: "Style", overridden: over(\.fontWeight), onReset: reset(\.fontWeight)) {
                PropPicker(selection: bind(\.fontWeight)) {
                    ForEach(fontFaces(for: ls.fontName), id: \.self) { Text($0).tag($0) }
                }
            }
            slider("Size", \.fontSize, range: 1...36, hard: 0.5...400, step: 0.5, digits: 1)
            color("Color", \.color, opacity: \.opacity)
            PropRow(label: "Case", overridden: over(\.typeCase), onReset: reset(\.typeCase)) {
                PropPicker(selection: bind(\.typeCase)) {
                    ForEach(LabelTypeCase.allCases) { Text($0.displayName).tag($0) }
                }
            }
            slider("Tracking", \.tracking, range: 0...400, hard: -200...2000, step: 5, unit: "‰")
            slider("Word space", \.wordSpacing, range: 0...1000, hard: -500...5000, step: 10, unit: "‰")
        }
    }

    private func fontFaces(for family: String) -> [String] {
        let names = (NSFontManager.shared.availableMembers(ofFontFamily: family) ?? [])
            .compactMap { $0[1] as? String }
        var out = names.isEmpty ? ["Regular"] : names
        if !out.contains(ls.fontWeight) { out.insert(ls.fontWeight, at: 0) }
        return out
    }

    // MARK: Placement

    @ViewBuilder
    private var placementSection: some View {
        if hasLines {
            PanelSection(layer.kind == .roads ? "Along the road" : "Along the line") {
                PropRow(label: "Mode", overridden: over(\.lineLabelMode), onReset: reset(\.lineLabelMode)) {
                    PropPicker(selection: bind(\.lineLabelMode)) {
                        ForEach(LineLabelMode.allCases) { Text($0.displayName).tag($0) }
                    }
                }
                if ls.lineLabelMode != .horizontal {
                    PropRow(label: "Position", overridden: over(\.linePosition), onReset: reset(\.linePosition)) {
                        PropSegments(selection: bind(\.linePosition)) {
                            Text("Above").tag(LinePosition.above)
                            Text("On").tag(LinePosition.on)
                            Text("Below").tag(LinePosition.below)
                        }
                    }
                }
                if ls.linePosition != .on || ls.lineLabelMode == .horizontal {
                    slider("Distance", \.distanceFromLine, range: 0...20, hard: 0...200, step: 0.5, digits: 1)
                }
                if ls.lineLabelMode == .curved {
                    slider("Max bend", \.maxCharAngle, range: 5...60, hard: 1...180, unit: "°")
                        .help("Text never crosses a bend sharper than this: it slides along the road to avoid it.")
                }
                slider("Repeat", \.repeatInterval, range: 20...1000, hard: 1...20000, step: 10)
                    .help("Minimum distance between two labels with the same name.")
            }
        }
        if hasSpots {
            PanelSection(hasLines ? "Area and point names" : "Placement") {
                PropRow(label: "Anchor", overridden: over(\.placement), onReset: reset(\.placement)) {
                    AnchorGrid(placement: bind(\.placement))
                    Spacer()
                }
                PropRow(label: "Offset") {
                    NumberInput(value: bind(\.offsetX), range: -500...500, step: 0.5, digits: 1, prefix: "X")
                    NumberInput(value: bind(\.offsetY), range: -500...500, step: 0.5, digits: 1, prefix: "Y")
                }
            }
        }
        PanelSection("Overlap") {
            PropRow(label: "When tight", overridden: over(\.overlapMode), onReset: reset(\.overlapMode)) {
                PropPicker(selection: bind(\.overlapMode)) {
                    ForEach(LabelOverlapMode.allCases) { Text($0.displayName).tag($0) }
                }
            }
            if ls.overlapMode == .never {
                slider("Margin", \.minSpacing, range: 0...60, hard: 0...1000, step: 1)
                    .help("Invisible clear border around each label.")
            }
            Hint("Labels of higher rows in the layer list win the space.")
        }
    }

    // MARK: Effects

    private var bufferSection: some View {
        PanelSection("Halo", trailing: { onOff(\.bufferEnabled) }) {
            if ls.bufferEnabled {
                color("Color", \.haloColor, opacity: \.bufferOpacity)
                slider("Size", \.haloWidth, range: 0.1...8, hard: 0...100, step: 0.1, digits: 1)
                PropRow(label: "Joins", overridden: over(\.bufferJoinStyle), onReset: reset(\.bufferJoinStyle)) {
                    PropSegments(selection: bind(\.bufferJoinStyle)) {
                        ForEach(LineJoin.allCases) { Text($0.rawValue.capitalized).tag($0) }
                    }
                }
            }
        }
    }

    private var shadowSection: some View {
        PanelSection("Shadow", trailing: { onOff(\.shadowEnabled) }) {
            if ls.shadowEnabled {
                color("Color", \.shadowColor, opacity: \.shadowOpacity)
                slider("Blur", \.shadowBlur, range: 0...20, hard: 0...200, step: 0.5, digits: 1)
                PropRow(label: "Offset") {
                    NumberInput(value: bind(\.shadowOffsetX), range: -200...200, step: 0.5, digits: 1, prefix: "X")
                    NumberInput(value: bind(\.shadowOffsetY), range: -200...200, step: 0.5, digits: 1, prefix: "Y")
                }
            }
        }
    }

    private var calloutsSection: some View {
        PanelSection("Callout line", trailing: { onOff(\.calloutsEnabled) }) {
            if ls.calloutsEnabled {
                Hint("Connects a label to its feature once you've moved it away.")
                PropRow(label: "Style") {
                    PropPicker(selection: bind(\.calloutStyle)) {
                        ForEach(CalloutStyle.allCases) { Text($0.displayName).tag($0) }
                    }
                }
                color("Color", \.calloutColor)
                slider("Width", \.calloutWidth, range: 0.1...4, hard: 0...50, step: 0.1, digits: 1)
                slider("Min dist", \.calloutMinDistance, range: 0...40, hard: 0...500)
            }
        }
    }

    private var sourceSection: some View {
        PanelSection("Text source") {
            PropRow(label: "OSM tag", overridden: over(\.tagKey), onReset: reset(\.tagKey)) {
                PropPicker(selection: bind(\.tagKey)) {
                    ForEach(availableTags, id: \.self) { Text($0).tag($0) }
                }
            }
            PropRow(label: "Fallback", overridden: over(\.fallbackTagKey), onReset: reset(\.fallbackTagKey)) {
                PropPicker(selection: bind(\.fallbackTagKey)) {
                    ForEach(availableTags, id: \.self) { Text($0).tag($0) }
                }
            }
        }
    }

    /// Maps each editable keypath to its `LabelStyle` Codable key, so a sub-mode
    /// edit can pin exactly that field. Keys match the synthesized CodingKeys.
    static let codingKey: [PartialKeyPath<LabelStyle>: String] = [
        \LabelStyle.enabled: "enabled",
        \LabelStyle.tagKey: "tagKey",
        \LabelStyle.fallbackTagKey: "fallbackTagKey",
        \LabelStyle.fontName: "fontName",
        \LabelStyle.fontWeight: "fontWeight",
        \LabelStyle.fontSize: "fontSize",
        \LabelStyle.opacity: "opacity",
        \LabelStyle.color: "color",
        \LabelStyle.haloColor: "haloColor",
        \LabelStyle.haloWidth: "haloWidth",
        \LabelStyle.typeCase: "typeCase",
        \LabelStyle.tracking: "tracking",
        \LabelStyle.wordSpacing: "wordSpacing",
        \LabelStyle.placement: "placement",
        \LabelStyle.offsetX: "offsetX",
        \LabelStyle.offsetY: "offsetY",
        \LabelStyle.lineLabelMode: "lineLabelMode",
        \LabelStyle.linePosition: "linePosition",
        \LabelStyle.distanceFromLine: "distanceFromLine",
        \LabelStyle.repeatInterval: "repeatInterval",
        \LabelStyle.minSpacing: "minSpacing",
        \LabelStyle.maxCharAngle: "maxCharAngle",
        \LabelStyle.overlapMode: "overlapMode",
        \LabelStyle.showAllLabels: "showAllLabels",
        \LabelStyle.bufferEnabled: "bufferEnabled",
        \LabelStyle.bufferOpacity: "bufferOpacity",
        \LabelStyle.bufferJoinStyle: "bufferJoinStyle",
        \LabelStyle.shadowEnabled: "shadowEnabled",
        \LabelStyle.shadowColor: "shadowColor",
        \LabelStyle.shadowOpacity: "shadowOpacity",
        \LabelStyle.shadowBlur: "shadowBlur",
        \LabelStyle.shadowOffsetX: "shadowOffsetX",
        \LabelStyle.shadowOffsetY: "shadowOffsetY",
        \LabelStyle.calloutsEnabled: "calloutsEnabled",
        \LabelStyle.calloutStyle: "calloutStyle",
        \LabelStyle.calloutColor: "calloutColor",
        \LabelStyle.calloutWidth: "calloutWidth",
        \LabelStyle.calloutMinDistance: "calloutMinDistance",
    ]
}

// MARK: - Font picker

/// Searchable font list, each name set in its own face.
struct FontPickerButton: View {
    @Binding var family: String
    @State private var show = false
    @State private var query = ""

    private static let families = NSFontManager.shared.availableFontFamilies.filter { !$0.hasPrefix(".") }

    var body: some View {
        Button { show.toggle() } label: {
            HStack {
                Text(family.isEmpty ? "System" : family).font(MC.body).lineLimit(1)
                Spacer(minLength: 2)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 8)).foregroundStyle(MC.tertiary)
            }
            .padding(.horizontal, 6).frame(height: MC.controlHeight)
            .background(RoundedRectangle(cornerRadius: 5).fill(MC.field))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $show, arrowEdge: .leading) {
            VStack(spacing: 6) {
                PropTextField(text: $query, placeholder: "Search fonts")
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            ForEach(filtered, id: \.self) { name in
                                Button {
                                    family = name
                                    show = false
                                } label: {
                                    HStack {
                                        Text(name).font(.custom(name, size: 13)).lineLimit(1)
                                        Spacer()
                                        if name == family {
                                            Image(systemName: "checkmark").font(.system(size: 10))
                                        }
                                    }
                                    .padding(.horizontal, 6).frame(height: 26)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .id(name)
                            }
                        }
                    }
                    .onAppear { proxy.scrollTo(family, anchor: .center) }
                }
            }
            .padding(8)
            .frame(width: 240, height: 340)
            .presentationBackground(MC.panel)
        }
    }

    private var filtered: [String] {
        query.isEmpty ? Self.families : Self.families.filter { $0.localizedCaseInsensitiveContains(query) }
    }
}

// MARK: - Anchor grid

struct AnchorGrid: View {
    @Binding var placement: LabelPlacement

    private let options: [[LabelPlacement]] = [
        [.topLeft, .top, .topRight],
        [.left, .center, .right],
        [.bottomLeft, .bottom, .bottomRight],
    ]

    var body: some View {
        VStack(spacing: 2) {
            ForEach(0..<3, id: \.self) { r in
                HStack(spacing: 2) {
                    ForEach(0..<3, id: \.self) { c in
                        let option = options[r][c]
                        Button { placement = option } label: {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(placement.normalized == option ? Color.accentColor : MC.field)
                                .frame(width: 18, height: 14)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help(option.displayName)
                    }
                }
            }
        }
    }
}
