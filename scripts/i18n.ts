import { state } from "../lib/store";
import { isWeb, safeDocument } from "../lib/platform";
import ar from "../locales/ar.json";
import bn from "../locales/bn.json";
import de from "../locales/de.json";
import en from "../locales/en.json";
import es from "../locales/es.json";
import fr from "../locales/fr.json";
import frc from "../locales/frc.json";
import hi from "../locales/hi.json";
import id from "../locales/id.json";
import ja from "../locales/ja.json";
import pl from "../locales/pl.json";
import pt from "../locales/pt.json";
import ro from "../locales/ro.json";
import ru from "../locales/ru.json";
import sa from "../locales/sa.json";
import tr from "../locales/tr.json";
import ur from "../locales/ur.json";
import zh from "../locales/zh.json";

const localeMap: Record<string, Record<string, string>> = {
  ar,
  bn,
  de,
  en,
  es,
  fr,
  frc,
  hi,
  id,
  ja,
  pl,
  pt,
  ro,
  ru,
  sa,
  tr,
  ur,
  zh,
};

const nl =
  typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "en";
const locale = state.language || (Locales.includes(nl) ? nl : "en");

if (isWeb && safeDocument) {
  safeDocument.documentElement.lang = locale;
}

const attributes = ["", "-label", "-aria-label", "-placeholder"];

let json: Record<string, string> | undefined = localeMap[locale];

if (isWeb) {
  Promise.resolve().then(() => {
    attributes.forEach(attributeHandler);
  });
}

function attributeHandler(attr: string) {
  if (!isWeb || !safeDocument) return;

  const query = "data-translation" + attr;

  safeDocument.querySelectorAll(`[${query}]`).forEach((el) => {
    const translationKey = el.getAttribute(query) as string;

    if (!translationKey || !json) return;

    const translationVal = json[translationKey] || translationKey;

    if (attr) {
      el.removeAttribute(query);
      el.setAttribute(attr.substring(1), translationVal);
    } else el.textContent = translationVal;
  });
}

export const i18n = (key: string, value: string = "") =>
  value ? (json?.[key] || key).replace("$", value) : json?.[key] || key;
