import Foundation
import LocalAuthentication
import Security

// One-time background setup only. Authentication UI is explicitly prohibited.
guard CommandLine.arguments.count == 3 else { exit(2) }
let expectedOrigin = CommandLine.arguments[1].trimmingCharacters(
  in: CharacterSet(charactersIn: "/"))
let preferences = UserDefaults(suiteName: "com.powerview.native")!
let origin = (preferences.string(forKey: "jira.origin") ?? "").trimmingCharacters(
  in: CharacterSet(charactersIn: "/"))
let email = preferences.string(forKey: "jira.email") ?? ""
guard origin == expectedOrigin, !email.isEmpty else { exit(3) }
let context = LAContext()
context.interactionNotAllowed = true
let query: [CFString: Any] = [
  kSecClass: kSecClassGenericPassword,
  kSecAttrService: "com.powerview.jira",
  kSecAttrAccount: origin + "|" + email,
  kSecUseAuthenticationContext: context,
  kSecReturnData: true,
  kSecMatchLimit: kSecMatchLimitOne,
]
var result: CFTypeRef?
let status = SecItemCopyMatching(query as CFDictionary, &result)
guard status == errSecSuccess, let data = result as? Data,
  let token = String(data: data, encoding: .utf8), !token.isEmpty
else { exit(4) }
let payload = try JSONSerialization.data(withJSONObject: [
  "origin": origin, "email": email, "token": token,
])
guard
  FileManager.default.createFile(
    atPath: CommandLine.arguments[2], contents: payload, attributes: [.posixPermissions: 0o600])
else { exit(5) }
