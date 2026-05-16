import type { MetadataOverrides } from '../../lib/api';
import type { ReactNode } from 'react';
import { Input } from '../ui/Input';
import { TagSelect } from '../ui/TagSelect';
import { useT } from '../../i18n';

// Suggested values shown in the TagSelect dropdowns. Users can still enter
// arbitrary strings via `allowCustom`; these are just hints for the common case.
const MODALITY_SUGGESTIONS = ['text', 'image', 'audio', 'video', 'file'];
const SUPPORTED_PARAM_SUGGESTIONS = [
  'temperature',
  'top_p',
  'top_k',
  'min_p',
  'top_a',
  'frequency_penalty',
  'presence_penalty',
  'repetition_penalty',
  'seed',
  'max_tokens',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'response_format',
  'structured_outputs',
  'stop',
  'tools',
  'tool_choice',
  'reasoning',
  'include_reasoning',
  'web_search_options',
];

interface Props {
  overrides: MetadataOverrides;
  isCustom: boolean;
  onSetField: <K extends keyof MetadataOverrides>(
    key: K,
    value: MetadataOverrides[K] | undefined
  ) => void;
  onSetPricing: (
    key: keyof NonNullable<MetadataOverrides['pricing']>,
    value: string | undefined
  ) => void;
  onSetArchitecture: (
    key: keyof NonNullable<MetadataOverrides['architecture']>,
    value: string | string[] | undefined
  ) => void;
  onSetTopProvider: (
    key: keyof NonNullable<MetadataOverrides['top_provider']>,
    value: number | undefined
  ) => void;
}

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div
    className="font-body text-[11px] font-semibold uppercase tracking-wide text-text-muted"
    style={{ marginBottom: '4px' }}
  >
    {children}
  </div>
);

const FieldLabel = ({ children }: { children: ReactNode }) => (
  <label
    className="font-body text-[11px] font-medium text-text-secondary"
    style={{ display: 'block', marginBottom: '2px' }}
  >
    {children}
  </label>
);

