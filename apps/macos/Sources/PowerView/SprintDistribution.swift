import PowerViewCore
import SwiftUI

struct SprintDistribution: View {
  let counts: JSONValue
  private let buckets: [(String, Color)] = [
    ("done", PV.green), ("inProgress", PV.accent), ("notStarted", Color(hex: 0x8794a9)),
    ("unknown", PV.secondary),
  ]
  var body: some View {
    GeometryReader { geometry in
      HStack(spacing: 1) {
        ForEach(buckets, id: \.0) { key, color in
          if let count = counts[key].number, count > 0 {
            color.frame(
              width: max(0, (geometry.size.width - 3) * count / max(1, counts["total"].number ?? 0))
            )
            .help(key + ": " + count.formatted())
          }
        }
      }.clipShape(Capsule())
    }.frame(height: 8).accessibilityLabel(
      "Done \(counts["done"].plainText), in progress \(counts["inProgress"].plainText), not started \(counts["notStarted"].plainText)"
    )
  }
}
