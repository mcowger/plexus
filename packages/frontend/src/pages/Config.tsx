import { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Save, RotateCcw } from 'lucide-react';

export const Config = () => {
  const [config, setConfig] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    api.getConfig().then(setConfig);
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    await api.saveConfig(config);
    setTimeout(() => setIsSaving(false), 500); // Simulate delay
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
            <div style={{display: 'flex', gap: '8px'}}>
                 <Button variant="secondary" size="sm" onClick={() => api.getConfig().then(setConfig)} leftIcon={<RotateCcw size={14}/>}>Reset</Button>
                 <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving} leftIcon={<Save size={14}/>}>Save Changes</Button>
            </div>
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
