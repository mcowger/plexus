import { useEffect, useState } from 'react';
import { ArrowLeft, Code2, Plus, Save, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  CustomQuotaChecker,
  api,
  deleteCustomQuotaChecker,
  fetchCustomQuotaCheckers,
  saveCustomQuotaChecker,
  testCustomQuotaChecker,
} from '../lib/api';
import type { Provider } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { useToast } from '../contexts/ToastContext';

const DEFAULT_CODE = `const response = await ctx.fetch(
  ctx.getOption('endpoint', 'https://openrouter.ai/api/v1/credits'),
  {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  },
);
if (!response.ok) throw new Error(\`HTTP \${response.status}\`);
const data = await response.json();
const totalCredits = Number(data?.data?.total_credits);
const totalUsage = Number(data?.data?.total_usage);
if (!Number.isFinite(totalCredits) || !Number.isFinite(totalUsage)) {
  throw new Error('OpenRouter returned an invalid credits response');
}
return [
  ctx.balance({
    key: 'balance',
    label: 'Account credits',
    unit: 'usd',
    limit: totalCredits,
    used: totalUsage,
    remaining: totalCredits - totalUsage,
  }),
];`;

export function CustomQuotaCheckers() {
  const toast = useToast();
  const navigate = useNavigate();
  const [checkers, setCheckers] = useState<CustomQuotaChecker[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    id: '',
    displayName: '',
    code: DEFAULT_CODE,
    enabled: true,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testProvider, setTestProvider] = useState('');
  const [testOptionsText, setTestOptionsText] = useState('{}');
  const [testMessage, setTestMessage] = useState<string | null>(null);

  const load = async () => setCheckers(await fetchCustomQuotaCheckers());
  useEffect(() => {
    Promise.all([load(), api.getProviders()])
      .then(([, nextProviders]) => {
        setProviders(nextProviders);
        if (nextProviders[0]) setTestProvider(nextProviders[0].id);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)));
  }, []);

  const selectChecker = (checker: CustomQuotaChecker) => {
    setSelectedId(checker.id);
    setDraft({
      id: checker.id,
      displayName: checker.displayName,
      code: checker.code,
      enabled: checker.enabled,
    });
  };

  const createChecker = () => {
    setSelectedId(null);
    setDraft({ id: '', displayName: '', code: DEFAULT_CODE, enabled: true });
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await saveCustomQuotaChecker(draft.id, {
        displayName: draft.displayName,
        code: draft.code,
        enabled: draft.enabled,
      });
      await load();
      selectChecker(saved);
      toast.success('Custom quota checker saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (
      !selectedId ||
      !(await toast.confirm({
        title: 'Delete custom quota checker?',
        message: 'Providers using this checker will no longer be able to run it.',
        confirmLabel: 'Delete',
        variant: 'danger',
      }))
    )
      return;
    try {
      await deleteCustomQuotaChecker(selectedId);
      await load();
      createChecker();
      toast.success('Custom quota checker deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const test = async () => {
    if (!draft.id.trim() || !testProvider) return;
    let testOptions: Record<string, unknown>;
    try {
      const parsed = JSON.parse(testOptionsText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Test options must be a JSON object');
      }
      testOptions = parsed;
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : 'Invalid test options JSON');
      return;
    }
    setTesting(true);
    setTestMessage(null);
    try {
      const result = await testCustomQuotaChecker(draft.id, testProvider, testOptions, draft.code);
      setTestMessage(`Success: ${result.meters.length} meter(s) returned.`);
    } catch (error) {
      setTestMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Custom Quota Checkers"
        subtitle="Write and test trusted JavaScript quota integrations — starts with OpenRouter credits"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/providers')}
              leftIcon={<ArrowLeft size={14} />}
            >
              Providers
            </Button>
            <Button size="sm" onClick={createChecker} leftIcon={<Plus size={14} />}>
              New checker
            </Button>
          </div>
        }
      />
      <PageContainer>
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit p-2">
            {checkers.length === 0 ? (
              <p className="p-3 text-xs text-text-secondary">No custom quota checkers yet.</p>
            ) : (
              checkers.map((checker) => (
                <button
                  key={checker.id}
                  type="button"
                  onClick={() => selectChecker(checker)}
                  className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs ${selectedId === checker.id ? 'bg-primary/15 text-primary' : 'text-text-secondary hover:bg-bg-hover hover:text-text'}`}
                >
                  <Code2 size={14} />
                  <span className="min-w-0 truncate">{checker.displayName || checker.id}</span>
                </button>
              ))
            )}
          </Card>
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-text-secondary">
                Type / ID
                <input
                  className="mt-1 h-8 w-full rounded border border-border-glass bg-bg-glass px-2 text-sm text-text"
                  value={draft.id}
                  disabled={Boolean(selectedId)}
                  onChange={(event) => setDraft({ ...draft, id: event.target.value })}
                />
              </label>
              <label className="text-xs text-text-secondary">
                Display name
                <input
                  className="mt-1 h-8 w-full rounded border border-border-glass bg-bg-glass px-2 text-sm text-text"
                  value={draft.displayName}
                  onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                />
              </label>
            </div>
            <label className="mt-3 flex items-center gap-2 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
              />
              Enabled
            </label>
            <label className="mt-3 block text-xs text-text-secondary">
              JavaScript function body
              <textarea
                className="mt-1 min-h-[420px] w-full rounded border border-border-glass bg-bg-deep p-3 font-mono text-xs leading-relaxed text-text outline-none focus:border-primary"
                value={draft.code}
                onChange={(event) => setDraft({ ...draft, code: event.target.value })}
                spellCheck={false}
              />
            </label>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="min-w-48 flex-1 text-xs text-text-secondary">
                Test against provider
                <select
                  className="mt-1 h-8 w-full rounded border border-border-glass bg-bg-glass px-2 text-sm text-text"
                  value={testProvider}
                  onChange={(event) => setTestProvider(event.target.value)}
                >
                  <option value="">Select a provider</option>
                  {providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name || provider.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="min-w-48 flex-1 text-xs text-text-secondary">
                Test options (JSON)
                <input
                  className="mt-1 h-8 w-full rounded border border-border-glass bg-bg-glass px-2 font-mono text-xs text-text"
                  value={testOptionsText}
                  onChange={(event) => setTestOptionsText(event.target.value)}
                  spellCheck={false}
                />
              </label>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isLoading={testing}
                onClick={test}
                disabled={!draft.id.trim() || !testProvider}
                leftIcon={<Code2 size={14} />}
              >
                Test code
              </Button>
              {testMessage && <span className="text-xs text-text-secondary">{testMessage}</span>}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              {selectedId && (
                <Button variant="danger" size="sm" onClick={remove} leftIcon={<Trash2 size={14} />}>
                  Delete
                </Button>
              )}
              <Button
                size="sm"
                isLoading={saving}
                onClick={save}
                disabled={!draft.id.trim() || !draft.displayName.trim() || !draft.code.trim()}
                leftIcon={<Save size={14} />}
              >
                Save checker
              </Button>
            </div>
          </Card>
        </div>
      </PageContainer>
    </div>
  );
}
