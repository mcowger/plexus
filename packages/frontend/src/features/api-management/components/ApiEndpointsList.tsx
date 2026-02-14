import React, { useState, useMemo } from 'react';
import {
  Globe,
  Key,
  Server,
  Search,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Clock,
  Database,
  Zap,
} from 'lucide-react';
import { useConfig } from '../../../hooks/useConfig';
import { Button } from '../../../components/ui/shadcn-button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../../components/ui/shadcn-card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/shadcn-table';
import { Badge } from '../../../components/ui/shadcn-badge';
import { Input } from '../../../components/ui/Input';
import { cn } from '../../../lib/utils';

interface ApiEndpoint {
  id: string;
  name: string;
  displayName: string;
  apiBaseUrl: string;
  apiKey: string;
  models: string[];
  enabled: boolean;
  estimateTokens?: boolean;
}

export const ApiEndpointsList: React.FC = () => {
  const { config, loading, error } = useConfig();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set());

  const endpoints = useMemo<ApiEndpoint[]>(() => {
    if (!config?.providers) return [];

    return Object.entries(config.providers).map(([id, provider]: [string, any]) => ({
      id,
      name: id,
      displayName: provider.display_name || id,
      apiBaseUrl: typeof provider.api_base_url === 'string'
        ? provider.api_base_url
        : provider.api_base_url?.chat || '',
      apiKey: provider.api_key || '',
      models: Object.keys(provider.models || {}),
      enabled: provider.enabled !== false,
      estimateTokens: provider.estimateTokens,
    }));
  }, [config]);

  const filteredEndpoints = useMemo(() => {
    if (!searchQuery) return endpoints;
    const query = searchQuery.toLowerCase();
    return endpoints.filter(
      (ep) =>
        ep.name.toLowerCase().includes(query) ||
        ep.displayName.toLowerCase().includes(query) ||
        ep.apiBaseUrl.toLowerCase().includes(query) ||
        ep.models.some((m) => m.toLowerCase().includes(query))
    );
  }, [endpoints, searchQuery]);

  const toggleExpand = (id: string) => {
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const maskApiKey = (key: string): string => {
    if (!key || key.length < 8) return '***';
    return key.slice(0, 4) + '...' + key.slice(-4);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="ml-3 text-text-secondary">Loading API endpoints...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-8">
          <div className="text-center text-danger">
            <XCircle className="w-12 h-12 mx-auto mb-3" />
            <p className="font-medium">Failed to load API endpoints</p>
            <p className="text-sm text-text-secondary mt-1">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Server className="w-5 h-5" />
                API Endpoints
              </CardTitle>
              <CardDescription>
                {endpoints.length} provider{endpoints.length !== 1 ? 's' : ''} configured
              </CardDescription>
            </div>
            <div className="flex items-center gap-4 text-sm text-text-secondary">
              <div className="flex items-center gap-1">
                <CheckCircle className="w-4 h-4 text-success" />
                <span>{endpoints.filter((e) => e.enabled).length} active</span>
              </div>
              <div className="flex items-center gap-1">
                <XCircle className="w-4 h-4 text-danger" />
                <span>{endpoints.filter((e) => !e.enabled).length} disabled</span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input
                placeholder="Search endpoints, models, or URLs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[200px]">Provider</TableHead>
                  <TableHead>Endpoint URL</TableHead>
                  <TableHead className="w-[100px]">Models</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEndpoints.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-text-secondary">
                      {searchQuery ? 'No endpoints match your search' : 'No API endpoints configured'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEndpoints.map((endpoint) => (
                    <React.Fragment key={endpoint.id}>
                      <TableRow className="group">
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Globe className="w-4 h-4 text-text-muted" />
                            <div>
                              <div className="font-medium">{endpoint.displayName}</div>
                              <div className="text-xs text-text-secondary">{endpoint.name}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Database className="w-4 h-4 text-text-muted" />
                            <code className="text-xs bg-bg-hover px-2 py-1 rounded">
                              {endpoint.apiBaseUrl || 'N/A'}
                            </code>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            {endpoint.models.length} model
                            {endpoint.models.length !== 1 ? 's' : ''}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={endpoint.enabled ? 'default' : 'secondary'}
                            className={cn(
                              endpoint.enabled && 'bg-success/20 text-success hover:bg-success/30'
                            )}
                          >
                            {endpoint.enabled ? (
                              <><CheckCircle className="w-3 h-3 mr-1" /> Active</>
                            ) : (
                              <><XCircle className="w-3 h-3 mr-1" /> Disabled</>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleExpand(endpoint.id)}
                          >
                            {expandedProviders.has(endpoint.id) ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </Button>
                        </TableCell>
                      </TableRow>
                      {expandedProviders.has(endpoint.id) && (
                        <TableRow className="bg-bg-hover/50">
                          <TableCell colSpan={5} className="p-4">
                            <div className="space-y-4">
                              <div>
                                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                                  <Key className="w-4 h-4" />
                                  API Key
                                </h4>
                                <code className="text-xs bg-bg-surface px-2 py-1 rounded font-mono">
                                  {maskApiKey(endpoint.apiKey)}
                                </code>
                              </div>
                              <div>
                                <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                                  <Zap className="w-4 h-4" />
                                  Models ({endpoint.models.length})
                                </h4>
                                <div className="flex flex-wrap gap-2">
                                  {endpoint.models.map((model) => (
                                    <Badge key={model} variant="outline" className="text-xs">
                                      {model}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <div className="flex items-center gap-4 text-xs text-text-secondary">
                                {endpoint.estimateTokens && (
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    Token estimation enabled
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ApiEndpointsList;
