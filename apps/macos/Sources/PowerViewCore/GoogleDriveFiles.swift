import Foundation

public enum GoogleDriveFileError: Error, Equatable {
  case invalidIdentifier, invalidName, tooLarge, invalidResponse, denied, notFound
  case requestFailed(Int)
}

public struct GoogleDriveFile: Codable, Sendable, Equatable {
  public let id: String
  public let name: String
  public let mimeType: String
}

/// Direct Drive file storage. Creates a new snapshot rather than silently replacing a shared file.
public struct GoogleDriveFiles: Sendable {
  private let transport: any JiraTransport
  private let token: @Sendable () async throws -> String
  private static let maximumBytes = 5 * 1024 * 1024

  public init(
    accessToken: @escaping @Sendable () async throws -> String,
    transport: any JiraTransport = JiraURLTransport()
  ) {
    token = accessToken
    self.transport = transport
  }

  public func createSnapshot(name: String, folderID: String, data: Data) async throws
    -> GoogleDriveFile
  {
    try Self.validate(folderID)
    guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      name.hasSuffix(".pvrelease"), !name.contains("\r"), !name.contains("\n")
    else { throw GoogleDriveFileError.invalidName }
    guard data.count <= Self.maximumBytes else { throw GoogleDriveFileError.tooLarge }
    let boundary = "powerview-" + UUID().uuidString
    let metadata = try JSONSerialization.data(withJSONObject: [
      "name": name, "parents": [folderID], "mimeType": "application/json",
    ])
    var body = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8)
    body.append(metadata)
    body.append(Data("\r\n--\(boundary)\r\nContent-Type: application/json\r\n\r\n".utf8))
    body.append(data)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    var request = URLRequest(
      url: URL(
        string:
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType"
      )!)
    request.httpMethod = "POST"
    request.setValue("multipart/related; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    let response = try await send(request)
    let file = try JSONDecoder().decode(GoogleDriveFile.self, from: response)
    try Self.validate(file.id)
    guard file.name == name, file.mimeType == "application/json" else {
      throw GoogleDriveFileError.invalidResponse
    }
    return file
  }

  public func download(fileID: String) async throws -> Data {
    try Self.validate(fileID)
    return try await send(
      URLRequest(
        url: URL(
          string:
            "https://www.googleapis.com/drive/v3/files/\(fileID)?alt=media&supportsAllDrives=true")!
      ))
  }

  private static func validate(_ identifier: String) throws {
    guard identifier.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil else {
      throw GoogleDriveFileError.invalidIdentifier
    }
  }

  private func send(_ original: URLRequest) async throws -> Data {
    var request = original
    request.setValue("Bearer " + (try await token()), forHTTPHeaderField: "Authorization")
    let (data, response) = try await transport.send(request)
    guard response.url?.scheme == "https", response.url?.host == "www.googleapis.com" else {
      throw GoogleDriveFileError.invalidResponse
    }
    switch response.statusCode {
    case 200...299: break
    case 401, 403: throw GoogleDriveFileError.denied
    case 404: throw GoogleDriveFileError.notFound
    default: throw GoogleDriveFileError.requestFailed(response.statusCode)
    }
    guard data.count <= Self.maximumBytes else { throw GoogleDriveFileError.tooLarge }
    return data
  }
}
