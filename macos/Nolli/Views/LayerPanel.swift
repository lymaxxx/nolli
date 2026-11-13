import SwiftUI

enum LeftPanelTab { case layers, components }

struct LayerPanel: View {
    @ObservedObject var appState: AppState
    @State private var activeTab: LeftPanelTab = .layers

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 2) {
                tab("Layers", .layers)
                tab("Components", .components)
                Spacer()
            }
            .padding(.horizontal, 8)
            .frame(height: 36)
            .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }

            if activeTab == .layers {
                LayersContent(appState: appState)
            } else {
                ComponentsPanel(appState: appState)
            }
        }
    }

    private func tab(_ title: String, _ t: LeftPanelTab) -> some View {
        Button { activeTab = t } label: {
            Text(title)
                .font(activeTab == t ? MC.title : MC.body)
                .foregroundStyle(activeTab == t ? Color.primary : MC.secondary)
                .padding(.horizontal, 8).frame(height: 24)
                .background(RoundedRectangle(cornerRadius: 5).fill(activeTab == t ? MC.field : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Layers tab

/// One visible row of the flattened layer tree.
private struct TreeRow: Identifiable {
    enum Kind {
        case layer
        case sub(UUID)
        case icons
        case labels
        case subLabel(UUID)
    }
    let id: String
    let layer: MapLayer
    let kind: Kind
    let depth: Int
    /// Rows may only be reordered among rows with the same group.
    let group: String?
}

private struct LayersContent: View {
    @ObservedObject var appState: AppState
    @State private var showAdd = false
    @State private var collapsed = Set<String>()
    @State private var frames: [String: CGRect] = [:]
    @State private var dragging: TreeRow? = nil
    @State private var dropTarget: (group: String, index: Int, y: CGFloat)? = nil

    private var rows: [TreeRow] {
        var out: [TreeRow] = []
        for layer in appState.layers {
            let lid = layer.id.uuidString
            out.append(.init(id: "L\(lid)", layer: layer, kind: .layer, depth: 0, group: "top"))
            guard !collapsed.contains("L\(lid)") else { continue }
            if layer.kind == .roads {
                for sub in layer.roadSubLayers {
                    out.append(.init(id: "S\(sub.id)", layer: layer, kind: .sub(sub.id), depth: 1, group: "S\(lid)"))
                }
            }
            if layer.symbolStyle.enabled {
                out.append(.init(id: "I\(lid)", layer: layer, kind: .icons, depth: 1, group: nil))
            }
            if layer.labelStyle.enabled {
                out.append(.init(id: "T\(lid)", layer: layer, kind: .labels, depth: 1, group: nil))
                if layer.kind == .roads, !collapsed.contains("T\(lid)") {
                    for sub in layer.roadSubLayers {
                        out.append(.init(id: "U\(sub.id)", layer: layer, kind: .subLabel(sub.id), depth: 2, group: "S\(lid)"))
                    }
                }
            }
        }
        return out
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Layers").font(MC.title)
                Spacer()
                IconButton(systemName: "plus", help: "Add layer") { showAdd.toggle() }
                    .popover(isPresented: $showAdd, arrowEdge: .bottom) {
                        AddLayerPopover(appState: appState, isPresented: $showAdd)
                        .presentationBackground(MC.panel)
                    }
            }
            .padding(.leading, 12).padding(.trailing, 8)
            .frame(height: 34)

            if appState.layers.isEmpty {
                emptyState
            } else {
                ScrollView {
                    tree
                }
                .onPreferenceChange(RowFrameKey.self) { frames = $0 }
                // Clicking empty space clears the selection, as in Figma.
                .background(Color.clear.contentShape(Rectangle()).onTapGesture { appState.selectedItem = nil })
            }
        }
    }

    private var tree: some View {
        VStack(spacing: 0) {
            ForEach(rows) { row in
                TreeRowView(row: row, layer: row.layer, appState: appState,
                            isCollapsed: collapsed.contains(row.id),
                            toggleCollapse: {
                                if collapsed.contains(row.id) { collapsed.remove(row.id) } else { collapsed.insert(row.id) }
                            })
                .opacity(dragging?.id == row.id ? 0.45 : 1)
                .background(GeometryReader { g in
                    Color.clear.preference(key: RowFrameKey.self,
                                           value: [row.id: g.frame(in: .named("layerTree"))])
                })
                .gesture(row.group == nil ? nil : DragGesture(minimumDistance: 5, coordinateSpace: .named("layerTree"))
                    .onChanged { updateDrag(row: row, y: $0.location.y) }
                    .onEnded { _ in finishDrag() })
            }
        }
        .padding(.horizontal, 6)
        .padding(.bottom, 12)
        .coordinateSpace(name: "layerTree")
        .overlay(alignment: .topLeading) {
            if let t = dropTarget {
                Rectangle().fill(Color.accentColor).frame(height: 2)
                    .padding(.horizontal, 6)
                    .offset(y: t.y - 1)
                    .allowsHitTesting(false)
            }
        }
    }

    private func updateDrag(row: TreeRow, y: CGFloat) {
        dragging = row
        guard let group = row.group else { return }
        // Siblings of the same kind (a sub row only moves among its own list).
        let prefix = String(row.id.prefix(1))
        let siblings = rows.filter { $0.group == group && $0.id.hasPrefix(prefix) }
        var index = 0
        for s in siblings {
            guard let f = frames[s.id] else { continue }
            if y > f.midY { index += 1 }
        }
        let lineY: CGFloat
        if index < siblings.count, let f = frames[siblings[index].id] {
            lineY = f.minY
        } else if group == "top", let last = rows.last, let f = frames[last.id] {
            lineY = f.maxY
        } else if let last = siblings.last, let f = frames[last.id] {
            lineY = f.maxY
        } else {
            lineY = 0
        }
        dropTarget = (group, index, lineY)
    }

    private func finishDrag() {
        defer { dragging = nil; dropTarget = nil }
        guard let row = dragging, let target = dropTarget else { return }
        switch row.kind {
        case .layer:
            guard let from = appState.layers.firstIndex(where: { $0.id == row.layer.id }) else { return }
            guard target.index != from, target.index != from + 1 else { return }
            appState.moveLayer(from: IndexSet(integer: from), to: target.index)
        case .sub(let id), .subLabel(let id):
            guard let from = row.layer.roadSubLayers.firstIndex(where: { $0.id == id }) else { return }
            guard target.index != from, target.index != from + 1 else { return }
            row.layer.roadSubLayers.move(fromOffsets: IndexSet(integer: from), toOffset: target.index)
            appState.documentChanged()
        default:
            break
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            if appState.boundingBox == nil {
                Image(systemName: "rectangle.dashed").font(.system(size: 22)).foregroundStyle(MC.tertiary)
                Text("Choose the area to work on").font(MC.bodyMedium)
                Hint("Move the map to your location, then use the current view or draw a box.")
                    .multilineTextAlignment(.center)
                SecondaryButton(title: "Use Current View", systemImage: "viewfinder") { useCurrentView() }
                SecondaryButton(title: "Draw Area", systemImage: "rectangle.dashed") { appState.canvasMode = .selectArea }
            } else {
                Image(systemName: "square.stack.3d.up").font(.system(size: 22)).foregroundStyle(MC.tertiary)
                Text("Add your first layer").font(MC.bodyMedium)
                Hint("Roads, buildings, water… Data for the selected area downloads automatically.")
                    .multilineTextAlignment(.center)
                SecondaryButton(title: "Add Layer", systemImage: "plus") { showAdd = true }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func useCurrentView() {
        let cam = appState.camera
        let s = cam.viewSize
        let proj = cam.projection
        let c = [CGPoint.zero, CGPoint(x: s.width, y: 0), CGPoint(x: 0, y: s.height), CGPoint(x: s.width, y: s.height)]
            .map { proj.fromScreen($0) }
        appState.boundingBox = BoundingBox(minLat: c.map(\.lat).min()!, minLon: c.map(\.lon).min()!,
                                           maxLat: c.map(\.lat).max()!, maxLon: c.map(\.lon).max()!)
    }
}

private struct RowFrameKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { _, new in new }
    }
}

// MARK: - Row

private struct TreeRowView: View {
    let row: TreeRow
    @ObservedObject var layer: MapLayer
    @ObservedObject var appState: AppState
    let isCollapsed: Bool
    let toggleCollapse: () -> Void

    @State private var hovering = false
    @State private var renaming = false
    @State private var nameDraft = ""

    private var sub: RoadSubLayer? {
        switch row.kind {
        case .sub(let id), .subLabel(let id): return layer.roadSubLayers.first { $0.id == id }
        default: return nil
        }
    }

    private var selection: SelectedItem {
        switch row.kind {
        case .layer: return .layer(layer.id)
        case .sub(let id): return .roadSubLayer(parentId: layer.id, subId: id)
        case .icons: return .symbolChild(parentId: layer.id)
        case .labels: return .labelChild(parentId: layer.id)
        case .subLabel(let id): return .subtypeLabel(parentId: layer.id, subId: id)
        }
    }

    private var isSelected: Bool { appState.selectedItem == selection }

    private var hasChildren: Bool {
        switch row.kind {
        case .layer: return layer.kind == .roads || layer.labelStyle.enabled || layer.symbolStyle.enabled
        case .labels: return layer.kind == .roads
        default: return false
        }
    }

    private var title: String {
        switch row.kind {
        case .layer: return layer.name
        case .sub, .subLabel: return sub?.name ?? ""
        case .icons: return "Icons"
        case .labels: return "Labels"
        }
    }

    private var icon: String {
        switch row.kind {
        case .layer: return layer.kind.icon
        case .sub: return "line.diagonal"
        case .icons: return "star"
        case .labels, .subLabel: return "textformat"
        }
    }

    private var visible: Bool {
        switch row.kind {
        case .layer: return layer.isVisible
        case .sub: return sub?.isVisible ?? true
        case .icons: return layer.symbolStyle.isVisible
        case .labels: return layer.labelStyle.isVisible
        case .subLabel: return sub?.labelStyle?.enabled ?? false
        }
    }

    private var hasOverrides: Bool {
        switch row.kind {
        case .sub:
            // The built-in width hierarchy isn't something the user changed.
            guard let sub else { return false }
            var own = sub.lineOverrides ?? []
            if sub.customStyle.width == sub.defaultWidth { own.remove("width") }
            return !own.isEmpty
        case .subLabel: return !(sub?.labelOverrides ?? []).subtracting(["enabled"]).isEmpty
        default: return false
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if row.depth > 0 { Color.clear.frame(width: CGFloat(row.depth) * 14) }

            Group {
                if hasChildren {
                    Button(action: toggleCollapse) {
                        Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                            .font(.system(size: 8, weight: .semibold))
                            .foregroundStyle(MC.tertiary)
                            .frame(width: 12, height: 20).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                } else {
                    Color.clear.frame(width: 12)
                }
            }

            Image(systemName: icon)
                .font(.system(size: 11))
                .foregroundStyle(row.depth == 0 ? Color.primary.opacity(0.75) : MC.secondary)
                .frame(width: 16)

            if renaming {
                TextField("", text: $nameDraft)
                    .textFieldStyle(.plain).font(MC.body)
                    .onSubmit { commitRename() }
            } else {
                Text(title)
                    .font(row.depth == 0 ? MC.bodyMedium : MC.body)
                    .foregroundStyle(visible ? Color.primary : MC.tertiary)
                    .lineLimit(1)
            }

            if hasOverrides {
                Circle().fill(Color.accentColor).frame(width: 4, height: 4)
                    .help("Has its own settings; the rest follow the master")
            }

            Spacer(minLength: 2)

            if case .layer = row.kind, !hovering { statusBadge }

            if hovering, case .layer = row.kind {
                IconButton(systemName: "trash", size: 10, help: "Delete layer") { appState.removeLayer(layer.id) }
            }
            if hovering, case .icons = row.kind {
                IconButton(systemName: "minus", size: 10, help: "Remove icons from this layer") {
                    layer.symbolStyle.enabled = false
                    if isSelected { appState.selectedItem = .layer(layer.id) }
                    appState.documentChanged()
                }
            }
            if hovering, case .labels = row.kind {
                IconButton(systemName: "minus", size: 10, help: "Remove labels from this layer") {
                    layer.labelStyle.enabled = false
                    layer.syncSubLabelStyles()
                    if isSelected { appState.selectedItem = .layer(layer.id) }
                    appState.documentChanged()
                }
            }
            if hovering || !visible {
                IconButton(systemName: visible ? "eye" : "eye.slash", size: 10,
                           help: visible ? "Hide" : "Show") { toggleVisible() }
            }
        }
        .padding(.horizontal, 6)
        .frame(height: MC.rowHeight)
        .background(RoundedRectangle(cornerRadius: 5)
            .fill(isSelected ? MC.selected : (hovering ? MC.hover : .clear)))
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .onTapGesture(count: 2) { startRename() }
        .simultaneousGesture(TapGesture().onEnded { appState.selectedItem = selection; appState.rightTab = .design })
        .contextMenu { menu }
    }

    @ViewBuilder
    private var statusBadge: some View {
        switch layer.fetchStatus {
        case .fetching:
            ProgressView().controlSize(.mini)
        case .error(let message):
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 10)).foregroundStyle(.orange).help(message)
        case .loaded:
            let n = layer.lineFeatures.count + layer.polygonFeatures.count + layer.pointFeatures.count
            Text("\(n)").font(.system(size: 10)).foregroundStyle(MC.tertiary)
        case .idle:
            EmptyView()
        }
    }

    @ViewBuilder
    private var menu: some View {
        if case .layer = row.kind {
            Button("Rename") { startRename() }
            Button("Fetch This Layer") { appState.fetchSingleLayer(layer) }
            if !layer.labelStyle.enabled {
                Button("Add Labels") {
                    layer.labelStyle.enabled = true
                    layer.syncSubLabelStyles()
                    appState.documentChanged()
                }
            }
            if !layer.symbolStyle.enabled, layer.kind.featureType != .line {
                Button("Add Icons") { layer.symbolStyle.enabled = true; appState.documentChanged() }
            }
            Divider()
            Button("Delete Layer", role: .destructive) { appState.removeLayer(layer.id) }
        }
    }

    private func toggleVisible() {
        switch row.kind {
        case .layer:
            layer.isVisible.toggle()
        case .sub(let id):
            if let i = layer.roadSubLayers.firstIndex(where: { $0.id == id }) {
                layer.roadSubLayers[i].isVisible.toggle()
            }
        case .icons:
            layer.symbolStyle.isVisible.toggle()
        case .labels:
            layer.labelStyle.isVisible.toggle()
        case .subLabel(let id):
            if let i = layer.roadSubLayers.firstIndex(where: { $0.id == id }) {
                var ls = layer.roadSubLayers[i].labelStyle ?? layer.labelStyle
                ls.enabled.toggle()
                layer.roadSubLayers[i].labelStyle = ls
                var ov = layer.roadSubLayers[i].labelOverrides ?? []
                ov.insert("enabled")
                layer.roadSubLayers[i].labelOverrides = ov
            }
        }
        appState.documentChanged()
    }

    private func startRename() {
        switch row.kind {
        case .layer, .sub, .subLabel:
            nameDraft = title
            renaming = true
        default:
            break
        }
    }

    private func commitRename() {
        renaming = false
        let name = nameDraft.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        switch row.kind {
        case .layer:
            layer.name = name
        case .sub(let id), .subLabel(let id):
            if let i = layer.roadSubLayers.firstIndex(where: { $0.id == id }) {
                layer.roadSubLayers[i].name = name
            }
        default:
            break
        }
        appState.documentChanged()
    }
}

// MARK: - Add layer

struct AddLayerPopover: View {
    @ObservedObject var appState: AppState
    @Binding var isPresented: Bool

    private let sections: [(title: String, kinds: [LayerKind])] = [
        ("Roads",              [.roads]),
        ("Areas",              [.parks, .water, .buildings, .pedestrianZones, .plazas, .parking]),
        ("Points of interest", [.landmarks, .transport, .dining, .accommodation,
                                .healthcare, .shopping, .education]),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(sections, id: \.title) { section in
                    Text(section.title)
                        .font(MC.title).foregroundStyle(MC.secondary)
                        .padding(.horizontal, 8).padding(.top, 8).padding(.bottom, 3)
                    ForEach(section.kinds) { kind in
                        AddLayerRow(kind: kind) {
                            appState.addLayer(kind)
                            if let layer = appState.layers.first, appState.boundingBox != nil {
                                appState.fetchSingleLayer(layer)
                            }
                            isPresented = false
                        }
                    }
                }
            }
            .padding(6)
        }
        .frame(width: 210, height: 430)
    }
}

private struct AddLayerRow: View {
    let kind: LayerKind
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: kind.icon).font(.system(size: 11))
                    .foregroundStyle(kind.defaultColor.color).frame(width: 18)
                Text(kind.displayName).font(MC.body)
                Spacer()
            }
            .padding(.horizontal, 8).frame(height: 26)
            .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? MC.selected : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}
