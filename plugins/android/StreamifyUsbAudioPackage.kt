package com.erfanbagheri.streamifymobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Package registration for StreamifyUsbAudioModule.
 * Added to MainApplication by plugins/withUsbDac.js at prebuild time.
 */
class StreamifyUsbAudioPackage : ReactPackage {
  override fun createNativeModules(
      reactContext: ReactApplicationContext,
  ): List<NativeModule> = listOf(StreamifyUsbAudioModule(reactContext))

  override fun createViewManagers(
      reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
