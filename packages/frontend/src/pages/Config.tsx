import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Save, RotateCcw, AlertTriangle } from 'lucide-react';
import { parse, stringify } from 'yaml';

interface AutoOptionsFormState {
  agenticBoostThreshold: string;
  classifierJson: string;
}

const DEFAULT_AUTO_OPTIONS_FORM: AutoOptionsFormState = {
  agenticBoostThreshold: '',
  classifierJson: '{}',
};

export const Config = () => {
  const [config, setConfig] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [autoOptionsForm, setAutoOptionsForm] =
    useState<AutoOptionsFormState>(DEFAULT_AUTO_OPTIONS_FORM);
  const [autoOptionsError, setAutoOptionsError] = useState<string | null>(null);

  useEffect(() => {
    api.getConfig().then((rawConfig) => {
      setConfig(rawConfig);
      syncAutoOptionsForm(rawConfig);
    });
  }, []);

  const [validationErrors, setValidationErrors] = useState<Array<{
    path: string;
    message: string;
  }> | null>(null);

  const syncAutoOptionsForm = (yamlConfig: string) => {
    try {
      const parsed = (parse(yamlConfig) ?? {}) as Record<string, any>;
      const options = parsed.auto?.options ?? {};
      setAutoOptionsForm({
        agenticBoostThreshold:
          options.agentic_boost_threshold !== undefined
            ? String(options.agentic_boost_threshold)
            : '',
        classifierJson: JSON.stringify(options.classifier ?? {}, null, 2),
      });
      setAutoOptionsError(null);
    } catch {
      setAutoOptionsForm(DEFAULT_AUTO_OPTIONS_FORM);
      setAutoOptionsError('Fix YAML in editor to enable Auto Router options form.');
    }
  };

  const updateAutoOptionsInConfig = (nextForm: AutoOptionsFormState) => {
    setAutoOptionsForm(nextForm);

    try {
      const parsed = (parse(config) ?? {}) as Record<string, any>;
      parsed.auto ??= {};
      parsed.auto.options ??= {};

      if (nextForm.agenticBoostThreshold.trim() === '') {
        delete parsed.auto.options.agentic_boost_threshold;
      } else {
        const value = Number(nextForm.agenticBoostThreshold);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          setAutoOptionsError('Agentic boost threshold must be a number from 0 to 1 (inclusive).');
          return;
        }
        parsed.auto.options.agentic_boost_threshold = value;
      }

      if (nextForm.classifierJson.trim() === '') {
        delete parsed.auto.options.classifier;
      } else {
        try {
          const classifierValue = JSON.parse(nextForm.classifierJson);
          parsed.auto.options.classifier = classifierValue;
        } catch {
          setAutoOptionsError('Classifier must be valid JSON.');
          return;
        }
      }

      setConfig(stringify(parsed));
      setAutoOptionsError(null);
    } catch (error) {
      console.error('Failed to update auto-router options from form', error);
      setAutoOptionsError(
        'Unable to apply Auto Router options. Ensure YAML and classifier JSON are valid.'
      );
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setValidationErrors(null);
    try {
      await api.saveConfig(config);
    } catch (e) {
      const error = e as any;
      if (error.details && Array.isArray(error.details)) {
        // Backend validation errors
        setValidationErrors(
          error.details.map((err: any) => ({
            path: err.path?.join('.') || 'config',
            message: err.message,
          }))
        );
      } else {
        const errorMessage = error.message || 'Failed to save config';
        alert(`Save failed:\n\n${errorMessage}`);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2">Configuration</h1>
        <p className="text-[15px] text-text-secondary m-0">Edit global system configuration.</p>
      </div>

      <div className="glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-full shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-glass">
          <h3 className="font-heading text-lg font-semibold text-text m-0">plexus.yaml</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                api.getConfig().then((rawConfig) => {
                  setConfig(rawConfig);
                  syncAutoOptionsForm(rawConfig);
                });
                setValidationErrors(null);
              }}
              leftIcon={<RotateCcw size={14} />}
            >
              Reset
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              isLoading={isSaving}
              leftIcon={<Save size={14} />}
            >
              Save Changes
            </Button>
          </div>
        </div>
        {validationErrors && validationErrors.length > 0 && (
          <div className="px-6 py-4 bg-danger/10 border-b border-danger/30">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-danger flex-shrink-0 mt-0.5" size={18} />
              <div className="flex-1">
                <h4 className="font-heading text-sm font-semibold text-danger m-0 mb-2">
                  Configuration validation failed
                </h4>
                <ul className="m-0 pl-4 space-y-1">
                  {validationErrors.map((err, idx) => (
                    <li key={idx} className="text-sm text-danger/90 font-mono">
                      <span className="font-semibold">{err.path}:</span> {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}
        <div className="px-6 py-4 border-b border-border-glass bg-bg-hover/40">
          <h4 className="font-heading text-sm font-semibold text-text m-0 mb-2">
            Auto Router Options
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                agentic_boost_threshold
              </label>
              <Input
                value={autoOptionsForm.agenticBoostThreshold}
                onChange={(e) =>
                  updateAutoOptionsInConfig({
                    ...autoOptionsForm,
                    agenticBoostThreshold: e.target.value,
                  })
                }
                placeholder="0.8"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="font-body text-[13px] font-medium text-text-secondary">
                classifier (JSON)
              </label>
              <textarea
                className="w-full rounded-md border border-border-glass bg-bg-surface px-3 py-2 text-xs font-mono text-text"
                rows={5}
                value={autoOptionsForm.classifierJson}
                onChange={(e) =>
                  updateAutoOptionsInConfig({
                    ...autoOptionsForm,
                    classifierJson: e.target.value,
                  })
                }
                placeholder="{}"
              />
            </div>
          </div>
          {autoOptionsError && <p className="text-danger text-xs mt-2 mb-0">{autoOptionsError}</p>}
        </div>
        <div className="h-[500px] rounded-sm overflow-hidden">
          <Editor
            height="100%"
            defaultLanguage="yaml"
            value={config}
            theme="vs-dark"
            onChange={(value) => setConfig(value || '')}
            options={{
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 14,
              fontFamily: '"Fira code", "Fira Mono", monospace',
            }}
          />
        </div>
      </div>
    </div>
  );
};
