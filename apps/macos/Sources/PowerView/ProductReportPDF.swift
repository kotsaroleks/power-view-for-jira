import AppKit
import PDFKit
import PowerViewCore
import WebKit

/// Native report UI remains SwiftUI; WebKit is used only as the system HTML print engine.
@MainActor final class ProductReportPDF: NSObject, WKNavigationDelegate {
  private var continuation: CheckedContinuation<Void, Error>?
  private var timeout: Task<Void, Never>?
  private var pdfContinuation: CheckedContinuation<Data, Error>?
  private let webView: WKWebView
  override init() {
    let config = WKWebViewConfiguration()
    config.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 960, height: 1200), configuration: config)
    super.init()
    webView.navigationDelegate = self
  }
  static func write(snapshot: JSONValue, language: String, to url: URL) async throws {
    let renderer = ProductReportPDF()
    guard let cssURL = Bundle.main.url(forResource: "report-print", withExtension: "css") else {
      // Command-line render checks can provide the copied product CSS explicitly.
      throw CocoaError(.fileReadNoSuchFile)
    }
    try await renderer.write(
      snapshot: snapshot, language: language, css: String(contentsOf: cssURL, encoding: .utf8),
      to: url)
  }
  func write(snapshot: JSONValue, language: String, css: String, to url: URL) async throws {
    let html = ReportHTML.build(snapshot, language: language, css: css)
    try await withCheckedThrowingContinuation { (value: CheckedContinuation<Void, Error>) in
      continuation = value
      timeout = Task { [weak self] in
        do { try await Task.sleep(for: .seconds(30)) } catch { return }
        self?.finish(URLError(.timedOut))
        self?.webView.stopLoading()
      }
      webView.loadHTMLString(html, baseURL: nil)
    }
    let rawHeight = try await webView.evaluateJavaScript(
      "Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)")
    guard let measured = rawHeight as? Double, measured.isFinite, measured > 0, measured < 250_000
    else {
      throw CocoaError(.fileWriteUnknown)
    }
    let pageHeight = 960.0 * 841.89 / 595.28
    let rawBlocks = try await webView.evaluateJavaScript(
      "Array.from(document.querySelectorAll('tr,li,.report-metric,.people-report-row')).map(e => { const r = e.getBoundingClientRect(); return {top:r.top + window.scrollY,bottom:r.bottom + window.scrollY}; })"
    )
    let blocks = rawBlocks as? [[String: Double]] ?? []
    let output = NSMutableData()
    var bounds = CGRect(x: 0, y: 0, width: 595.28, height: 841.89)
    guard let consumer = CGDataConsumer(data: output),
      let context = CGContext(consumer: consumer, mediaBox: &bounds, nil)
    else { throw CocoaError(.fileWriteUnknown) }
    var y = 0.0
    var pageCount = 0
    while y < measured {
      try Task.checkCancellation()
      guard pageCount < 200 else {
        context.closePDF()
        throw CocoaError(.fileWriteUnknown)
      }
      var end = min(measured, y + pageHeight)
      let crossing = blocks.compactMap { block -> Double? in
        guard let top = block["top"], let bottom = block["bottom"], top > y + 40,
          top < end, bottom > end, bottom - top < pageHeight
        else { return nil }
        return top
      }
      if let safe = crossing.min() { end = safe }
      let captureHeight = max(1, end - y)
      let config = WKPDFConfiguration()
      config.rect = CGRect(x: 0, y: y, width: 960, height: captureHeight)
      let data = try await capture(config)
      guard let part = PDFDocument(data: data), let rendered = part.page(at: 0),
        let reference = rendered.pageRef
      else {
        context.closePDF()
        throw CocoaError(.fileWriteUnknown)
      }
      context.beginPDFPage(nil)
      let scale = bounds.width / 960
      let offset = bounds.height - captureHeight * scale
      context.saveGState()
      context.translateBy(x: 0, y: offset)
      context.scaleBy(x: scale, y: scale)
      context.drawPDFPage(reference)
      context.restoreGState()
      for annotation in rendered.annotations {
        if let url = annotation.url {
          let r = annotation.bounds
          context.setURL(
            url as CFURL,
            for: CGRect(
              x: r.minX * scale, y: offset + r.minY * scale, width: r.width * scale,
              height: r.height * scale))
        }
      }
      context.endPDFPage()
      guard output.length < 100_000_000 else {
        context.closePDF()
        throw CocoaError(.fileWriteUnknown)
      }
      y = end
      pageCount += 1
    }
    context.closePDF()
    guard let document = PDFDocument(data: output as Data), document.pageCount > 0,
      !(document.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { throw CocoaError(.fileWriteUnknown) }
    try (output as Data).write(to: url, options: .atomic)
  }
  private func capture(_ config: WKPDFConfiguration) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in
      pdfContinuation = continuation
      timeout = Task { [weak self] in
        do { try await Task.sleep(for: .seconds(30)) } catch { return }
        self?.finish(URLError(.timedOut))
      }
      webView.createPDF(configuration: config) { [weak self] result in
        guard let self else { return }
        timeout?.cancel()
        timeout = nil
        let pending = pdfContinuation
        pdfContinuation = nil
        pending?.resume(with: result)
      }
    }
  }

  private func finish(_ error: Error? = nil) {
    timeout?.cancel()
    timeout = nil
    let pending = continuation
    continuation = nil
    if let error {
      pending?.resume(throwing: error)
      let pdf = pdfContinuation
      pdfContinuation = nil
      pdf?.resume(throwing: error)
    } else {
      pending?.resume()
    }
  }
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { finish() }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    finish(error)
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) { finish(error) }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    finish(URLError(.networkConnectionLost))
  }
}
