import { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { formatDuration, formatTimeAgo } from '../lib/format';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, ExternalLink, Trash2, ChevronDown, ChevronRight, Shield, AlertCircle, X } from 'lucide-react';

interface OAuthCredentialsGrouped {
    providers: Array<{
        provider: string;
        accounts: Array<{
            user_identifier: string;
            expires_at: number;
            expires_in_seconds: number;
            is_expired: boolean;
            project_id?: string;
            on_cooldown: boolean;
            cooldown_expiry?: number;
            cooldown_remaining_seconds?: number;
            status: 'active' | 'expiring' | 'expired' | 'cooldown';
            last_refreshed_at: number;
            token_age_seconds: number;
            refresh_token_expires_at: number;
            refresh_token_expires_in_seconds: number;
        }>;
    }>;
}

interface RefreshStatus {
    available: boolean;
    running?: boolean;
    checkInterval?: number;
    refreshThreshold?: number;
    message?: string;
}

export default function OAuth() {
    const [credentials, setCredentials] = useState<OAuthCredentialsGrouped | null>(null);
    const [refreshStatus, setRefreshStatus] = useState<RefreshStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshingAccounts, setRefreshingAccounts] = useState<Set<string>>(new Set());
    const [expandedProviders, setExpandedProviders] = useState<Set<string>>(new Set(['antigravity', 'claude-code']));
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<{ provider: string; account: string } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [cooldownTimers, setCooldownTimers] = useState<Record<string, number>>({});

    // Manual Auth State
    const [showManualAuthModal, setShowManualAuthModal] = useState(false);
    const [manualAuthUrl, setManualAuthUrl] = useState('');
    const [pastedUrl, setPastedUrl] = useState('');
    const [manualAuthLoading, setManualAuthLoading] = useState(false);
    const [manualAuthError, setManualAuthError] = useState<string | null>(null);

    const loadStatus = async () => {
        try {
            setLoading(true);
            setError(null);
            const [oauthCredentials, tokenRefreshStatus] = await Promise.all([
                api.getOAuthCredentialsGrouped(),
                api.getOAuthRefreshStatus()
            ]);
            setCredentials(oauthCredentials);
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

    // Cooldown countdown timer
    useEffect(() => {
        const interval = setInterval(() => {
            const newTimers: Record<string, number> = {};
            credentials?.providers.forEach(provider => {
                provider.accounts.forEach(account => {
                    if (account.on_cooldown && account.cooldown_remaining_seconds) {
                        const key = `${provider.provider}:${account.user_identifier}`;
                        const remaining = Math.max(0, account.cooldown_remaining_seconds - 1);
                        if (remaining > 0) {
                            newTimers[key] = remaining;
                        }
                    }
                });
            });
            setCooldownTimers(newTimers);
        }, 1000);

        return () => clearInterval(interval);
    }, [credentials]);

    const toggleProvider = (provider: string) => {
        const newExpanded = new Set(expandedProviders);
        if (newExpanded.has(provider)) {
            newExpanded.delete(provider);
        } else {
            newExpanded.add(provider);
        }
        setExpandedProviders(newExpanded);
    };

    const handleInitiateAuth = async (provider: string) => {
        try {
            let response: { auth_url: string };

            if (provider === 'claude-code') {
                response = await api.initiateClaudeCodeAuth();

                // Check for localhost
                const hostname = window.location.hostname;
                const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

                if (!isLocalhost) {
                    setManualAuthUrl(response.auth_url);
                    setShowManualAuthModal(true);
                    return;
                }
            } else {
                response = await api.initiateOAuthFlow(provider);
            }

            window.open(response.auth_url, '_blank');

            // Poll for status after opening auth window
            const pollInterval = setInterval(async () => {
                const newStatus = await api.getOAuthCredentialsGrouped(provider);
                if (newStatus.providers.length > 0 && newStatus.providers[0].accounts.length > 0) {
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

    const handleManualAuthComplete = async () => {
        if (!pastedUrl) return;

        try {
            setManualAuthLoading(true);
            setManualAuthError(null);

            // Parse URL to get query parameters
            let urlObj: URL;
            try {
                // If user pasted just path or incomplete URL, try to fix it, but really they should paste full URL
                urlObj = new URL(pastedUrl);
            } catch (e) {
                setManualAuthError('Invalid URL format. Please paste the full URL from your address bar.');
                setManualAuthLoading(false);
                return;
            }

            const code = urlObj.searchParams.get('code');
            const state = urlObj.searchParams.get('state');

            if (!code || !state) {
                setManualAuthError('The URL does not contain the required "code" and "state" parameters.');
                setManualAuthLoading(false);
                return;
            }

            const result = await api.finalizeClaudeCodeAuth(code, state);

            if (result.success) {
                setShowManualAuthModal(false);
                setPastedUrl('');
                await loadStatus();
            } else {
                setManualAuthError(result.error || 'Failed to complete authentication.');
            }
        } catch (err) {
            setManualAuthError(err instanceof Error ? err.message : 'An error occurred.');
        } finally {
            setManualAuthLoading(false);
        }
    };

    const handleRefreshAccount = async (provider: string, accountId: string) => {
        const key = `${provider}:${accountId}`;
        try {
            setRefreshingAccounts(prev => new Set(prev).add(key));
            setError(null);

            if (provider === 'claude-code') {
                const result = await api.refreshClaudeCodeToken(accountId);
                if (result.success) {
                    await loadStatus();
                } else {
                    setError(result.error || 'Failed to refresh token');
                }
            } else {
                const result = await api.refreshOAuthToken();
                if (result.success) {
                    await loadStatus();
                } else {
                    setError(result.message);
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to refresh token');
        } finally {
            setRefreshingAccounts(prev => {
                const next = new Set(prev);
                next.delete(key);
                return next;
            });
        }
    };

    const handleDeleteCredentials = async () => {
        if (!deleteTarget) return;

        try {
            setError(null);
            let success: boolean;

            if (deleteTarget.provider === 'claude-code') {
                success = await api.deleteClaudeCodeAccount(deleteTarget.account);
            } else {
                success = await api.deleteOAuthCredentials(deleteTarget.provider, deleteTarget.account);
            }

            if (success) {
                setShowDeleteModal(false);
                setDeleteTarget(null);
                await loadStatus();
            } else {
                setError('Failed to delete credentials');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete credentials');
        }
    };

    const openDeleteModal = (provider: string, account: string) => {
        setDeleteTarget({ provider, account });
        setShowDeleteModal(true);
    };

    const handleClearCooldown = async (provider: string, accountId: string) => {
        try {
            setError(null);
            await api.clearCooldown(provider, accountId);
            await loadStatus();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to clear cooldown');
        }
    };


    const getTokenStatus = (expiresInSeconds: number): { label: string; variant: 'success' | 'warning' | 'danger' } => {
        if (expiresInSeconds < 0) return { label: 'Expired', variant: 'danger' };
        if (expiresInSeconds < 600) return { label: 'Expiring', variant: 'warning' }; // < 10 minutes
        return { label: 'Valid', variant: 'success' };
    };

    const getAccountStatusBadge = (account: { status: string; on_cooldown: boolean }) => {
        if (account.on_cooldown) {
            return <Badge variant="danger" icon={<AlertCircle size={14} />}>On Cooldown</Badge>;
        }

        switch (account.status) {
            case 'active':
                return <Badge variant="success" icon={<CheckCircle size={14} />}>Active</Badge>;
            case 'expiring':
                return <Badge variant="warning" icon={<AlertTriangle size={14} />}>Expiring Soon</Badge>;
            case 'expired':
                return <Badge variant="danger" icon={<XCircle size={14} />}>Expired</Badge>;
            default:
                return <Badge variant="secondary">Unknown</Badge>;
        }
    };

    const getProviderSummary = (accounts: any[]) => {
        const total = accounts.length;
        const healthy = accounts.filter(a => a.status === 'active' && !a.on_cooldown).length;
        const onCooldown = accounts.filter(a => a.on_cooldown).length;
        const expired = accounts.filter(a => a.is_expired).length;

        if (total === 0) return 'No accounts';

        const parts = [`${total} account${total !== 1 ? 's' : ''}`];
        if (healthy > 0) parts.push(`${healthy} healthy`);
        if (onCooldown > 0) parts.push(`${onCooldown} on cooldown`);
        if (expired > 0) parts.push(`${expired} expired`);

        return parts.join(', ');
    };

    const getProviderName = (provider: string): string => {
        const names: Record<string, string> = {
            'antigravity': 'Google Antigravity',
            'claude-code': 'Claude Code'
        };
        return names[provider] || provider;
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

    const hasAnyAccounts = credentials?.providers.some(p => p.accounts.length > 0);

    return (
        <div className="p-8 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold">OAuth Management</h1>
                    <p className="text-muted-foreground mt-1">
                        Manage OAuth 2.0 authentication for providers with multiple accounts
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    {refreshStatus && (
                        <Badge variant={refreshStatus.running ? 'success' : 'secondary'}>
                            Auto-refresh: {refreshStatus.running ? 'Active' : 'Inactive'}
                        </Badge>
                    )}
                    <Button onClick={loadStatus} variant="secondary" size="sm">
                        <RefreshCw size={16} className="mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
                    {error}
                </div>
            )}

            {!hasAnyAccounts ? (
                <Card>
                    <div className="p-6 space-y-4">
                        <div className="flex items-center gap-3">
                            <Shield size={24} className="text-muted-foreground" />
                            <div>
                                <h2 className="text-xl font-semibold">Get Started with OAuth</h2>
                                <p className="text-sm text-muted-foreground mt-1">
                                    No OAuth accounts configured yet. Connect your first account to get started.
                                </p>
                            </div>
                        </div>

                        <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                            <div className="text-sm font-medium mb-2">Google Antigravity</div>
                            <p className="text-sm text-muted-foreground mb-3">
                                OAuth 2.0 authentication for Google Antigravity API
                            </p>
                            <Button onClick={() => handleInitiateAuth('antigravity')} variant="primary">
                                <ExternalLink size={16} className="mr-2" />
                                Connect to Google Antigravity
                            </Button>
                        </div>

                        <div className="bg-background/50 rounded-lg p-4 border border-border/50">
                            <div className="text-sm font-medium mb-2">Claude Code</div>
                            <p className="text-sm text-muted-foreground mb-3">
                                OAuth 2.0 authentication for Anthropic Claude API (via Claude Code)
                            </p>
                            <Button onClick={() => handleInitiateAuth('claude-code')} variant="primary">
                                <ExternalLink size={16} className="mr-2" />
                                Connect to Claude Code
                            </Button>
                        </div>

                        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
                            <div className="text-sm font-medium text-blue-400 mb-2">What happens next?</div>
                            <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                                <li>You'll be redirected to your provider to sign in</li>
                                <li>Grant Plexus access to the required scopes</li>
                                <li>You'll be redirected back to Plexus</li>
                                <li>Your tokens will be securely stored and automatically refreshed</li>
                            </ol>
                        </div>
                    </div>
                </Card>
            ) : (
                <>
                    {/* Accordion for each provider */}
                    {credentials?.providers.map(providerData => {
                        const isExpanded = expandedProviders.has(providerData.provider);
                        const providerName = getProviderName(providerData.provider);
                        const summary = getProviderSummary(providerData.accounts);

                        return (
                            <div key={providerData.provider} className="border border-border-glass rounded-md">
                                {/* Accordion Header */}
                                <div
                                    className="p-3 px-4 flex items-center justify-between cursor-pointer bg-bg-hover transition-colors duration-200 select-none hover:bg-bg-glass"
                                    onClick={() => toggleProvider(providerData.provider)}
                                >
                                    <div className="flex items-center gap-3">
                                        {isExpanded ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                                        <span style={{fontWeight: 600, fontSize: '14px'}}>{providerName}</span>
                                        <span className="text-sm text-muted-foreground">{summary}</span>
                                    </div>
                                    <Button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleInitiateAuth(providerData.provider);
                                        }}
                                        variant="secondary"
                                        size="sm"
                                    >
                                        <ExternalLink size={14} className="mr-2" />
                                        Add Account
                                    </Button>
                                </div>

                                {/* Accordion Content */}
                                {isExpanded && (
                                    <div style={{borderTop: '1px solid var(--color-border-glass)'}}>
                                        <div className="p-6 space-y-4">
                                            {/* Configuration Reminder */}
                                            <div className="bg-blue-500/5 border border-blue-500/10 rounded p-2">
                                                <div className="text-xs text-muted-foreground">
                                                    Configure provider on the <a href="/providers" className="text-blue-400 hover:underline">Providers page</a> to use these accounts.
                                                </div>
                                            </div>

                                            {/* Accounts Grid */}
                                            <div>
                                                <div className="text-sm font-medium mb-3">Connected Accounts</div>
                                                <div className="flex flex-wrap gap-3">
                                                    {providerData.accounts.map(account => {
                                                        const cooldownKey = `${providerData.provider}:${account.user_identifier}`;
                                                        const cooldownRemaining = cooldownTimers[cooldownKey] || account.cooldown_remaining_seconds || 0;
                                                        const authTokenStatus = getTokenStatus(account.expires_in_seconds);
                                                        const refreshTokenStatus = getTokenStatus(account.refresh_token_expires_in_seconds);

                                                        return (
                                                            <div
                                                                key={account.user_identifier}
                                                                className="bg-background/50 rounded-lg p-3 border border-border/50"
                                                                style={{ width: '340px' }}
                                                            >
                                                            {/* Header Row */}
                                                            <div className="flex items-center justify-between mb-2">
                                                                <div>
                                                                    <div className="font-mono text-sm font-medium">{account.user_identifier}</div>
                                                                    {account.project_id && (
                                                                        <div className="text-xs text-muted-foreground">
                                                                            {account.project_id}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    {account.on_cooldown && (
                                                                        <Button
                                                                            onClick={() => handleClearCooldown(providerData.provider, account.user_identifier)}
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            title="Clear cooldown"
                                                                        >
                                                                            <X size={16} style={{color: 'var(--color-warning)'}}/>
                                                                        </Button>
                                                                    )}
                                                                    <Button
                                                                        onClick={() => handleRefreshAccount(providerData.provider, account.user_identifier)}
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        title="Refresh token"
                                                                        disabled={refreshingAccounts.has(`${providerData.provider}:${account.user_identifier}`)}
                                                                    >
                                                                        <RefreshCw
                                                                            size={16}
                                                                            style={{color: 'var(--color-success)'}}
                                                                            className={refreshingAccounts.has(`${providerData.provider}:${account.user_identifier}`) ? 'animate-spin' : ''}
                                                                        />
                                                                    </Button>
                                                                    <Button
                                                                        onClick={() => openDeleteModal(providerData.provider, account.user_identifier)}
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        title="Remove account"
                                                                    >
                                                                        <Trash2 size={16} style={{color: 'var(--color-danger)'}}/>
                                                                    </Button>
                                                                </div>
                                                            </div>

                                                            {/* Status Row */}
                                                            {account.on_cooldown ? (
                                                                <div className="text-center py-2 bg-red-500/10 border border-red-500/20 rounded text-sm">
                                                                    <span className="text-red-400 font-medium">Status: On Cooldown</span>
                                                                    <span className="text-muted-foreground ml-2">
                                                                        (resets in <span className="font-mono">{formatDuration(cooldownRemaining)}</span>)
                                                                    </span>
                                                                </div>
                                                            ) : (
                                                                <div className="text-center py-2 bg-background/30 rounded text-sm">
                                                                    <span className="text-muted-foreground">Status: </span>
                                                                    <span className={
                                                                        account.status === 'active' ? 'text-green-400' :
                                                                        account.status === 'expiring' ? 'text-yellow-400' :
                                                                        'text-red-400'
                                                                    }>
                                                                        {account.status === 'active' ? 'Active' :
                                                                         account.status === 'expiring' ? 'Expiring Soon' :
                                                                         'Expired'}
                                                                    </span>
                                                                </div>
                                                            )}

                                                            {/* Token Status Grid */}
                                                            <div className="grid grid-cols-2 gap-3 mt-2">
                                                                <div className="text-center">
                                                                    <div className="text-xs text-muted-foreground mb-1">Auth Token:</div>
                                                                    <div className={`text-xs font-medium ${
                                                                        authTokenStatus.variant === 'success' ? 'text-green-400' :
                                                                        authTokenStatus.variant === 'warning' ? 'text-yellow-400' :
                                                                        'text-red-400'
                                                                    }`}>
                                                                        Status: {authTokenStatus.label}
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground mt-1">
                                                                        Expires in {formatDuration(account.expires_in_seconds)}
                                                                    </div>
                                                                </div>
                                                                <div className="text-center">
                                                                    <div className="text-xs text-muted-foreground mb-1">Refresh Token:</div>
                                                                    <div className={`text-xs font-medium ${
                                                                        refreshTokenStatus.variant === 'success' ? 'text-green-400' :
                                                                        refreshTokenStatus.variant === 'warning' ? 'text-yellow-400' :
                                                                        'text-red-400'
                                                                    }`}>
                                                                        Status: {refreshTokenStatus.label}
                                                                    </div>
                                                                    <div className="text-xs text-muted-foreground mt-1">
                                                                        Expires in {formatDuration(account.refresh_token_expires_in_seconds)}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteModal && deleteTarget && (
                <Modal
                    isOpen={showDeleteModal}
                    onClose={() => {
                        setShowDeleteModal(false);
                        setDeleteTarget(null);
                    }}
                    title="Remove OAuth Account"
                >
                    <div className="space-y-4">
                        <p className="text-sm text-muted-foreground">
                            Are you sure you want to remove the account <span className="font-mono">{deleteTarget.account}</span> from <span className="font-semibold">{getProviderName(deleteTarget.provider)}</span>?
                            This will remove all stored OAuth credentials for this account.
                        </p>
                        <div className="flex gap-3 justify-end">
                            <Button
                                onClick={() => {
                                    setShowDeleteModal(false);
                                    setDeleteTarget(null);
                                }}
                                variant="secondary"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDeleteCredentials}
                                variant="danger"
                            >
                                Remove Account
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Manual Auth Modal */}
            <Modal
                isOpen={showManualAuthModal}
                onClose={() => setShowManualAuthModal(false)}
                title="Remote Authentication Required"
            >
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        You are accessing Plexus remotely. Claude Code OAuth only supports callbacks to <code className="bg-muted px-1 py-0.5 rounded">localhost</code>.
                        You need to perform a manual "Loopback" authentication.
                    </p>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 text-sm space-y-2">
                        <div className="font-semibold text-blue-400">Step 1: Start Authorization</div>
                        <p className="text-muted-foreground">Click the button below to open the authorization page in a new tab.</p>
                        <Button
                            onClick={() => window.open(manualAuthUrl, '_blank')}
                            variant="primary"
                            className="w-full mt-2"
                        >
                            <ExternalLink size={16} className="mr-2" />
                            Open Authorization Page
                        </Button>
                    </div>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 text-sm space-y-2">
                        <div className="font-semibold text-blue-400">Step 2: Copy Failed URL</div>
                        <p className="text-muted-foreground">
                            When authorization completes, the browser will try to redirect to <code className="bg-muted px-1 py-0.5 rounded">localhost:54545</code>.
                            This will likely fail with "Connection Refused" or "Site can't be reached".
                            <strong>Copy the entire URL from the address bar of that failed page.</strong>
                        </p>
                    </div>

                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-md p-3 text-sm space-y-2">
                        <div className="font-semibold text-blue-400">Step 3: Paste URL</div>
                        <p className="text-muted-foreground">Paste the copied URL below to complete the setup.</p>
                        <input
                            type="text"
                            value={pastedUrl}
                            onChange={(e) => setPastedUrl(e.target.value)}
                            placeholder="http://localhost:54545/v0/oauth/claude/callback?code=..."
                            className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    {manualAuthError && (
                        <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 text-sm text-red-400">
                            {manualAuthError}
                        </div>
                    )}

                    <div className="flex gap-3 justify-end pt-2">
                        <Button
                            onClick={() => setShowManualAuthModal(false)}
                            variant="secondary"
                        >
                            Cancel
                        </Button>
                        <Button
                            onClick={handleManualAuthComplete}
                            disabled={!pastedUrl || manualAuthLoading}
                            variant="primary"
                        >
                            {manualAuthLoading ? (
                                <>
                                    <RefreshCw className="animate-spin mr-2" size={16} />
                                    Verifying...
                                </>
                            ) : (
                                'Complete Authorization'
                            )}
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
