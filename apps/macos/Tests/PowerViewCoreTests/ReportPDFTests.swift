import Foundation
import PDFKit
import Testing

@testable import PowerViewCore

@Test func reportPDFHasA4PagesRepeatedHeaderAndExtractableUkrainianText() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString + ".pdf")
  defer { try? FileManager.default.removeItem(at: url) }
  let text = (1...250).map { "APP-\($0) · Перевірка українського тексту · План і факт" }.joined(
    separator: "\n")
  try ReportPDFExporter.write(text: text, header: "Power View — Контрольний звіт", to: url)
  let pdf = try #require(PDFDocument(url: url))
  #expect(pdf.pageCount > 1)
  for index in 0..<pdf.pageCount {
    let page = try #require(pdf.page(at: index))
    #expect(abs(page.bounds(for: .mediaBox).width - 595.28) < 0.1)
    #expect(abs(page.bounds(for: .mediaBox).height - 841.89) < 0.1)
    #expect(page.string?.contains("Контрольний звіт") == true)
  }
  #expect(pdf.string?.contains("Перевірка українського тексту") == true)
  #expect(pdf.string?.contains("APP-250") == true)
}

@Test func structuredPDFPreservesReportMetricsHierarchyAndGroupedActivity() throws {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    UUID().uuidString + ".pdf")
  defer { try? FileManager.default.removeItem(at: url) }
  let raw =
    #"{"board":{"name":"Synthetic board"},"request":{"type":"daily","period":{"start":"2026-10-20","end":"2026-10-21","dataCutoff":"2026-10-20T12:00:00Z"}},"result":{"executiveSummary":{"totalIssues":1,"completedDuringPeriod":1,"createdIssues":0,"worklogSeconds":5400,"unassignedIssues":0},"people":[{"user":{"id":"u","displayName":"Олексій"},"assignedIssues":[{"id":"1","key":"APP-1","browseUrl":"https://jira.example.test/browse/APP-1","summary":"Перевірка звіту","status":{"name":"Done"}}],"completedIssues":["APP-1"],"worklogSeconds":5400}],"activity":[{"id":"e","issueId":"1","issueKey":"APP-1","type":"status-changed","to":"Done","occurredAt":"2026-10-20T11:00:00Z","actor":{"id":"u","displayName":"Олексій"}}]}}"#
  let snapshot = try JSONDecoder().decode(JSONValue.self, from: Data(raw.utf8))
  try ReportPDFExporter.write(snapshot: snapshot, language: "uk", to: url)
  let pdf = try #require(PDFDocument(url: url))
  let text = try #require(pdf.string)
  #expect(text.contains("Issues in scope: 1"))
  #expect(text.contains("1.5h"))
  #expect(text.contains("Перевірка звіту"))
  #expect(text.contains("Олексій"))
  #expect(text.contains("set status to"))
  #expect(text.contains("Activity log"))
  let annotations = (0..<pdf.pageCount).flatMap { pdf.page(at: $0)?.annotations ?? [] }
  #expect(
    annotations.contains {
      ($0.action as? PDFActionURL)?.url?.absoluteString == "https://jira.example.test/browse/APP-1"
    })
}
