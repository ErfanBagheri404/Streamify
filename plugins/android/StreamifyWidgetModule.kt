package com.erfanbagheri.streamifymobile

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * JS → widget sync. Fire-and-forget: every method writes SharedPreferences and
 * pokes the AppWidgetProvider, which is cheap enough to run on the RN native
 * queue. Any launcher/permission failure is swallowed — a widget update must
 * never be able to crash playback.
 */
class StreamifyWidgetModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "StreamifyWidgetModule"

  @ReactMethod
  fun updateState(
      title: String?,
      artist: String?,
      artworkUrl: String?,
      isPlaying: Boolean,
      positionMs: Double,
      durationMs: Double,
  ) {
    try {
      val store = StreamifyWidgetStore
      store.update(
          reactApplicationContext,
          title,
          artist,
          artworkUrl,
          isPlaying,
          positionMs.toLong(),
          durationMs.toLong(),
      )
      StreamifyWidgetProvider.refreshAll(reactApplicationContext)
    } catch (e: Exception) {
      // Launcher may be unavailable (work profile, locked state); ignore.
    }
  }

  @ReactMethod
  fun setPlaylistSlots(names: ReadableArray) {
    try {
      val list = (0 until names.size()).mapNotNull { names.getString(it) }
      StreamifyWidgetStore.setPlaylistSlots(reactApplicationContext, list)
      StreamifyWidgetProvider.refreshAll(reactApplicationContext)
    } catch (e: Exception) {
      // Same as updateState: never propagate into JS playback paths.
    }
  }
}
