import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { RotateCw } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
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
import { Skeleton } from '../components/ui/Skeleton';

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
  const { t } = useTranslation();
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
      .catch((e) => toast.error(String(e), t('myKey.loadFailed')))
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
      <div className="flex flex-col min-h-full">
        <PageHeader title={t('myKey.title')} subtitle={t('myKey.loadingSubtitle')} />
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
      <div className="flex flex-col min-h-full">
        <PageHeader title={t('myKey.title')} />
        <PageContainer width="standard">
          <Card>
            <p className="text-danger">{t('myKey.loadError')}</p>
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
      toast.success(t('myKey.comment.saved'));
    } catch (e: any) {
      toast.error(e?.message || t('myKey.comment.saveFailed'));
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
      toast.error(e?.message || t('myKey.trace.toggleFailed'));
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
        toast.warning(t('myKey.rotate.sessionRefreshFailed'));
      }
    } catch (e: any) {
      toast.error(e?.message || t('myKey.rotate.failed'));
    } finally {
      setRotating(false);
    }
  };

  const allowedProviders = info.allowedProviders ?? [];
  const allowedModels = info.allowedModels ?? [];

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title={t('myKey.title')}
        subtitle={
          <Trans
            i18nKey="myKey.subtitle"
            values={{ name: info.keyName ?? '' }}
            components={{ name: <span className="font-medium text-text" /> }}
          />
        }
      />
      <PageContainer width="standard">
        <div className="flex flex-col gap-4 sm:gap-6">
          <Card title={t('myKey.identity.title')}>
            <dl className="grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
              <dt className="text-text-muted">{t('myKey.identity.keyName')}</dt>
              <dd className="font-mono text-text break-all">{info.keyName}</dd>
              <dt className="text-text-muted">{t('myKey.identity.quota')}</dt>
              <dd className="text-text">{info.quotaName || '—'}</dd>
              <dt className="text-text-muted">{t('myKey.identity.allowedProviders')}</dt>
              <dd className="text-text break-words">
                {allowedProviders.length > 0
                  ? allowedProviders.join(', ')
                  : t('myKey.anyUnrestricted')}
              </dd>
              <dt className="text-text-muted">{t('myKey.identity.allowedModels')}</dt>
              <dd className="text-text break-words">
                {allowedModels.length > 0 ? allowedModels.join(', ') : t('myKey.anyUnrestricted')}
              </dd>
            </dl>
          </Card>

          <Card title={t('myKey.comment.title')}>
            <div className="flex flex-col gap-3">
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={t('myKey.comment.placeholder')}
              />
              <div className="flex justify-stretch sm:justify-end">
                <Button
                  onClick={handleSaveComment}
                  disabled={savingComment || (comment.trim() || null) === (info.comment ?? null)}
                  isLoading={savingComment}
                  className="w-full sm:w-auto"
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t('myKey.trace.title')}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text">{t('myKey.trace.description')}</p>
                <p className="text-xs text-text-muted mt-1">
                  {info.traceEnabledGlobal
                    ? t('myKey.trace.globalOn')
                    : info.traceEnabled
                      ? t('myKey.trace.on')
                      : t('myKey.trace.off')}
                </p>
              </div>
              <Switch
                checked={!!info.traceEnabled}
                onChange={handleToggleTrace}
                disabled={togglingTrace || !!info.traceEnabledGlobal}
                aria-label={t('myKey.trace.ariaToggle')}
              />
            </div>
          </Card>

          <Card title={t('myKey.rotate.title')}>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text-secondary">{t('myKey.rotate.description')}</p>
              <div className="flex justify-stretch sm:justify-end">
                <Button
                  variant="danger"
                  onClick={() => setShowRotate(true)}
                  disabled={rotating}
                  leftIcon={<RotateCw size={16} />}
                  className="w-full sm:w-auto"
                >
                  {t('myKey.rotate.button')}
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
          title={newSecret ? t('myKey.rotate.successTitle') : t('myKey.rotate.confirmTitle')}
          footer={
            newSecret ? (
              <Button
                onClick={() => {
                  setShowRotate(false);
                  setNewSecret(null);
                }}
              >
                {t('common.done')}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={() => setShowRotate(false)}
                  disabled={rotating}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  onClick={handleRotate}
                  disabled={rotating}
                  isLoading={rotating}
                >
                  {t('myKey.rotate.confirmAction')}
                </Button>
              </>
            )
          }
        >
          {newSecret ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-text">{t('myKey.rotate.successBody')}</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <code className="flex-1 min-w-0 p-2 bg-bg-card border border-border rounded-md text-xs font-mono break-all">
                  {newSecret}
                </code>
                <CopyButton value={newSecret} variant="icon" />
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-secondary">{t('myKey.rotate.confirmBody')}</p>
          )}
        </Modal>
      </PageContainer>
    </div>
  );
};
