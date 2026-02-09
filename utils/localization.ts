import enTranslations from "../locales/en.json" with { type: "json" };

const translations: Record<string, string> = {};

// Initialize translations with English
function initializeTranslations() {
  const flattenTranslations = (
    obj: any,
    prefix = "",
  ): Record<string, string> => {
    let result: Record<string, string> = {};
    for (const key in obj) {
      const newKey = prefix ? `${prefix}.${key}` : key;
      if (typeof obj[key] === "object" && obj[key] !== null) {
        result = { ...result, ...flattenTranslations(obj[key], newKey) };
      } else {
        result[newKey] = obj[key];
      }
    }
    return result;
  };

  const flattened = flattenTranslations(enTranslations);
  Object.assign(translations, flattened);
}

initializeTranslations();

export function t(key: string): string {
  return translations[key] ?? key;
}
