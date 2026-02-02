const translations: Record<string, string> = {}

export function t(key: string): string {
  return translations[key] ?? key
}
