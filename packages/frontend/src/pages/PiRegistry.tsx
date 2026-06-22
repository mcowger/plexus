import { useEffect, useState, useCallback } from 'react';
import { Plus, Trash2, Save, Boxes, Server } from 'lucide-react';
import { api } from '../lib/api';
import type { PiAiApi, PiAiCustomProviderDef, PiAiCustomModelDef } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { useToast } from '../contexts/ToastContext';

const PI_APIS: PiAiApi[] = [
  'openai-completions',
  'openai-responses',
  'openai-codex-responses',
  'azure-openai-responses',
  'anthropic-messages',
  'google-generative-ai',
  'google-generative-ai-vertex',
];

const selectClass =
  'w-full bg-bg-input border border-border-glass rounded-sm px-2 py-1.5 font-body text-[13px] text-text focus:outline-none focus:border-accent';
const labelClass = 'font-body text-[11px] text-text-muted block mb-0.5';

/** Parse a JSON textarea, returning undefined for empty and throwing on invalid. */
function parseJsonField(raw: string): Record<string, any> | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const parsed = JSON.parse(t);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  throw new Error('Must be a JSON object');
}

export function PiRegistry() {
  const toast = useToast();
  const [providers, setProviders] = useState<Record<string, PiAiCustomProviderDef>>({});
  const [models, setModels] = useState<Record<string, PiAiCustomModelDef>>({});
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([api.getPiCustomProviders(), api.getPiCustomModels()]);
      setProviders(p);
      setModels(m);
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load registries');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <PageContainer>
      <PageHeader
        title="pi-ai Registry"
        subtitle="Define custom providers and new/inherited models for the beta inference path that aren't yet in pi-ai's built-in registry."
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <CustomProvidersCard providers={providers} loading={loading} onChanged={reload} />
        <CustomModelsCard models={models} loading={loading} onChanged={reload} />
      </div>
    </PageContainer>
  );
}

// ─── Custom Providers ────────────────────────────────────────────────────────

