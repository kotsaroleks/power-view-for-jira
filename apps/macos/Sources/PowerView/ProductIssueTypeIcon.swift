import SwiftUI

struct ProductIssueTypeIcon: View {
  let name: String
  private var kind: String {
    name.lowercased().components(separatedBy: .whitespacesAndNewlines).joined()
      .replacingOccurrences(of: "_", with: "").replacingOccurrences(of: "-", with: "")
  }
  private var color: Color {
    Color(
      hex: ["epic": 0x6554c0, "story": 0x36b37e, "bug": 0xde350b, "subtask": 0x2684ff][kind]
        ?? 0x626f86)
  }
  var body: some View {
    if ["epic", "story", "bug", "subtask"].contains(kind) {
      Canvas { context, size in
        context.scaleBy(x: size.width / 16, y: size.height / 16)
        var path = Path()
        func line(_ a: CGPoint, _ b: CGPoint) {
          path.move(to: a)
          path.addLine(to: b)
        }
        switch kind {
        case "epic":
          path.move(to: CGPoint(x: 9.25, y: 1.5))
          for point in [
            CGPoint(x: 3.6, y: 8.35), CGPoint(x: 6.8, y: 8.35), CGPoint(x: 5.75, y: 14.5),
            CGPoint(x: 12.4, y: 6.6), CGPoint(x: 9.05, y: 6.6),
          ] { path.addLine(to: point) }
          path.closeSubpath()
        case "story":
          path.addLines([
            CGPoint(x: 4, y: 2.25), CGPoint(x: 12, y: 2.25), CGPoint(x: 12, y: 13.75),
            CGPoint(x: 8, y: 11.2), CGPoint(x: 4, y: 13.75),
          ])
          path.closeSubpath()
        case "bug":
          path.move(to: CGPoint(x: 6, y: 4.75))
          path.addLine(to: CGPoint(x: 10, y: 4.75))
          path.addQuadCurve(to: CGPoint(x: 11, y: 5.75), control: CGPoint(x: 11, y: 4.75))
          path.addLine(to: CGPoint(x: 11, y: 9.75))
          path.addCurve(
            to: CGPoint(x: 8, y: 12.75), control1: CGPoint(x: 11, y: 11.4),
            control2: CGPoint(x: 9.65, y: 12.75))
          path.addCurve(
            to: CGPoint(x: 5, y: 9.75), control1: CGPoint(x: 6.35, y: 12.75),
            control2: CGPoint(x: 5, y: 11.4))
          path.addLine(to: CGPoint(x: 5, y: 5.75))
          path.addQuadCurve(to: CGPoint(x: 6, y: 4.75), control: CGPoint(x: 5, y: 4.75))
          line(CGPoint(x: 6.25, y: 4.75), CGPoint(x: 5.5, y: 3.25))
          line(CGPoint(x: 9.75, y: 4.75), CGPoint(x: 10.5, y: 3.25))
          for y in [6.5, 9.0] {
            line(CGPoint(x: 2.75, y: y), CGPoint(x: 5, y: y))
            line(CGPoint(x: 11, y: y), CGPoint(x: 13.25, y: y))
          }
          line(CGPoint(x: 8, y: 4.75), CGPoint(x: 8, y: 12.75))
        default:
          path.move(to: CGPoint(x: 3.25, y: 2.5))
          path.addLine(to: CGPoint(x: 3.25, y: 5.75))
          path.addQuadCurve(to: CGPoint(x: 5.5, y: 8), control: CGPoint(x: 3.25, y: 8))
          path.addLine(to: CGPoint(x: 10.75, y: 8))
          path.move(to: CGPoint(x: 8.5, y: 4.75))
          path.addLines([
            CGPoint(x: 8.5, y: 4.75), CGPoint(x: 11.75, y: 8), CGPoint(x: 8.5, y: 11.25),
          ])
          path.addRect(CGRect(x: 11.75, y: 3.25, width: 2, height: 2))
          path.addRect(CGRect(x: 11.75, y: 10.75, width: 2, height: 2))
        }
        if kind == "epic" || kind == "story" {
          context.fill(path, with: .color(.white))
        } else {
          context.stroke(
            path, with: .color(.white),
            style: StrokeStyle(
              lineWidth: kind == "bug" ? 1.4 : 1.6, lineCap: .round, lineJoin: .round))
        }
      }.frame(width: 12, height: 12).frame(width: 18, height: 18).background(
        color, in: RoundedRectangle(cornerRadius: 4)
      ).accessibilityLabel(name + " issue type")
    }
  }
}
