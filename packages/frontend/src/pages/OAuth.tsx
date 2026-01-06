import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, ExternalLink, Trash2 } from 'lucide-react';

interface OAuthStatus {
    configured: boolean;
    provider?: string;
    user?: string;
    project_id?: string;
    expires_at?: number;
    expires_in_seconds?: number;
    is_expired?: boolean;
    auth_url?: string;
    message?: string;
}

interface RefreshStatus {
    available: boolean;
    running?: boolean;
    checkInterval?: number;
    refreshThreshold?: number;
    message?: string;
}

export default function OAuth() {
    const [status, setStatus] = useState<OAuthStatus | null>(null);
    const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const loadStatus = async () => {
        try {
            setLoading(true);
            setError(null);
            const [oauthStatus, tokenRefreshStatus] = await Promise.all([
                api.getOAuthStatus('antigravity'),
                api.getOAuthRefreshStatus()
            ]);
            setStatus(oauthStatus);
            setRefreshStatus(tokenRefreshStatus);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load OAuth status');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStatus();
        // Refresh status every 30 seconds
        const interval = setInterval(loadStatus, 30000);
        return () => clearInterval(interval);
    }, []);

    const handleInitiateAuth = async () => {
        try {
            const response = await api.initiateOAuthFlow('antigravity');
            window.open(response.auth_url, '_blank');
            // Poll for status after opening auth window
            const pollInterval = setInterval(async () => {
                const newStatus = await api.getOAuthStatus('antigravity');
                if (newStatus.configured) {
                    clearInterval(pollInterval);
                    await loadStatus();
                }
            }, 3000);

            // Stop polling after 5 minutes
            setTimeout(() => clearInterval(pollInterval), 5 * 60 * 1000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to initiate OAuth flow');
        }
    };

    const handleRefreshToken = async () => {
        try {
            setRefreshing(true);
            setError(null);
            const result = await api.refreshOAuthToken();
            if (result.success) {
                await loadStatus();
            } else {
                setError(result.message);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh token');
        } finally {
            setRefreshing(false);
        }
    };

    const handleDeleteCredentials = async () => {
        if (!status?.user) return;

        try {
            setError(null);
            const success = await api.deleteOAuthCredentials('antigravity', status.user);
            if (success) {
                setShowDeleteModal(false);
                await loadStatus();
            } else {
                setError('Failed to delete credentials');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete credentials');
        }
    };

    const formatTimeRemaining = (seconds: number): string => {
        if (seconds < 0) return 'Expired';
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const getStatusBadge = () => {
        if (!status) return null;

        if (!status.configured) {
            return <Badge variant="secondary" icon={<XCircle size={14} />}>Not Configured</Badge>;
        }

        if (status.is_expired) {
            return <Badge variant="danger" icon={<XCircle size={14} />}>Expired</Badge>;
        }

        if (status.expires_in_seconds && status.expires_in_seconds < 600) {
            return <Badge variant="warning" icon={<AlertTriangle size={14} />}>Expiring Soon</Badge>;
        }

        return <Badge variant="success" icon={<CheckCircle size={14} />}>Connected</Badge>;
    };

    if (loading) {
        return (
            <div className="p-8">
                <div className="flex items-center justify-center py-12">
                    <RefreshCw className="animate-spin" size={24} />
                </div>
            </div>
        );
    }

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">OAuth Management</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage OAuth 2.0 authentication for providers like Google Antigravity
                    </p>
                </div>
                <Button onClick={loadStatus} variant="secondary" size="sm">
                    <RefreshCw size={16} className="mr-2" />
                    Refresh
                </Button>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
                    {error}
                </div>
            )}

            <Card>
                <div className="p-6 space-y-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold flex items-center gap-2">
                                Google Antigravity
                                {getStatusBadge()}
                            </h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                OAuth 2.0 authentication for Google Antigravity API
                            </p>
                        </div>
                    </div>

                    {status?.configured ? (
                        <div className="space-y-4">
                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                                <div className="text-sm font-medium text-blue-400 mb-2">⚠️ Remember to Configure Provider & Model</div>
                                <div className="text-sm text-muted-foreground space-y-2">
                                    <p>OAuth authentication is active, but you must configure a provider and model in your config to use it.</p>
                                    <p>
                                        <strong>Option 1:</strong> Visit the <a href="/providers" className="text-blue-400 hover:underline">Providers page</a> to configure via UI.
                                    </p>
                                    <p>
                                        <strong>Option 2:</strong> Add to your YAML config with <code className="bg-background/50 px-1 py-0.5 rounded text-xs">oauth_provider: antigravity</code> (no <code className="bg-background/50 px-1 py-0.5 rounded text-xs">api_key</code> needed).
                                    </p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                                    <div className="text-sm text-muted-foreground">Account</div>
                                    <div className="font-mono text-sm mt-1">{status.user || 'Unknown'}</div>
                                </div>

                                {status.project_id && (
                                    <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                                        <div className="text-sm text-muted-foreground">Project ID</div>
                                        <div className="font-mono text-sm mt-1">{status.project_id}</div>
                                    </div>
                                )}

                                {status.expires_in_seconds !== undefined && (
                                    <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                                        <div className="text-sm text-muted-foreground">Token Expires In</div>
                                        <div className="font-mono text-sm mt-1">
                                            {formatTimeRemaining(status.expires_in_seconds)}
                                        </div>
                                    </div>
                                )}

                                {status.expires_at && (
                                    <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                                        <div className="text-sm text-muted-foreground">Expires At</div>
                                        <div className="font-mono text-sm mt-1">
                                            {new Date(status.expires_at).toLocaleString()}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {refreshStatus && (
                                <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-sm font-medium">Automatic Token Refresh</div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                {refreshStatus.running ? 'Service is running' : 'Service not available'}
                                                {refreshStatus.checkInterval && ` • Checks every ${Math.floor(refreshStatus.checkInterval / 60000)} minutes`}
                                                {refreshStatus.refreshThreshold && ` • Refreshes ${Math.floor(refreshStatus.refreshThreshold / 60000)} minutes before expiry`}
                                            </div>
                                        </div>
                                        <Badge variant={refreshStatus.running ? 'success' : 'secondary'}>
                                            {refreshStatus.running ? 'Active' : 'Inactive'}
                                        </Badge>
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-3">
                                <Button
                                    onClick={handleRefreshToken}
                                    variant="secondary"
                                    disabled={refreshing}
                                >
                                    {refreshing ? (
                                        <>
                                            <RefreshCw size={16} className="mr-2 animate-spin" />
                                            Refreshing...
                                        </>
                                    ) : (
                                        <>
                                            <RefreshCw size={16} className="mr-2" />
                                            Refresh Token Now
                                        </>
                                    )}
                                </Button>
                                <Button
                                    onClick={() => setShowDeleteModal(true)}
                                    variant="danger"
                                >
                                    <Trash2 size={16} className="mr-2" />
                                    Disconnect
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                                <p className="text-sm text-muted-foreground">
                                    {status?.message || 'No OAuth credentials configured. Click the button below to authenticate with Google.'}
                                </p>
                            </div>

                            <Button onClick={handleInitiateAuth} variant="primary">
                                <ExternalLink size={16} className="mr-2" />
                                Connect to Google Antigravity
                            </Button>

                            <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                                <div className="text-sm font-medium text-blue-400 mb-2">What happens next?</div>
                                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                                    <li>You'll be redirected to Google to sign in</li>
                                    <li>Grant Plexus access to the required scopes</li>
                                    <li>You'll be redirected back to Plexus</li>
                                    <li>Your tokens will be securely stored and automatically refreshed</li>
                                </ol>
                            </div>
                        </div>
                    )}
                </div>
            </Card>

            {showDeleteModal && (
                <Modal
                    isOpen={showDeleteModal}
                    onClose={() => setShowDeleteModal(false)}
                    title="Disconnect OAuth Account"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Are you sure you want to disconnect your Google Antigravity account ({status?.user})?
                            This will remove all stored OAuth credentials.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <Button
                                onClick={() => setShowDeleteModal(false)}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDeleteCredentials}
                                variant="danger"
                            >
                                Disconnect
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}
        </div>
    );
}
