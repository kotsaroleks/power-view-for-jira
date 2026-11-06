import SwiftUI

struct TimelineCalendarSettings: View {
  @Binding var nonWorkingDays: [Int]
  @Binding var durations: [String: Double]
  let canEdit: Bool
  private let weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
  private let kinds: [(String, String, Double)] = [
    ("subtask", "Subtask", 1), ("task", "Task", 3), ("bug", "Bug", 3),
    ("story", "Story", 5), ("epic", "Epic", 10), ("unknown", "Unknown issue type", 3),
  ]
  private func duration(_ kind: (String, String, Double)) -> Double {
    guard let value = durations[kind.0], value.isFinite else { return kind.2 }
    return min(365, max(1, value.rounded()))
  }
  var body: some View {
    DisclosureGroup("Working calendar and default durations") {
      VStack(alignment: .leading, spacing: 16) {
        Text("Non-working days").font(.headline)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 72), alignment: .leading)], spacing: 10) {
          ForEach(0..<7, id: \.self) { day in
            Toggle(
              weekdays[day],
              isOn: Binding(
                get: { nonWorkingDays.contains(day) },
                set: { excluded in
                  if excluded {
                    nonWorkingDays = Array(Set(nonWorkingDays + [day])).sorted()
                  } else {
                    nonWorkingDays.removeAll { $0 == day }
                  }
                })
            )
            .disabled(!canEdit || (!nonWorkingDays.contains(day) && nonWorkingDays.count >= 6))
          }
        }
        Text(
          "Fallback durations in working days. Issues without either Jira date remain unscheduled."
        )
        .font(.caption).foregroundStyle(.secondary)
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), alignment: .leading)], spacing: 12) {
          ForEach(kinds, id: \.0) { kind in
            Stepper(
              value: Binding(
                get: { duration(kind) },
                set: { durations[kind.0] = $0 }), in: 1...365, step: 1
            ) {
              VStack(alignment: .leading, spacing: 4) {
                Text(kind.1).font(.system(size: 13, weight: .semibold))
                Text("\(Int(duration(kind))) working days").font(.system(size: 12)).foregroundStyle(
                  PV.secondary
                ).monospacedDigit()
              }
            }.disabled(!canEdit).padding(12).background(
              PV.background, in: RoundedRectangle(cornerRadius: 8))
          }
        }
      }.padding(.vertical, 6)
    }
  }
}
