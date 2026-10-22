import { AlertTriangle, RotateCw } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';

import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { QuotaStatusCard } from '../components/quota';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { CopyButton } from '../components/ui/CopyButton';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { Switch } from '../components/ui/Switch';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api, type QuotaStatusEntry } from '../lib/api';
import { sortMostConstrainedFirst } from '../lib/quota';

interface SelfInfo {
  role: 'admin' | 'limited';
  keyName?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  allowRawPassthrough?: boolean;
  quotaNames?: string[];
  quotaName?: string | null;
  comment?: string | null;
  traceEnabled?: boolean;
  traceEnabledGlobal?: boolean;
}

export const MyKey: React.FC = () => {
  const { isLimited, isAdmin, login } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState<SelfInfo | null>(null);
  const [quotas, setQuotas] = useState<QuotaStatusEntry[] | null>(null);
  const [quotaError, setQuotaError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [togglingTrace, setTogglingTrace] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSelfMe()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setComment(data.comment ?? '');
      })
      .catch((e) => toast.error(String(e), 'Load failed'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    api
      .getSelfQuota()
      .then((data) => {
        if (!cancelled) setQuotas(data.quotas);
      })
      .catch(() => {
        if (!cancelled) setQuotaError(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isAdmin && !isLimited) {
    return <Navigate to="/keys" replace />;
  }

  if (loading) {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader title="My Key" subtitle="Loading your key details..." />
        <PageContainer width="standard">
          <div className="flex flex-col gap-4">
            <Skeleton height={140} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        </PageContainer>
      </div>
    );
  }

  if (!info || info.role !== 'limited') {
    return (
      <div className="flex min-h-full flex-col">
        <PageHeader title="My Key" />
        <PageContainer width="standard">
          <Card>
            <p className="text-danger">Unable to load key info.</p>
          </Card>
        </PageContainer>
      </div>
    );
  }

  const handleSaveComment = async () => {
    setSavingComment(true);
    try {
      await api.updateSelfComment(comment.trim() || null);
      setInfo({ ...info, comment: comment.trim() || null });
      toast.success('Comment saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save comment');
    } finally {
      setSavingComment(false);
    }
  };

  const handleToggleTrace = async (enabled: boolean) => {
    setTogglingTrace(true);
    try {
      const res = await api.toggleSelfDebug(enabled);
      setInfo({ ...info, traceEnabled: res.enabled, traceEnabledGlobal: res.enabledGlobal });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to toggle trace');
    } finally {
      setTogglingTrace(false);
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    try {
      const res = await api.rotateSelfSecret();
      const ok = await login(res.secret);
      setNewSecret(res.secret);
      if (!ok) {
        toast.warning('Secret rotated, but session refresh failed. Re-login with the new secret.');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Rotation failed');
    } finally {
      setRotating(false);
    }
  };

  const allowedProviders = info.allowedProviders ?? [];
  const allowedModels = info.allowedModels ?? [];

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="My Key"
        subtitle={
          <>
            Details for <span className="text-text font-medium">{info.keyName}</span>. All logs,
            traces, and dashboard data in this session are scoped to this key.
          </>
        }
      />
      <PageContainer width="standard">
        <div className="flex flex-col gap-4 sm:gap-6">
          <Card title="Identity">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[max-content_1fr]">
              <dt className="text-text-muted">Key name</dt>
              <dd className="text-text font-mono break-all">{info.keyName}</dd>
              <dt className="text-text-muted">Quota</dt>
              <dd className="text-text">
                {info.quotaNames && info.quotaNames.length > 0
                  ? info.quotaNames.join(', ')
                  : info.quotaName || '—'}
              </dd>
              <dt className="text-text-muted">Allowed providers</dt>
              <dd className="text-text break-words">
                {allowedProviders.length > 0 ? allowedProviders.join(', ') : 'Any (unrestricted)'}
              </dd>
              <dt className="text-text-muted">Allowed models</dt>
              <dd className="text-text break-words">
                {allowedModels.length > 0 ? allowedModels.join(', ') : 'Any (unrestricted)'}
              </dd>
              <dt className="text-text-muted">Raw provider access</dt>
              <dd className="text-text">{info.allowRawPassthrough ? 'Enabled' : 'Disabled'}</dd>
            </dl>
          </Card>

          <Card title="Quota">
            {quotaError ? (
              <div className="text-warning flex items-start gap-2 text-sm">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>Could not load quota status — try refreshing.</span>
              </div>
            ) : quotas === null ? (
              <p className="text-text-muted text-sm">Loading…</p>
            ) : quotas.length === 0 ? (
              <p className="text-text-muted text-sm">
                No quota is assigned to this key — requests are unrestricted by quota policy.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {sortMostConstrainedFirst(quotas).map((q) => (
                  <QuotaStatusCard key={q.name} entry={q} />
                ))}
              </div>
            )}
          </Card>

          <Card title="Comment">
            <div className="flex flex-col gap-3">
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Free-text note about this key (optional)"
              />
              <div className="flex justify-stretch sm:justify-end">
                <Button
                  onClick={handleSaveComment}
                  disabled={savingComment || (comment.trim() || null) === (info.comment ?? null)}
                  isLoading={savingComment}
                  className="w-full sm:w-auto"
                >
                  Save
                </Button>
              </div>
            </div>
          </Card>

          <Card title="Trace capture">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-text text-sm">
                  Capture full request/response payloads for this key only.
                </p>
                <p className="text-text-muted mt-1 text-xs">
                  {info.traceEnabledGlobal
                    ? 'Global tracing is ON (admin) — all requests are captured regardless of this toggle.'
                    : info.traceEnabled
                      ? 'Currently capturing traces for this key.'
                      : 'Tracing is off for this key.'}
                </p>
              </div>
              <Switch
                checked={!!info.traceEnabled}
                onChange={handleToggleTrace}
                disabled={togglingTrace || !!info.traceEnabledGlobal}
                aria-label="Toggle trace capture"
              />
            </div>
          </Card>

          <Card title="Rotate secret">
            <div className="flex flex-col gap-3">
              <p className="text-text-secondary text-sm">
                Generates a new secret for this key. The old secret stops working immediately. Your
                historical logs, traces, and errors are preserved (they're indexed by key name, not
                secret).
              </p>
              <div className="flex justify-stretch sm:justify-end">
                <Button
                  variant="danger"
                  onClick={() => setShowRotate(true)}
                  disabled={rotating}
                  leftIcon={<RotateCw size={16} />}
                  className="w-full sm:w-auto"
                >
                  Rotate secret
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <Modal
          isOpen={showRotate}
          onClose={() => {
            setShowRotate(false);
            setNewSecret(null);
          }}
          title={newSecret ? 'New secret generated' : 'Rotate secret?'}
          footer={
            newSecret ? (
              <Button
                onClick={() => {
                  setShowRotate(false);
                  setNewSecret(null);
                }}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowRotate(false)}
                  disabled={rotating}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRotate}
                  disabled={rotating}
                  isLoading={rotating}
                >
                  Rotate now
                </Button>
              </>
            )
          }
        >
          {newSecret ? (
            <div className="flex flex-col gap-3">
              <p className="text-text text-sm">
                Copy this secret now — it will not be shown again.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="bg-bg-card border-border min-w-0 flex-1 rounded-md border p-2 font-mono text-xs break-all">
                  {newSecret}
                </code>
                <CopyButton value={newSecret} variant="icon" />
              </div>
            </div>
          ) : (
            <p className="text-text-secondary text-sm">
              The old secret will stop working immediately. Any clients using it will receive 401
              errors until they are updated with the new secret.
            </p>
          )}
        </Modal>
      </PageContainer>
    </div>
  );
};
