import { defineTranslations } from "@getpaseo/plugin/client";
import { MESSAGES, SUPPORTED_LOCALES } from "../../shared/i18n/messages";

/**
 * The labels Paseo itself renders (screen header, sidebar row and Settings entry,
 * Command Center result), handed over as message references so the app resolves
 * them in its own language and swaps them when that changes. Built from the same
 * table as the rest of the plugin's copy, so there is one translation per string.
 */
export const titles = defineTranslations({
  resources: {
    ...Object.fromEntries(SUPPORTED_LOCALES.map((locale) => [locale, { title: MESSAGES[locale].title }])),
    en: { title: MESSAGES.en.title },
  },
});