const parseIntOrUndef = (s: string): number | undefined => {
  const trimmed = s.trim();
  if (!trimmed) return undefined;
  const n = parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function MetadataOverrideForm({
  overrides,
  isCustom,
  onSetField,
  onSetPricing,
  onSetArchitecture,
  onSetTopProvider,
}: Props) {
  const { t } = useT('models.metadataForm');
  const helperText = isCustom ? t('helperCustom') : t('helperOverride');

  return (
    <div
      className="rounded-sm border border-border-glass bg-bg-subtle"
      style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <p className="font-body text-[11px] text-text-muted" style={{ marginBottom: 0 }}>
        {helperText}
      </p>

      {/* Basic */}
      <div>
        <SectionLabel>{t('sectionBasic')}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <FieldLabel>{t('fieldName')}</FieldLabel>
            <Input
              value={overrides.name ?? ''}
              onChange={(e) =>
                onSetField('name', e.target.value === '' ? undefined : e.target.value)
              }
              placeholder={t('placeholderDisplayName')}
            />
          </div>
          <div>
            <FieldLabel>{t('fieldContextLength')}</FieldLabel>
            <Input
              type="number"
              min={1}
              value={overrides.context_length ?? ''}
              onChange={(e) => onSetField('context_length', parseIntOrUndef(e.target.value))}
              placeholder={t('placeholderExampleTokens')}
            />
          </div>
        </div>
        <div style={{ marginTop: '6px' }}>
          <FieldLabel>{t('fieldDescription')}</FieldLabel>
          <Input
            value={overrides.description ?? ''}
            onChange={(e) =>
              onSetField('description', e.target.value === '' ? undefined : e.target.value)
            }
            placeholder={t('placeholderShortDescription')}
          />
        </div>
      </div>

      {/* Pricing */}
      <div>
        <SectionLabel>{t('sectionPricing')}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <FieldLabel>{t('fieldPrompt')}</FieldLabel>
            <Input
              value={overrides.pricing?.prompt ?? ''}
              onChange={(e) =>
                onSetPricing('prompt', e.target.value === '' ? undefined : e.target.value)
              }
              placeholder="0.000003"
            />
          </div>
          <div>
            <FieldLabel>{t('fieldCompletion')}</FieldLabel>
            <Input
              value={overrides.pricing?.completion ?? ''}
              onChange={(e) =>
                onSetPricing('completion', e.target.value === '' ? undefined : e.target.value)
              }
              placeholder="0.000015"
            />
          </div>
          <div>
            <FieldLabel>{t('fieldInputCacheRead')}</FieldLabel>
            <Input
              value={overrides.pricing?.input_cache_read ?? ''}
              onChange={(e) =>
                onSetPricing('input_cache_read', e.target.value === '' ? undefined : e.target.value)
              }
              placeholder="0.0000003"
            />
          </div>
          <div>
            <FieldLabel>{t('fieldInputCacheWrite')}</FieldLabel>
            <Input
              value={overrides.pricing?.input_cache_write ?? ''}
              onChange={(e) =>
                onSetPricing(
                  'input_cache_write',
                  e.target.value === '' ? undefined : e.target.value
                )
              }
              placeholder="0.00000375"
            />
          </div>
        </div>
      </div>

      {/* Architecture */}
      <div>
        <SectionLabel>{t('sectionArchitecture')}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <FieldLabel>{t('fieldInputModalities')}</FieldLabel>
            <TagSelect
              placeholder={t('placeholderModalities')}
              options={MODALITY_SUGGESTIONS}
              selected={overrides.architecture?.input_modalities ?? []}
              allowCustom
              onChange={(list) =>
                onSetArchitecture('input_modalities', list.length > 0 ? list : undefined)
              }
            />
          </div>
          <div>
            <FieldLabel>{t('fieldOutputModalities')}</FieldLabel>
            <TagSelect
              placeholder={t('placeholderModalities')}
              options={MODALITY_SUGGESTIONS}
              selected={overrides.architecture?.output_modalities ?? []}
              allowCustom
              onChange={(list) =>
                onSetArchitecture('output_modalities', list.length > 0 ? list : undefined)
              }
            />
          </div>
          <div style={{ gridColumn: 'span 2' }}>
            <FieldLabel>{t('fieldTokenizer')}</FieldLabel>
            <Input
              value={overrides.architecture?.tokenizer ?? ''}
              onChange={(e) =>
                onSetArchitecture('tokenizer', e.target.value === '' ? undefined : e.target.value)
              }
              placeholder={t('placeholderTokenizer')}
            />
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div>
        <SectionLabel>{t('sectionCapabilities')}</SectionLabel>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '6px' }}>
          <div>
            <FieldLabel>{t('fieldSupportedParameters')}</FieldLabel>
            <TagSelect
              placeholder={t('placeholderParameters')}
              options={SUPPORTED_PARAM_SUGGESTIONS}
              selected={overrides.supported_parameters ?? []}
              allowCustom
              onChange={(list) =>
                onSetField('supported_parameters', list.length > 0 ? list : undefined)
              }
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <FieldLabel>{t('fieldTopProviderContextLength')}</FieldLabel>
              <Input
                type="number"
                min={1}
                value={overrides.top_provider?.context_length ?? ''}
                onChange={(e) =>
                  onSetTopProvider('context_length', parseIntOrUndef(e.target.value))
                }
                placeholder={t('placeholderExampleTokens')}
              />
            </div>
            <div>
              <FieldLabel>{t('fieldMaxCompletionTokens')}</FieldLabel>
              <Input
                type="number"
                min={1}
                value={overrides.top_provider?.max_completion_tokens ?? ''}
                onChange={(e) =>
                  onSetTopProvider('max_completion_tokens', parseIntOrUndef(e.target.value))
                }
                placeholder={t('placeholderExampleCompletion')}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
