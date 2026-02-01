import en from "../locales/en.json";

export const t = (key: string): string => {
  const keys = key.split(".");
  let current: any = en;
  
  for (const k of keys) {
    if (current && typeof current === "object" && k in current) {
      current = current[k];
    } else {
      return key; // Return the key if translation not found
    }
  }
  
  return typeof current === "string" ? current : key;
};

export default t;