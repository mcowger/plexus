import { useEffect, useState } from 'react';
import { api, Alias } from '../lib/api';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Search } from 'lucide-react';

export const Models = () => {
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.getAliases().then(setAliases);
  }, []);

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
    </div>
  );
};
