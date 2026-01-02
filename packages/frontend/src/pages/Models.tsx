import { useEffect, useState } from 'react';
import { api, Model, Alias } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Search } from 'lucide-react';

export const Models = () => {
  const [models, setModels] = useState<Model[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getModels().then(setModels);
    api.getAliases().then(setAliases);
  }, []);

  const filteredModels = models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const filteredAliases = aliases.filter(a => a.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="dashboard">
      <div className="page-header">
        <h1 className="page-title">Models</h1>
        <p className="page-description">Available AI models across providers.</p>
      </div>

      <Card className="mb-6">
           <div style={{position: 'relative'}}>
              <Search size={16} style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-secondary)'}} />
              <Input 
                placeholder="Search models..." 
                style={{paddingLeft: '36px'}}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
           </div>
      </Card>

      <Card title="Model Aliases" className="mb-6">
        <div className="table-wrapper">
            <table className="data-table">
                <thead>
                    <tr>
                        <th style={{paddingLeft: '24px'}}>Alias</th>
                        <th>Selector</th>
                        <th style={{paddingRight: '24px'}}>Targets</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAliases.map(alias => (
                        <tr key={alias.id}>
                            <td style={{fontWeight: 600, paddingLeft: '24px'}}>{alias.id}</td>
                            <td>
                                <span className="badge badge-outline" style={{fontSize: '11px', textTransform: 'capitalize'}}>
                                    {alias.selector || 'random (default)'}
                                </span>
                            </td>
                            <td style={{paddingRight: '24px'}}>
                                {alias.targets.map((t, i) => (
                                    <div key={i} style={{fontSize: '12px', color: 'var(--color-text-secondary)'}}>
                                        {t.provider} &rarr; {t.model}
                                    </div>
                                ))}
                            </td>
                        </tr>
                    ))}
                    {filteredAliases.length === 0 && (
                        <tr>
                            <td colSpan={3} className="empty">No aliases found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </Card>

      <Card title="Provider Models">
        <div className="table-wrapper">
            <table className="data-table">
                <thead>
                    <tr>
                        <th style={{paddingLeft: '24px'}}>Model ID</th>
                        <th style={{paddingRight: '24px'}}>Provider</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredModels.map(model => (
                        <tr key={model.id}>
                            <td style={{fontWeight: 600, paddingLeft: '24px'}}>{model.id}</td>
                            <td style={{paddingRight: '24px'}}>{model.providerId}</td>
                        </tr>
                    ))}
                    {filteredModels.length === 0 && (
                        <tr>
                            <td colSpan={2} className="empty">No models found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </Card>
    </div>
  );
};
