import SwiftUI
import AppKit

// MARK: - Colour row (swatch · hex · opacity)

/// The standard colour control: swatch and hex, plus optional opacity. Clicking
/// opens the colour panel.
struct ColorRow: View {
    let label: String
    @Binding var color: CodableColor
    var opacity: Binding<Double>? = nil
    var overridden = false
    var onReset: (() -> Void)? = nil

    var body: some View {
        PropRow(label: label, overridden: overridden, onReset: onReset) {
            ColorWell(color: $color)
            if let opacity {
                PercentInput(value: opacity).frame(width: 52)
            }
        }
    }
}

struct ColorWell: View {
    @Binding var color: CodableColor
    var showHex = true
    @State private var showPanel = false

    var body: some View {
        Button { showPanel.toggle() } label: {
            HStack(spacing: 6) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(color.color)
                    .frame(width: 16, height: 16)
                    .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(MC.hairline, lineWidth: 1))
                if showHex {
                    Text(color.hex.replacingOccurrences(of: "#", with: ""))
                        .font(MC.mono)
                        .foregroundStyle(.primary)
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 4)
            .frame(height: MC.controlHeight)
            .frame(maxWidth: showHex ? .infinity : nil)
            .background(RoundedRectangle(cornerRadius: 5).fill(MC.field))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .popover(isPresented: $showPanel, arrowEdge: .leading) {
            ColorPanelView(color: $color)
            .presentationBackground(MC.panel)
        }
    }
}

// MARK: - Colour panel

private enum ColorPanelTab: String, CaseIterable { case color = "Color", schemes = "Schemes" }
private enum ColorMode: String, CaseIterable { case hex = "HEX", rgb = "RGB", hsb = "HSB", cmyk = "CMYK" }

