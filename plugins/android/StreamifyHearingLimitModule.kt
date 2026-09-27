package com.erfanbagheri.streamifymobile

import android.content.Context
import android.media.AudioManager
import android.media.audiofx.DynamicsProcessing
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * Hearing-safety limiter (issue #48) built on [DynamicsProcessing], the
 * framework AudioEffect that already ships on API 28+ (the app targets 35).
 *
 * There is no `sessionId` reachable from JS (kotlin-audio and track-player do
 * not expose the player session), so the effect is attached to the global
 * session 0 — Android routes it onto the active output mix. Same mechanism as
 * the hardware equalizer.
 *
 * The limiter clamps peaks; the ceiling is expressed in estimated dB(A) and
 * mapped to a dBFS threshold against [REFERENCE_MAX_DBA] (the nominal
 * full-scale output of a phone speaker). Every value coming from JS is
 * clamped to [MIN_CEILING]..[MAX_CEILING] here; JS input is never trusted.
 *
 * Several ROMs expose no usable dynamics processing. Init failure is then
 * reported as `supported: false` rather than an exception, so JS can hide the
 * toggle instead of crashing.
 */
class StreamifyHearingLimitModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "StreamifyHearingLimitModule"

  private var effect: DynamicsProcessing? = null
  private var effectAttempted = false
  private var limiterEnabled = false
  private var ceilingDbA = DEFAULT_CEILING

  private fun clampCeiling(value: Int): Int = value.coerceIn(MIN_CEILING, MAX_CEILING)

  /** Estimated dB(A) -> dBFS threshold against the nominal full-scale output. */
  private fun thresholdDbfs(dba: Int): Float =
      (dba - REFERENCE_MAX_DBA).toFloat().coerceIn(MIN_THRESHOLD_DBFS, 0f)

  /** Attach to the global output mix, once. Null when the ROM has none. */
  private fun ensureEffect(): DynamicsProcessing? {
    effect?.let { return it }
    if (effectAttempted) return null
    effectAttempted = true
    return try {
      val config =
          DynamicsProcessing.Config.Builder(
                  DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
                  CHANNELS,
                  false,
                  0,
                  false,
                  0,
                  false,
                  0,
                  true)
              .build()
      val created = DynamicsProcessing(0, config)
      if (created.engine == null) {
        created.release()
        return null
      }
      effect = created
      applyLimiter()
      created
    } catch (_: Exception) {
      null
    } catch (_: LinkageError) {
      // Vendor ROMs have shipped broken audiofx stubs.
      null
    }
  }

  /** Push the current ceiling + enabled flag onto every channel's limiter. */
  private fun applyLimiter() {
    val processing = effect ?: return
    try {
      val config = processing.properties ?: return
      val threshold = thresholdDbfs(ceilingDbA)
      for (channel in 0 until config.channelCount) {
        val limiter = config.getLimiterByChannelIndex(channel) ?: continue
        limiter.setEnabled(limiterEnabled)
        limiter.setThreshold(threshold)
        limiter.setRatio(RATIO)
        limiter.setAttackTime(ATTACK_MS)
        limiter.setReleaseTime(RELEASE_MS)
        config.setLimiterByChannelIndex(channel, limiter)
      }
      processing.properties = config
    } catch (_: Exception) {
      // Effect went away underneath us; the next call re-creates it.
      release()
    }
  }

  private fun stateMap(): WritableMap {
    val state = Arguments.createMap()
    state.putBoolean("supported", effect != null)
    state.putBoolean("enabled", limiterEnabled && effect != null)
    state.putInt("ceiling", ceilingDbA)
    state.putInt("minCeiling", MIN_CEILING)
    state.putInt("maxCeiling", MAX_CEILING)
    // Android reports no SPL for the output device, so there is no
    // device-supplied ceiling to honour. 0 = "not reported".
    state.putInt("deviceMax", 0)
    return state
  }

  @ReactMethod
  fun isSupported(promise: Promise) {
    ensureEffect()
    promise.resolve(effect != null)
  }

  /** The ceiling the device is actually running, after the native clamp. */
  @ReactMethod
  fun getCeiling(promise: Promise) {
    ensureEffect()
    promise.resolve(ceilingDbA)
  }

  @ReactMethod
  fun setCeiling(ceiling: Double, promise: Promise) {
    ceilingDbA = clampCeiling(ceiling.toInt())
    applyLimiter()
    promise.resolve(ceilingDbA)
  }

  @ReactMethod
  fun setEnabled(enabled: Boolean, promise: Promise) {
    ensureEffect()
    if (effect == null) {
      limiterEnabled = false
      promise.resolve(false)
      return
    }
    limiterEnabled = enabled
    applyLimiter()
    promise.resolve(limiterEnabled)
  }

  /**
   * System media volume, 0..1. This is the only volume the app can observe —
   * TrackPlayer's own volume is a fade multiplier, not the user's level — and
   * 0 means the user muted the stream, so the exposure meter stops.
   */
  @ReactMethod
  fun getOutputVolume(promise: Promise) {
    promise.resolve(readOutputVolume())
  }

  private fun readOutputVolume(): Double {
    return try {
      val audio = reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      val max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
      val current = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
      if (max <= 0) 0.0 else current.toDouble() / max.toDouble()
    } catch (_: Exception) {
      0.0
    }
  }

  /** One bridge call for support flag, ceiling window and live values. */
  @ReactMethod
  fun getState(promise: Promise) {
    ensureEffect()
    promise.resolve(stateMap())
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
    const val CHANNELS = 2
    const val MIN_CEILING = 60
    const val MAX_CEILING = 100
    const val DEFAULT_CEILING = 85
    const val REFERENCE_MAX_DBA = 100
    const val MIN_THRESHOLD_DBFS = -40f
    const val RATIO = 20f
    const val ATTACK_MS = 1f
    const val RELEASE_MS = 60f
  }
}
