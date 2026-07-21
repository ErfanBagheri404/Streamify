import { useMemo } from "react";
import { useAppSettings } from "./useAppSettings";
import {
  getLanguageDirection,
  getLanguageLocale,
  isRtlLanguage,
  translate,
} from "../utils/localizationBridge";

export function useAppLanguage() {
  const { settings } = useAppSettings();
  const language = settings.language;

  return useMemo(
    () => ({
      language,
      dir: getLanguageDirection(language),
      locale: getLanguageLocale(language),
      isRtl: isRtlLanguage(language),
      t: (key: string, params?: Record<string, string | number | undefined>) =>
        translate(language, key, params),
    }),
    [language],
  );
}
