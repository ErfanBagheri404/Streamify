package com.erfanbagheri.streamifymobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.view.KeyEvent

/**
 * Widget transport buttons.
 *
 * A widget button arrives here through a broadcast, so this process is alive —
 * but the JS runtime (and therefore RNTP's media session) may not be. A fresh
 * heartbeat stamp, written by the JS sync on every state push, means it is.
 *
 * Fresh stamp: inject the key through `AudioManager.dispatchMediaKeyEvent`,
 * which routes to the ACTIVE media session. Ours, because ours is the one
 * that was just pushing state. No permission needed.
 *
 * Stale stamp: our session is gone, so the key would be stolen by whatever
 * app is actually playing (Spotify, YouTube Music). Open the app instead.
 */
class StreamifyWidgetActions : BroadcastReceiver() {

  companion object {
    const val ACTION_COMMAND = "com.erfanbagheri.streamifymobile.widget.COMMAND"
    const val EXTRA_KEY_CODE = "com.erfanbagheri.streamifymobile.widget.KEY_CODE"
    const val EXTRA_OPEN_PLAYLIST = "streamify.widget.playlist"
    private const val HEARTBEAT_MAX_AGE_MS = 60_000L

    fun dispatch(context: Context, keyCode: Int) {
      val prefs = StreamifyWidgetStore.prefs(context)
      val age = System.currentTimeMillis() - prefs.getLong(StreamifyWidgetStore.KEY_ALIVE_WALL, 0L)
      if (age in 0 until HEARTBEAT_MAX_AGE_MS) {
        val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        audio.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
        // Optimistic icon flip; the next JS push corrects it.
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY || keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
          StreamifyWidgetStore.setPlaying(context, !StreamifyWidgetStore.isPlaying(context))
        }
        StreamifyWidgetProvider.refreshAll(context)
        return
      }
      context.startActivity(
          Intent(context, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP)
          })
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION_COMMAND) return
    val keyCode = intent.getIntExtra(EXTRA_KEY_CODE, 0)
    if (keyCode != 0) dispatch(context, keyCode)
  }
}