struct ColorPanelView: View {
    @Binding var color: CodableColor
    @State private var tab: ColorPanelTab = .color
    @State private var mode: ColorMode = .hex
    // Kept separately so hue survives passing through black, white and grey.
    @State private var hue = 0.0
    @State private var sat = 0.0
    @State private var bri = 0.0
    @State private var hexText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PropSegments(selection: $tab) {
                ForEach(ColorPanelTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            if tab == .color {
                HStack(alignment: .top, spacing: 12) {
                    editor.frame(width: 208)
                    Rectangle().fill(MC.hairline).frame(width: 1)
                    if let st = AppState.active {
                        SwatchesColumn(appState: st, current: $color)
                    }
                }
            } else if let st = AppState.active {
                SchemesPanel(appState: st).frame(width: 300)
            }
        }
        .padding(12)
        .onAppear { syncFromColor(force: true) }
        .onChange(of: color) { _, _ in syncFromColor(force: false) }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 8) {
            SaturationBrightnessField(hue: hue, sat: sat, bri: bri) { s, b in
                sat = s; bri = b; pushHSB()
            }
            .frame(height: 130)
            HueStrip(hue: Binding(get: { hue }, set: { hue = $0; pushHSB() }))
                .frame(height: 12)
            AlphaStrip(color: color, alpha: Binding(get: { color.a }, set: { color.a = $0 }))
                .frame(height: 12)

            PropSegments(selection: $mode) {
                ForEach(ColorMode.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            switch mode {
            case .hex:
                HStack(spacing: 6) {
                    Text("#").font(MC.mono).foregroundStyle(MC.tertiary)
                    TextField("", text: $hexText)
                        .textFieldStyle(.plain).font(MC.mono)
                        .onSubmit(applyHex)
                }
                .padding(.horizontal, 6)
                .frame(height: MC.controlHeight)
                .background(RoundedRectangle(cornerRadius: 5).fill(MC.field))
            case .rgb:
                channels([("R", rgb(\.r), 255), ("G", rgb(\.g), 255), ("B", rgb(\.b), 255)])
            case .hsb:
                channels([("H", Binding(get: { hue }, set: { hue = $0; pushHSB() }), 360),
                          ("S", Binding(get: { sat }, set: { sat = $0; pushHSB() }), 100),
                          ("B", Binding(get: { bri }, set: { bri = $0; pushHSB() }), 100)])
            case .cmyk:
                channels([("C", cmyk(0), 100), ("M", cmyk(1), 100), ("Y", cmyk(2), 100), ("K", cmyk(3), 100)])
            }
            HStack {
                Text("Opacity").font(MC.body).foregroundStyle(MC.secondary)
                Spacer()
                PercentInput(value: Binding(get: { color.a }, set: { color.a = $0 })).frame(width: 60)
            }
        }
    }

    private func channels(_ items: [(String, Binding<Double>, Double)]) -> some View {
        HStack(spacing: 4) {
            ForEach(items, id: \.0) { name, binding, scale in
                NumberInput(value: Binding(get: { binding.wrappedValue * scale },
                                           set: { binding.wrappedValue = $0 / scale }),
                            range: 0...scale, step: 1, digits: 0, prefix: name)
            }
        }
    }

    private func rgb(_ kp: WritableKeyPath<CodableColor, Double>) -> Binding<Double> {
        Binding(get: { color[keyPath: kp] }, set: { color[keyPath: kp] = $0 })
    }

    private func cmyk(_ i: Int) -> Binding<Double> {
        func values() -> [Double] {
            let k = 1 - max(color.r, color.g, color.b)
            guard k < 1 else { return [0, 0, 0, 1] }
            return [(1 - color.r - k) / (1 - k), (1 - color.g - k) / (1 - k), (1 - color.b - k) / (1 - k), k]
        }
        return Binding(get: { values()[i] }, set: { nv in
            var v = values(); v[i] = nv
            color.r = (1 - v[0]) * (1 - v[3])
            color.g = (1 - v[1]) * (1 - v[3])
            color.b = (1 - v[2]) * (1 - v[3])
        })
    }

    private func pushHSB() {
        let c = NSColor(hue: hue, saturation: sat, brightness: bri, alpha: 1).usingColorSpace(.sRGB) ?? .black
        color.r = c.redComponent; color.g = c.greenComponent; color.b = c.blueComponent
    }

    private func syncFromColor(force: Bool) {
        hexText = color.hex.replacingOccurrences(of: "#", with: "")
        let c = NSColor(srgbRed: color.r, green: color.g, blue: color.b, alpha: 1)
        var h: CGFloat = 0, s: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getHue(&h, saturation: &s, brightness: &b, alpha: &a)
        // Only adopt values that actually differ, so dragging at S=0 keeps hue.
        let cur = NSColor(hue: hue, saturation: sat, brightness: bri, alpha: 1).usingColorSpace(.sRGB) ?? .black
        let same = abs(cur.redComponent - color.r) < 0.003 && abs(cur.greenComponent - color.g) < 0.003
            && abs(cur.blueComponent - color.b) < 0.003
        if force || !same {
            bri = b
            sat = b > 0 ? s : sat
            if s > 0 { hue = h }
        }
    }

    private func applyHex() {
        var s = hexText.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else {
            hexText = color.hex.replacingOccurrences(of: "#", with: "")
            return
        }
        color.r = Double((v >> 16) & 0xFF) / 255
        color.g = Double((v >> 8) & 0xFF) / 255
        color.b = Double(v & 0xFF) / 255
    }
}

private struct SaturationBrightnessField: View {
    let hue: Double, sat: Double, bri: Double
    let onChange: (Double, Double) -> Void
    var body: some View {
        GeometryReader { g in
            ZStack {
                Color(hue: hue, saturation: 1, brightness: 1)
                LinearGradient(colors: [.white, .white.opacity(0)], startPoint: .leading, endPoint: .trailing)
                LinearGradient(colors: [.black.opacity(0), .black], startPoint: .top, endPoint: .bottom)
                Circle().strokeBorder(.white, lineWidth: 2)
                    .background(Circle().strokeBorder(.black.opacity(0.3), lineWidth: 3))
                    .frame(width: 12, height: 12)
                    .position(x: CGFloat(sat) * g.size.width, y: CGFloat(1 - bri) * g.size.height)
            }
            .clipShape(RoundedRectangle(cornerRadius: 5))
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { v in
                onChange(Double(min(max(v.location.x / g.size.width, 0), 1)),
                         Double(1 - min(max(v.location.y / g.size.height, 0), 1)))
            })
        }
    }
}

private struct HueStrip: View {
    @Binding var hue: Double
    var body: some View {
        GeometryReader { g in
            LinearGradient(colors: stride(from: 0.0, through: 1.0, by: 1.0 / 6).map {
                Color(hue: $0, saturation: 1, brightness: 1)
            }, startPoint: .leading, endPoint: .trailing)
            .clipShape(Capsule())
            .overlay(alignment: .leading) { thumb.offset(x: CGFloat(hue) * (g.size.width - 12)) }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged {
                hue = Double(min(max($0.location.x / g.size.width, 0), 0.9999))
            })
        }
    }
    private var thumb: some View {
        Circle().strokeBorder(.white, lineWidth: 2).frame(width: 12, height: 12).shadow(radius: 1)
    }
}

