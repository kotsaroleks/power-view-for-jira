import SwiftUI

/// Native equivalent of the original toolbars' flex-wrap layout.
struct ProductFlowLayout: Layout {
  var spacing: CGFloat = 10
  var rowSpacing: CGFloat = 8
  private func arrange(width: CGFloat, subviews: Subviews) -> (CGSize, [CGRect]) {
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, maximum: CGFloat = 0
    var frames: [CGRect] = []
    for subview in subviews {
      let size = subview.sizeThatFits(.unspecified)
      if x > 0 && x + size.width > width { x = 0; y += rowHeight + rowSpacing; rowHeight = 0 }
      frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
      maximum = max(maximum, x + size.width); x += size.width + spacing; rowHeight = max(rowHeight, size.height)
    }
    return (CGSize(width: maximum, height: y + rowHeight), frames)
  }
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) -> CGSize {
    arrange(width: proposal.width ?? .greatestFiniteMagnitude, subviews: subviews).0
  }
  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout Void) {
    let frames = arrange(width: bounds.width, subviews: subviews).1
    for (subview, frame) in zip(subviews, frames) { subview.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY), anchor: .topLeading, proposal: ProposedViewSize(frame.size)) }
  }
}
