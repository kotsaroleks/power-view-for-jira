import Combine
import Foundation

/// Focus restoration asks the production scroll views to reveal their real row/cell.
@MainActor final class NativeTimeGridPosition: ObservableObject {
  struct Request: Identifiable { let id = UUID(); let issueID: String; let day: String }
  @Published private(set) var request: Request?
  @Published private(set) var horizontalOffset: CGFloat = 0
  @Published private(set) var verticalOffset: CGFloat = 0
  func reveal(issueID: String, day: String) { request = Request(issueID: issueID, day: day) }
  func recordHorizontal(_ value: CGFloat) { if value.isFinite && abs(horizontalOffset - value) > 0.25 { horizontalOffset = value } }
  func recordVertical(_ value: CGFloat) { if value.isFinite && abs(verticalOffset - value) > 0.25 { verticalOffset = value } }
}
