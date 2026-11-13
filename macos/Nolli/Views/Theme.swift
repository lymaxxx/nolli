import SwiftUI
import AppKit

// MARK: - Design tokens

enum MC {
    static let leftWidth: CGFloat = 256
    static let rightWidth: CGFloat = 300
    static let barHeight: CGFloat = 46
    static let rowHeight: CGFloat = 28
    static let controlHeight: CGFloat = 24
    static let labelWidth: CGFloat = 68

    static let body = Font.system(size: 11)
    static let bodyMedium = Font.system(size: 11, weight: .medium)
    static let title = Font.system(size: 11, weight: .semibold)
    static let mono = Font.system(size: 11, design: .monospaced)

    static let panel = Color(NSColor.windowBackgroundColor)
    static let field = Color.primary.opacity(0.055)
    static let hover = Color.primary.opacity(0.05)
    static let selected = Color.accentColor.opacity(0.14)
    static let hairline = Color.primary.opacity(0.1)
    static let secondary = Color.primary.opacity(0.58)
    static let tertiary = Color.primary.opacity(0.36)
}

// MARK: - Panel structure

/// A Figma-style property group: bold title, optional trailing control, hairline
/// below, and no box around it.
struct PanelSection<Trailing: View, Content: View>: View {
    let title: String
    @ViewBuilder var trailing: () -> Trailing
    @ViewBuilder var content: () -> Content

    init(_ title: String,
         @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() },
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.trailing = trailing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Text(title).font(MC.title)
                Spacer(minLength: 4)
                trailing()
            }
            .frame(minHeight: 16)
            content()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(MC.hairline).frame(height: 1) }
    }
}

/// Label + control on one line. An overridden field shows its label in the accent
/// colour; clicking the small dot returns it to the master value.
struct PropRow<Content: View>: View {
    let label: String
    var overridden = false
    var onReset: (() -> Void)? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 3) {
                if overridden {
                    Button { onReset?() } label: {
                        Circle().fill(Color.accentColor).frame(width: 5, height: 5)
                            .padding(3).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("Overrides the master value. Click to reset.")
                    .padding(.leading, -3)
                }
                Text(label).font(MC.body)
                    .foregroundStyle(overridden ? Color.accentColor : MC.secondary)
                    .lineLimit(1)
            }
            .frame(width: MC.labelWidth, alignment: .leading)
            content()
        }
        .frame(minHeight: MC.controlHeight)
    }
}

/// Slider plus an editable value. The value can be typed past the slider's range
/// (within `hard`), nudged with ↑/↓ (⇧ for ×10) or scrubbed.
struct PropSlider: View {
    let label: String
    @Binding var value: Double
    var range: ClosedRange<Double>
    var hard: ClosedRange<Double>? = nil
    var step: Double = 1
    var digits: Int = 0
    var unit: String = ""
    var overridden = false
    var onReset: (() -> Void)? = nil

    var body: some View {
        PropRow(label: label, overridden: overridden, onReset: onReset) {
            Slider(value: Binding(
                get: { min(max(value, range.lowerBound), range.upperBound) },
                set: { value = $0 }
            ), in: range)
            .controlSize(.mini)
            .frame(maxWidth: .infinity)
            NumberInput(value: $value, range: hard ?? range, step: step, digits: digits, unit: unit)
                .frame(width: 58)
        }
    }
}

/// Percentage field over a 0…1 value.
struct PercentInput: View {
    @Binding var value: Double
    var body: some View {
        NumberInput(value: Binding(get: { value * 100 }, set: { value = $0 / 100 }),
                    range: 0...100, step: 1, digits: 0, unit: "%")
    }
}

// MARK: - Number input

/// A compact numeric field: type a value, press ↑/↓ to step (⇧ = ×10), or drag on
/// the prefix to scrub, like Figma.
struct NumberInput: View {
    @Binding var value: Double
    var range: ClosedRange<Double>
    var step: Double = 1
    var digits: Int = 0
    var unit: String = ""
    var prefix: String? = nil

    @State private var scrubStart: Double? = nil
    @State private var focused = false

    var body: some View {
        HStack(spacing: 3) {
            if let prefix {
                Text(prefix).font(MC.body).foregroundStyle(MC.tertiary)
                    .frame(minWidth: 10)
                    .contentShape(Rectangle())
                    .onHover { $0 ? NSCursor.resizeLeftRight.push() : NSCursor.pop() }
                    .gesture(DragGesture(minimumDistance: 1)
                        .onChanged { v in
                            if scrubStart == nil { scrubStart = value }
                            let n = (scrubStart ?? value) + Double(v.translation.width).rounded() * step
                            value = min(max(n, range.lowerBound), range.upperBound)
                        }
                        .onEnded { _ in scrubStart = nil })
            }
            NumberTextField(value: $value, range: range, step: step, digits: digits, focused: $focused)
                .frame(maxWidth: .infinity)
            if !unit.isEmpty {
                Text(unit).font(.system(size: 10)).foregroundStyle(MC.tertiary).fixedSize()
            }
        }
        .padding(.horizontal, 6)
        .frame(height: MC.controlHeight)
        .background(RoundedRectangle(cornerRadius: 5).fill(MC.field))
        .overlay(RoundedRectangle(cornerRadius: 5)
            .strokeBorder(focused ? Color.accentColor : .clear, lineWidth: 1))
    }
}

