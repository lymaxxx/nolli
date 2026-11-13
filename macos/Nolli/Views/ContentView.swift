import SwiftUI
import AppKit

struct ContentView: View {
    @StateObject private var appState = AppState()

    var body: some View {
        VStack(spacing: 0) {
            TopBar(appState: appState)
            HStack(spacing: 0) {
                if !appState.panelsHidden {
                    LayerPanel(appState: appState)
                        .frame(width: MC.leftWidth)
                        .background(MC.panel)
                        .overlay(alignment: .trailing) { Rectangle().fill(MC.hairline).frame(width: 1) }
                        .transition(.move(edge: .leading))
                }
                MapArea(appState: appState)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                if !appState.panelsHidden {
                    RightPanel(appState: appState)
                        .frame(width: MC.rightWidth)
                        .background(MC.panel)
                        .overlay(alignment: .leading) { Rectangle().fill(MC.hairline).frame(width: 1) }
                        .transition(.move(edge: .trailing))
                }
            }
            StatusBar(appState: appState, camera: appState.camera)
        }
        .ignoresSafeArea(.container, edges: .top)
        .frame(minWidth: 1000, minHeight: 620)
        .sheet(isPresented: $appState.showExportSheet) {
            ExportSheet(appState: appState, isPresented: $appState.showExportSheet)
        }
        .sheet(isPresented: $appState.showSettingsSheet) {
            SettingsView(appState: appState)
        }
        .onChange(of: appState.canvasMode) { _, mode in
            if mode == .edit { appState.beginEditSession() }
        }
        .onChange(of: appState.boundingBox) { _, _ in appState.boundingBoxChanged() }
        .onChange(of: appState.selectedSignId) { _, _ in appState.viewportSignSide = nil }
        .onChange(of: appState.rightTab) { _, tab in
            if tab != .signs { appState.viewportSignSide = nil; appState.isPlacingSign = false }
        }
    }
}

// MARK: - Map area

private struct MapArea: View {
    @ObservedObject var appState: AppState

    var body: some View {
        ZStack {
            MapSurface(appState: appState)

            if let side = appState.viewportSignSide,
               let id = appState.selectedSignId,
               let idx = appState.signOutputs.firstIndex(where: { $0.id == id }) {
                signPreview(idx: idx, side: side)
            } else {
                VStack {
                    MapHint(appState: appState).padding(.top, 12)
                    Spacer()
                    HStack(alignment: .bottom) {
                        if appState.settings.showTileBackground {
                            Text("© OpenStreetMap contributors")
                                .font(.system(size: 9))
                                .padding(.horizontal, 5).padding(.vertical, 2)
                                .background(.white.opacity(0.75), in: RoundedRectangle(cornerRadius: 3))
                                .foregroundStyle(.black.opacity(0.7))
                        }
                        Spacer()
                        MapHUD(appState: appState, camera: appState.camera)
                    }
                    .padding(10)
                }
            }

            if appState.isFetchingAll {
                VStack {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(appState.statusMessage).font(MC.body)
                        Button("Cancel") { appState.currentFetchTask?.cancel() }
                            .buttonStyle(.plain).font(MC.body).foregroundStyle(Color.accentColor)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(MC.panel, in: RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.18), radius: 8, y: 2)
                    .padding(.top, 48)
                    Spacer()
                }
            }
        }
    }

    private func signPreview(idx: Int, side: SignSide) -> some View {
        let sign = appState.signOutputs[idx]
        let rot = side == .front ? sign.rotation : sign.backRotation
        return ZStack(alignment: .topTrailing) {
            Rectangle().fill(Color(NSColor.underPageBackgroundColor))
            DraggableSignPreview(sign: $appState.signOutputs[idx], displayRotation: rot,
                                 layers: appState.layers, baseZoom: appState.baseZoom,
                                 iconLibrary: appState.iconLibrary, artworkScale: appState.signArtworkScale,
                                 labelsVersion: appState.labelsVersion)
                .aspectRatio(sign.widthMM / max(sign.heightMM, 1), contentMode: .fit)
                .shadow(color: .black.opacity(0.25), radius: 14, y: 5)
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .help("Drag to reposition the map within the sign")
            Button("Back to Map") { appState.viewportSignSide = nil }
                .controlSize(.small).padding(12)
        }
    }
}

