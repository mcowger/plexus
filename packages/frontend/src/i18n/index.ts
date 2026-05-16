import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

export const SUPPORTED_LANGUAGES = ['en', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'plexus.lang';

/**
 * Per-namespace locale files are kept in `locales/<lng>/<namespace>.json`.
 * We merge them into a single i18next "translation" bundle keyed by the
 * filename. This keeps each page/feature's strings isolated and lets us
 * add new sections without touching one giant JSON.
 *
 * We use Bun's bundler `import.meta.glob`-style mechanism via static glob
 * imports. Bun resolves these at build time and inlines the JSON.
 */
import enCommon from './locales/en/common.json';
import enLanguage from './locales/en/language.json';
import enAppBar from './locales/en/appBar.json';
import enSidebar from './locales/en/sidebar.json';
import enLogin from './locales/en/login.json';
import enDashboard from './locales/en/dashboard.json';
import enLogs from './locales/en/logs.json';
import enErrors from './locales/en/errors.json';
import enDebug from './locales/en/debug.json';
import enMyKey from './locales/en/myKey.json';
import enKeys from './locales/en/keys.json';
import enProviders from './locales/en/providers.json';
import enModels from './locales/en/models.json';
import enConfig from './locales/en/config.json';
import enQuotas from './locales/en/quotas.json';
import enMcp from './locales/en/mcp.json';
import enSystemLogs from './locales/en/systemLogs.json';
import enDetailedUsage from './locales/en/detailedUsage.json';

import zhCommon from './locales/zh/common.json';
import zhLanguage from './locales/zh/language.json';
import zhAppBar from './locales/zh/appBar.json';
import zhSidebar from './locales/zh/sidebar.json';
import zhLogin from './locales/zh/login.json';
import zhDashboard from './locales/zh/dashboard.json';
import zhLogs from './locales/zh/logs.json';
import zhErrors from './locales/zh/errors.json';
import zhDebug from './locales/zh/debug.json';
import zhMyKey from './locales/zh/myKey.json';
import zhKeys from './locales/zh/keys.json';
import zhProviders from './locales/zh/providers.json';
import zhModels from './locales/zh/models.json';
import zhConfig from './locales/zh/config.json';
import zhQuotas from './locales/zh/quotas.json';
import zhMcp from './locales/zh/mcp.json';
import zhSystemLogs from './locales/zh/systemLogs.json';
import zhDetailedUsage from './locales/zh/detailedUsage.json';

const en = {
  common: enCommon,
  language: enLanguage,
  appBar: enAppBar,
  sidebar: enSidebar,
  login: enLogin,
  dashboard: enDashboard,
  logs: enLogs,
  errors: enErrors,
  debug: enDebug,
  myKey: enMyKey,
  keys: enKeys,
  providers: enProviders,
  models: enModels,
  config: enConfig,
  quotas: enQuotas,
  mcp: enMcp,
  systemLogs: enSystemLogs,
  detailedUsage: enDetailedUsage,
};

const zh = {
  common: zhCommon,
  language: zhLanguage,
  appBar: zhAppBar,
  sidebar: zhSidebar,
  login: zhLogin,
  dashboard: zhDashboard,
  logs: zhLogs,
  errors: zhErrors,
  debug: zhDebug,
  myKey: zhMyKey,
  keys: zhKeys,
  providers: zhProviders,
  models: zhModels,
  config: zhConfig,
  quotas: zhQuotas,
  mcp: zhMcp,
  systemLogs: zhSystemLogs,
  detailedUsage: zhDetailedUsage,
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    returnNull: false,
  });

// Keep <html lang> in sync so screen readers / browsers behave correctly.
const applyHtmlLang = (lng: string) => {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lng.startsWith('zh') ? 'zh' : 'en';
  }
};

applyHtmlLang(i18n.resolvedLanguage || i18n.language || 'en');
i18n.on('languageChanged', applyHtmlLang);

/** Imperative `t` for callbacks, class components, and toast messages (no re-render). */
export const t = i18n.t.bind(i18n);

export { useT } from './useT';
export default i18n;
