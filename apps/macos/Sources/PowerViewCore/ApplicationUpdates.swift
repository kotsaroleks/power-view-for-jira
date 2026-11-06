import Foundation

public struct ApplicationRelease: Sendable, Equatable {
  public let version: String
  public let page: URL
  public let package: URL?
  public let newer: Bool
}
public enum ApplicationUpdates {
  public static func parse(_ value: JSONValue, currentVersion: String) throws -> ApplicationRelease
  {
    guard let tag = value["tag_name"].string,
      let rawPage = value["html_url"].string, let page = URL(string: rawPage),
      page.scheme == "https", page.host == "github.com",
      page.path.hasPrefix("/kotsaroleks/power-view-for-jira/releases/"),
      value["draft"].boolean == false, value["prerelease"].boolean == false
    else { throw JiraError.unexpectedResponse }
    let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
    guard version.range(of: "^[0-9]+(?:\\.[0-9]+){1,3}$", options: .regularExpression) != nil else {
      throw JiraError.unexpectedResponse
    }
    let asset = value["assets"].array.first {
      let name = $0["name"].plainText.lowercased()
      return (name.contains("macos") || name.contains("power-view-mac"))
        && (name.hasSuffix(".zip") || name.hasSuffix(".dmg"))
    }
    let package = asset?["browser_download_url"].string.flatMap(URL.init(string:)).flatMap { url in
      url.scheme == "https" && url.host == "github.com"
        && url.path.hasPrefix("/kotsaroleks/power-view-for-jira/releases/download/") ? url : nil
    }
    return .init(
      version: version, page: page, package: package,
      newer: version.compare(currentVersion, options: .numeric) == .orderedDescending)
  }
  public static func check(
    currentVersion: String, transport: any JiraTransport = JiraURLTransport()
  ) async throws -> ApplicationRelease {
    var request = URLRequest(
      url: URL(
        string: "https://api.github.com/repos/kotsaroleks/power-view-for-jira/releases/latest")!)
    request.timeoutInterval = 20
    request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
    let (data, response) = try await transport.send(request)
    guard response.statusCode == 200 else { throw JiraError.http(response.statusCode) }
    return try parse(
      JSONDecoder().decode(JSONValue.self, from: data), currentVersion: currentVersion)
  }
}
