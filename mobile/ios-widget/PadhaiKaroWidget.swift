import WidgetKit
import SwiftUI

struct PadhaiKaroWidgetEntry: TimelineEntry {
    let date: Date
    let todayMinutes: Int
    let pendingTopics: Int
}

struct PadhaiKaroWidgetProvider: TimelineProvider {
    private let defaults = UserDefaults(suiteName: "group.com.padhaikaro.app")

    func placeholder(in context: Context) -> PadhaiKaroWidgetEntry { PadhaiKaroWidgetEntry(date: Date(), todayMinutes: 0, pendingTopics: 0) }
    func getSnapshot(in context: Context, completion: @escaping (PadhaiKaroWidgetEntry) -> Void) { completion(entry()) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<PadhaiKaroWidgetEntry>) -> Void) {
        completion(Timeline(entries: [entry()], policy: .after(Date().addingTimeInterval(15 * 60))))
    }
    private func entry() -> PadhaiKaroWidgetEntry {
        PadhaiKaroWidgetEntry(date: Date(), todayMinutes: defaults?.integer(forKey: "todayMinutes") ?? 0, pendingTopics: defaults?.integer(forKey: "pendingTopics") ?? 0)
    }
}

struct PadhaiKaroWidgetView: View {
    let entry: PadhaiKaroWidgetEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PadhaiKaro").font(.headline)
            Text("\(entry.todayMinutes) min studied").font(.title3).bold()
            Text("\(entry.pendingTopics) topics pending").font(.caption)
        }.padding()
    }
}

@main
struct PadhaiKaroWidget: Widget {
    let kind = "PadhaiKaroWidget"
    var body: some WidgetConfiguration { StaticConfiguration(kind: kind, provider: PadhaiKaroWidgetProvider()) { entry in PadhaiKaroWidgetView(entry: entry) }.configurationDisplayName("PadhaiKaro progress").description("Today’s study time and pending topics.") }
}