private struct AlphaStrip: View {
    let color: CodableColor
    @Binding var alpha: Double
    var body: some View {
        GeometryReader { g in
            LinearGradient(colors: [Color(red: color.r, green: color.g, blue: color.b, opacity: 0),
                                    Color(red: color.r, green: color.g, blue: color.b, opacity: 1)],
                           startPoint: .leading, endPoint: .trailing)
            .background(Color.primary.opacity(0.08))
            .clipShape(Capsule())
            .overlay(alignment: .leading) {
                Circle().strokeBorder(.white, lineWidth: 2).frame(width: 12, height: 12).shadow(radius: 1)
                    .offset(x: CGFloat(alpha) * (g.size.width - 12))
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged {
                alpha = Double(min(max($0.location.x / g.size.width, 0), 1))
            })
        }
    }
}

// MARK: - Swatches

private struct SwatchesColumn: View {
    @ObservedObject var appState: AppState
    @Binding var current: CodableColor

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Swatches").font(MC.title)
                Spacer()
                IconButton(systemName: "plus", size: 10, help: "Save this colour as a swatch") {
                    appState.colorSwatches.append(current)
                    appState.isDirty = true
                }
            }
            if appState.colorSwatches.isEmpty {
                Hint("Press + to keep the current colour here.")
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(20), spacing: 5), count: 4),
                              alignment: .leading, spacing: 5) {
                        ForEach(Array(appState.colorSwatches.enumerated()), id: \.offset) { idx, sw in
                            Button { current = sw } label: {
                                RoundedRectangle(cornerRadius: 4).fill(sw.color)
                                    .frame(width: 20, height: 20)
                                    .overlay(RoundedRectangle(cornerRadius: 4)
                                        .strokeBorder(sw == current ? Color.accentColor : MC.hairline,
                                                      lineWidth: sw == current ? 2 : 1))
                            }
                            .buttonStyle(.plain)
                            .contextMenu {
                                Button("Delete Swatch", role: .destructive) {
                                    appState.colorSwatches.remove(at: idx)
                                    appState.isDirty = true
                                }
                            }
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .frame(width: 100)
    }
}

// MARK: - Whole-map colour schemes

private struct SchemesPanel: View {
    @ObservedObject var appState: AppState
    @State private var newName = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Hint("A scheme stores every colour on the map: lines, fills, labels and background. Switch palettes in one click.")
            HStack(spacing: 6) {
                PropTextField(text: $newName, placeholder: "Scheme name")
                Button("Save Current") {
                    let name = newName.isEmpty ? "Scheme \(appState.colorSchemes.count + 1)" : newName
                    appState.colorSchemes.append(appState.captureColorScheme(named: name))
                    appState.isDirty = true
                    newName = ""
                }
                .controlSize(.small)
            }
            if appState.colorSchemes.isEmpty {
                Hint("No schemes saved yet.").padding(.top, 2)
            } else {
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(appState.colorSchemes) { scheme in
                            HStack(spacing: 8) {
                                HStack(spacing: 1) {
                                    ForEach(Array(paletteSample(scheme).enumerated()), id: \.offset) { _, c in
                                        Rectangle().fill(c.color).frame(width: 9, height: 16)
                                    }
                                }
                                .clipShape(RoundedRectangle(cornerRadius: 3))
                                Text(scheme.name).font(MC.body).lineLimit(1)
                                Spacer()
                                Button("Apply") { appState.applyColorScheme(scheme) }.controlSize(.mini)
                                Menu {
                                    Button("Update from Current Colors") {
                                        if let i = appState.colorSchemes.firstIndex(where: { $0.id == scheme.id }) {
                                            let name = appState.colorSchemes[i].name
                                            let id = appState.colorSchemes[i].id
                                            appState.colorSchemes[i] = appState.captureColorScheme(named: name)
                                            appState.colorSchemes[i].id = id
                                            appState.isDirty = true
                                        }
                                    }
                                    Button("Delete", role: .destructive) {
                                        appState.colorSchemes.removeAll { $0.id == scheme.id }
                                        appState.isDirty = true
                                    }
                                } label: {
                                    Image(systemName: "ellipsis").font(.system(size: 10))
                                }
                                .menuStyle(.borderlessButton).menuIndicator(.hidden).frame(width: 18)
                            }
                            .padding(.vertical, 3)
                        }
                    }
                }
                .frame(maxHeight: 220)
            }
        }
    }

    private func paletteSample(_ scheme: MapColorScheme) -> [CodableColor] {
        var seen = Set<String>(), out: [CodableColor] = []
        for key in scheme.colors.keys.sorted() {
            guard let c = scheme.colors[key], seen.insert(c.hex).inserted else { continue }
            out.append(c)
            if out.count == 6 { break }
        }
        return out
    }
}
