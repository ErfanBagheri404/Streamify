import { useSettings } from "../contexts/SettingsContext";

export function useAppSettings() {
  return useSettings();
}
