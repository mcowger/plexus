import { AlertTriangle, Info } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  apiAccessToKey,
  hasApiAccess,
  isDecisionsTargetAccess,
  keepDecisionsAccess,
  legacyDecisionsAccessKind,
  migrateLegacyDecisionsAccess,
  stripDecisionsAccess,
  toggleApiAccess,
} from '../../../lib/apiFormats';
import type { ApiAccess } from '../../../lib/apiFormats';
import { Tooltip } from '../../ui/Tooltip';
import {
  API_ACCESS_OPTIONS,
  CODEX_IMAGE_ACCESS,
  CODEX_IMAGE_API_ACCESS_OPTIONS,
  DEFAULT_IMAGE_ACCESS,
  FIELD_CLS,
  getApiBadgeStyle,
  IMAGE_API_ACCESS_OPTIONS,
} from './constants';
import type { ModelConfig } from './types';
import type { PiAiModel } from './usePiAiModels';

function ModelIdInputCompact({
  modelId,
  onCommit,
}: {
  modelId: string;
  onCommit: (oldId: string, newId: string) => void;
}) {
  const [draftId, setDraftId] = useState(modelId);

  useEffect(() => {
    setDraftId(modelId);
  }, [modelId]);

  const commit = () => {
    if (!draftId || draftId === modelId) return;
    onCommit(modelId, draftId);
  };

  return (
    <input
      className={FIELD_CLS}
      value={draftId}
      onChange={(e) => setDraftId(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

interface Props {
  modelId: string;
  modelConfig: ModelConfig;
  updateModelConfig: (modelId: string, updates: any) => void;
  onUpdateModelId: (oldId: string, newId: string) => void;
  piAiProvider?: string;
  piModels: PiAiModel[];
  piModelCustom: Record<string, boolean>;
  setPiModelCustom: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  isCodexOAuthProvider: boolean;
  getApiBaseUrlMap: () => Record<string, string>;
}

export function ModelIdentity({
  modelId,
  modelConfig,
  updateModelConfig,
  onUpdateModelId,
  piAiProvider,
  piModels,
  piModelCustom,
  setPiModelCustom,
  isCodexOAuthProvider,
  getApiBaseUrlMap,
}: Props) {
  const mCfg = modelConfig;
  const imageAccessOptions = isCodexOAuthProvider
    ? CODEX_IMAGE_API_ACCESS_OPTIONS
    : IMAGE_API_ACCESS_OPTIONS;
  // System One is exclusive to `decisions`-typed models, where Access Via is
  // irrelevant and hidden entirely — so the picker below never offers it.
  // Legacy pure-decisions `access_via` configs are converted to
  // `type: 'decisions'` once, when the provider form loads (see
  // useProviderForm's handleEdit). Lists left with any System One entries
  // (mixed chat+System One, or pure after unchecking the last chat chip
  // mid-session) can't be normalized losslessly on the user's behalf, so
  // the banner below explains the options: switch the type to Decisions,
  // or remove System One.
  const hasMixedDecisionsAccess =
    (mCfg.type ?? 'text') !== 'decisions' && legacyDecisionsAccessKind(mCfg.access_via) !== 'none';
  // A decisions-typed model with no System One base URL and no decisions
  // `access_via` entry cannot serve anything (routing fails closed), and
  // Access Via is hidden for this type — so warn here instead of
  // silently saving an unroutable model.
  const decisionsTypeWithoutProtocol =
    mCfg.type === 'decisions' &&
    !Object.keys(getApiBaseUrlMap()).some((t) => isDecisionsTargetAccess(t)) &&
    !((mCfg.access_via ?? []) as ApiAccess[]).some((entry) => isDecisionsTargetAccess(entry));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[11px] font-medium">Model ID</label>
        <ModelIdInputCompact modelId={modelId} onCommit={onUpdateModelId} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[11px] font-medium">Model Type</label>
        <select
          className={FIELD_CLS}
          value={mCfg.type || 'text'}
          onChange={(e) => {
            const newType = e.target.value as
              'text' | 'embeddings' | 'transcriptions' | 'speech' | 'image' | 'decisions';
            if (newType === 'embeddings')
              updateModelConfig(modelId, {
                type: newType,
                access_via: ['embeddings'],
              });
            else if (newType === 'transcriptions')
              updateModelConfig(modelId, {
                type: newType,
                access_via: ['transcriptions'],
              });
            else if (newType === 'speech')
              updateModelConfig(modelId, { type: newType, access_via: ['speech'] });
            else if (newType === 'image')
              updateModelConfig(modelId, {
                type: newType,
                access_via: [isCodexOAuthProvider ? CODEX_IMAGE_ACCESS : DEFAULT_IMAGE_ACCESS],
              });
            else if (newType === 'decisions')
              // access_via is irrelevant for decisions routing; keep the
              // decisions-capable entries (normalized onto `systemone`, so
              // subtypes survive) and drop chat surfaces — the opposite of
              // every other type switch, which strips decisions entries.
              updateModelConfig(modelId, {
                type: newType,
                access_via: migrateLegacyDecisionsAccess(keepDecisionsAccess(mCfg.access_via)),
              });
            else
              updateModelConfig(modelId, {
                type: newType,
                access_via: stripDecisionsAccess(mCfg.access_via),
              });
          }}
        >
          <option value="text">Text</option>
          <option value="embeddings">Embeddings</option>
          <option value="transcriptions">Transcriptions</option>
          <option value="speech">Speech</option>
          <option value="image">Image</option>
          <option value="decisions">Decisions</option>
        </select>
      </div>
      {decisionsTypeWithoutProtocol && (
        <div className="bg-warning/10 border-warning/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
          <span className="text-warning text-[11px]">
            This provider has no System One base URL and this model has no decisions Access Via
            entry, so it cannot serve any requests. Add a systemone base URL to the provider, or
            switch the model type.
          </span>
        </div>
      )}

      {(!mCfg.type || mCfg.type === 'text' || mCfg.type === 'image') && (
        <div className="flex flex-col gap-1">
          <label className="font-body text-text-secondary text-[11px] font-medium">
            Access Via
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {(mCfg.type === 'image' ? imageAccessOptions : API_ACCESS_OPTIONS).map((option) => {
              const key = apiAccessToKey(option);
              const selected = hasApiAccess(mCfg.access_via, key);
              return (
                <div key={key} className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-[3px]">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => {
                        if (mCfg.type === 'image') {
                          updateModelConfig(modelId, {
                            access_via: selected ? [] : [key],
                          });
                          return;
                        }

                        let next = toggleApiAccess(mCfg.access_via, option);
                        if (key === 'responses' && selected) {
                          next = next.filter((entry) => apiAccessToKey(entry) !== 'responses:lite');
                        }
                        updateModelConfig(modelId, { access_via: next });
                      }}
                    />
                    <span
                      className="inline-flex items-center rounded-xl font-medium"
                      style={{
                        ...getApiBadgeStyle(option.type),
                        fontSize: '10px',
                        padding: '2px 6px',
                        opacity: selected ? 1 : 0.5,
                      }}
                    >
                      {option.label}
                    </span>
                  </label>
                  {key === 'responses' && selected && (
                    <div className="flex items-center gap-1">
                      <label className="font-body text-text-secondary flex cursor-pointer items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={hasApiAccess(mCfg.access_via, 'responses:lite')}
                          onChange={() => {
                            const next = toggleApiAccess(mCfg.access_via, {
                              type: 'responses',
                              subtype: 'lite',
                            });
                            updateModelConfig(modelId, { access_via: next });
                          }}
                        />
                        <span>Lite</span>
                      </label>
                      <Tooltip
                        position="top"
                        content={
                          <div className="font-body w-64 leading-relaxed whitespace-normal">
                            Passes Codex-specific Responses input through unchanged, including
                            additional tools. Enable only for targets known to support Responses
                            Lite—usually direct OpenAI or Codex endpoints. Most OpenAI-compatible
                            proxies do not support it.
                          </div>
                        }
                      >
                        <button
                          type="button"
                          aria-label="About Responses Lite"
                          className="text-text-muted hover:bg-bg-hover hover:text-text-secondary focus-visible:ring-primary flex h-4 w-4 items-center justify-center rounded-full transition-colors focus-visible:ring-1 focus-visible:outline-none"
                        >
                          <Info size={12} />
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {(!mCfg.access_via || mCfg.access_via.length === 0) && (
            <span className="font-body text-text-muted text-[11px] italic">
              empty = use any provider API
            </span>
          )}
          {hasMixedDecisionsAccess && (
            <div className="bg-info/10 border-info/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
              <Info size={14} className="text-info mt-0.5 shrink-0" />
              <span className="text-info text-[11px]">
                This model advertises System One through a legacy Access Via entry. Set{' '}
                <span style={{ fontWeight: 600 }}>Model Type: Decisions</span> to make it
                decisions-only, or it will keep serving that protocol alongside the selected
                surfaces.
              </span>
              <button
                type="button"
                onClick={() =>
                  updateModelConfig(modelId, {
                    access_via: stripDecisionsAccess(mCfg.access_via),
                  })
                }
                className="border-info/40 text-info hover:bg-info/20 ml-auto shrink-0 cursor-pointer rounded-sm border px-2 py-0.5 text-[11px] transition-colors"
              >
                Remove System One
              </button>
            </div>
          )}
          {(() => {
            const providerBaseUrlMap = getApiBaseUrlMap();
            const hasOllamaBaseUrl = Object.entries(providerBaseUrlMap).some(
              ([type, url]) => type === 'ollama' && url && url.trim() !== ''
            );
            if (hasOllamaBaseUrl && !hasApiAccess(mCfg.access_via, 'ollama')) {
              return (
                <div className="bg-info/10 border-info/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
                  <Info size={14} className="text-info mt-0.5 shrink-0" />
                  <span className="text-info text-[11px]">
                    Provider has a native Ollama URL — select{' '}
                    <span style={{ fontWeight: 600 }}>ollama</span> above to use it.
                  </span>
                </div>
              );
            }
            return null;
          })()}
          {mCfg.type === 'image' && (
            <div className="bg-info/10 border-info/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
              <Info size={14} className="text-info mt-0.5 shrink-0" />
              <span className="text-info text-[11px]">
                {isCodexOAuthProvider ? (
                  <>
                    Codex Images is the only image protocol available on a ChatGPT OAuth provider.
                    Requests are signed with the provider&apos;s OAuth session, so no base URL is
                    needed.
                  </>
                ) : (
                  <>
                    Choose one image protocol. OpenRouter Images targets the dedicated{' '}
                    <code>/api/v1/images</code> endpoint; OpenAI-compatible and Gemini Images use
                    their native adapters.
                  </>
                )}
              </span>
            </div>
          )}
          {mCfg.type === 'image' &&
            isCodexOAuthProvider &&
            (mCfg.access_via?.length ?? 0) > 0 &&
            !hasApiAccess(mCfg.access_via, CODEX_IMAGE_ACCESS) && (
              <div className="bg-warning/10 border-warning/30 flex items-start gap-2 rounded-sm border px-2 py-1.5">
                <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
                <span className="text-warning text-[11px]">
                  This model still targets an HTTP image protocol, which a ChatGPT OAuth provider
                  cannot serve. Select{' '}
                  <span style={{ fontWeight: 600 }}>Codex Images (ChatGPT OAuth)</span> above.
                </span>
              </div>
            )}
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="font-body text-text-secondary text-[11px] font-medium">
          pi-ai Model ID
        </label>
        {piAiProvider && piModels.length > 0 && !piModelCustom[modelId] ? (
          <select
            className={FIELD_CLS}
            value={mCfg.pi_ai_model_id ?? ''}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '__custom__') {
                setPiModelCustom((prev) => ({ ...prev, [modelId]: true }));
                return;
              }
              updateModelConfig(modelId, {
                pi_ai_model_id: raw || undefined,
              });
            }}
          >
            <option value="">— none —</option>
            {piModels.map((model) => (
              <option
                key={model.id}
                value={model.id}
                title={`${model.api}${model.custom ? ' · custom model' : ''}`}
              >
                {model.id}
                {model.custom ? ' (custom)' : ''}
              </option>
            ))}
            <option value="__custom__">custom...</option>
          </select>
        ) : (
          <div className="flex gap-1">
            <input
              className={`${FIELD_CLS} flex-1`}
              type="text"
              placeholder="e.g. gpt-4.1, claude-opus-4-6"
              value={mCfg.pi_ai_model_id ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                updateModelConfig(modelId, {
                  pi_ai_model_id: raw || undefined,
                });
              }}
              autoFocus={!!piModelCustom[modelId]}
            />
            {piAiProvider && piModels.length > 0 && piModelCustom[modelId] && (
              <button
                type="button"
                className="font-body text-text-muted hover:text-text flex-shrink-0 px-1 text-[11px]"
                title="Back to list"
                onClick={() => setPiModelCustom((prev) => ({ ...prev, [modelId]: false }))}
              >
                ↩
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
