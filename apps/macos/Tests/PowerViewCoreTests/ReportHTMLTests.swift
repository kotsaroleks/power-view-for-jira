import Foundation
import Testing

@testable import PowerViewCore

@Test func printableReportVisibleContentMatchesActualChromeTemplate() throws {
  let url = Bundle.module.url(
    forResource: "report-print-golden", withExtension: "json", subdirectory: "Fixtures")!
  let cases = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url)).array
  func visible(_ html: String) -> String {
    html.replacingOccurrences(
      of: "<style>[\\s\\S]*?</style>", with: "", options: .regularExpression
    )
    .replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
    .replacingOccurrences(of: "&amp;", with: "&").replacingOccurrences(of: "&lt;", with: "<")
    .replacingOccurrences(of: "&gt;", with: ">").replacingOccurrences(of: "&quot;", with: "\"")
    .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    .trimmingCharacters(in: .whitespacesAndNewlines)
  }
  for item in cases {
    let generated = ReportHTML.build(item["snapshot"], language: "en", css: "")
    #expect(visible(generated) == visible(item["html"].plainText), "\(item["name"].plainText)")
  }
}
@Test func printableReportEscapesUntrustedTextAndBlocksRemoteResources() {
  let snapshot: JSONValue = .object([
    "board": .object(["name": .string("<script>alert(1)</script>")])
  ])
  let html = ReportHTML.build(snapshot, language: "en", css: "")
  #expect(!html.contains("<script>"))
  #expect(html.contains("&lt;script&gt;"))
  #expect(html.contains("default-src 'none'"))
}
