/**
 * USB DAC / hi-res output mode (issue #42).
 *
 * Wraps the native module. The native half reports the active output device
 * and its sample rate; this file never touches playback. Routing the audio
 * session to a DAC is the OS's job once the device is the active output —
 * duplicating that in JS would fight the audio manager, not help it.
 *
 * Every call degrades to a state, never a throw: a device with no USB host
 * support, an OEM that omits the sample rate, or a pre-API-23 platform all
 * produce `null`, and the settings row simply stays hidden.
 */
import { NativeModules, Platform } from "react-native";

export interface UsbAudioOutputInfo {
  /** False when the platform cannot report an active output at all. */
  available: boolean;
  name?: string;
  type?: number;
  /** True only for a USB audio-class device. */
  isDac?: boolean;
  /** 0 when the platform does not report one. */
  sampleRateHz?: number;
}

export interface UsbDeviceSummary {
  name: string;
  vendorId: number;
  productId: number;
  /** USB device class; 0xFF is vendor-specific, which audio DACs usually are. */
  class: number;
}

interface StreamifyUsbAudioNative {
  getOutputInfo(): Promise<UsbAudioOutputInfo>;
  listUsbDevices(): Promise<UsbDeviceSummary[]>;
}

const native: StreamifyUsbAudioNative | null =
  Platform.OS === "android"
    ? ((NativeModules as unknown as Record<string, unknown>)
        .StreamifyUsbAudio as StreamifyUsbAudioNative | undefined) ?? null
    : null;

export const isUsbDacAvailable = native !== null;

/**
 * The output device currently in use, or null when the platform cannot say.
 * Never rejects: a missing native module or a throwing platform call both
 * resolve to null.
 */
export async function getUsbAudioOutput(): Promise<UsbAudioOutputInfo | null> {
  if (!native) return null;
  try {
    const info = await native.getOutputInfo();
    return info && info.available ? info : null;
  } catch {
    return null;
  }
}

/** Attached USB devices, or [] when unsupported. */
export async function listUsbAudioDevices(): Promise<UsbDeviceSummary[]> {
  if (!native) return [];
  try {
    const devices = await native.listUsbDevices();
    return Array.isArray(devices) ? devices : [];
  } catch {
    return [];
  }
}

/** "48 kHz" / "96 kHz" / "" — the badge text the settings row shows. */
export function formatSampleRate(hz: number | undefined): string {
  if (!hz || !Number.isFinite(hz) || hz <= 0) return "";
  const kHz = hz / 1000;
  // 44100 -> "44.1 kHz", 48000 -> "48 kHz", 96000 -> "96 kHz".
  const text = Number.isInteger(kHz) ? String(kHz) : kHz.toFixed(1);
  return `${text} kHz`;
}

/** Hi-res is anything above CD (44.1k) — the badge the issue asks for. */
export function isHiRes(hz: number | undefined): boolean {
  return typeof hz === "number" && Number.isFinite(hz) && hz > 44100;
}
