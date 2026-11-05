package com.erfanbagheri.streamifymobile

import android.content.Context
import android.content.SharedPreferences

/**
 * Shared widget state, written by JS on every track/player-state change and
 * read by [StreamifyWidgetProvider] when rendering.
 *
 * RNTP's MusicService is a HeadlessJsTaskService: it only answers transport
 * commands while the JS runtime is alive, so the widget is a mirror of state
 * JS already knows rather than an independent player. Persisting here means
 * the launcher shows the last known track even after the process is killed.
 */
object StreamifyWidgetStore {
  private const val PREFS = "streamify_widget_state"
  private const val KEY_TITLE = "title"
  private const val KEY_ARTIST = "artist"
  private const val KEY_ARTWORK = "artwork_url"
  private const val KEY_IS_PLAYING = "is_playing"
  private const val KEY_POSITION = "position_ms"
  private const val KEY_DURATION = "duration_ms"
  private const val KEY_SLOTS = "playlist_slots"

  /**
   * Wall-clock stamp of the last state push. JS pushes progress every second
   * while playing, so a fresh stamp means the JS runtime is alive and a
   * transport key can go straight to our media session. Widget transport must
   * NOT blindly dispatch media keys: with our process dead the key would land
   * on whatever app *is* playing (Spotify, YouTube Music), so a stale stamp
   * makes the button open the app instead.
   */
  const val KEY_ALIVE_WALL = "alive_wall"

  fun prefs(context: Context): SharedPreferences =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun update(
      context: Context,
      title: String?,
      artist: String?,
      artworkUrl: String?,
      isPlaying: Boolean,
      positionMs: Long,
      durationMs: Long,
  ) {
    prefs(context)
        .edit()
        .putString(KEY_TITLE, title ?: "")
        .putString(KEY_ARTIST, artist ?: "")
        .putString(KEY_ARTWORK, artworkUrl ?: "")
        .putBoolean(KEY_IS_PLAYING, isPlaying)
        .putLong(KEY_POSITION, positionMs)
        .putLong(KEY_DURATION, durationMs)
        .putLong(KEY_ALIVE_WALL, System.currentTimeMillis())
        .apply()
  }

  /** Optimistic transport flip; the next JS push overwrites it with truth. */
  fun setPlaying(context: Context, playing: Boolean) {
    prefs(context).edit().putBoolean(KEY_IS_PLAYING, playing).apply()
  }

  /** Recently played playlist names, pipe-separated (max 4). */
  fun setPlaylistSlots(context: Context, names: List<String>) {
    prefs(context).edit().putString(KEY_SLOTS, names.take(4).joinToString("|")).apply()
  }

  fun playlistSlots(context: Context): List<String> {
    val raw = prefs(context).getString(KEY_SLOTS, "") ?: ""
    return raw.split("|").filter { it.isNotBlank() }.take(4)
  }

  fun title(context: Context): String =
      prefs(context).getString(KEY_TITLE, "").orEmpty()

  fun artist(context: Context): String =
      prefs(context).getString(KEY_ARTIST, "").orEmpty()

  fun artworkUrl(context: Context): String =
      prefs(context).getString(KEY_ARTWORK, "").orEmpty()

  fun isPlaying(context: Context): Boolean =
      prefs(context).getBoolean(KEY_IS_PLAYING, false)

  fun positionMs(context: Context): Long =
      prefs(context).getLong(KEY_POSITION, 0L)

  fun durationMs(context: Context): Long =
      prefs(context).getLong(KEY_DURATION, 0L)
}
