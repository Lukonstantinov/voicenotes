/**
 * ObjC bridge: exposes the Swift AudioCaptureModule to the React Native bridge.
 *
 * startListening / stopListening  — regular async methods (run on module queue)
 * getLatestPitch                  — blocking synchronous method; returns NSDictionary
 *                                   synchronously on the JS thread.
 *
 * In New Architecture (TurboModules), getLatestPitch is called via the JSI layer
 * which makes it inherently synchronous without blocking the bridge.
 */

#import <React/RCTBridgeModule.h>

#ifdef RCT_NEW_ARCH_ENABLED
#import "NativeAudioPitchSpec/NativeAudioPitchSpec.h"
#endif

@interface RCT_EXTERN_MODULE(AudioPitch, NSObject)

RCT_EXTERN_METHOD(startListening)
RCT_EXTERN_METHOD(stopListening)
RCT_EXTERN__BLOCKING_SYNCHRONOUS_METHOD(getLatestPitch)

@end

#ifdef RCT_NEW_ARCH_ENABLED
// Declare conformance to the codegen-generated protocol so the TurboModule
// manager can discover this module via JSI.
@interface AudioCaptureModule (TurboModule) <NativeAudioPitchSpec>
@end
#endif
