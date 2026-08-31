import Foundation
import WidgetKit

@objc(PadhaiKaroWidgetBridge)
final class PadhaiKaroWidgetBridge: NSObject {
    @objc
    func update(_ todayMinutes: NSNumber, pendingTopics: NSNumber) {
        let defaults = UserDefaults(suiteName: "group.com.padhaikaro.app")
        defaults?.set(todayMinutes.intValue, forKey: "todayMinutes")
        defaults?.set(pendingTopics.intValue, forKey: "pendingTopics")
        WidgetCenter.shared.reloadTimelines(ofKind: "PadhaiKaroWidget")
    }
}
