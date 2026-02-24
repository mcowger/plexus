import { useEffect, useState, useCallback } from 'react';
import { parse, stringify } from 'yaml';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import {
  AutoRouterSettings,
  DEFAULT_AUTO_CONFIG,
  type AutoRouterConfig,
} from '../components/autorouter/AutoRouterSettings';
import { Save, RotateCcw, Settings as SettingsIcon, AlertTriangle } from 'lucide-react';

interface PlexusConfig {
  auto?: AutoRouterConfig;
  [key: string]: any;
}

export const AutoRouter = () => {
  const [configStr, setConfigStr] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [autoConfig, setAutoConfig] = useState<AutoRouterConfig | null>(null);
  const [allModelAliases, setAllModelAliases] = useState<string[]>([]);
  const [validationErrors, setValidationErrors] = useState<Array<{
    path: string;
    message: string;
  }> | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const yamlStr = await api.getConfig();
      setConfigStr(yamlStr);
      const config = parse(yamlStr) as PlexusConfig;
      setAutoConfig(config.auto ?? DEFAULT_AUTO_CONFIG);

      const aliases = new Set<string>();
      if (config.models) {
        Object.keys(config.models).forEach((alias) => aliases.add(alias));
      }
      if (config.providers) {
        Object.values(config.providers).forEach((provider: any) => {
          if (provider.models) {
            if (Array.isArray(provider.models)) {
              provider.models.forEach((m: string) => aliases.add(m));
            } else {
              Object.keys(provider.models).forEach((m: string) => aliases.add(m));
            }
          }
        });
      }
      setAllModelAliases(Array.from(aliases).sort());
    } catch (err) {
      console.error('Failed to load config:', err);
      setAutoConfig(DEFAULT_AUTO_CONFIG);
    }
  }, []);

  useEffect(() => {
    loadConfig().catch(() => {
      setAutoConfig(DEFAULT_AUTO_CONFIG);
    });
  }, [loadConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    setValidationErrors(null);
    try {
      const config = parse(configStr) as PlexusConfig;
      config.auto = autoConfig ?? undefined;
      const newYamlStr = stringify(config);
      await api.saveConfig(newYamlStr);
      setConfigStr(newYamlStr);
    } catch (e) {
      const error = e as any;
      if (error.details && Array.isArray(error.details)) {
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

  const handleReset = () => {
    loadConfig();
    setValidationErrors(null);
  };

  if (!autoConfig) {
    return (
      <div className="min-h-screen p-6 bg-gradient-to-br from-bg-deep to-bg-surface">
        <div className="flex items-center justify-center h-64">
          <div className="text-text-secondary">Loading configuration...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-bold text-text m-0 mb-2 flex items-center gap-3">
          <SettingsIcon className="text-primary" style={{ width: 32, height: 32 }} />
          Auto Router
        </h1>
        <p className="text-[15px] text-text-secondary m-0">Configure system settings.</p>
      </div>

      <div className="glass-bg backdrop-blur-md border border-white/10 rounded-lg shadow-xl overflow-hidden transition-all duration-300 max-w-5xl shadow-[0_8px_32px_rgba(0,0,0,0.3)]">
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

        <div className="p-6">
          <AutoRouterSettings
            config={autoConfig}
            onChange={setAutoConfig}
            allModelAliases={allModelAliases}
          />
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-glass bg-bg-subtle/50">
          <Button
            variant="secondary"
            size="sm"
            onClick={handleReset}
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
    </div>
  );
};
