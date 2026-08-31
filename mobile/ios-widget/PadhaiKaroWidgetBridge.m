#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(PadhaiKaroWidgetBridge, NSObject)
RCT_EXTERN_METHOD(update:(nonnull NSNumber *)todayMinutes pendingTopics:(nonnull NSNumber *)pendingTopics)
@end