/// Contextual guidance so each mode explains itself.
private struct MapHint: View {
    @ObservedObject var appState: AppState

    private var text: String? {
        if appState.isPlacingSign { return "Click the map to place a sign · Esc to cancel" }
        switch appState.canvasMode {
        case .selectArea:
            return "Drag to draw the area to download · Esc to cancel"
        case .edit:
            switch appState.selectedItem {
            case .none:
                return "Select a layer on the left to edit it"
            case .labelChild, .subtypeLabel:
                return "Drag a dot: road names slide along their road, others move freely · Delete removes a road name"
            case .symbolChild:
                return "Drag a dot to move an icon"
            case .layer, .roadSubLayer:
                return "Click a shape to show its points, then drag them · hold Space to pan"
            }
        case .pan:
            return appState.boundingBox == nil && appState.layers.isEmpty
                ? "Search for a place, then draw an area with the Bounding Box tool (B)" : nil
        }
    }

    var body: some View {
        if let text {
            Text(text)
                .font(MC.body)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(MC.panel, in: Capsule())
                .shadow(color: .black.opacity(0.15), radius: 6, y: 1)
                .allowsHitTesting(false)
        }
    }
}

/// Zoom, fit and compass controls floating over the map.
private struct MapHUD: View {
    @ObservedObject var appState: AppState
    @ObservedObject var camera: MapCamera

    var body: some View {
        HStack(spacing: 2) {
            IconButton(systemName: "location.north.fill", size: 11, help: "Reset north (⌘0). Option-drag or twist two fingers to rotate.") {
                camera.animate.send(CameraTarget(lat: camera.centerLat, lon: camera.centerLon,
                                                 zoom: camera.zoom, rotation: 0))
            }
            .rotationEffect(.degrees(-camera.rotation))
            if let b = appState.boundingBox {
                IconButton(systemName: "viewfinder", help: "Zoom to selected area (⌘1)") { camera.fit(b) }
            }
            Rectangle().fill(MC.hairline).frame(width: 1, height: 14)
            IconButton(systemName: "minus", help: "Zoom out") { step(-1) }
            Text("\(Int(camera.zoom.rounded()))")
                .font(MC.mono).foregroundStyle(MC.secondary).frame(minWidth: 18)
            IconButton(systemName: "plus", help: "Zoom in") { step(+1) }
        }
        .padding(3)
        .background(MC.panel, in: RoundedRectangle(cornerRadius: 8))
        .shadow(color: .black.opacity(0.18), radius: 6, y: 1)
    }

    private func step(_ d: Double) {
        camera.animate.send(CameraTarget(lat: camera.centerLat, lon: camera.centerLon,
                                         zoom: max(MapCamera.minZoom, min(MapCamera.maxZoom, camera.zoom + d)),
                                         rotation: nil))
    }
}

// MARK: - Status bar

private struct StatusBar: View {
    @ObservedObject var appState: AppState
    @ObservedObject var camera: MapCamera

    var body: some View {
        HStack(spacing: 14) {
            if let c = camera.mouse {
                Text(String(format: "%.5f, %.5f", c.lat, c.lon)).font(.system(size: 10, design: .monospaced))
            }
            Text(String(format: "Zoom %.1f", camera.zoom)).font(.system(size: 10))
            if abs(camera.rotation) > 0.05 {
                Text(String(format: "%.0f°", camera.rotation)).font(.system(size: 10))
            }
            Spacer()
            Text(appState.statusMessage).font(.system(size: 10)).lineLimit(1)
        }
        .foregroundStyle(MC.secondary)
        .padding(.horizontal, 10)
        .frame(height: 22)
        .background(MC.panel)
        .overlay(alignment: .top) { Rectangle().fill(MC.hairline).frame(height: 1) }
    }
}

