import { Plus, Search } from 'lucide-react';
import { useState } from 'react';

import { PageContainer } from '../components/layout/PageContainer';
import { PageHeader } from '../components/layout/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Tabs } from '../components/ui/Tabs';
import { TagSelect } from '../components/ui/TagSelect';
import { useCurrency } from '../lib/CurrencyContext';
import { filterKeys, filterQuotas, isKeyDisabled } from './keys/helpers';
import { KeyEditorModal } from './keys/KeyEditorModal';
import { KeyLists } from './keys/KeyLists';
import { QuotaEditorModal } from './keys/QuotaEditorModal';
import { QuotaLists } from './keys/QuotaLists';
import { QuotaStatusModal } from './keys/QuotaStatusModal';
import { useKeyActions } from './keys/useKeyActions';
import { useKeysPageData } from './keys/useKeysPageData';
import { useQuotaActions } from './keys/useQuotaActions';

export const Keys = () => {
  const { currency, rate, symbol } = useCurrency();
  const pageData = useKeysPageData();
  const keyActions = useKeyActions({ loadData: pageData.loadData });
  const quotaActions = useQuotaActions({
    defaultQuotaNames: pageData.defaultQuotaNames,
    setDefaultQuotaNames: pageData.setDefaultQuotaNames,
    loadData: pageData.loadData,
    quotaStatuses: pageData.quotaStatuses,
  });
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'keys' | 'quotas'>('keys');
  const [showDisabledKeys, setShowDisabledKeys] = useState(false);

  const filteredKeys = filterKeys(pageData.keys, search);
  const activeKeys = filteredKeys.filter((key) => !isKeyDisabled(key));
  const disabledKeys = filteredKeys.filter(isKeyDisabled);
  const filteredQuotas = filterQuotas(pageData.quotas, search);

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Access Control"
        subtitle="API keys issued for downstream consumers"
        actions={
          activeTab === 'keys' ? (
            <Button leftIcon={<Plus size={14} />} onClick={keyActions.handleAddNewKey} size="sm">
              Create key
            </Button>
          ) : (
            <Button
              leftIcon={<Plus size={14} />}
              onClick={quotaActions.handleAddNewQuota}
              size="sm"
            >
              Add quota
            </Button>
          )
        }
      >
        <Tabs
          value={activeTab}
          onChange={(value) => setActiveTab(value as 'keys' | 'quotas')}
          items={[
            {
              value: 'keys',
              label: `API Keys (${pageData.keys.filter((key) => !isKeyDisabled(key)).length})`,
            },
            { value: 'quotas', label: `Quotas (${Object.keys(pageData.quotas).length})` },
          ]}
        />
      </PageHeader>

      <PageContainer>
        {/* Hidden old tabs (to avoid further JSX restructuring) */}
        <div className="hidden">
          <div>
            <button
              className={`font-body px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'keys'
                  ? 'text-primary border-primary border-b-2'
                  : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setActiveTab('keys')}
            >
              API Keys ({pageData.keys.filter((key) => !isKeyDisabled(key)).length})
            </button>
            <button
              className={`font-body px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === 'quotas'
                  ? 'text-primary border-primary border-b-2'
                  : 'text-text-secondary hover:text-text'
              }`}
              onClick={() => setActiveTab('quotas')}
            >
              Quotas ({Object.keys(pageData.quotas).length})
            </button>
          </div>
        </div>

        <Card className="mb-6">
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-text-secondary)',
              }}
            />
            <Input
              placeholder={activeTab === 'keys' ? 'Search keys...' : 'Search quotas...'}
              style={{ paddingLeft: '36px' }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
        </Card>

        {activeTab === 'keys' && (
          <KeyLists
            activeKeys={activeKeys}
            disabledKeys={disabledKeys}
            defaultQuotaNames={pageData.defaultQuotaNames}
            quotaStatuses={pageData.quotaStatuses}
            copiedKey={keyActions.copiedKey}
            currency={currency}
            rate={rate}
            symbol={symbol}
            showDisabledKeys={showDisabledKeys}
            onSetShowDisabledKeys={setShowDisabledKeys}
            onEditKey={keyActions.handleEditKey}
            onDisableKey={keyActions.handleDisableKey}
            onDeleteKey={keyActions.handleDeleteKey}
            onCopy={keyActions.handleCopy}
            onViewQuotaStatus={quotaActions.handleViewQuotaStatus}
            onClearQuota={quotaActions.handleClearQuota}
          />
        )}

        {activeTab === 'quotas' && (
          <>
            <Card title="Default quotas" className="mb-6 !overflow-visible">
              <p className="text-text-muted mb-3 text-xs">
                Applied to any key with no quotas of its own (non-stacking — a key's own{' '}
                <code>quotas</code> always wins over this fallback when set).
              </p>
              <TagSelect
                placeholder="No default quotas — select one or more..."
                options={Object.keys(pageData.quotas).sort()}
                selected={pageData.defaultQuotaNames}
                onChange={quotaActions.handleSaveDefaultQuotas}
              />
              {quotaActions.isSavingDefaults && (
                <p className="text-text-muted mt-2 text-xs">Saving…</p>
              )}
            </Card>
            <QuotaLists
              filteredQuotas={filteredQuotas}
              totalQuotas={Object.keys(pageData.quotas).length}
              keys={pageData.keys}
              currency={currency}
              rate={rate}
              symbol={symbol}
              onEditQuota={quotaActions.handleEditQuota}
              onDeleteQuota={quotaActions.handleDeleteQuota}
            />
          </>
        )}

        <KeyEditorModal
          isOpen={keyActions.isKeyModalOpen}
          onClose={() => keyActions.setIsKeyModalOpen(false)}
          editingKey={keyActions.editingKey}
          setEditingKey={keyActions.setEditingKey}
          originalKeyName={keyActions.originalKeyName}
          isSaving={keyActions.isSavingKey}
          onSave={keyActions.handleSaveKey}
          onGenerate={keyActions.generateKey}
          expiryAmount={keyActions.expiryAmount}
          setExpiryAmount={keyActions.setExpiryAmount}
          expiryUnit={keyActions.expiryUnit}
          setExpiryUnit={keyActions.setExpiryUnit}
          aliasIds={pageData.aliasIds}
          providerIds={pageData.providerIds}
          quotaNames={Object.keys(pageData.quotas).sort()}
        />
        <QuotaEditorModal
          isOpen={quotaActions.isQuotaModalOpen}
          onClose={() => quotaActions.setIsQuotaModalOpen(false)}
          editingQuota={quotaActions.editingQuota}
          setEditingQuota={quotaActions.setEditingQuota}
          originalQuotaName={quotaActions.originalQuotaName}
          isSaving={quotaActions.isSavingQuota}
          onSave={quotaActions.handleSaveQuota}
          providerIds={pageData.providerIds}
          allModelNames={pageData.allModelNames}
          symbol={symbol}
        />
        <QuotaStatusModal
          isOpen={quotaActions.isQuotaDetailOpen}
          onClose={() => quotaActions.setIsQuotaDetailOpen(false)}
          selectedQuotaName={quotaActions.selectedQuotaName}
          selectedQuotaStatus={quotaActions.selectedQuotaStatus}
          quotas={pageData.quotas}
          recomputingQuota={quotaActions.recomputingQuota}
          onClearQuota={quotaActions.handleClearQuota}
          onRecomputeQuota={quotaActions.handleRecomputeQuota}
        />
      </PageContainer>
    </div>
  );
};
