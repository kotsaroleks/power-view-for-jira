import Testing

@testable import PowerViewCore

@Test func macOSUpdateOnlyOffersOurPublishedPackage() throws {
  let release: JSONValue = .object([
    "tag_name": .string("v0.2.0"),
    "html_url": .string("https://github.com/kotsaroleks/power-view-for-jira/releases/tag/v0.2.0"),
    "draft": .bool(false), "prerelease": .bool(false),
    "assets": .array([
      .object([
        "name": .string("extension.zip"),
        "browser_download_url": .string("https://example.com/not-a-mac.zip"),
      ]),
      .object([
        "name": .string("power-view-macos-arm64.zip"),
        "browser_download_url": .string(
          "https://github.com/kotsaroleks/power-view-for-jira/releases/download/v0.2.0/power-view-macos-arm64.zip"
        ),
      ]),
    ]),
  ])
  let result = try ApplicationUpdates.parse(release, currentVersion: "0.1.9")
  #expect(result.newer)
  #expect(result.package?.lastPathComponent == "power-view-macos-arm64.zip")
  #expect(try !ApplicationUpdates.parse(release, currentVersion: "0.2.0").newer)
}
