package com.erfanbagheri.streamifymobile

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.util.LruCache
import android.view.KeyEvent
import android.view.View
import android.widget.RemoteViews
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Home-screen player widget (issue #29).
 *
 * Classic RemoteViews + AppWidgetProvider rather than Jetpack Glance: the app
 * ships no Compose runtime, and Glance would pull in Compose + media3 for one
 * widget. RemoteViews is platform-only and needs no new dependency.
 *
 * Layout is chosen from the widget's current OPTION_APPWIDGET_MIN_WIDTH so one
 * provider serves small/medium/large and everything in between — Android
 * hands us the measured size, which is what "resizeable" actually means here.
 */
class StreamifyWidgetProvider : AppWidgetProvider() {

  companion object {
    const val ACTION_REFRESH = "com.erfanbagheri.streamifymobile.widget.REFRESH"

    /** ~8 MB, counted in KB of bitmap rather than entries. */
    private val artworkCache =
        object : LruCache<String, Bitmap>(8 * 1024) {
          override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount / 1024
        }

    private val artworkLoader = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "streamify-widget-artwork").apply { isDaemon = true }
    }

    fun refreshAll(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, StreamifyWidgetProvider::class.java))
      if (ids.isEmpty()) return
      for (id in ids) {
        manager.updateAppWidget(id, buildViews(context, id))
      }
    }

    /** One provider serves every size; Android reports the measured width. */
    private fun layoutFor(minWidthDp: Int): Int =
        when {
          minWidthDp >= 300 -> R.layout.widget_player_large
          minWidthDp >= 190 -> R.layout.widget_player_medium
          else -> R.layout.widget_player_small
        }

    private fun buildViews(context: Context, widgetId: Int): RemoteViews {
      val manager = AppWidgetManager.getInstance(context)
      val options = manager.getAppWidgetOptions(widgetId)
      val minWidth = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110)
      val layout = layoutFor(minWidth)
      val views = RemoteViews(context.packageName, layout)

      val title = StreamifyWidgetStore.title(context)
      val artist = StreamifyWidgetStore.artist(context)
      val playing = StreamifyWidgetStore.isPlaying(context)

      views.setTextViewText(R.id.widget_title, title.ifBlank { context.getString(R.string.widget_no_track) })
      views.setTextViewText(R.id.widget_artist, artist)
      views.setImageViewResource(
          R.id.widget_play_pause,
          if (playing) R.drawable.ic_widget_pause else R.drawable.ic_widget_play,
      )
      views.setViewVisibility(
          R.id.widget_artist,
          if (artist.isBlank()) View.GONE else View.VISIBLE,
      )

      views.setOnClickPendingIntent(
          R.id.widget_play_pause,
          commandIntent(context, if (playing) KeyEvent.KEYCODE_MEDIA_PAUSE else KeyEvent.KEYCODE_MEDIA_PLAY),
      )
      views.setOnClickPendingIntent(
          R.id.widget_prev,
          commandIntent(context, KeyEvent.KEYCODE_MEDIA_PREVIOUS),
      )
      views.setOnClickPendingIntent(
          R.id.widget_next,
          commandIntent(context, KeyEvent.KEYCODE_MEDIA_NEXT),
      )
      // Tapping artwork or the title opens the app (artwork has no click
      // handler of its own so it would swallow the tap).
      val openApp = openAppIntent(context, null)
      views.setOnClickPendingIntent(R.id.widget_artwork, openApp)
      views.setOnClickPendingIntent(R.id.widget_title, openApp)

      if (layout != R.layout.widget_player_small) {
        val duration = StreamifyWidgetStore.durationMs(context)
        val position = StreamifyWidgetStore.positionMs(context)
        val progress =
            if (duration > 0) ((position * 100) / duration).coerceIn(0L, 100L).toInt() else 0
        views.setProgressBar(R.id.widget_progress, 100, progress, false)
      }

      if (layout == R.layout.widget_player_large) {
        val slots = StreamifyWidgetStore.playlistSlots(context)
        val slotIds =
            intArrayOf(R.id.widget_slot_0, R.id.widget_slot_1, R.id.widget_slot_2, R.id.widget_slot_3)
        for (i in slotIds.indices) {
          val name = slots.getOrNull(i)
          views.setTextViewText(
              slotIds[i],
              name ?: context.getString(R.string.widget_empty_slot),
          )
          views.setOnClickPendingIntent(slotIds[i], openAppIntent(context, name))
        }
      }

      applyArtwork(context, views, widgetId)
      return views
    }

    private fun commandIntent(context: Context, keyCode: Int): PendingIntent {
      val intent =
          Intent(context, StreamifyWidgetActions::class.java).apply {
            action = StreamifyWidgetActions.ACTION_COMMAND
            putExtra(StreamifyWidgetActions.EXTRA_KEY_CODE, keyCode)
          }
      return PendingIntent.getBroadcast(
          context,
          keyCode,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
      )
    }

    private fun openAppIntent(context: Context, playlist: String?): PendingIntent {
      val launch =
          Intent(context, MainActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (playlist != null) {
              putExtra(StreamifyWidgetActions.EXTRA_OPEN_PLAYLIST, playlist)
            }
          }
      return PendingIntent.getActivity(
          context,
          playlist?.hashCode() ?: 0,
          launch,
          PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
      )
    }

    private fun immutableFlag(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0

    /**
     * Artwork: cache hit sets it synchronously; otherwise show the note
     * placeholder and load on a single background thread, then push the
     * widget again. A `file://` or `content://` source (cached/downloaded
     * track) is read from disk instead of the network.
     */
    private fun applyArtwork(context: Context, views: RemoteViews, widgetId: Int) {
      val url = StreamifyWidgetStore.artworkUrl(context)
      if (url.isBlank()) {
        views.setImageViewResource(R.id.widget_artwork, R.drawable.ic_music_note)
        return
      }
      val cached = artworkCache.get(url)
      if (cached != null) {
        views.setImageViewBitmap(R.id.widget_artwork, cached)
        return
      }
      views.setImageViewResource(R.id.widget_artwork, R.drawable.ic_music_note)
      artworkLoader.execute {
        val bitmap = loadArtwork(context, url) ?: return@execute
        // Drop stale loads: the track may have changed while this downloaded.
        if (StreamifyWidgetStore.artworkUrl(context) != url) return@execute
        artworkCache.put(url, bitmap)
        try {
          AppWidgetManager.getInstance(context).updateAppWidget(widgetId, buildViews(context, widgetId))
        } catch (e: Exception) {
          // Widget removed while loading; nothing to update.
        }
      }
    }

    private fun loadArtwork(context: Context, url: String): Bitmap? {
      return try {
        if (url.startsWith("file://") || url.startsWith("content://")) {
          val uri = android.net.Uri.parse(url)
          context.contentResolver.openInputStream(uri)?.use { stream ->
            decodeScaled(readCapped(stream), MAX_ART_PX)
          }
        } else {
          val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 6000
            readTimeout = 6000
            instanceFollowRedirects = true
          }
          try {
            if (connection.responseCode !in 200..299) {
              null
            } else {
              connection.inputStream.use { stream -> decodeScaled(readCapped(stream), MAX_ART_PX) }
            }
          } finally {
            connection.disconnect()
          }
        }
      } catch (e: Exception) {
        null
      }
    }

    /**
     * Read at most MAX_ART_BYTES. A hostile or broken server must not be able
     * to OOM the launcher just because our widget asked for artwork.
     */
    private fun readCapped(stream: java.io.InputStream): ByteArray {
      val out = java.io.ByteArrayOutputStream()
      val buf = ByteArray(16 * 1024)
      var total = 0
      while (total < MAX_ART_BYTES) {
        val read = stream.read(buf, 0, minOf(buf.size, MAX_ART_BYTES - total))
        if (read <= 0) break
        out.write(buf, 0, read)
        total += read
      }
      return out.toByteArray()
    }

    /**
     * Two-pass decode: measure, then subsample, so a 1000px source doesn't cost
     * 4 MB of heap per widget render.
     */
    private fun decodeScaled(bytes: ByteArray, maxPx: Int): Bitmap? {
      if (bytes.isEmpty()) return null
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      var sample = 1
      var largest = maxOf(bounds.outWidth, bounds.outHeight)
      while (largest / sample > maxPx) sample *= 2
      val opts = BitmapFactory.Options().apply { inSampleSize = sample }
      return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
    }

    private const val MAX_ART_PX = 512
    private const val MAX_ART_BYTES = 2 * 1024 * 1024
  }

  override fun onUpdate(context: Context, manager: AppWidgetManager, widgetIds: IntArray) {
    for (id in widgetIds) {
      manager.updateAppWidget(id, buildViews(context, id))
    }
  }

  override fun onAppWidgetOptionsChanged(
      context: Context,
      manager: AppWidgetManager,
      appWidgetId: Int,
      newOptions: Bundle?,
  ) {
    manager.updateAppWidget(appWidgetId, buildViews(context, appWidgetId))
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (intent.action == ACTION_REFRESH) refreshAll(context)
  }
}
