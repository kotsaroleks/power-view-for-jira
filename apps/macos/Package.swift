// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "PowerView", platforms: [.macOS(.v14)],
  products: [.executable(name: "PowerView", targets: ["PowerView"])],
  targets: [
    .target(name: "PowerViewCore"),
    .executableTarget(name: "PowerView", dependencies: ["PowerViewCore"]),
    .testTarget(
      name: "PowerViewCoreTests", dependencies: ["PowerViewCore"], resources: [.copy("Fixtures")]),
    .testTarget(name: "PowerViewApplicationTests", dependencies: ["PowerView", "PowerViewCore"], resources: [.copy("Fixtures")]),
  ]
)
