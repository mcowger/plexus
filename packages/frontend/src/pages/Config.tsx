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
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">Configuration</h1>
        <p className="page-description">Edit global system configuration.</p>
      </div>

      <div className="card">
        <div className="card-header">
            <h3 className="card-title">plexus.yaml</h3>
            <div style={{display: 'flex', gap: '8px'}}>
                 <Button variant="secondary" size="sm" onClick={() => api.getConfig().then(setConfig)} leftIcon={<RotateCcw size={14}/>}>Reset</Button>
                 <Button variant="primary" size="sm" onClick={handleSave} isLoading={isSaving} leftIcon={<Save size={14}/>}>Save Changes</Button>
            </div>
        </div>
        <div className="code-editor-container" style={{ height: '500px', borderRadius: '4px', overflow: 'hidden' }}>
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
