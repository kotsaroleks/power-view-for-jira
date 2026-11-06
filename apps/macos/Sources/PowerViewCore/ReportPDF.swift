import AppKit
import CoreText
import Foundation

public enum ReportPDFExporter {
  public static func write(text: String, header: String, to url: URL) throws {
    try write(
      attributed: NSAttributedString(
        string: text,
        attributes: [.font: NSFont.systemFont(ofSize: 10), .foregroundColor: NSColor.black]),
      header: header, to: url)
  }
  public static func write(snapshot: JSONValue, language: String, to url: URL) throws {
    let output = NSMutableAttributedString(string: "")
    let ink = NSColor(calibratedRed: 23 / 255, green: 43 / 255, blue: 77 / 255, alpha: 1)
    let secondary = NSColor(calibratedRed: 98 / 255, green: 111 / 255, blue: 134 / 255, alpha: 1)
    func line(
      _ text: String, size: CGFloat = 10, bold: Bool = false, color: NSColor? = nil,
      gap: CGFloat = 6, link: URL? = nil
    ) {
      let paragraph = NSMutableParagraphStyle()
      paragraph.paragraphSpacing = gap
      paragraph.lineSpacing = 3
      paragraph.tabStops = [
        NSTextTab(textAlignment: .left, location: 85),
        NSTextTab(textAlignment: .left, location: 190),
        NSTextTab(textAlignment: .left, location: 390),
      ]
      var attributes: [NSAttributedString.Key: Any] = [
        .font: bold ? NSFont.boldSystemFont(ofSize: size) : NSFont.systemFont(ofSize: size),
        .foregroundColor: color ?? ink, .paragraphStyle: paragraph,
      ]
      if let link { attributes[.link] = link }
      output.append(
        NSAttributedString(
          string: text + "\n",
          attributes: attributes))
    }
    func heading(_ text: String) { line(text, size: 16, bold: true, gap: 12) }
    func hours(_ value: JSONValue) -> String {
      value.number.map { ReportPresentation.hours($0) } ?? "N/A"
    }
    let result = snapshot["result"]
    let summary = result["executiveSummary"]
    line(
      (snapshot["request"]["type"].string ?? "").uppercased() + " REPORT", size: 9, bold: true,
      color: secondary)
    line(snapshot["board"]["name"].string ?? "Power View", size: 26, bold: true, gap: 12)
    line(
      snapshot["request"]["period"]["start"].plainText + " — "
        + snapshot["request"]["period"]["end"].plainText, color: secondary)
    line(
      "Data as of " + snapshot["request"]["period"]["dataCutoff"].plainText, color: secondary,
      gap: 16)
    for warning in snapshot["completeness"]["warnings"].array {
      line(warning["message"].plainText, bold: true, color: .systemOrange)
    }
    heading("Report summary")
    line(
      "Issues in scope: " + summary["totalIssues"].plainText + "    Completed: "
        + (snapshot["request"]["type"].string == "sprint"
        ? summary["completedIssues"] : summary["completedDuringPeriod"]).plainText, size: 13,
      bold: true)
    line(
      "Created: " + summary["createdIssues"].plainText + "    Worklog: "
        + hours(summary["worklogSeconds"]) + "    Unassigned: "
        + summary["unassignedIssues"].plainText, size: 12, gap: 18)
    if result["sprint"] != .null {
      let completion = result["sprint"]["completion"]
      heading("Sprint completion")
      line(
        (completion["percentage"].number.map { String(format: "%.1f%%", $0) } ?? "Unavailable")
          + " · " + completion["numerator"].plainText + " / " + completion["denominator"].plainText
          + " " + completion["unit"].plainText, size: 13, bold: true)
    }
    if result["sprint"] != .null {
      let utilization =
        result["sprint"]["timeUtilization"]["percentage"].number.map {
          String(format: "%.1f%%", $0)
        } ?? "Unavailable"
      line("Time utilization: " + utilization)
      line(
        "Unestimated: " + result["sprint"]["unestimated"]["total"].plainText + " · "
          + result["sprint"]["unestimated"]["incomplete"].plainText + " still open")
    }
    let issues =
      result["people"].array.flatMap { $0["assignedIssues"].array }
      + result["unassigned"]["issues"].array
    heading("Changed issues")
    for row in ReportPresentation.changedTree(issues: issues, events: result["activity"].array) {
      line(
        String(repeating: "    ", count: row.depth) + row.issue["key"].plainText + " · "
          + row.issue["summary"].plainText + " · " + row.issue["status"]["name"].plainText,
        link: row.issue["browseUrl"].string.flatMap(URL.init(string:)))
      for entry in ReportPresentation.activity(result["activity"].array).filter({
        $0.issueKey == row.issue["key"].string
      }) {
        line(
          entry.occurredAt + " · " + entry.actor + " · " + entry.change, size: 9, color: secondary)
      }
    }
    heading("Period activity")
    let activity = Dictionary(grouping: result["activity"].array, by: { $0["type"].plainText })
    for type in activity.keys.sorted() {
      line(type + ": " + (activity[type]?.count ?? 0).formatted())
    }
    heading("Delivery pulse")
    line(
      "Completed: " + summary["completedDuringPeriod"].plainText + "    Reopened: "
        + summary["reopenedDuringPeriod"].plainText + "    Created: "
        + summary["createdIssues"].plainText)
    line("Time spent: " + hours(summary["totalTimeSpentSeconds"]), gap: 18)
    heading("People")
    for person in result["people"].array {
      line(person["user"]["displayName"].plainText, size: 13, bold: true)
      line(
        "Assigned: " + person["assignedIssues"].array.count.formatted() + "    Completed: "
          + person["completedIssues"].array.count.formatted() + "    Worklog: "
          + hours(person["worklogSeconds"]), color: secondary)
      for issue in person["assignedIssues"].array {
        line(
          issue["key"].plainText + " · " + issue["summary"].plainText + " · "
            + issue["status"]["name"].plainText,
          link: issue["browseUrl"].string.flatMap(URL.init(string:)))
        line(
          "Original Estimate: " + hours(issue["originalEstimateSeconds"])
            + " · Cumulative time spent: " + hours(issue["timeSpentSeconds"]), size: 9,
          color: secondary)
      }
    }
    if !result["unassigned"]["issues"].array.isEmpty {
      heading("Unassigned")
      for issue in result["unassigned"]["issues"].array {
        line(issue["key"].plainText + " · " + issue["summary"].plainText)
      }
    }
    if result["sprint"] != .null {
      for (key, title) in [
        ("addedAfterStart", "Added after start"), ("removedAfterStart", "Removed after start"),
      ] {
        heading(title)
        for entry in result["sprint"][key].array {
          line(entry["issue"]["key"].plainText + " · " + entry["issue"]["summary"].plainText)
        }
      }
    }
    heading("Activity log")
    line("Issue\tWho\tWhat", bold: true)
    for event in ReportPresentation.activity(result["activity"].array) {
      line(event.issueKey + "\t" + event.actor + "\t" + event.change)
      line(event.occurredAt, size: 8, color: secondary)
    }
    try write(
      attributed: output,
      header: (snapshot["board"]["name"].string ?? "Power View") + " · "
        + (snapshot["generatedAt"].string ?? ""), to: url)
  }
  private static func write(attributed: NSAttributedString, header: String, to url: URL) throws {
    let data = NSMutableData()
    var pageBounds = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
    guard let consumer = CGDataConsumer(data: data),
      let context = CGContext(consumer: consumer, mediaBox: &pageBounds, nil)
    else { throw CocoaError(.fileWriteUnknown) }
    let framesetter = CTFramesetterCreateWithAttributedString(attributed)
    var location = 0
    var page = 1
    repeat {
      context.beginPDFPage(nil)
      let headerText = NSAttributedString(
        string: header,
        attributes: [.font: NSFont.systemFont(ofSize: 9), .foregroundColor: NSColor.darkGray])
      let headerLine = CTLineCreateWithAttributedString(headerText)
      context.saveGState()
      context.clip(to: CGRect(x: 40, y: 804, width: 515, height: 18))
      context.textPosition = CGPoint(x: 40, y: 810)
      CTLineDraw(headerLine, context)
      context.restoreGState()
      let path = CGPath(rect: CGRect(x: 40, y: 50, width: 515, height: 745), transform: nil)
      let frame = CTFramesetterCreateFrame(
        framesetter, CFRange(location: location, length: 0), path, nil)
      CTFrameDraw(frame, context)
      let renderedLines = CTFrameGetLines(frame) as! [CTLine]
      var origins = Array(repeating: CGPoint.zero, count: renderedLines.count)
      CTFrameGetLineOrigins(frame, CFRange(location: 0, length: 0), &origins)
      for (index, rendered) in renderedLines.enumerated() {
        let range = CTLineGetStringRange(rendered)
        guard range.location < attributed.length,
          let link = attributed.attribute(.link, at: range.location, effectiveRange: nil) as? URL
        else { continue }
        let width = CTLineGetTypographicBounds(rendered, nil, nil, nil)
        context.setURL(
          link as CFURL,
          for: CGRect(x: 40 + origins[index].x, y: 47 + origins[index].y, width: width, height: 15))
      }
      let visible = CTFrameGetVisibleStringRange(frame)
      if attributed.length > 0 && visible.length == 0 {
        context.endPDFPage()
        context.closePDF()
        throw CocoaError(.fileWriteUnknown)
      }
      let footer = NSAttributedString(
        string: "Power View · \(page)",
        attributes: [.font: NSFont.systemFont(ofSize: 9), .foregroundColor: NSColor.black])
      context.textPosition = CGPoint(x: 40, y: 25)
      CTLineDraw(CTLineCreateWithAttributedString(footer), context)
      context.endPDFPage()
      location += visible.length
      page += 1
    } while location < attributed.length
    context.closePDF()
    // Publish only after every page has rendered successfully.
    try (data as Data).write(to: url, options: [.atomic])
  }
}
extension ReportTextRenderer {
  public static func detailed(_ snapshot: JSONValue, language: String) -> String {
    if snapshot["request"]["type"].string == "board-health" {
      return boardHealth(snapshot, language: language)
    }
    let uk = language == "uk"
    var lines = [
      render(snapshot, language: language), "", uk ? "Деталізація задач" : "Issue details",
    ]
    func hours(_ value: JSONValue) -> String {
      value.number.map { ($0 / 3600).formatted() + (uk ? " год" : "h") } ?? "N/A"
    }
    for person in snapshot["result"]["people"].array {
      lines += ["", person["user"]["displayName"].string ?? ""]
      for issue in person["assignedIssues"].array {
        lines.append(
          (issue["key"].string ?? "") + " · " + (issue["summary"].string ?? "") + " · "
            + (issue["status"]["name"].string ?? ""))
        lines.append(
          "  Original Estimate: " + hours(issue["originalEstimateSeconds"]) + " · "
            + (uk ? "Загальний залогований час: " : "Cumulative time spent: ")
            + hours(issue["timeSpentSeconds"]))
      }
    }
    lines += ["", "Unassigned"]
    for issue in snapshot["result"]["unassigned"]["issues"].array {
      lines.append(
        (issue["key"].string ?? "") + " · " + (issue["summary"].string ?? "") + " · "
          + (issue["status"]["name"].string ?? ""))
    }
    if snapshot["result"]["sprint"] != .null {
      for (key, title) in [
        ("addedAfterStart", uk ? "Додано після старту" : "Added after start"),
        ("removedAfterStart", uk ? "Виключено після старту" : "Removed after start"),
      ] {
        lines += ["", title]
        for entry in snapshot["result"]["sprint"][key].array {
          lines.append(
            (entry["issue"]["key"].string ?? "") + " · " + (entry["issue"]["summary"].string ?? ""))
          lines += entry["events"].array.compactMap { $0["occurredAt"].string }.map { "  " + $0 }
        }
      }
    }
    return lines.joined(separator: "\n")
  }
}
