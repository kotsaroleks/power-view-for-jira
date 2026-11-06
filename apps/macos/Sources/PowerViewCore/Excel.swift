import Foundation

public enum ExcelError: Error, Equatable {
  case invalidWorkbook, tooLarge, commandFailed, releaseNotReady
}
public struct ImportRow: Identifiable, Equatable, Sendable {
  public let number: Int
  public let value: String
  public let key: String?
  public let problem: String?
  public var id: Int { number }
}
public struct Worksheet: Sendable {
  public let path: String
  public let rows: [Int: [String: String]]
  public var columns: [String] {
    Set(rows.values.flatMap(\.keys)).sorted { $0.count == $1.count ? $0 < $1 : $0.count < $1.count }
  }
  public func preview(column: String, project: String, existingKeys: Set<String>) -> [ImportRow] {
    var seen = existingKeys
    return rows.keys.sorted().compactMap { row in
      let value = (rows[row]?[column] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
      guard !value.isEmpty else { return nil }
      let key = value.uppercased()
      let problem: String?
      if key.range(of: "^[A-Z][A-Z0-9_]*-[1-9][0-9]*$", options: .regularExpression) == nil {
        problem = "Не є Jira-ключем (можливо, заголовок)"
      } else if !key.hasPrefix(project + "-") {
        problem = "Інший Jira-проєкт"
      } else if !seen.insert(key).inserted {
        problem = "Дублікат"
      } else {
        problem = nil
      }
      return ImportRow(number: row, value: value, key: problem == nil ? key : nil, problem: problem)
    }
  }
}
public struct ExcelSheet: Identifiable, Equatable, Sendable {
  public let name: String
  public let path: String
  public var id: String { path }
}
/// XLSX only. No formulas are executed; cached values and strings are read as plain text.
public enum ExcelWorkbook {
  public static func sheetPaths(at url: URL) throws -> [String] { try sheets(at: url).map(\.path) }
  public static func sheets(at url: URL) throws -> [ExcelSheet] {
    let listing = try command("/usr/bin/unzip", ["-Z1", url.path])
    guard let text = String(data: listing, encoding: .utf8) else {
      throw ExcelError.invalidWorkbook
    }
    let entries = Set(text.split(separator: "\n").map(String.init))
    let workbook = XMLSheetReader()
    let relationships = XMLSheetReader()
    try workbook.parse(command("/usr/bin/unzip", ["-p", url.path, "xl/workbook.xml"]))
    try relationships.parse(
      command("/usr/bin/unzip", ["-p", url.path, "xl/_rels/workbook.xml.rels"]))
    guard !workbook.sheets.isEmpty, workbook.sheets.count <= 100 else {
      throw ExcelError.invalidWorkbook
    }
    return try workbook.sheets.map { sheet in
      guard let target = relationships.relationships[sheet.relationship],
        let decoded = target.removingPercentEncoding,
        !decoded.contains(":"), !decoded.contains("\\")
      else { throw ExcelError.invalidWorkbook }
      let absolute = decoded.hasPrefix("/") ? decoded : "/xl/" + decoded
      let normalized = URL(fileURLWithPath: absolute).standardizedFileURL.path
      guard normalized.hasPrefix("/xl/worksheets/"),
        entries.contains(String(normalized.dropFirst()))
      else { throw ExcelError.invalidWorkbook }
      return ExcelSheet(name: sheet.name, path: String(normalized.dropFirst()))
    }
  }
  public static func read(at url: URL, sheetPath: String) throws -> Worksheet {
    guard try sheetPaths(at: url).contains(sheetPath) else { throw ExcelError.invalidWorkbook }
    let stringsData = try? command("/usr/bin/unzip", ["-p", url.path, "xl/sharedStrings.xml"])
    let strings = XMLSheetReader()
    if let stringsData { try strings.parse(stringsData) }
    let sheet = XMLSheetReader(sharedStrings: strings.strings)
    try sheet.parse(command("/usr/bin/unzip", ["-p", url.path, sheetPath]))
    return Worksheet(path: sheetPath, rows: sheet.rows)
  }
  public static func export(_ release: Release, to url: URL) throws {
    guard release.isReady else { throw ExcelError.releaseNotReady }
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    defer { try? FileManager.default.removeItem(at: root) }
    func write(_ path: String, _ text: String) throws {
      let file = root.appendingPathComponent(path)
      try FileManager.default.createDirectory(
        at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
      try Data(text.utf8).write(to: file)
    }
    try write(
      "[Content_Types].xml",
      """
      <?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>
      """)
    try write(
      "_rels/.rels",
      """
      <?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>
      """)
    try write(
      "xl/workbook.xml",
      """
      <?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Estimates" sheetId="1" r:id="rId1"/></sheets></workbook>
      """)
    try write(
      "xl/_rels/workbook.xml.rels",
      """
      <?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>
      """)
    func cell(_ reference: String, _ value: String) -> String {
      "<c r=\"\(reference)\" t=\"inlineStr\"><is><t>\(escape(value))</t></is></c>"
    }
    var rows =
      "<row r=\"1\">" + cell("A1", "Jira key") + cell("B1", "Estimate (person-days)") + "</row>"
    for (index, story) in release.stories.enumerated() {
      let row = index + 2
      rows +=
        "<row r=\"\(row)\">" + cell("A\(row)", story.id)
        + "<c r=\"B\(row)\"><v>\(story.clientDays)</v></c></row>"
    }
    try write(
      "xl/worksheets/sheet1.xml",
      "<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>\(rows)</sheetData></worksheet>"
    )
    let archive = root.appendingPathComponent("export.xlsx")
    _ = try command(
      "/usr/bin/zip", ["-q", "-r", archive.path, "[Content_Types].xml", "_rels", "xl"],
      directory: root)
    try Data(contentsOf: archive).write(to: url, options: .atomic)
  }
  private static func escape(_ text: String) -> String {
    text.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
      .replacingOccurrences(of: ">", with: "&gt;").replacingOccurrences(of: "\"", with: "&quot;")
  }
  private static func command(_ executable: String, _ arguments: [String], directory: URL? = nil)
    throws -> Data
  {
    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    process.currentDirectoryURL = directory
    process.standardOutput = output
    process.standardError = FileHandle.nullDevice
    try process.run()
    var data = Data()
    while let chunk = try output.fileHandleForReading.read(upToCount: 65_536), !chunk.isEmpty {
      data.append(chunk)
      if data.count > 20_000_000 {
        process.terminate()
        process.waitUntilExit()
        throw ExcelError.tooLarge
      }
    }
    process.waitUntilExit()
    guard process.terminationStatus == 0 else { throw ExcelError.commandFailed }
    return data
  }
}
private final class XMLSheetReader: NSObject, XMLParserDelegate {
  var strings: [String] = []
  var sheets: [(name: String, relationship: String)] = []
  var relationships: [String: String] = [:]
  var rows: [Int: [String: String]] = [:]
  let sharedStrings: [String]
  var text = "", cellValue = "", reference = "", type = "", string = ""
  var inText = false, inValue = false, inString = false
  init(sharedStrings: [String] = []) { self.sharedStrings = sharedStrings }
  func parse(_ data: Data) throws {
    guard
      String(data: data, encoding: .utf8)?.range(of: "<!DOCTYPE", options: .caseInsensitive) == nil
    else { throw ExcelError.invalidWorkbook }
    let parser = XMLParser(data: data)
    parser.delegate = self
    parser.shouldResolveExternalEntities = false
    guard parser.parse() else { throw ExcelError.invalidWorkbook }
  }
  func parser(
    _ parser: XMLParser, foundInternalEntityDeclarationWithName name: String, value: String?
  ) { parser.abortParsing() }
  func parser(
    _ parser: XMLParser, foundExternalEntityDeclarationWithName name: String, publicID: String?,
    systemID: String?
  ) { parser.abortParsing() }
  func parser(
    _ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
    qualifiedName: String?, attributes: [String: String]
  ) {
    if elementName == "sheet", let name = attributes["name"], let relationship = attributes["r:id"]
    {
      sheets.append((name, relationship))
    }
    if elementName == "Relationship", let id = attributes["Id"], let target = attributes["Target"],
      attributes["TargetMode"] != "External"
    {
      relationships[id] = target
    }
    if elementName == "si" {
      inString = true
      string = ""
    }
    if elementName == "c" {
      reference = attributes["r"] ?? ""
      type = attributes["t"] ?? ""
      cellValue = ""
    }
    if elementName == "t" {
      inText = true
      text = ""
    }
    if elementName == "v" {
      inValue = true
      text = ""
    }
  }
  func parser(_ parser: XMLParser, foundCharacters string: String) {
    if inText || inValue { text += string }
  }
  func parser(
    _ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?,
    qualifiedName: String?
  ) {
    if elementName == "t" {
      if inString { string += text } else { cellValue += text }
      inText = false
    }
    if elementName == "v" {
      cellValue = text
      inValue = false
    }
    if elementName == "si" {
      strings.append(string)
      inString = false
    }
    if elementName == "c" {
      let column = String(reference.prefix { $0.isLetter })
      guard !column.isEmpty, let row = Int(reference.dropFirst(column.count)), row > 0 else {
        return
      }
      var value = cellValue
      if type == "s" {
        guard let index = Int(value), sharedStrings.indices.contains(index) else {
          parser.abortParsing()
          return
        }
        value = sharedStrings[index]
      }
      rows[row, default: [:]][column] = value
    }
  }
}
