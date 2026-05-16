import { useTranslation } from 'react-i18next';

/**
 * Project shorthand around react-i18next.
 *
 * You still need a hook in each component that displays translated text (so the
 * UI re-renders when the language changes). This wrapper only shortens keys via
 * `keyPrefix` and re-exports a bound `t` for non-React code paths.
 *
 * @example Page-scoped keys (recommended for pages / large tabs)
 * ```tsx
 * const { t } = useT('login');
 * return <h1>{t('title')}</h1>; // login.title
 * ```
 *
 * @example Shared strings in the same namespace (single hook)
 * ```tsx
 * const { t } = useT('quotas');
 * return (
 *   <>
 *     <span>{t('checkerConfigs.naga.provisioningApiKey')}</span>
 *     <span>{t('checkerCommon.endpointOptional')}</span>
 *   </>
 * );
 * ```
 *
 * @example Full paths (no prefix)
 * ```tsx
 * const { t } = useT();
 * return <span>{t('sidebar.nav.logs')}</span>;
 * ```
 */
export function useT(
  keyPrefix?: string,
  options?: Omit<Parameters<typeof useTranslation>[1], 'keyPrefix'>
) {
  return useTranslation(undefined, {
    ...options,
    ...(keyPrefix ? { keyPrefix } : {}),
  });
}
