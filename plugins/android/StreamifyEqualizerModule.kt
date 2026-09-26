package com.erfanbagheri.streamifymobile

import android.media.audiofx.AudioEffect
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * Hardware equalizer (issue #28) on [AudioEffect.EFFECT_TYPE_EQUALIZER].
 *
 * There is no `sessionId` reachable from JS (kotlin-audio and track-player
 * do not expose the player session), so the effect is attached to the global
 * session 0 — Android routes it onto the active output mix.
 *
 * A few devices/ROMs have no equalizer at all; [getInfo] then resolves
 * `supported: false` instead of throwing, so the caller can hide the toggle.
 * Every value coming from JS is clamped to what the device reports; JS input
 * is never trusted.
 */
class StreamifyEqualizerModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "StreamifyEqualizerModule"

  private var effect: AudioEffect? = null

  /** Attach to the global output mix, once. Null when unsupported. */
  private fun ensureEffect(): AudioEffect? {
    effect?.let { return it }
    val created =
        try {
          AudioEffect(0, AudioEffect.EFFECT_TYPE_EQUALIZER, 0)
        } catch (_: Exception) {
          return null
        }
    if (created.initState != AudioEffect.STATE_INITIALIZED) {
      created.release()
      return null
    }
    effect = created
    return created
  }

  private fun bandCount(eq: AudioEffect): Int = eq.numberOfBands.toInt().coerceAtLeast(0)

  /** Device-reported millibel window, or null when the effect exposes none. */
  private fun levelRange(eq: AudioEffect): Pair<Int, Int>? {
    val range = eq.bandLevelRange
    val min = range?.first?.toInt()
    val max = range?.last?.toInt()
    if (min == null || max == null || min > max) return null
    return min to max
  }

  private fun unsupportedInfo(): WritableMap {
    val info = Arguments.createMap()
    info.putBoolean("supported", false)
    info.putInt("numberOfBands", 0)
    info.putInt("minMillibel", 0)
    info.putInt("maxMillibel", 0)
    info.putArray("levels", Arguments.createArray())
    return info
  }

  /**
   * Single call for the whole feature: support flag, band count, millibel
   * window and current levels. One bridge call beats three.
   */
  @ReactMethod
  fun getInfo(promise: Promise) {
    val eq = ensureEffect() ?: run {
      promise.resolve(unsupportedInfo())
      return
    }
    val bands = bandCount(eq)
    val range = levelRange(eq)
    val info = Arguments.createMap()
    info.putBoolean("supported", bands > 0 && range != null)
    info.putInt("numberOfBands", bands)
    info.putInt("minMillibel", range?.first ?: 0)
    info.putInt("maxMillibel", range?.second ?: 0)
    val levels = Arguments.createArray()
    // Center frequencies label the bands in the UI; harmless when unsupported.
    val freqs = Arguments.createArray()
    for (band in 0 until bands) {
      freqs.pushInt(eq.getCenterFreq(band.toShort()))
      if (range != null) {
        val millibel = eq.getBandLevel(band.toShort()).toInt()
        levels.pushDouble(millibel.coerceIn(range.first, range.second).toDouble())
      }
    }
    info.putArray("levels", levels)
    info.putArray("centerFreqHz", freqs)
    promise.resolve(info)
  }

  /** Band index and gain are clamped to the device range, never trusted. */
  @ReactMethod
  fun setBandLevel(band: Double, millibel: Double, promise: Promise) {
    val eq = ensureEffect()
    val range = eq?.let { levelRange(it) }
    if (eq == null || range == null || bandCount(eq) == 0) {
      promise.reject(ERROR_UNSUPPORTED, "Equalizer is not available on this device")
      return
    }
    val index = band.toInt().coerceIn(0, bandCount(eq) - 1)
    val clamped = millibel.toInt().coerceIn(range.first, range.second)
    eq.setBandLevel(index.toShort(), clamped.toShort())
    promise.resolve(clamped.toDouble())
  }

  @ReactMethod
  fun setEnabled(enabled: Boolean, promise: Promise) {
    val eq = ensureEffect()
    if (eq == null) {
      promise.reject(ERROR_UNSUPPORTED, "Equalizer is not available on this device")
      return
    }
    eq.enabled = enabled
    promise.resolve(eq.enabled)
  }

  /** Release the audio effect; called when the RN instance goes away. */
  override fun invalidate() {
    release()
    super.invalidate()
  }

  private fun release() {
    try {
      effect?.release()
    } catch (_: Exception) {
      // Already torn down by the audio stack.
    }
    effect = null
  }

  private companion object {
    const val ERROR_UNSUPPORTED = "EQUALIZER_UNSUPPORTED"
  }
}