/// AppKit text field so arrow keys and focus behave reliably on macOS.
struct NumberTextField: NSViewRepresentable {
    @Binding var value: Double
    var range: ClosedRange<Double>
    var step: Double
    var digits: Int
    @Binding var focused: Bool

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NotifyingTextField {
        let f = NotifyingTextField()
        f.isBordered = false
        f.drawsBackground = false
        f.focusRingType = .none
        f.font = .systemFont(ofSize: 11)
        f.alignment = .left
        f.lineBreakMode = .byClipping
        f.cell?.isScrollable = true
        f.cell?.wraps = false
        f.delegate = context.coordinator
        f.onFocus = { [weak coord = context.coordinator] in coord?.parent.focused = true }
        return f
    }

    func updateNSView(_ f: NotifyingTextField, context: Context) {
        context.coordinator.parent = self
        // Don't overwrite what the user is typing.
        if f.currentEditor() == nil { f.stringValue = Self.format(value, digits) }
    }

    static func format(_ v: Double, _ digits: Int) -> String {
        if digits == 0 { return String(Int(v.rounded())) }
        var s = String(format: "%.\(digits)f", v)
        while s.contains("."), s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: NumberTextField
        init(_ p: NumberTextField) { parent = p }

        private func clamp(_ v: Double) -> Double {
            min(max(v, parent.range.lowerBound), parent.range.upperBound)
        }

        private func commit(_ field: NSTextField) {
            let text = field.stringValue.replacingOccurrences(of: ",", with: ".")
            if let v = Double(text) { parent.value = clamp(v) }
            field.stringValue = NumberTextField.format(parent.value, parent.digits)
        }

        func controlTextDidEndEditing(_ obj: Notification) {
            guard let f = obj.object as? NSTextField else { return }
            commit(f)
            parent.focused = false
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy sel: Selector) -> Bool {
            let big = NSEvent.modifierFlags.contains(.shift)
            func nudge(_ dir: Double) {
                let current = Double(textView.string.replacingOccurrences(of: ",", with: ".")) ?? parent.value
                let v = clamp(current + dir * parent.step * (big ? 10 : 1))
                parent.value = v
                textView.string = NumberTextField.format(v, parent.digits)
                textView.selectAll(nil)
            }
            switch sel {
            case #selector(NSResponder.moveUp(_:)), #selector(NSResponder.moveUpAndModifySelection(_:)):
                nudge(+1); return true
            case #selector(NSResponder.moveDown(_:)), #selector(NSResponder.moveDownAndModifySelection(_:)):
                nudge(-1); return true
            case #selector(NSResponder.insertNewline(_:)):
                if let f = control as? NSTextField { commit(f) }
                control.window?.makeFirstResponder(nil)
                return true
            case #selector(NSResponder.cancelOperation(_:)):
                control.window?.makeFirstResponder(nil)
                return true
            default:
                return false
            }
        }
    }
}

final class NotifyingTextField: NSTextField {
    var onFocus: (() -> Void)?
    override func becomeFirstResponder() -> Bool {
        let ok = super.becomeFirstResponder()
        if ok {
            onFocus?()
            DispatchQueue.main.async { [weak self] in self?.currentEditor()?.selectAll(nil) }
        }
        return ok
    }
}

// MARK: - Small controls

struct PropTextField: View {
    @Binding var text: String
    var placeholder = ""
    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(MC.body)
            .padding(.horizontal, 6)
            .frame(height: MC.controlHeight)
            .background(RoundedRectangle(cornerRadius: 5).fill(MC.field))
    }
}

struct PropToggle: View {
    let label: String
    @Binding var isOn: Bool
    var overridden = false
    var onReset: (() -> Void)? = nil
    var body: some View {
        HStack {
            if overridden {
                Button { onReset?() } label: {
                    Circle().fill(Color.accentColor).frame(width: 5, height: 5)
                }
                .buttonStyle(.plain)
                .help("Overrides the master value. Click to reset.")
            }
            Text(label).font(MC.body).foregroundStyle(overridden ? Color.accentColor : MC.secondary)
            Spacer()
            Toggle("", isOn: $isOn).labelsHidden().toggleStyle(.switch).controlSize(.mini)
        }
        .frame(minHeight: MC.controlHeight)
    }
}

struct PropPicker<T: Hashable, Content: View>: View {
    @Binding var selection: T
    @ViewBuilder var content: () -> Content
    var body: some View {
        Picker("", selection: $selection, content: content)
            .labelsHidden()
            .pickerStyle(.menu)
            .controlSize(.small)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct PropSegments<T: Hashable, Content: View>: View {
    @Binding var selection: T
    @ViewBuilder var content: () -> Content
    var body: some View {
        Picker("", selection: $selection, content: content)
            .labelsHidden()
            .pickerStyle(.segmented)
            .controlSize(.small)
            .frame(maxWidth: .infinity)
    }
}

/// Small borderless icon button with a hover background.
struct IconButton: View {
    let systemName: String
    var size: CGFloat = 12
    var active = false
    var help: String = ""
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: size))
                .foregroundStyle(active ? Color.accentColor : MC.secondary)
                .frame(width: 22, height: 22)
                .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? MC.hover : .clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
    }
}

struct SecondaryButton: View {
    let title: String
    var systemImage: String? = nil
    let action: () -> Void
    @State private var hovering = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 10)) }
                Text(title).font(MC.body)
            }
            .padding(.horizontal, 8)
            .frame(height: MC.controlHeight)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 5).fill(hovering ? MC.field.opacity(1.7) : MC.field))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
    }
}

/// Muted explanatory text inside a section.
struct Hint: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.system(size: 10)).foregroundStyle(MC.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}
