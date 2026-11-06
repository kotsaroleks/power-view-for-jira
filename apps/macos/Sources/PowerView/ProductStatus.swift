import Charts
import PowerViewCore
import SwiftUI

struct ProductStatus: View {
  let snapshot: WorkspaceSnapshot?
  private let palette: [UInt32] = [
    0x0c66e4, 0x22a06b, 0x7e57c2, 0xe56910, 0xc9372c, 0x1d7a8c, 0x8f5c00, 0x5e6c84, 0xb65c9a,
    0x6a9a23,
  ]
  var body: some View {
    let distribution = StatusDistribution.build(snapshot?.issues ?? [])
    VStack(alignment: .leading, spacing: 32) {
      HStack(alignment: .top) {
        VStack(alignment: .leading, spacing: 10) {
          PV.eyebrow("BOARD STATUS")
          Text(snapshot?.boardName ?? "Status chart").font(.system(size: 28, weight: .bold))
          Text("Issue distribution across every Jira status.").foregroundStyle(PV.secondary)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 8) {
          Text("Board  \(snapshot?.boardID ?? "—")")
          Text(
            "Updated  "
              + (snapshot?.loadedAt.formatted(date: .abbreviated, time: .shortened) ?? "—"))
        }.font(.system(size: 12)).foregroundStyle(PV.secondary)
      }
      if snapshot?.truncated == true {
        Text("This workspace reached its issue limit. The chart reflects the loaded issues only.")
          .font(.system(size: 13)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
          .background(Color(hex: 0xfff7d6))
      }
      if distribution.isEmpty {
        VStack(spacing: 12) {
          Text("○").font(.system(size: 48))
          Text("No issues to chart").font(.title2.bold())
          Text("The selected board did not return any issues for the configured JQL.")
            .foregroundStyle(PV.secondary)
        }.frame(maxWidth: .infinity).padding(48)
      } else {
        HStack(alignment: .center, spacing: 64) {
          VStack(spacing: 16) {
            Chart(Array(distribution.enumerated()), id: \.element.id) { index, item in
              SectorMark(
                angle: .value("Issues", item.count), innerRadius: .ratio(0), angularInset: 0
              ).foregroundStyle(Color(hex: palette[index % palette.count]))
            }.frame(width: 320, height: 320).overlay {
              VStack(spacing: 2) {
                Text(String(snapshot?.issues.count ?? 0)).font(.system(size: 36, weight: .bold))
                Text("issues").font(.system(size: 12)).foregroundStyle(PV.secondary)
              }.frame(width: 100, height: 100).background(.white, in: Circle())
            }
            Text("\(distribution.count) statuses").font(.system(size: 13)).foregroundStyle(
              PV.secondary)
          }
          VStack(spacing: 22) {
            ForEach(Array(distribution.enumerated()), id: \.element.id) { index, item in
              VStack(spacing: 10) {
                HStack(spacing: 12) {
                  RoundedRectangle(cornerRadius: 4).fill(Color(hex: palette[index % palette.count]))
                    .frame(width: 14, height: 14)
                  VStack(alignment: .leading, spacing: 4) {
                    Text(item.name).fontWeight(.semibold)
                    Text("\(item.count) issues").font(.system(size: 12)).foregroundStyle(
                      PV.secondary)
                  }
                  Spacer()
                  Text(item.percentage.formatted(.number.precision(.fractionLength(0...1))) + "%")
                    .font(.system(size: 18, weight: .bold))
                }
                GeometryReader { geometry in
                  RoundedRectangle(cornerRadius: 3).fill(PV.subtle).overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 3).fill(
                      Color(hex: palette[index % palette.count])
                    ).frame(width: geometry.size.width * item.percentage / 100)
                  }
                }.frame(height: 5)
              }
            }
          }.frame(maxWidth: .infinity)
        }.padding(.vertical, 16)
      }
    }.padding(32).productCard(20)
  }
}
