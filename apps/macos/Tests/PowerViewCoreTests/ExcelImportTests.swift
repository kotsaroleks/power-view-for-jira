import Foundation
import Testing

@testable import PowerViewCore

private func workbookFixture(directory: URL, sheetXML: Data) throws -> URL {
  let files = [
    "xl/workbook.xml":
      #"<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Release keys" sheetId="1" r:id="rId7"/></sheets></workbook>"#,
    "xl/_rels/workbook.xml.rels":
      #"<Relationships><Relationship Id="rId7" Target="worksheets/import-data.xml"/></Relationships>"#,
    "xl/sharedStrings.xml":
      #"<sst><si><t>Jira key</t></si><si><r><t>APP</t></r><r><t>-1</t></r></si><si><t>OTHER-1</t></si></sst>"#,
  ]
  for (path, text) in files {
    let file = directory.appendingPathComponent(path)
    try FileManager.default.createDirectory(
      at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
    try Data(text.utf8).write(to: file)
  }
  let sheet = directory.appendingPathComponent("xl/worksheets/import-data.xml")
  try FileManager.default.createDirectory(
    at: sheet.deletingLastPathComponent(), withIntermediateDirectories: true)
  try sheetXML.write(to: sheet)
  let url = directory.appendingPathComponent("input.xlsx")
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/usr/bin/zip")
  process.arguments = ["-q", "-r", url.path, "xl"]
  process.currentDirectoryURL = directory
  try process.run()
  process.waitUntilExit()
  #expect(process.terminationStatus == 0)
  return url
}
@Test func excelUsesWorkbookSheetNamesRelationshipsAndRichSharedStrings() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let xml =
    #"<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>0</v></c></row><row r="2"><c r="B2" t="s"><v>1</v></c></row><row r="3"><c r="B3" t="inlineStr"><is><t>APP-1</t></is></c></row><row r="4"><c r="B4" t="s"><v>2</v></c></row></sheetData></worksheet>"#
  let url = try workbookFixture(directory: directory, sheetXML: Data(xml.utf8))
  let sheets = try ExcelWorkbook.sheets(at: url)
  #expect(sheets[0].name == "Release keys")
  #expect(sheets[0].path == "xl/worksheets/import-data.xml")
  let sheet = try ExcelWorkbook.read(at: url, sheetPath: sheets[0].path)
  let rows = sheet.preview(column: "B", project: "APP", existingKeys: [])
  #expect(rows.compactMap(\.key) == ["APP-1"])
  #expect(rows[2].problem == "Дублікат")
  #expect(rows[3].problem == "Інший Jira-проєкт")
}
@Test func excelRejectsEntityDeclarationsEvenInUTF16() throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let xml =
    "<?xml version=\"1.0\" encoding=\"UTF-16\"?><!DOCTYPE worksheet [<!ENTITY example \"APP-1\">]><worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>&example;</t></is></c></row></sheetData></worksheet>"
  let url = try workbookFixture(directory: directory, sheetXML: xml.data(using: .utf16)!)
  #expect(throws: ExcelError.invalidWorkbook) {
    try ExcelWorkbook.read(at: url, sheetPath: "xl/worksheets/import-data.xml")
  }
}
