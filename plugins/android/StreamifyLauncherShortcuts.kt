package com.erfanbagheri.streamifymobile

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat

/**
 * Dynamic launcher shortcuts (issue #34): recently-played tracks pushed from
 * JS. Each taps into a `streamify://track/<id>` deep link — a plain
 * ACTION_VIEW on the scheme MainActivity already declares, so no native
 * handling is needed beyond this registration.
 *
 * The launcher caps published shortcuts (typically 5); keeping only 2 dynamic
 * leaves room for the 4 static entries in res/xml/shortcuts.xml.
 */
object StreamifyLauncherShortcuts {

  fun updateRecentTracks(
      context: Context,
      ids: List<String>,
      titles: List<String>,
      artists: List<String>,
  ) {
    try {
      // Re-push the 2 most recent tracks; pushDynamicShortcut() bumps each to
      // the front and lets the launcher trim the excess.
      for (i in ids.indices.take(2)) {
        val title = titles.getOrNull(i) ?: ""
        if (title.isBlank()) continue
        val id = ids[i]
        val shortcut =
            ShortcutInfoCompat.Builder(context, "track_$id")
                .setShortLabel(title)
                .setLongLabel(
                    artists.getOrNull(i)?.takeIf { it.isNotBlank() } ?: title)
                .setIcon(
                    IconCompat.createWithResource(
                        context, R.drawable.ic_shortcut_resume))
                .setIntent(
                    Intent(Intent.ACTION_VIEW, Uri.parse("streamify://track/$id"))
                        .setClass(context, MainActivity::class.java))
                .build()
        ShortcutManagerCompat.pushDynamicShortcut(context, shortcut)
      }
    } catch (_: Exception) {
      // Launcher may not support dynamic shortcuts; never crash playback.
    }
  }
}