function CustomProvidersCard({
  providers,
  loading,
  onChanged,
}: {
  providers: Record<string, PiAiCustomProviderDef>;
  loading: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [draftName, setDraftName] = useState('');

  const entries = Object.entries(providers);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Server size={16} className="text-text-muted" />
        <h3 className="font-body text-[14px] font-semibold text-text">Custom Providers</h3>
      </div>
      <p className="font-body text-[12px] text-text-muted mb-3">
        A custom provider supplies the upstream wire API (and optional compat overrides) for a niche
        host pi-ai doesn&apos;t recognise. Reference it from a Plexus provider&apos;s{' '}
        <span className="font-mono">pi-ai Provider</span> field.
      </p>

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="new provider id (e.g. niche-host)"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Plus size={14} />}
          disabled={!draftName.trim() || !!providers[draftName.trim()]}
          onClick={async () => {
            const name = draftName.trim();
            try {
              await api.savePiCustomProvider(name, { api: 'openai-completions' });
              setDraftName('');
              toast.success(`Created provider '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to create');
            }
          }}
        >
          Add
        </Button>
      </div>

      {loading && <div className="font-body text-[12px] text-text-muted">Loading…</div>}
      {!loading && entries.length === 0 && (
        <div className="font-body text-[12px] text-text-secondary italic">
          No custom providers defined.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {entries.map(([name, def]) => (
          <ProviderRow key={name} name={name} def={def} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

function ProviderRow({
  name,
  def,
  onChanged,
}: {
  name: string;
  def: PiAiCustomProviderDef;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [apiVal, setApiVal] = useState<PiAiApi>(def.api);
  const [displayName, setDisplayName] = useState(def.display_name ?? '');
  const [compatText, setCompatText] = useState(
    def.compat ? JSON.stringify(def.compat, null, 2) : ''
  );

  return (
    <div className="border border-border-glass rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[13px] text-text">{name}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await api.deletePiCustomProvider(name);
              toast.success(`Deleted '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to delete');
            }
          }}
        >
          <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
        </Button>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>Upstream API</label>
          <select
            className={selectClass}
            value={apiVal}
            onChange={(e) => setApiVal(e.target.value as PiAiApi)}
          >
            {PI_APIS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>Display name (optional)</label>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
      </div>
      <label className={labelClass}>compat overrides (JSON object, optional)</label>
      <textarea
        className={`${selectClass} font-mono`}
        rows={4}
        placeholder='{ "maxTokensField": "max_tokens" }'
        value={compatText}
        onChange={(e) => setCompatText(e.target.value)}
      />
      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          leftIcon={<Save size={14} />}
          onClick={async () => {
            let compat: Record<string, any> | undefined;
            try {
              compat = parseJsonField(compatText);
            } catch (e: any) {
              toast.error(`Invalid compat JSON: ${e.message}`);
              return;
            }
            try {
              await api.savePiCustomProvider(name, {
                api: apiVal,
                ...(displayName.trim() ? { display_name: displayName.trim() } : {}),
                ...(compat ? { compat } : {}),
              });
              toast.success(`Saved '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to save');
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

// ─── Custom Models ───────────────────────────────────────────────────────────

function CustomModelsCard({
  models,
  loading,
  onChanged,
}: {
  models: Record<string, PiAiCustomModelDef>;
  loading: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [draftName, setDraftName] = useState('');
  const entries = Object.entries(models);

  return (
    <Card>
      <div className="flex items-center gap-2 mb-3">
        <Boxes size={16} className="text-text-muted" />
        <h3 className="font-body text-[14px] font-semibold text-text">Custom / Inherited Models</h3>
      </div>
      <p className="font-body text-[12px] text-text-muted mb-3">
        Inherit an existing pi-ai model as a new one (e.g. treat{' '}
        <span className="font-mono">gpt-5.6</span> like <span className="font-mono">gpt-5.5</span>),
        or define a full standalone model. Reference it from a provider model&apos;s{' '}
        <span className="font-mono">pi-ai Model ID</span> field.
      </p>

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="new model id (e.g. gpt-5.6)"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          style={{ flex: 1 }}
        />
        <Button
          variant="secondary"
          size="sm"
          leftIcon={<Plus size={14} />}
          disabled={!draftName.trim() || !!models[draftName.trim()]}
          onClick={async () => {
            const name = draftName.trim();
            try {
              // Seed as a standalone openai-completions model; user edits below.
              await api.savePiCustomModel(name, { api: 'openai-completions' });
              setDraftName('');
              toast.success(`Created model '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to create');
            }
          }}
        >
          Add
        </Button>
      </div>

      {loading && <div className="font-body text-[12px] text-text-muted">Loading…</div>}
      {!loading && entries.length === 0 && (
        <div className="font-body text-[12px] text-text-secondary italic">
          No custom models defined.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {entries.map(([name, def]) => (
          <ModelRow key={name} name={name} def={def} onChanged={onChanged} />
        ))}
      </div>
    </Card>
  );
}

function ModelRow({
  name,
  def,
  onChanged,
}: {
  name: string;
  def: PiAiCustomModelDef;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'inherit' | 'standalone'>(
    def.inherits ? 'inherit' : 'standalone'
  );
  const [inheritProvider, setInheritProvider] = useState(def.inherits?.provider ?? '');
  const [inheritModel, setInheritModel] = useState(def.inherits?.model_id ?? '');
  const [apiVal, setApiVal] = useState<PiAiApi>(def.api ?? 'openai-completions');
  const [contextWindow, setContextWindow] = useState(def.contextWindow?.toString() ?? '');
  const [maxTokens, setMaxTokens] = useState(def.maxTokens?.toString() ?? '');
  const [reasoning, setReasoning] = useState(def.reasoning ?? false);
  const [compatText, setCompatText] = useState(
    def.compat ? JSON.stringify(def.compat, null, 2) : ''
  );
  const [tlmText, setTlmText] = useState(
    def.thinkingLevelMap ? JSON.stringify(def.thinkingLevelMap, null, 2) : ''
  );

  const num = (s: string): number | undefined => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  return (
    <div className="border border-border-glass rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-[13px] text-text">{name}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await api.deletePiCustomModel(name);
              toast.success(`Deleted '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to delete');
            }
          }}
        >
          <Trash2 size={14} style={{ color: 'var(--color-danger)' }} />
        </Button>
      </div>

      <div className="flex gap-3 mb-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="radio" checked={mode === 'inherit'} onChange={() => setMode('inherit')} />
          <span className="font-body text-[12px] text-text">Inherit a base model</span>
        </label>
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="radio"
            checked={mode === 'standalone'}
            onChange={() => setMode('standalone')}
          />
          <span className="font-body text-[12px] text-text">Standalone</span>
        </label>
      </div>

      {mode === 'inherit' ? (
        <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
          <div style={{ flex: 1 }}>
            <label className={labelClass}>Base provider</label>
            <Input
              placeholder="e.g. openai"
              value={inheritProvider}
              onChange={(e) => setInheritProvider(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label className={labelClass}>Base model id</label>
            <Input
              placeholder="e.g. gpt-5.5"
              value={inheritModel}
              onChange={(e) => setInheritModel(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: '8px' }}>
          <label className={labelClass}>Upstream API</label>
          <select
            className={selectClass}
            value={apiVal}
            onChange={(e) => setApiVal(e.target.value as PiAiApi)}
          >
            {PI_APIS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>
            Context window {mode === 'inherit' ? '(override)' : ''}
          </label>
          <Input
            type="number"
            placeholder="tokens"
            value={contextWindow}
            onChange={(e) => setContextWindow(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className={labelClass}>
            Max output tokens {mode === 'inherit' ? '(override)' : ''}
          </label>
          <Input
            type="number"
            placeholder="tokens"
            value={maxTokens}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </div>
        <label className="flex items-end gap-1.5 cursor-pointer pb-1.5">
          <input
            type="checkbox"
            checked={reasoning}
            onChange={(e) => setReasoning(e.target.checked)}
          />
          <span className="font-body text-[12px] text-text">Reasoning</span>
        </label>
      </div>

      <label className={labelClass}>thinkingLevelMap (JSON, optional)</label>
      <textarea
        className={`${selectClass} font-mono`}
        rows={3}
        placeholder='{ "off": null, "low": "LOW", "high": "HIGH" }'
        value={tlmText}
        onChange={(e) => setTlmText(e.target.value)}
      />
      <label className={`${labelClass} mt-2`}>compat overrides (JSON, optional)</label>
      <textarea
        className={`${selectClass} font-mono`}
        rows={3}
        placeholder='{ "supportsReasoningEffort": true }'
        value={compatText}
        onChange={(e) => setCompatText(e.target.value)}
      />

      <div className="flex justify-end mt-2">
        <Button
          size="sm"
          leftIcon={<Save size={14} />}
          onClick={async () => {
            let compat: Record<string, any> | undefined;
            let tlm: Record<string, any> | undefined;
            try {
              compat = parseJsonField(compatText);
              tlm = parseJsonField(tlmText);
            } catch (e: any) {
              toast.error(`Invalid JSON: ${e.message}`);
              return;
            }
            const def: PiAiCustomModelDef = {
              ...(mode === 'inherit'
                ? inheritProvider.trim() && inheritModel.trim()
                  ? {
                      inherits: { provider: inheritProvider.trim(), model_id: inheritModel.trim() },
                    }
                  : {}
                : { api: apiVal }),
              ...(num(contextWindow) ? { contextWindow: num(contextWindow) } : {}),
              ...(num(maxTokens) ? { maxTokens: num(maxTokens) } : {}),
              ...(reasoning ? { reasoning: true } : {}),
              ...(tlm ? { thinkingLevelMap: tlm } : {}),
              ...(compat ? { compat } : {}),
            };
            if (!def.inherits && !def.api) {
              toast.error('Provide an inheritance base or an upstream API');
              return;
            }
            try {
              await api.savePiCustomModel(name, def);
              toast.success(`Saved '${name}'`);
              onChanged();
            } catch (e: any) {
              toast.error(e?.message ?? 'Failed to save');
            }
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
