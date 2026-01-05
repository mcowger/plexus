import { useEffect, useState } from 'react';
import { api, Model, Alias, Provider } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Search } from 'lucide-react';

export const Models = () => {
  const [models, setModels] = useState<Model[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getModels().then(setModels);
    api.getAliases().then(setAliases);
    api.getProviders().then(setProviders);
  }, []);

  const filteredModels = models.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
  const filteredAliases = aliases.filter(a => a.id.toLowerCase().includes(search.toLowerCase()));
  const filteredProviders = providers.filter(p => 
      p.id.toLowerCase().includes(search.toLowerCase()) || 
      models.some(m => m.providerId === p.id && m.name.toLowerCase().includes(search.toLowerCase()))
  );

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
                        <th>Aliases</th>
                        <th>Selector</th>
                        <th style={{paddingRight: '24px'}}>Targets</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredAliases.map(alias => (
                        <tr key={alias.id}>
                            <td style={{fontWeight: 600, paddingLeft: '24px'}}>{alias.id}</td>
                            <td>
                                {alias.aliases && alias.aliases.length > 0 ? (
                                    <div style={{display: 'flex', flexWrap: 'wrap', gap: '4px'}}>
                                        {alias.aliases.map(a => (
                                            <span key={a} className="badge badge-outline" style={{fontSize: '10px'}}>
                                                {a}
                                            </span>
                                        ))}
                                    </div>
                                ) : <span style={{color: 'var(--color-text-secondary)', fontSize: '12px'}}>-</span>}
                            </td>
                            <td>
                                <span className="badge badge-outline" style={{fontSize: '11px', textTransform: 'capitalize'}}>
                                    {alias.selector || 'random (default)'}
                                </span>
                            </td>
                            <td style={{paddingRight: '24px'}}>
                                {alias.targets.map((t, i) => (
                                    <div key={i} style={{fontSize: '12px', color: 'var(--color-text-secondary)'}}>
                                        {t.provider} &rarr; {t.model} <span style={{opacity: 0.7}}>[{t.apiType?.join(', ')}]</span>
                                    </div>
                                ))}
                            </td>
                        </tr>
                    ))}
                    {filteredAliases.length === 0 && (
                        <tr>
                            <td colSpan={4} className="empty">No aliases found</td>
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
                        <th style={{paddingLeft: '24px'}}>Provider</th>
                        <th>APIs Supported</th>
                        <th style={{paddingRight: '24px'}}>Models [pricing source]</th>
                    </tr>
                </thead>
                <tbody>
                    {filteredProviders.map(provider => {
                        const providerModels = filteredModels.filter(m => m.providerId === provider.id);
                        if (providerModels.length === 0 && !provider.id.toLowerCase().includes(search.toLowerCase())) return null;

                        return (
                            <tr key={provider.id}>
                                <td style={{fontWeight: 600, paddingLeft: '24px', verticalAlign: 'top'}}>
                                    {provider.id}
                                </td>
                                <td style={{verticalAlign: 'top', fontSize: '12px', color: 'var(--color-text-secondary)'}}>
                                    {Array.isArray(provider.type) ? (
                                        <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                                            {provider.type.map(type => (
                                                <div key={type}>
                                                    <span style={{fontWeight: 500}}>{type}:</span>{' '}
                                                    <span style={{opacity: 0.8}}>
                                                        {typeof provider.apiBaseUrl === 'object' 
                                                            ? (provider.apiBaseUrl as Record<string,string>)[type] 
                                                            : provider.apiBaseUrl}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div>
                                            <span style={{fontWeight: 500}}>{provider.type}:</span>{' '}
                                            <span style={{opacity: 0.8}}>{provider.apiBaseUrl as string}</span>
                                        </div>
                                    )}
                                </td>
                                <td style={{paddingRight: '24px', verticalAlign: 'top'}}>
                                    <div style={{display: 'flex', flexDirection: 'column', gap: '4px'}}>
                                        {providerModels.map(model => (
                                            <div key={model.id} style={{fontSize: '13px'}}>
                                                {model.name}
                                                {model.pricingSource && (
                                                    <span style={{marginLeft: '8px', fontSize: '11px', color: 'var(--color-text-tertiary)'}}>
                                                        [{model.pricingSource}]
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                        {providerModels.length === 0 && <span style={{fontSize: '12px', opacity: 0.5}}>No models configured</span>}
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                    {filteredProviders.length === 0 && (
                        <tr>
                            <td colSpan={3} className="empty">No providers found</td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
      </Card>
    </div>
  );
};
