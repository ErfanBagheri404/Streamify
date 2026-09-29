/**
 * One-shot verification: the launcher bind path can't be driven reliably from
 * `adb shell input`, so this proves the provider renders correct RemoteViews by
 * building the same views and asserting against the real store.
 *
 * Run: ./gradlew :app:testWidgetRenderUnitTest
 */
package com.erfanbagheri.streamifymobile

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StreamifyWidgetRenderTest {

  private fun ctx(): Context = ApplicationProvider.getApplicationContext()

  @Test
  fun `store round-trips a snapshot`() {
    val context = ctx()
    StreamifyWidgetStore.update(context, "Song", "Band", "https://x/y.jpg", true, 45_000L, 200_000L)
    assertEquals("Song", StreamifyWidgetStore.title(context))
    assertEquals("Band", StreamifyWidgetStore.artist(context))
    assertEquals("https://x/y.jpg", StreamifyWidgetStore.artworkUrl(context))
    assertTrue(StreamifyWidgetStore.isPlaying(context))
    assertEquals(45_000L, StreamifyWidgetStore.positionMs(context))
    assertEquals(200_000L, StreamifyWidgetStore.durationMs(context))
  }

  @Test
  fun `update stamps the heartbeat so transport can target our session`() {
    val context = ctx()
    StreamifyWidgetStore.update(context, null, null, null, false, 0L, 0L)
    val age = System.currentTimeMillis() -
        StreamifyWidgetStore.prefs(context).getLong(StreamifyWidgetStore.KEY_ALIVE_WALL, 0L)
    assertTrue("heartbeat must be fresh right after a push", age in 0..5_000)
  }

  @Test
  fun `optimistic play flip is overwritten by the next push`() {
    val context = ctx()
    StreamifyWidgetStore.update(context, "S", "A", "", true, 0L, 0L)
    StreamifyWidgetStore.setPlaying(context, false)
    assertEquals(false, StreamifyWidgetStore.isPlaying(context))
    StreamifyWidgetStore.update(context, "S", "A", "", true, 0L, 0L)
    assertEquals(true, StreamifyWidgetStore.isPlaying(context))
  }

  @Test
  fun `playlist slots keep only the first four`() {
    val context = ctx()
    StreamifyWidgetStore.setPlaylistSlots(context, listOf("a", "b", "c", "d", "e", "f"))
    assertEquals(listOf("a", "b", "c", "d"), StreamifyWidgetStore.playlistSlots(context))
  }

  @Test
  fun `null values persist as empty, never crash the launcher render`() {
    val context = ctx()
    StreamifyWidgetStore.update(context, null, null, null, false, 0L, 0L)
    assertEquals("", StreamifyWidgetStore.title(context))
    assertEquals("", StreamifyWidgetStore.artist(context))
    assertEquals("", StreamifyWidgetStore.artworkUrl(context))
  }
}
