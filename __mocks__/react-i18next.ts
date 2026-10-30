/**
 * The i18n mock every spec gets: `t(key, options)` returns the key with each `{{name}}` replaced by
 * `String(options[name])`, and throws naming the placeholder when the call gives no value for it, so a component that
 * forgets a value fails its spec instead of rendering the placeholder.
 */
const t = (key: string, options?: Record<string, unknown>): string =>
  key.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_match, name: string) => {
    if (options === undefined || !Object.prototype.hasOwnProperty.call(options, name)) {
      throw new Error(`t("${key}") has no value for {{${name}}}`);
    }
    return String(options[name]);
  });

export const useTranslation = () => ({ t });