// MARK: - Top bar

struct TopBar: View {
    @ObservedObject var appState: AppState

    private var title: String {
        let name = appState.projectURL?.deletingPathExtension().lastPathComponent ?? "Untitled"
        return appState.isDirty ? "\(name) — Edited" : name
    }

    var body: some View {
        HStack(spacing: 10) {
            // Sidebar collapse: on its own, not part of any group.
            BarButton(systemName: "sidebar.left", active: false,
                      help: appState.panelsHidden ? "Show panels (⌘\\)" : "Hide panels (⌘\\)") {
                withAnimation(.easeInOut(duration: 0.2)) { appState.panelsHidden.toggle() }
            }
            .padding(.leading, 78)     // clear of the window controls

            SearchField(appState: appState)

            Text(title).font(MC.body).foregroundStyle(MC.secondary).lineLimit(1)
                .frame(minWidth: 40, maxWidth: .infinity)
                .allowsHitTesting(false)

            // (drag | edit | bounding box)
            BarGroup {
                BarButton(systemName: "hand.raised", active: appState.canvasMode == .pan, help: "Drag (H)") {
                    appState.canvasMode = .pan
                }
                BarButton(systemName: "pencil", active: appState.canvasMode == .edit, help: "Edit points of the selected layer (E)") {
                    appState.canvasMode = .edit
                }
                BarButton(systemName: "rectangle.dashed", active: appState.canvasMode == .selectArea, help: "Bounding box: draw the area to download (B)") {
                    appState.canvasMode = .selectArea
                }
            }

            if appState.canvasMode == .edit, appState.editSessionDirty {
                HStack(spacing: 6) {
                    Button("Revert All") { appState.revertEditSession() }
                        .buttonStyle(.bordered).tint(.red).controlSize(.small)
                        .help("Throw away every change since entering edit mode")
                    Button("Save") { appState.commitEditSession() }
                        .buttonStyle(.borderedProminent).tint(.blue).controlSize(.small)
                        .help("Keep the changes made in edit mode")
                }
            }

            // (fetch)
            BarGroup {
                BarButton(systemName: "arrow.clockwise", active: false,
                          enabled: appState.boundingBox != nil && !appState.isFetchingAll && !appState.layers.isEmpty,
                          help: "Fetch OSM data for all layers in the selected area") {
                    appState.fetchAll()
                }
            }

            // (document | export)
            BarGroup {
                Menu {
                    Button("New Project") { appState.newProject() }
                    Button("Open…") { appState.openProject() }
                    Divider()
                    Button("Save") { appState.saveProject() }
                    Button("Save As…") { appState.saveProjectAs() }
                } label: {
                    Image(systemName: "doc").font(.system(size: 13)).foregroundStyle(MC.secondary)
                        .frame(width: 30, height: 28)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .frame(width: 30, height: 28)
                .help("Document")
                BarButton(systemName: "square.and.arrow.up", active: false,
                          enabled: !appState.layers.isEmpty, help: "Export (⇧⌘E)") {
                    appState.showExportSheet = true
                }
            }

            // (style | sign)
            BarGroup {
                BarButton(systemName: "slider.horizontal.3",
                          active: !appState.panelsHidden && appState.rightTab == .design,
                          help: "Style: frame settings and the style of the selected layer") {
                    appState.selectedItem = nil
                    appState.rightTab = .design
                    if appState.panelsHidden {
                        withAnimation(.easeInOut(duration: 0.2)) { appState.panelsHidden = false }
                    }
                }
                BarButton(systemName: "signpost.right",
                          active: !appState.panelsHidden && appState.rightTab == .signs,
                          help: "Signs") {
                    appState.rightTab = appState.rightTab == .signs && !appState.panelsHidden ? .design : .signs
                    if appState.panelsHidden {
                        withAnimation(.easeInOut(duration: 0.2)) { appState.panelsHidden = false }
                    }
                }
            }

            // (settings)
            BarGroup {
                BarButton(systemName: "gearshape", active: false, help: "Settings") {
                    appState.showSettingsSheet = true
                }
            }
        }
        .padding(.trailing, 10)
        .frame(height: MC.barHeight)
        .background {
            MC.panel.gesture(WindowDragGesture())
        }
        .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }
    }
}

