import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api } from '@/lib/api';
import { parse, stringify } from 'yaml';
import { Save, Server, FileText, AlertTriangle, Shield, Activity } from 'lucide-react';
import { toast } from 'sonner';

interface ServerSettings {
  host: string;
  port: number;
}

interface AdminSettings {
  apiKey: string;
  rateLimit: {
    windowMs: number;
    maxRequests: number;
  };
}

interface EventsSettings {
  heartbeatIntervalMs: number;
  maxClients: number;
}

interface LoggingSettings {
  level: 'debug' | 'info' | 'warn' | 'error';
  usage: {
    enabled: boolean;
    storagePath: string;
    retentionDays: number;
  };
  debug: {
    enabled: boolean;
    captureRequests: boolean;
    captureResponses: boolean;
    storagePath: string;
    retentionDays: number;
    streamTimeoutSeconds: number;
  };
  errors: {
    storagePath: string;
    retentionDays: number;
  };
}

interface ResilienceSettings {
  cooldown: {
    storagePath: string;
    minDuration: number;
    maxDuration: number;
    defaults: {
      rate_limit: number;
      auth_error: number;
      timeout: number;
      server_error: number;
      connection_error: number;
    };
  };
  health: {
    degradedThreshold: number;
    unhealthyThreshold: number;
  };
}

interface ConfigData {
  server: ServerSettings;
  admin: AdminSettings;
  events: EventsSettings;
  logging: LoggingSettings;
  resilience: ResilienceSettings;
}

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];

