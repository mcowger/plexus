import { useState, useEffect } from 'react';
import { Eye, Loader2, Save } from 'lucide-react';
import { api, Alias } from '../../lib/api';

interface Props {
  aliases: Alias[];
}

export function VisionFallthroughSelector({ aliases }: Props) {
  const [globalDescriptorModel, setGlobalDescriptorModel] = useState('');
  const [isSavingDescriptor, setIsSavingDescriptor] = useState(false);

  useEffect(() => {
    const fetchVFConfig = async () => {
      try {
        const config = await api.getVisionFallthroughConfig();
        if (config?.descriptor_model) {
          setGlobalDescriptorModel(config.descriptor_model);
        }
      } catch (e) {
        console.error('Failed to load VF config', e);
      }
    };
    fetchVFConfig();
  }, []);

  const handleSaveDescriptor = async () => {
    setIsSavingDescriptor(true);
    try {
      await api.updateVisionFallthroughConfig({
        descriptor_model: globalDescriptorModel,
      });
    } catch (e) {
      console.error('Failed to save descriptor model', e);
    } finally {
      setIsSavingDescriptor(false);
    }
  };

  const sortedAliases = [...aliases].sort((a, b) => a.id.localeCompare(b.id));

  return (
    <span className="inline-flex w-full flex-wrap items-center gap-2 rounded-md border border-border bg-slate-900/60 px-3 py-1.5 sm:w-auto">
      <Eye size={14} className="text-text-secondary" />
      <span className="text-xs font-medium text-text-secondary">Vision Fall Through:</span>
      <select
        className="min-w-0 flex-1 cursor-pointer border-none bg-transparent text-xs text-text outline-none focus:ring-0 sm:max-w-[140px]"
        value={globalDescriptorModel}
        onChange={(e) => setGlobalDescriptorModel(e.target.value)}
      >
        <option value="">(None)</option>
        {sortedAliases.map((a) => (
          <option key={a.id} value={a.id}>
            {a.id}
          </option>
        ))}
      </select>
      <button
        onClick={handleSaveDescriptor}
        disabled={isSavingDescriptor}
        className="ml-1 text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
        title="Save descriptor model"
        type="button"
      >
        {isSavingDescriptor ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      </button>
    </span>
  );
}