private struct BarGroup<Content: View>: View {
    @ViewBuilder var content: () -> Content
    var body: some View {
        HStack(spacing: 1) { content() }
            .padding(2)
            .background(RoundedRectangle(cornerRadius: 8).fill(MC.field))
    }
}

private struct BarButton: View {
    let systemName: String
    var active: Bool
    var enabled = true
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 13))
                .foregroundStyle(active ? Color.white : (enabled ? MC.secondary : MC.tertiary))
                .frame(width: 30, height: 28)
                .background(RoundedRectangle(cornerRadius: 6)
                    .fill(active ? Color.accentColor : (hovering && enabled ? MC.hover : .clear)))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .onHover { hovering = $0 }
        .help(help)
    }
}

private struct SearchField: View {
    @ObservedObject var appState: AppState

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "magnifyingglass").font(.system(size: 11)).foregroundStyle(MC.tertiary)
            TextField("Search location", text: $appState.searchText)
                .textFieldStyle(.plain)
                .font(.system(size: 12))
                .onSubmit { appState.geocode() }
                .onChange(of: appState.searchText) { _, t in
                    if t.isEmpty { appState.geocodeResults = [] }
                }
        }
        .padding(.horizontal, 8)
        .frame(width: 210, height: 28)
        .background(RoundedRectangle(cornerRadius: 7).fill(MC.field))
        .popover(isPresented: Binding(
            get: { !appState.geocodeResults.isEmpty },
            set: { if !$0 { appState.geocodeResults = [] } }
        ), arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(appState.geocodeResults, id: \.displayName) { r in
                    SearchResultRow(result: r) { appState.choose(r) }
                }
            }
            .padding(4)
            .frame(width: 320)
            .presentationBackground(MC.panel)
        }
    }
}

private struct SearchResultRow: View {
    let result: GeocoderResult
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 1) {
                let parts = result.displayName.components(separatedBy: ", ")
                Text(parts.first ?? result.displayName).font(MC.bodyMedium).lineLimit(1)
                Text(parts.dropFirst().joined(separator: ", ")).font(.system(size: 10))
                    .foregroundStyle(MC.secondary).lineLimit(1)
            }
            .padding(.horizontal, 8).padding(.vertical, 5)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? MC.selected : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

// MARK: - Right panel

struct RightPanel: View {
    @ObservedObject var appState: AppState

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 2) {
                tab("Design", .design)
                tab("Signs", .signs)
                Spacer()
                if appState.rightTab == .signs {
                    IconButton(systemName: "xmark", size: 10, help: "Close signs") { appState.rightTab = .design }
                }
            }
            .padding(.horizontal, 8)
            .frame(height: 36)
            .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }

            if appState.rightTab == .design {
                StyleInspector(appState: appState)
            } else {
                SignsPanel(appState: appState)
            }
        }
    }

    private func tab(_ title: String, _ t: RightPanelTab) -> some View {
        Button { appState.rightTab = t } label: {
            Text(title)
                .font(appState.rightTab == t ? MC.title : MC.body)
                .foregroundStyle(appState.rightTab == t ? Color.primary : MC.secondary)
                .padding(.horizontal, 8).frame(height: 24)
                .background(RoundedRectangle(cornerRadius: 5).fill(appState.rightTab == t ? MC.field : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
