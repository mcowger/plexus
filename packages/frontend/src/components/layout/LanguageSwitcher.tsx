import React, { useEffect, useRef, useState } from 'react';
import { Check, Languages } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../../i18n';
import { Tooltip } from '../ui/Tooltip';

interface LanguageSwitcherProps {
  /** When true, render only the icon (used for the collapsed desktop sidebar). */
  collapsed?: boolean;
}

const LABEL_KEYS: Record<SupportedLanguage, string> = {
  en: 'language.english',
  zh: 'language.chinese',
};

export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ collapsed = false }) => {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const current = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.resolvedLanguage ?? '')
    ? (i18n.resolvedLanguage as SupportedLanguage)
    : 'en';

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const changeLanguage = (lng: SupportedLanguage) => {
    void i18n.changeLanguage(lng);
    setOpen(false);
  };

  const trigger = (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={t('language.switcher')}
      className={clsx(
        'group relative flex items-center gap-2.5 py-2 px-2.5 rounded-md font-body text-[13px] font-medium cursor-pointer transition-all duration-fast w-full',
        'text-text-secondary hover:bg-bg-hover hover:text-text',
        collapsed && 'justify-center'
      )}
    >
      <Languages size={16} className="flex-shrink-0" />
      <span
        className={clsx(
          'flex-1 text-left transition-opacity duration-fast',
          collapsed && 'opacity-0 w-0 overflow-hidden'
        )}
      >
        {t(LABEL_KEYS[current])}
      </span>
    </button>
  );

  return (
    <div ref={containerRef} className="relative">
      {collapsed ? (
        <Tooltip content={t('language.switcher')} position="right">
          {trigger}
        </Tooltip>
      ) : (
        trigger
      )}

      {open && (
        <div
          role="listbox"
          aria-label={t('language.switcher')}
          className={clsx(
            'absolute z-[600] min-w-[140px] py-1 rounded-md border border-border bg-bg-surface shadow-lg',
            collapsed ? 'left-full top-0 ml-2' : 'left-0 right-0 bottom-full mb-1'
          )}
        >
          {SUPPORTED_LANGUAGES.map((lng) => {
            const isActive = current === lng;
            return (
              <button
                key={lng}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => changeLanguage(lng)}
                className={clsx(
                  'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[12px] text-left transition-colors duration-fast',
                  isActive
                    ? 'text-amber-300 bg-amber-500/10'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text'
                )}
              >
                <span>{t(LABEL_KEYS[lng])}</span>
                {isActive && <Check size={14} className="flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
