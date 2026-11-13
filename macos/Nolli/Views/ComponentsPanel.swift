import SwiftUI
import UniformTypeIdentifiers

struct ComponentsPanel: View {
    @ObservedObject var appState: AppState
    @State private var selectedIconId: UUID? = nil
    @State private var iconTab: IconTab = .icons

    enum IconTab { case icons, textStyles }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Sub-tab picker
            PropSegments(selection: $iconTab) {
                Text("Icons").tag(IconTab.icons)
                Text("Text Styles").tag(IconTab.textStyles)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            if iconTab == .icons {
                iconsTab
            } else {
                textStylesPlaceholder
            }
        }
    }

    // MARK: - Icons tab

    private var iconsTab: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Toolbar
            HStack {
                SecondaryButton(title: "Import SVG…", systemImage: "square.and.arrow.down") { importSVGs() }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)

            Divider()

            if appState.iconLibrary.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "photo.badge.plus")
                        .font(.system(size: 22)).foregroundStyle(.tertiary)
                    Text("Import SVG files\nto build your icon library")
                        .font(MC.body)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(68), spacing: 6), count: 3),
                              spacing: 8) {
                        ForEach(appState.iconLibrary) { icon in
                            IconCell(icon: icon, isSelected: selectedIconId == icon.id)
                                .onTapGesture { selectedIconId = icon.id }
                                .contextMenu {
                                    Button("Delete", role: .destructive) {
                                        appState.iconLibrary.removeAll { $0.id == icon.id }
                                        if selectedIconId == icon.id { selectedIconId = nil }
                                    }
                                }
                        }
                    }
                    .padding(12)
                }

                if let icon = appState.iconLibrary.first(where: { $0.id == selectedIconId }) {
                    Divider()
                    IconSettingsPanel(icon: Binding(
                        get: { icon },
                        set: { updated in
                            if let idx = appState.iconLibrary.firstIndex(where: { $0.id == icon.id }) {
                                appState.iconLibrary[idx] = updated
                            }
                        }
                    ))
                }
            }
        }
    }

    // MARK: - Text Styles tab

    private var textStylesPlaceholder: some View {
        VStack(alignment: .leading, spacing: 0) {
            if appState.textStyles.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "textformat")
                        .font(.system(size: 22)).foregroundStyle(.tertiary)
                    Text("No styles yet.\nSave a style from the Label Inspector.")
                        .font(MC.body).multilineTextAlignment(.center).foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity).padding()
            } else {
                List {
                    ForEach($appState.textStyles) { $ts in
                        TextStyleRow(style: $ts, onDelete: {
                            appState.textStyles.removeAll { $0.id == ts.id }; appState.isDirty = true
                        })
                    }
                }
                .listStyle(.plain)
            }
        }
    }

    // MARK: - Import

    private func importSVGs() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [UTType(filenameExtension: "svg") ?? .data]
        panel.allowsMultipleSelection = true
        panel.begin { response in
            guard response == .OK else { return }
            for url in panel.urls {
                guard let data = try? Data(contentsOf: url) else { continue }
                let name = url.deletingPathExtension().lastPathComponent
                let icon = SVGIcon(name: name, svgData: data)
                DispatchQueue.main.async {
                    appState.iconLibrary.append(icon)
                    appState.isDirty = true
                }
            }
        }
    }
}

// MARK: - Icon cell

struct IconCell: View {
    let icon: SVGIcon
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 4) {
            SVGPreview(svgData: icon.svgData)
                .frame(width: 44, height: 44)
                .background(MC.field)
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
                )

            Text(icon.name)
                .font(.system(size: 9))
                .lineLimit(1)
                .foregroundStyle(.secondary)
        }
        .frame(width: 60)
        .padding(4)
        .background(isSelected ? Color.accentColor.opacity(0.1) : .clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }
}

// MARK: - SVG preview

struct SVGPreview: View {
    let svgData: Data
    var body: some View {
        if let img = SVGRaster.image(from: svgData) {
            Image(nsImage: img).resizable().aspectRatio(contentMode: .fit).padding(3)
        } else {
            Image(systemName: "questionmark.square.dashed").foregroundStyle(MC.tertiary)
        }
    }
}

// MARK: - Icon settings panel

struct IconSettingsPanel: View {
    @Binding var icon: SVGIcon

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Name").font(MC.body).frame(width: 80, alignment: .leading)
                TextField("", text: $icon.name)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Text("Size").font(MC.body).frame(width: 80, alignment: .leading)
                TextField("", value: $icon.width, format: .number)
                    .frame(width: 46).textFieldStyle(.roundedBorder)
                Text("×").font(MC.body).foregroundStyle(.secondary)
                TextField("", value: $icon.height, format: .number)
                    .frame(width: 46).textFieldStyle(.roundedBorder)
                Text("u").font(MC.body).foregroundStyle(.secondary)
                Spacer()
                Toggle("Lock", isOn: $icon.lockAspect)
                    .toggleStyle(.checkbox).font(MC.body)
            }

            HStack {
                Text("Opacity").font(MC.body).frame(width: 80, alignment: .leading)
                Slider(value: $icon.opacity, in: 0...1).frame(maxWidth: .infinity)
                Text("\(Int(icon.opacity * 100))%")
                    .font(MC.body).foregroundStyle(.secondary).frame(width: 34)
            }
        }
        .padding(12)
        .background(MC.field)
    }
}

// MARK: - Text style row (used in ComponentsPanel Text Styles tab)

struct TextStyleRow: View {
    @Binding var style: TextStyle
    var onDelete: () -> Void
    @State private var isEditing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(style.name).font(MC.body).fontWeight(.medium)
                    Text("\(style.fontName) · \(style.fontWeight) · \(Int(style.fontSize))pt · \(style.color.hex)")
                        .font(MC.body).foregroundStyle(.secondary)
                }
                Spacer()
                Button(isEditing ? "Done" : "Edit") { isEditing.toggle() }
                    .font(MC.body).buttonStyle(.plain).foregroundStyle(.blue)
                Button("Delete", role: .destructive) { onDelete() }
                    .font(MC.body).buttonStyle(.plain).foregroundStyle(.red)
            }
            .padding(.vertical, 6)

            if isEditing {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("Name").font(MC.body).frame(width: 64, alignment: .leading)
                        TextField("", text: $style.name).textFieldStyle(.roundedBorder)
                    }
                    HStack {
                        Text("Font").font(MC.body).frame(width: 64, alignment: .leading)
                        Picker("", selection: $style.fontName) {
                            let fonts = NSFontManager.shared.availableFontFamilies.filter { !$0.hasPrefix(".") }
                            ForEach(fonts, id: \.self) { Text($0).font(.custom($0, size: 12)) }
                        }
                        .labelsHidden().frame(maxWidth: .infinity)
                    }
                    HStack {
                        Text("Size").font(MC.body).frame(width: 64, alignment: .leading)
                        Slider(value: $style.fontSize, in: 5...36).frame(maxWidth: .infinity)
                        Text("\(Int(style.fontSize))pt").font(MC.body).foregroundStyle(.secondary).frame(width: 34)
                    }
                    HStack {
                        Text("Color").font(MC.body).frame(width: 64, alignment: .leading)
                        ColorWell(color: $style.color)
                    }
                }
                .padding(8)
                .background(RoundedRectangle(cornerRadius: 6).fill(MC.field))
                .padding(.bottom, 6)
            }
        }
    }
}