export const SystemPage: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [server, setServer] = useState<ServerSettings>({
    host: '0.0.0.0',
    port: 4000,
  });
  const [admin, setAdmin] = useState<AdminSettings>({
    apiKey: '',
    rateLimit: {
      windowMs: 60000,
      maxRequests: 100,
    },
  });
  const [events, setEvents] = useState<EventsSettings>({
    heartbeatIntervalMs: 5000,
    maxClients: 10,
  });
  const [logging, setLogging] = useState<LoggingSettings>({
    level: 'info',
    usage: {
      enabled: true,
      storagePath: './data/logs/usage',
      retentionDays: 30,
    },
    debug: {
      enabled: false,
      captureRequests: true,
      captureResponses: true,
      storagePath: './data/logs/debug',
      retentionDays: 7,
      streamTimeoutSeconds: 300,
    },
    errors: {
      storagePath: './data/logs/errors',
      retentionDays: 90,
    },
  });
  const [resilience, setResilience] = useState<ResilienceSettings>({
    cooldown: {
      storagePath: './data/cooldowns.json',
      minDuration: 5,
      maxDuration: 3600,
      defaults: {
        rate_limit: 60,
        auth_error: 3600,
        timeout: 30,
        server_error: 120,
        connection_error: 60,
      },
    },
    health: {
      degradedThreshold: 0.5,
      unhealthyThreshold: 0.9,
    },
  });

  const loadConfig = async () => {
    try {
      setLoading(true);
      const configYaml = await api.getConfig();
      const config = parse(configYaml) as ConfigData;

      if (config.server) setServer(config.server);
      if (config.admin) setAdmin(config.admin);
      if (config.events) setEvents(config.events);
      if (config.logging)       setLogging(config.logging);
      if (config.resilience) setResilience(config.resilience);
    } catch (error) {
      console.error('Failed to load config:', error);
      toast.error('Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleSave = async () => {
    try {
      setSaving(true);

      const configYaml = await api.getConfig();
      const config = parse(configYaml) as unknown as Record<string, unknown>;

      config.server = server;
      config.admin = admin;
      config.events = events;
      config.logging = logging;
      config.resilience = resilience;

      await api.updateConfig(stringify(config));
      toast.success('System settings saved successfully');
    } catch (error) {
      console.error('Failed to save config:', error);
      toast.error('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms >= 60000) return `${ms / 60000}m`;
    if (ms >= 1000) return `${ms / 1000}s`;
    return `${ms}ms`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-muted-foreground">Loading system configuration...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">System Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure server, logging, resilience, and admin settings
          </p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <Tabs defaultValue="server" className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 gap-1 p-1">
          <TabsTrigger value="server">
            <Server className="h-4 w-4 mr-2" />
            Server
          </TabsTrigger>
          <TabsTrigger value="admin">
            <Shield className="h-4 w-4 mr-2" />
            Admin
          </TabsTrigger>
          <TabsTrigger value="events">
            <Activity className="h-4 w-4 mr-2" />
            Events
          </TabsTrigger>
          <TabsTrigger value="logging">
            <FileText className="h-4 w-4 mr-2" />
            Logging
          </TabsTrigger>
          <TabsTrigger value="resilience">
            <AlertTriangle className="h-4 w-4 mr-2" />
            Resilience
          </TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Server Configuration</CardTitle>
              <CardDescription>
                Configure the server's network binding settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="server-host">Host Address</Label>
                <Input
                  id="server-host"
                  value={server.host}
                  onChange={(e) => setServer({ ...server, host: e.target.value })}
                  placeholder="0.0.0.0"
                />
                <p className="text-xs text-muted-foreground">
                  The network interface to bind to. 0.0.0.0 allows connections from all interfaces.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="server-port">Port</Label>
                <Input
                  id="server-port"
                  type="number"
                  min="1"
                  max="65535"
                  value={server.port}
                  onChange={(e) => setServer({ ...server, port: parseInt(e.target.value) || 4000 })}
                />
                <p className="text-xs text-muted-foreground">
                  The port number for the HTTP server. Requires restart to take effect.
                </p>
              </div>

              <div className="rounded-lg bg-muted p-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Server className="h-4 w-4" />
                  Connection URL
                </div>
                <code className="text-sm bg-background px-2 py-1 rounded">
                  http://{server.host}:{server.port}
                </code>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="admin" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Admin Settings</CardTitle>
              <CardDescription>
                Configure admin authentication and rate limiting
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="admin-api-key">Admin API Key</Label>
                <Input
                  id="admin-api-key"
                  type="password"
                  value={admin.apiKey}
                  onChange={(e) => setAdmin({ ...admin, apiKey: e.target.value })}
                  placeholder="Enter admin API key"
                />
                <p className="text-xs text-muted-foreground">
                  API key for admin interface access. Keep this secret!
                </p>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold">Rate Limiting</h3>

                <div className="space-y-2">
                  <Label htmlFor="rate-limit-window">Time Window (ms)</Label>
                  <Input
                    id="rate-limit-window"
                    type="number"
                    min="1000"
                    value={admin.rateLimit.windowMs}
                    onChange={(e) =>
                      setAdmin({
                        ...admin,
                        rateLimit: { ...admin.rateLimit, windowMs: parseInt(e.target.value) || 60000 },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Time window in milliseconds for rate limit calculation
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="rate-limit-max">Max Requests</Label>
                  <Input
                    id="rate-limit-max"
                    type="number"
                    min="1"
                    value={admin.rateLimit.maxRequests}
                    onChange={(e) =>
                      setAdmin({
                        ...admin,
                        rateLimit: { ...admin.rateLimit, maxRequests: parseInt(e.target.value) || 100 },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of requests allowed per time window
                  </p>
                </div>

                <div className="rounded-lg bg-muted p-4">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Activity className="h-4 w-4" />
                    Rate Limit: {admin.rateLimit.maxRequests} requests per{' '}
                    {formatDuration(admin.rateLimit.windowMs)}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Event System</CardTitle>
              <CardDescription>
                Configure event handling and client management
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="heartbeat-interval">Heartbeat Interval</Label>
                <Input
                  id="heartbeat-interval"
                  type="number"
                  min="1000"
                  value={events.heartbeatIntervalMs}
                  onChange={(e) =>
                    setEvents({ ...events, heartbeatIntervalMs: parseInt(e.target.value) || 5000 })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Interval in milliseconds between heartbeat signals
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max-clients">Max Clients</Label>
                <Input
                  id="max-clients"
                  type="number"
                  min="1"
                  value={events.maxClients}
                  onChange={(e) => setEvents({ ...events, maxClients: parseInt(e.target.value) || 10 })}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum number of concurrent client connections
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logging" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Logging Configuration</CardTitle>
              <CardDescription>
                Configure logging levels and storage settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="log-level">Log Level</Label>
                <Select
                  value={logging.level}
                  onValueChange={(value: LogLevel) => setLogging({ ...logging, level: value })}
                >
                  <SelectTrigger id="log-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LOG_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Minimum log level to capture (debug, info, warn, error)
                </p>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold">Usage Logs</h3>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="usage-enabled"
                    checked={logging.usage.enabled}
                    onCheckedChange={(checked) =>
                      setLogging({ ...logging, usage: { ...logging.usage, enabled: checked } })
                    }
                  />
                  <Label htmlFor="usage-enabled">Enable Usage Logging</Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="usage-storage-path">Storage Path</Label>
                  <Input
                    id="usage-storage-path"
                    value={logging.usage.storagePath}
                    onChange={(e) =>
                      setLogging({ ...logging, usage: { ...logging.usage, storagePath: e.target.value } })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="usage-retention">Retention Days</Label>
                  <Input
                    id="usage-retention"
                    type="number"
                    min="1"
                    value={logging.usage.retentionDays}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        usage: { ...logging.usage, retentionDays: parseInt(e.target.value) || 30 },
                      })
                    }
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold">Debug Logs</h3>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="debug-enabled"
                    checked={logging.debug.enabled}
                    onCheckedChange={(checked) =>
                      setLogging({ ...logging, debug: { ...logging.debug, enabled: checked } })
                    }
                  />
                  <Label htmlFor="debug-enabled">Enable Debug Logging</Label>
                  <Badge variant={logging.debug.enabled ? 'destructive' : 'secondary'}>
                    {logging.debug.enabled ? 'Active' : 'Inactive'}
                  </Badge>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="capture-requests"
                    checked={logging.debug.captureRequests}
                    onCheckedChange={(checked) =>
                      setLogging({ ...logging, debug: { ...logging.debug, captureRequests: checked } })
                    }
                  />
                  <Label htmlFor="capture-requests">Capture Requests</Label>
                </div>

                <div className="flex items-center space-x-2">
                  <Switch
                    id="capture-responses"
                    checked={logging.debug.captureResponses}
                    onCheckedChange={(checked) =>
                      setLogging({ ...logging, debug: { ...logging.debug, captureResponses: checked } })
                    }
                  />
                  <Label htmlFor="capture-responses">Capture Responses</Label>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="debug-storage-path">Storage Path</Label>
                  <Input
                    id="debug-storage-path"
                    value={logging.debug.storagePath}
                    onChange={(e) =>
                      setLogging({ ...logging, debug: { ...logging.debug, storagePath: e.target.value } })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="debug-retention">Retention Days</Label>
                  <Input
                    id="debug-retention"
                    type="number"
                    min="1"
                    value={logging.debug.retentionDays}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        debug: { ...logging.debug, retentionDays: parseInt(e.target.value) || 7 },
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="stream-timeout">Stream Timeout (seconds)</Label>
                  <Input
                    id="stream-timeout"
                    type="number"
                    min="30"
                    max="3600"
                    value={logging.debug.streamTimeoutSeconds}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        debug: { ...logging.debug, streamTimeoutSeconds: parseInt(e.target.value) || 300 },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum duration for streaming requests before force completing trace (30-3600 seconds)
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold">Error Logs</h3>

                <div className="space-y-2">
                  <Label htmlFor="error-storage-path">Storage Path</Label>
                  <Input
                    id="error-storage-path"
                    value={logging.errors.storagePath}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        errors: { ...logging.errors, storagePath: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="error-retention">Retention Days</Label>
                  <Input
                    id="error-retention"
                    type="number"
                    min="1"
                    value={logging.errors.retentionDays}
                    onChange={(e) =>
                      setLogging({
                        ...logging,
                        errors: { ...logging.errors, retentionDays: parseInt(e.target.value) || 90 },
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="resilience" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Resilience Settings</CardTitle>
              <CardDescription>
                Configure cooldown management and health monitoring
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <h3 className="font-semibold">Cooldown Configuration</h3>

                <div className="space-y-2">
                  <Label htmlFor="cooldown-storage-path">Storage Path</Label>
                  <Input
                    id="cooldown-storage-path"
                    value={resilience.cooldown.storagePath}
                    onChange={(e) =>
                      setResilience({
                        ...resilience,
                        cooldown: { ...resilience.cooldown, storagePath: e.target.value },
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cooldown-min">Minimum Duration (seconds)</Label>
                  <Input
                    id="cooldown-min"
                    type="number"
                    min="1"
                    value={resilience.cooldown.minDuration}
                    onChange={(e) =>
                      setResilience({
                        ...resilience,
                        cooldown: { ...resilience.cooldown, minDuration: parseInt(e.target.value) || 5 },
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cooldown-max">Maximum Duration (seconds)</Label>
                  <Input
                    id="cooldown-max"
                    type="number"
                    min="1"
                    value={resilience.cooldown.maxDuration}
                    onChange={(e) =>
                      setResilience({
                        ...resilience,
                        cooldown: { ...resilience.cooldown, maxDuration: parseInt(e.target.value) || 3600 },
                      })
                    }
                  />
                </div>

                <div className="space-y-4 pt-4 border-t">
                  <h4 className="font-medium">Default Cooldown Durations (seconds)</h4>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Rate Limit</Label>
                      <Input
                        type="number"
                        min="1"
                        value={resilience.cooldown.defaults.rate_limit}
                        onChange={(e) =>
                          setResilience({
                            ...resilience,
                            cooldown: {
                              ...resilience.cooldown,
                              defaults: {
                                ...resilience.cooldown.defaults,
                                rate_limit: parseInt(e.target.value) || 60,
                              },
                            },
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Auth Error</Label>
                      <Input
                        type="number"
                        min="1"
                        value={resilience.cooldown.defaults.auth_error}
                        onChange={(e) =>
                          setResilience({
                            ...resilience,
                            cooldown: {
                              ...resilience.cooldown,
                              defaults: {
                                ...resilience.cooldown.defaults,
                                auth_error: parseInt(e.target.value) || 3600,
                              },
                            },
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Timeout</Label>
                      <Input
                        type="number"
                        min="1"
                        value={resilience.cooldown.defaults.timeout}
                        onChange={(e) =>
                          setResilience({
                            ...resilience,
                            cooldown: {
                              ...resilience.cooldown,
                              defaults: {
                                ...resilience.cooldown.defaults,
                                timeout: parseInt(e.target.value) || 30,
                              },
                            },
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Server Error</Label>
                      <Input
                        type="number"
                        min="1"
                        value={resilience.cooldown.defaults.server_error}
                        onChange={(e) =>
                          setResilience({
                            ...resilience,
                            cooldown: {
                              ...resilience.cooldown,
                              defaults: {
                                ...resilience.cooldown.defaults,
                                server_error: parseInt(e.target.value) || 120,
                              },
                            },
                          })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Connection Error</Label>
                      <Input
                        type="number"
                        min="1"
                        value={resilience.cooldown.defaults.connection_error}
                        onChange={(e) =>
                          setResilience({
                            ...resilience,
                            cooldown: {
                              ...resilience.cooldown,
                              defaults: {
                                ...resilience.cooldown.defaults,
                                connection_error: parseInt(e.target.value) || 60,
                              },
                            },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t">
                <h3 className="font-semibold">Health Monitoring</h3>

                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between mb-2">
                      <Label htmlFor="degraded-threshold">Degraded Threshold</Label>
                      <span className="text-sm text-muted-foreground">
                        {(resilience.health.degradedThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Slider
                      id="degraded-threshold"
                      min={0}
                      max={1}
                      step={0.05}
                      value={[resilience.health.degradedThreshold]}
                      onValueChange={([value]: number[]) =>
                        setResilience({
                          ...resilience,
                          health: { ...resilience.health, degradedThreshold: value ?? 0.5 },
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Error rate at which service is considered degraded
                    </p>
                  </div>

                  <div>
                    <div className="flex justify-between mb-2">
                      <Label htmlFor="unhealthy-threshold">Unhealthy Threshold</Label>
                      <span className="text-sm text-muted-foreground">
                        {(resilience.health.unhealthyThreshold * 100).toFixed(0)}%
                      </span>
                    </div>
                    <Slider
                      id="unhealthy-threshold"
                      min={0}
                      max={1}
                      step={0.05}
                      value={[resilience.health.unhealthyThreshold]}
                      onValueChange={([value]: number[]) =>
                        setResilience({
                          ...resilience,
                          health: { ...resilience.health, unhealthyThreshold: value ?? 0.9 },
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Error rate at which service is considered unhealthy
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
