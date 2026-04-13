import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Copy, Check, RotateCw, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';

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

/**
 * Self-service page for the currently authenticated api-key user.
 * Lets them view their key's metadata, edit the comment, toggle trace
 * capture for their key only, and rotate their secret.
 */
export const MyKey: React.FC = () => {
  const { isLimited, isAdmin } = useAuth();
  const [info, setInfo] = useState<SelfInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [comment, setComment] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [togglingTrace, setTogglingTrace] = useState(false);
  const [showRotate, setShowRotate] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getSelfMe()
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setComment(data.comment ?? '');
      })
      .catch((e) => setError(String(e)))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Admins shouldn't land on this page via the nav — they have the full Keys
  // management page. Redirect defensively if they hit the URL directly.
  if (isAdmin && !isLimited) {
    return <Navigate to="/keys" replace />;
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  if (!info || info.role !== 'limited') {
    return (
      <div className="p-6">
        <p className="text-danger">{error || 'Unable to load key info.'}</p>
      </div>
    );
  }

  const handleSaveComment = async () => {
    setSavingComment(true);
    setError(null);
    try {
      await api.updateSelfComment(comment.trim() || null);
      setInfo({ ...info, comment: comment.trim() || null });
    } catch (e: any) {
      setError(e?.message || 'Failed to save comment');
    } finally {
      setSavingComment(false);
    }
  };

  const handleToggleTrace = async (enabled: boolean) => {
    setTogglingTrace(true);
    setError(null);
    try {
      const res = await api.toggleSelfDebug(enabled);
      setInfo({ ...info, traceEnabled: res.enabled, traceEnabledGlobal: res.enabledGlobal });
    } catch (e: any) {
      setError(e?.message || 'Failed to toggle trace');
    } finally {
      setTogglingTrace(false);
    }
  };

  const handleRotate = async () => {
    setRotating(true);
    setError(null);
    try {
      const res = await api.rotateSelfSecret();
      setNewSecret(res.secret);
    } catch (e: any) {
      setError(e?.message || 'Rotation failed');
    } finally {
      setRotating(false);
    }
  };

  const handleCopy = () => {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const allowedProviders = info.allowedProviders ?? [];
  const allowedModels = info.allowedModels ?? [];

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-text">My Key</h1>
        <p className="text-text-muted">
          Details for <span className="font-medium">{info.keyName}</span>. All logs, traces, and
          dashboard data in this session are scoped to this key.
        </p>
      </header>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-danger/10 border border-danger/30 rounded-md text-danger text-sm">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}

      <Card title="Identity">
        <dl className="grid grid-cols-1 gap-3 text-sm">
          <div className="flex">
            <dt className="w-40 text-text-muted">Key name</dt>
            <dd className="font-mono text-text">{info.keyName}</dd>
          </div>
          <div className="flex">
            <dt className="w-40 text-text-muted">Quota</dt>
            <dd className="text-text">{info.quotaName || '—'}</dd>
          </div>
          <div className="flex">
            <dt className="w-40 text-text-muted">Allowed providers</dt>
            <dd className="text-text">
              {allowedProviders.length > 0 ? allowedProviders.join(', ') : 'Any (unrestricted)'}
            </dd>
          </div>
          <div className="flex">
            <dt className="w-40 text-text-muted">Allowed models</dt>
            <dd className="text-text">
              {allowedModels.length > 0 ? allowedModels.join(', ') : 'Any (unrestricted)'}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Comment">
        <div className="space-y-3">
          <Input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Free-text note about this key (optional)"
          />
          <div className="flex justify-end">
            <Button
              onClick={handleSaveComment}
              disabled={savingComment || (comment.trim() || null) === (info.comment ?? null)}
            >
              {savingComment ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      </Card>

      <Card title="Trace capture">
        <div className="flex items-center justify-between">
          <div>
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
          />
        </div>
      </Card>

      <Card title="Rotate secret">
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            Generates a new secret for this key. The old secret stops working immediately. Your
            historical logs, traces, and errors are preserved (they're indexed by key name, not
            secret).
          </p>
          <div className="flex justify-end">
            <Button variant="danger" onClick={() => setShowRotate(true)} disabled={rotating}>
              <RotateCw size={16} />
              Rotate secret
            </Button>
          </div>
        </div>
      </Card>

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
              <Button variant="danger" onClick={handleRotate} disabled={rotating}>
                {rotating ? 'Rotating…' : 'Rotate now'}
              </Button>
            </>
          )
        }
      >
        {newSecret ? (
          <div className="space-y-3">
            <p className="text-sm text-text">
              Copy this secret now — it will not be shown again.
            </p>
            <div className="flex gap-2 items-center">
              <code className="flex-1 p-2 bg-bg-card border border-border rounded text-xs font-mono break-all">
                {newSecret}
              </code>
              <Button variant="secondary" onClick={handleCopy}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm">
            The old secret will stop working immediately. Any clients using it will receive 401
            errors until they are updated with the new secret.
          </p>
        )}
      </Modal>
    </div>
  );
};
