package com.erfanbagheri.streamifymobile

import android.content.ComponentName
import android.content.Context
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.view.KeyEvent

/**
 * Quick Settings play/pause tile (issue #34).
 *
 * Mirrors [StreamifyWidgetActions]' heartbeat gate: a media key may only be
 * dispatched while our own session is live, because with Streamify dead the
 * key would be consumed by whatever app is actually playing.
 */
class StreamifyPlaybackTileService : TileService() {

  override fun onStartListening() {
    super.onStartListening()
    render()
  }

  override fun onClick() {
    super.onClick()
    // dispatch() performs the optimistic icon flip, so the next JS state push
    // corrects it if the key did not reach our session.
    StreamifyWidgetActions.dispatch(this, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
    render()
  }

  private fun render() {
    // qsTile is null until QS has bound the tile; that is also the portable
    // "is it available" test (Tile.isAvailable is API 29+, minSdk here is 21).
    val tile = qsTile ?: return
    val playing = StreamifyWidgetStore.isPlaying(this)
    tile.state = if (playing) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = getString(if (playing) R.string.tile_pause else R.string.tile_play)
    tile.contentDescription = tile.label
    tile.updateTile()
  }

  companion object {
    /**
     * Ask the QS host to re-query the tile. Called whenever widget state
     * changes so the tile icon follows playback without polling.
     */
    fun refresh(context: Context) {
      try {
        TileService.requestListeningState(
            context, ComponentName(context, StreamifyPlaybackTileService::class.java))
      } catch (_: Exception) {
        // No QS host on this device; nothing to do.
      }
    }
  }
}
