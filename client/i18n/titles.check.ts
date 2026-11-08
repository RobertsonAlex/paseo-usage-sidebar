import assert from "node:assert/strict";
import { MESSAGES, SUPPORTED_LOCALES } from "../../shared/i18n/messages";
import { titles } from "./titles";

// defineTranslations validates on import; a bad resource would throw above and
// take the whole client entry down with it.
assert.deepEqual(Object.keys(titles.resources).sort(), [...SUPPORTED_LOCALES].sort());
for (const locale of SUPPORTED_LOCALES) {
  assert.deepEqual(titles.resources[locale], { title: MESSAGES[locale].title });
}
console.log("titles.check: ok");
