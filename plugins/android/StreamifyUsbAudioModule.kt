package com.erfanbagheri.streamifymobile

import android.content.Context
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap

/**
 * USB DAC / hi-res output mode (issue #42).
 *
 * The module is deliberately small: it reports the current output device and
 * its sample rate, and lets the app ask for the USB audio class device. It does
 * not own playback — TrackPlayer keeps the audio session, and the OS routes to
 * the DAC once it is the active output. What this module adds is the
 * enumeration and the rate readout the settings screen shows.
 */
class StreamifyUsbAudioModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "StreamifyUsbAudio"

  private fun audioManager(): AudioManager =
      reactApplicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  /**
   * The output device the system is currently using, with its sample rate when
   * the platform reports one. `isDac` is true only for a USB audio class
   * device — a phone speaker or Bluetooth sink is not a DAC however good it
   * sounds.
   */
  @ReactMethod
  fun getOutputInfo(promise: Promise) {
    try {
      val map: WritableMap = Arguments.createMap()
      val devices: List<AudioDeviceInfo> =
          audioManager().getDevices(AudioManager.GET_DEVICES_OUTPUTS)
      val current =
          devices.firstOrNull { it.isSink }
      if (current == null) {
        map.putBoolean("available", false)
        promise.resolve(map)
        return
      }
      map.putBoolean("available", true)
      map.putString("name", current.productName?.toString() ?: "Output")
      map.putInt("type", current.type)
      map.putBoolean("isDac", isUsbAudioDevice(current))
      // Sample rate is only reported on API 23+; older platforms answer 0.
      val rate =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val rates = current.sampleRates
            if (rates != null && rates.isNotEmpty()) rates.max() else 0
          } else 0
      map.putInt("sampleRateHz", rate)
      promise.resolve(map)
    } catch (e: Exception) {
      // A missing audio service is a state, not an error: the settings screen
      // shows "unavailable" rather than crashing.
      promise.resolve(Arguments.createMap().apply { putBoolean("available", false) })
    }
  }

  /** True when the device is a USB audio class device. */
  private fun isUsbAudioDevice(device: AudioDeviceInfo): Boolean {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      if (device.type == AudioDeviceInfo.TYPE_USB_DEVICE ||
          device.type == AudioDeviceInfo.TYPE_USB_HEADSET) {
        return true
      }
    }
    // API 21-22 expose USB audio as a bus; the product name is the only hint.
    return device.productName?.toString()?.contains("USB", ignoreCase = true) == true
  }

  /**
   * Enumerate attached USB devices. The picker shows these so the user can see
   * the DAC even before the OS routes audio to it.
   */
  @ReactMethod
  fun listUsbDevices(promise: Promise) {
    try {
      val manager =
          reactApplicationContext.getSystemService(Context.USB_SERVICE) as? UsbManager
      if (manager == null) {
        promise.resolve(Arguments.createArray())
        return
      }
      val array = Arguments.createArray()
      for (device in manager.deviceList.values) {
        val map = Arguments.createMap()
        map.putString("name", device.productName ?: device.deviceName)
        map.putInt("vendorId", device.vendorId)
        map.putInt("productId", device.productId)
        map.putInt("class", device.deviceClass)
        array.pushMap(map)
      }
      promise.resolve(array)
    } catch (e: Exception) {
      promise.resolve(Arguments.createArray())
    }
  }
}
