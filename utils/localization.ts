import enTranslations from "../locales/en.json" with { type: "json" };
import faTranslations from "../locales/fa.json" with { type: "json" };
import { type AppLanguage } from "../lib/app-settings";

type TranslationDictionary = Record<string, unknown>;

const TRANSLATIONS: Record<AppLanguage, TranslationDictionary> = {
  en: enTranslations as TranslationDictionary,
  fa: faTranslations as TranslationDictionary,
};

function getDirectValue(
  dictionary: TranslationDictionary,
  key: string,
): string | undefined {
  const result = dictionary[key];
  return typeof result === "string" ? result : undefined;
}

function getNestedValue(
  dictionary: TranslationDictionary,
  key: string,
): string | undefined {
  const result = key.split(".").reduce<unknown>((current, part) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }

    return (current as TranslationDictionary)[part];
  }, dictionary);

  return typeof result === "string" ? result : undefined;
}

function interpolate(
  template: string,
  params?: Record<string, string | number | undefined>,
): string {
  if (!params) {
    return template;
  }

  const pluralResolved = template.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^{}]*)\}\s*other\s*\{([^{}]*)\}\}/g,
    (match, countKey: string, oneValue: string, otherValue: string) => {
      const count = params[countKey];
      if (typeof count !== "number") {
        return match;
      }

      return count === 1 ? oneValue : otherValue;
    },
  );

  return pluralResolved.replace(/\{(\w+)\}|\$/g, (match, namedKey: string) => {
    if (namedKey) {
      const value = params[namedKey];
      return value == null ? match : String(value);
    }

    const fallbackValue = params.value;
    return fallbackValue == null ? match : String(fallbackValue);
  });
}

export function isRtlLanguage(language: AppLanguage): boolean {
  return language === "fa";
}

export function getLanguageDirection(language: AppLanguage): "ltr" | "rtl" {
  return isRtlLanguage(language) ? "rtl" : "ltr";
}

export function getLanguageLocale(language: AppLanguage): string {
  return language === "fa" ? "fa-IR" : "en-US";
}

export function translate(
  language: AppLanguage,
  key: string,
  params?: Record<string, string | number | undefined>,
): string {
  const localized =
    getNestedValue(TRANSLATIONS[language], key) ||
    getDirectValue(TRANSLATIONS[language], key) ||
    getNestedValue(TRANSLATIONS.en, key) ||
    getDirectValue(TRANSLATIONS.en, key);

  if (!localized) {
    return key;
  }

  return interpolate(localized, params);
}

export function t(
  key: string,
  params?: Record<string, string | number | undefined>,
  language: AppLanguage = "en",
): string {
  return translate(language, key, params);
}
