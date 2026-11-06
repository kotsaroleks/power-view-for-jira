import SwiftUI

/// Values copied from packages/ui/src/tokens.css and global.css, not a new theme.
enum PV {
  static let ink = Color(hex: 0x172b4d), secondary = Color(hex: 0x626f86)
  static let accent = Color(hex: 0x0c66e4), background = Color(hex: 0xf7f8fa)
  static let border = Color(hex: 0xdfe1e6), subtle = Color(hex: 0xf1f2f4)
  static let green = Color(hex: 0x1f845a), purple = Color(hex: 0x7e57c2)
  static func eyebrow(_ text: String) -> some View {
    Text(text.uppercased()).font(.system(size: 10, weight: .heavy)).tracking(1.3).foregroundStyle(
      secondary)
  }
}
extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
      blue: Double(hex & 255) / 255, opacity: 1)
  }
}
struct ProductButton: ButtonStyle {
  @Environment(\.isEnabled) private var enabled
  var primary = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.system(size: 13, weight: .semibold)).padding(.horizontal, 16).padding(
      .vertical, 10
    )
    .foregroundStyle(primary ? .white : PV.ink)
    .background(primary ? PV.accent : .white, in: RoundedRectangle(cornerRadius: 7))
    .overlay(RoundedRectangle(cornerRadius: 7).stroke(primary ? PV.accent : PV.border))
    .opacity(!enabled ? 0.5 : configuration.isPressed ? 0.75 : 1)
  }
}
struct ProductField: View {
  @Environment(\.isEnabled) private var enabled
  @FocusState private var focused: Bool
  let label: String
  @Binding var text: String
  var placeholder = ""
  var multiline = false
  var hint = ""
  var error = ""
  var secure = false
  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      if !label.isEmpty {
        Text(label).font(.system(size: 13, weight: .semibold)).foregroundStyle(PV.ink)
      }
      Group {
        if multiline {
          TextEditor(text: $text).font(.system(size: 13)).scrollContentBackground(.hidden)
            .frame(height: 96).padding(9)
            .overlay(alignment: .topLeading) {
              if text.isEmpty && !placeholder.isEmpty {
                Text(placeholder).font(.system(size: 13)).foregroundStyle(PV.secondary)
                  .padding(.horizontal, 14).padding(.vertical, 12).allowsHitTesting(false)
              }
            }
        } else if secure {
          SecureField(placeholder, text: $text).textFieldStyle(.plain).padding(.horizontal, 12)
            .frame(height: 40)
        } else {
          TextField(placeholder, text: $text).textFieldStyle(.plain).padding(.horizontal, 12).frame(
            height: 40)
        }
      }
      .focused($focused).foregroundStyle(PV.ink)
      .background(enabled ? Color.white : PV.subtle, in: RoundedRectangle(cornerRadius: 8))
      .overlay(
        RoundedRectangle(cornerRadius: 8).stroke(
          !error.isEmpty ? Color.red : focused ? PV.accent : PV.border, lineWidth: focused ? 2 : 1)
      )
      .accessibilityLabel(label.isEmpty ? placeholder : label)
      .accessibilityHint(error.isEmpty ? hint : error)
      if !error.isEmpty {
        Label(error, systemImage: "exclamationmark.circle").font(.system(size: 12)).foregroundStyle(
          .red)
      } else if !hint.isEmpty {
        Text(hint).font(.system(size: 12)).foregroundStyle(PV.secondary).fixedSize(
          horizontal: false, vertical: true)
      }
    }
  }
}
struct ProductControlSurface: ViewModifier {
  @Environment(\.isEnabled) private var enabled
  func body(content: Content) -> some View {
    content.padding(.horizontal, 10).frame(minHeight: 40)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(enabled ? Color.white : PV.subtle, in: RoundedRectangle(cornerRadius: 8))
      .overlay(RoundedRectangle(cornerRadius: 8).stroke(PV.border))
  }
}
extension View {
  func productCard(_ radius: CGFloat = 16) -> some View {
    self.background(.white, in: RoundedRectangle(cornerRadius: radius)).overlay(
      RoundedRectangle(cornerRadius: radius).stroke(PV.border))
  }
}
