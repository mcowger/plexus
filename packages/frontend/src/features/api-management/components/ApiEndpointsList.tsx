import { useEffect, useState, useMemo } from 'react';
import { api, Provider } from '../../../lib/api';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { Badge } from '../../../components/ui/Badge';
import { Switch } from '../../../components/ui/Switch';
import { Search, Globe, Server, AlertCircle } from 'lucide-react';

interface ApiEndpoint {
  id: string;
  name: string;
  url: string;
  apiType: string;
  providerId: string;
  enabled: boolean;
  modelCount: number;
  hasQuotaChecker: boolean;
  quotaCheckerType?: string;
  quotaCheckerEnabled?: boolean;
}

export const ApiEndpointsList: React.FC = () => {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const p = await api.getProviders();
      setProviders(p);
    } catch (e) {
      console.error('Failed to load providers', e);
    } finally {
      setLoading(false);
    }
  };

  // Extract API endpoints from providers
  const endpoints: ApiEndpoint[] = useMemo(() => {
    const result: ApiEndpoint[] = [];

    providers.forEach((provider) => {
      const modelCount = provider.models
        ? (Array.isArray(provider.models)
            ? provider.models.length
            : typeof provider.models === 'object'
              ? Object.keys(provider.models).length
              : 0)
        : 0;

      if (typeof provider.apiBaseUrl === 'string' && provider.apiBaseUrl.trim()) {
        // Single URL - infer API type from URL or provider type
        const apiTypes = Array.isArray(provider.type) ? provider.type : [provider.type];
        result.push({
          id: `${provider.id}-primary`,
          name: provider.name || provider.id,
          url: provider.apiBaseUrl,
          apiType: apiTypes[0] || 'chat',
          providerId: provider.id,
          enabled: provider.enabled !== false,
          modelCount,
          hasQuotaChecker: !!provider.quotaChecker?.type,
          quotaCheckerType: provider.quotaChecker?.type,
          quotaCheckerEnabled: provider.quotaChecker?.enabled,
        });
      } else if (typeof provider.apiBaseUrl === 'object' && provider.apiBaseUrl !== null) {
        // Multiple API endpoints per provider
        Object.entries(provider.apiBaseUrl).forEach(([apiType, url]) => {
          if (typeof url === 'string' && url.trim()) {
            result.push({
              id: `${provider.id}-${apiType}`,
              name: `${provider.name || provider.id} (${apiType})`,
              url,
              apiType,
              providerId: provider.id,
              enabled: provider.enabled !== false,
              modelCount,
              hasQuotaChecker: !!provider.quotaChecker?.type,
              quotaCheckerType: provider.quotaChecker?.type,
              quotaCheckerEnabled: provider.quotaChecker?.enabled,
            });
          }
        });
      }
    });

    return result;
  }, [providers]);

  // Filter endpoints based on search query
  const filteredEndpoints = useMemo(() => {
    if (!searchQuery.trim()) return endpoints;

    const query = searchQuery.toLowerCase();
    return endpoints.filter((endpoint) =>
      endpoint.name.toLowerCase().includes(query) ||
      endpoint.url.toLowerCase().includes(query) ||
      endpoint.apiType.toLowerCase().includes(query) ||
      endpoint.providerId.toLowerCase().includes(query)
    );
  }, [endpoints, searchQuery]);

  // Get status badge for endpoint
  const getStatusBadge = (endpoint: ApiEndpoint) => {
    if (!endpoint.enabled) {
      return <Badge status="disconnected">Inactive</Badge>;
    }
    return <Badge status="connected">Active</Badge>;
  };

  // Get API type badge style
  const getApiTypeBadgeStyle = (apiType: string): React.CSSProperties => {
    switch (apiType.toLowerCase()) {
      case 'messages':
        return { backgroundColor: '#D97757', color: 'white', border: 'none' };
      case 'chat':
        return { backgroundColor: '#ebebeb', color: '#333', border: 'none' };
      case 'gemini':
        return { backgroundColor: '#5084ff', color: 'white', border: 'none' };
      case 'embeddings':
        return { backgroundColor: '#10b981', color: 'white', border: 'none' };
      case 'transcriptions':
        return { backgroundColor: '#a855f7', color: 'white', border: 'none' };
      case 'speech':
        return { backgroundColor: '#f97316', color: 'white', border: 'none' };
      case 'images':
        return { backgroundColor: '#d946ef', color: 'white', border: 'none' };
      case 'responses':
        return { backgroundColor: '#06b6d4', color: 'white', border: 'none' };
      case 'oauth':
        return { backgroundColor: '#111827', color: 'white', border: 'none' };
      default:
        return {};
    }
  };

  // Truncate URL for display
  const truncateUrl = (url: string, maxLength: number = 60): string => {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength) + '...';
  };

  // Handle toggle endpoint enabled state
  const handleToggleEnabled = async (endpoint: ApiEndpoint, newState: boolean) => {
    const provider = providers.find((p) => p.id === endpoint.providerId);
    if (!provider) return;

    // Update local state immediately
    const updatedProviders = providers.map((p) =>
      p.id === provider.id ? { ...p, enabled: newState } : p
    );
    setProviders(updatedProviders);

    try {
      await api.saveProvider({ ...provider, enabled: newState }, provider.id);
    } catch (e) {
      console.error('Toggle error', e);
      alert('Failed to update endpoint status: ' + e);
      loadData(); // Reload on error
    }
  };

  return (
    <div className="min-h-screen p-6 transition-all duration-300 bg-gradient-to-br from-bg-deep to-bg-surface">
      <Card
        title="API Endpoints"
        extra={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-text-secondary text-xs">
              <span className="w-2 h-2 rounded-full bg-success"></span>
              <span>{filteredEndpoints.filter((e) => e.enabled).length} Active</span>
              <span className="mx-1">|</span>
              <span className="w-2 h-2 rounded-full bg-danger"></span>
              <span>{filteredEndpoints.filter((e) => !e.enabled).length} Inactive</span>
            </div>
          </div>
        }
      >
        {/* Search Bar */}
        <div className="mb-6 flex items-center gap-4">
          <div className="flex-1 relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">
              <Search size={18} />
            </div>
            <Input
              placeholder="Search endpoints by name, URL, API type, or provider..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button variant="secondary" size="sm" onClick={loadData} disabled={loading}>
            Refresh
          </Button>
        </div>

        {/* Endpoints Table */}
        <div className="overflow-x-auto -m-6">
          <table className="w-full border-collapse font-body text-[13px]">
            <thead>
              <tr>
                <th
                  className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                  style={{ paddingLeft: '24px' }}
                >
                  Status
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Endpoint
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  API Type
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Models
                </th>
                <th className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider">
                  Quota
                </th>
                <th
                  className="px-4 py-3 text-left border-b border-border-glass bg-bg-hover font-semibold text-text-secondary text-[11px] uppercase tracking-wider"
                  style={{ paddingRight: '24px', textAlign: 'right' }}
                >
                  Toggle
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && filteredEndpoints.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-text-secondary border-b border-border-glass"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <div className="animate-spin">
                        <Globe size={24} className="text-primary" />
                      </div>
                      <span>Loading endpoints...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredEndpoints.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-12 text-center text-text-secondary border-b border-border-glass"
                  >
                    <div className="flex flex-col items-center gap-3">
                      <AlertCircle size={24} className="text-text-muted" />
                      <span>
                        {searchQuery
                          ? 'No endpoints match your search criteria'
                          : 'No API endpoints configured'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredEndpoints.map((endpoint) => (
                  <tr key={endpoint.id} className="hover:bg-bg-hover transition-colors">
                    {/* Status */}
                    <td
                      className="px-4 py-3 text-left border-b border-border-glass text-text"
                      style={{ paddingLeft: '24px' }}
                    >
                      {getStatusBadge(endpoint)}
                    </td>

                    {/* Endpoint Name & URL */}
                    <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                      <div className="flex flex-col gap-1">
                        <div className="font-medium">{endpoint.name}</div>
                        <div
                          className="text-xs text-text-secondary font-mono"
                          title={endpoint.url}
                        >
                          {truncateUrl(endpoint.url)}
                        </div>
                      </div>
                    </td>

                    {/* API Type */}
                    <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                      <Badge
                        status="connected"
                        style={{
                          ...getApiTypeBadgeStyle(endpoint.apiType),
                          fontSize: '10px',
                          padding: '2px 8px',
                        }}
                        className="[&_.connection-dot]:hidden"
                      >
                        {endpoint.apiType}
                      </Badge>
                    </td>

                    {/* Provider */}
                    <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                      <div className="flex items-center gap-2">
                        <Server size={14} className="text-text-muted" />
                        <span className="font-medium">{endpoint.providerId}</span>
                      </div>
                    </td>

                    {/* Model Count */}
                    <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{endpoint.modelCount}</span>
                        <span className="text-text-secondary text-xs">
                          {endpoint.modelCount === 1 ? 'model' : 'models'}
                        </span>
                      </div>
                    </td>

                    {/* Quota Settings */}
                    <td className="px-4 py-3 text-left border-b border-border-glass text-text">
                      {endpoint.hasQuotaChecker ? (
                        <div className="flex flex-col gap-1">
                          <Badge
                            status={endpoint.quotaCheckerEnabled ? 'connected' : 'warning'}
                            style={{ fontSize: '10px', padding: '2px 6px' }}
                            className="[&_.connection-dot]:hidden"
                          >
                            {endpoint.quotaCheckerType}
                          </Badge>
                          <span className="text-xs text-text-secondary">
                            {endpoint.quotaCheckerEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                      ) : (
                        <span className="text-text-muted text-xs">-</span>
                      )}
                    </td>

                    {/* Toggle */}
                    <td
                      className="px-4 py-3 text-left border-b border-border-glass text-text"
                      style={{ paddingRight: '24px', textAlign: 'right' }}
                    >
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch
                          checked={endpoint.enabled}
                          onChange={(val) => handleToggleEnabled(endpoint, val)}
                          size="sm"
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Summary Footer */}
        <div className="mt-6 pt-4 border-t border-border-glass flex items-center justify-between text-xs text-text-secondary">
          <div className="flex items-center gap-4">
            <span>
              Showing <strong className="text-text">{filteredEndpoints.length}</strong> of{' '}
              <strong className="text-text">{endpoints.length}</strong> endpoints
            </span>
            {searchQuery && (
              <span className="text-text-muted">
                filtered by &quot;{searchQuery}&quot;
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
              <span>Active endpoints are receiving traffic</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default ApiEndpointsList;
