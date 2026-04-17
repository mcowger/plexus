import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { CopyButton } from '../components/ui/CopyButton';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { Skeleton, SkeletonText } from '../components/ui/Skeleton';

interface SelfInfo {
  role: 'admin' | 'limited';
  keyName?: string;
  allowedProviders?: string[];
  allowedModels?: string[];
  quotaName?: string | null;
  comment?: string | null;
  traceEnabled?: boolean;
  traceEnabledGlobal?: boolean;
}

export const MyKey: React.FC = () => {
  const { isLimited, isAdmin, login } = useAuth();
  const toast = useToast();
  const [info, setInfo] = useState<SelfInfo | null>(null);
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
      <PageContainer width="standard">
        <PageHeader title="My Key" subtitle="Loading your key details..." />
        <div className="flex flex-col gap-4">
          <Skeleton height={140} />
          <Skeleton height={120} />
          <Skeleton height={120} />
        </div>
      </PageContainer>
    );
  }

  if (!info || info.role !== 'limited') {
    return (
      <PageContainer width="standard">
        <PageHeader title="My Key" />
        <Card>
          <p className="text-danger">Unable to load key info.</p>
        </Card>
      </PageContainer>
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
    <PageContainer width="standard">
      <PageHeader
        title="My Key"
        subtitle={
          <>
            Details for <span className="font-medium text-text">{info.keyName}</span>. All logs,
            traces, and dashboard data in this session are scoped to this key.
          </>
        }
      />

      <div className="flex flex-col gap-4 sm:gap-6">
        <Card title="Identity">
          <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-text-muted">Key name</dt>
            <dd className="font-mono text-text break-all">{info.keyName}</dd>
            <dt className="text-text-muted">Quota</dt>
            <dd className="text-text">{info.quotaName || '—'}</dd>
            <dt className="text-text-muted">Allowed providers</dt>
            <dd className="text-text break-words">
              {allowedProviders.length > 0 ? allowedProviders.join(', ') : 'Any (unrestricted)'}
            </dd>
            <dt className="text-text-muted">Allowed models</dt>
            <dd className="text-text break-words">
              {allowedModels.length > 0 ? allowedModels.join(', ') : 'Any (unrestricted)'}
            </dd>
          </dl>
        </Card>

        <Card title="Comment">
          <div className="flex flex-col gap-3">
            <Input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Free-text note about this key (optional)"
            />
            <div className="flex justify-end">
              <Button
                onClick={handleSaveComment}
                disabled={savingComment || (comment.trim() || null) === (info.comment ?? null)}
                isLoading={savingComment}
              >
                Save
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Trace capture">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-text">
                Capture full request/response payloads for this key only.
              </p>
              <p className="text-xs text-text-muted mt-1">
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
            <p className="text-sm text-text-secondary">
              Generates a new secret for this key. The old secret stops working immediately. Your
              historical logs, traces, and errors are preserved (they're indexed by key name, not
              secret).
            </p>
            <div className="flex justify-end">
              <Button
                variant="danger"
                onClick={() => setShowRotate(true)}
                disabled={rotating}
                leftIcon={<RotateCw size={16} />}
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
              <Button variant="secondary" onClick={() => setShowRotate(false)} disabled={rotating}>
                Cancel
              </Button>
              <Button variant="danger" onClick={handleRotate} disabled={rotating} isLoading={rotating}>
                Rotate now
              </Button>
            </>
          )
        }
      >
        {newSecret ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-text">Copy this secret now — it will not be shown again.</p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 min-w-0 p-2 bg-bg-card border border-border rounded-md text-xs font-mono break-all">
                {newSecret}
              </code>
              <CopyButton value={newSecret} variant="icon" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">
            The old secret will stop working immediately. Any clients using it will receive 401
            errors until they are updated with the new secret.
          </p>
        )}
      </Modal>
    </PageContainer>
  );
};
