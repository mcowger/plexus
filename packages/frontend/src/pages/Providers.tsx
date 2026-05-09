import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Switch } from '../components/ui/Switch';
import { PageHeader } from '../components/layout/PageHeader';
import { PageContainer } from '../components/layout/PageContainer';
import { useProviderForm } from '../hooks/useProviderForm';
import { ProviderList } from '../components/providers/ProviderList';
import { ProviderApiUrlsEditor } from '../components/providers/ProviderApiUrlsEditor';
import { ProviderOAuthEditor } from '../components/providers/ProviderOAuthEditor';
import { ProviderQuotaEditor } from '../components/providers/ProviderQuotaEditor';
import { ProviderGpuProfileEditor } from '../components/providers/ProviderGpuProfileEditor';
import { ProviderAdvancedEditor } from '../components/providers/ProviderAdvancedEditor';
import { ProviderModelsEditor } from '../components/providers/ProviderModelsEditor';
import { FetchModelsModal } from '../components/providers/FetchModelsModal';
import { DeleteProviderModal } from '../components/providers/DeleteProviderModal';
import { Plus } from 'lucide-react';

export const Providers = () => {
  const f = useProviderForm();

  return (
    <div className="flex flex-col min-h-full">
      <PageHeader
        title="Providers"
        subtitle="Upstream LLM providers routed by the gateway"
        actions={
          <Button leftIcon={<Plus size={14} />} onClick={f.handleAddNew} size="sm">
            Add provider
          </Button>
        }
      />

      <PageContainer>
        <Card flush>
          <ProviderList
            providers={f.sortedProviders}
            getQuotaDisplay={f.getQuotaDisplay}
            onEdit={f.handleEdit}
            onToggleEnabled={f.handleToggleEnabled}
            onDelete={f.openDeleteModal}
          />
        </Card>

        {/* Edit / Add Modal */}
        <Modal
          isOpen={f.isModalOpen}
          onClose={() => f.setIsModalOpen(false)}
          title={f.originalId ? `Edit Provider: ${f.originalId}` : 'Add Provider'}
          size="lg"
          footer={
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <Button variant="ghost" onClick={() => f.setIsModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={f.handleSave}
                isLoading={f.isSaving}
                disabled={!!f.quotaValidationError}
              >
                Save Provider
              </Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '-8px' }}>
            {/* Basic fields */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto] xl:items-end">
              <Input
                label="Unique ID"
                value={f.editingProvider.id}
                onChange={(e) => f.setEditingProvider({ ...f.editingProvider, id: e.target.value })}
                placeholder="e.g. openai"
                disabled={!!f.originalId}
              />
              <Input
                label="Display Name"
                value={f.editingProvider.name}
                onChange={(e) =>
                  f.setEditingProvider({ ...f.editingProvider, name: e.target.value })
                }
                placeholder="e.g. OpenAI Production"
              />
              <Input
                label="API Key"
                type="password"
                value={f.editingProvider.apiKey}
                onChange={(e) =>
                  f.setEditingProvider({ ...f.editingProvider, apiKey: e.target.value })
                }
                placeholder="sk-..."
                disabled={f.isOAuthMode}
              />
              <div className="flex flex-col gap-2">
                <label className="font-body text-[13px] font-medium text-text-secondary">
                  Enabled
                </label>
                <div style={{ height: '38px', display: 'flex', alignItems: 'center' }}>
                  <Switch
                    checked={f.editingProvider.enabled !== false}
                    onChange={(checked) =>
                      f.setEditingProvider({ ...f.editingProvider, enabled: checked })
                    }
                  />
                </div>
              </div>
            </div>

            <div
              style={{ height: '1px', background: 'var(--color-border-glass)', margin: '4px 0' }}
            />

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {/* Left: APIs & Base URLs */}
              <ProviderApiUrlsEditor
                isOAuthMode={f.isOAuthMode}
                getApiBaseUrlMap={f.getApiBaseUrlMap}
                addApiBaseUrlEntry={f.addApiBaseUrlEntry}
                updateApiBaseUrlEntry={f.updateApiBaseUrlEntry}
                removeApiBaseUrlEntry={f.removeApiBaseUrlEntry}
                editingProvider={f.editingProvider}
                setEditingProvider={f.setEditingProvider}
                OAUTH_PROVIDERS={f.OAUTH_PROVIDERS}
                isApiBaseUrlsOpen={f.isApiBaseUrlsOpen}
                setIsApiBaseUrlsOpen={f.setIsApiBaseUrlsOpen}
              />

              {/* Right: Quota Checker */}
              <ProviderQuotaEditor
                editingProvider={f.editingProvider}
                setEditingProvider={f.setEditingProvider}
                selectedQuotaCheckerType={f.selectedQuotaCheckerType}
                selectableQuotaCheckerTypes={f.selectableQuotaCheckerTypes}
                isOAuthMode={f.isOAuthMode}
                oauthCheckerType={f.oauthCheckerType}
                quotaValidationError={f.quotaValidationError}
              />
            </div>

            {/* OAuth Authentication (shown inside API URLs editor when OAuth mode) */}
            {f.isOAuthMode && (
              <ProviderOAuthEditor
                editingProvider={f.editingProvider}
                oauthSession={f.oauthSession}
                oauthSessionId={f.oauthSessionId}
                oauthPromptValue={f.oauthPromptValue}
                setOauthPromptValue={f.setOauthPromptValue}
                oauthManualCode={f.oauthManualCode}
                setOauthManualCode={f.setOauthManualCode}
                oauthError={f.oauthError}
                oauthBusy={f.oauthBusy}
                oauthCredentialReady={f.oauthCredentialReady}
                oauthCredentialChecking={f.oauthCredentialChecking}
                oauthStatus={f.oauthStatus}
                oauthIsTerminal={f.oauthIsTerminal}
                oauthStatusLabel={f.oauthStatusLabel}
                onStart={f.handleStartOAuth}
                onSubmitPrompt={f.handleSubmitPrompt}
                onSubmitManualCode={f.handleSubmitManualCode}
                onCancel={f.handleCancelOAuth}
              />
            )}

            {/* GPU Profile */}
            <ProviderGpuProfileEditor
              editingProvider={f.editingProvider}
              setEditingProvider={f.setEditingProvider}
            />

            {/* Advanced */}
            <ProviderAdvancedEditor
              editingProvider={f.editingProvider}
              setEditingProvider={f.setEditingProvider}
              addKV={f.addKV}
              updateKV={f.updateKV}
              removeKV={f.removeKV}
            />

            {/* Models */}
            <ProviderModelsEditor
              editingProvider={f.editingProvider}
              setEditingProvider={f.setEditingProvider}
              isModelsOpen={f.isModelsOpen}
              setIsModelsOpen={f.setIsModelsOpen}
              openModelIdx={f.openModelIdx}
              setOpenModelIdx={f.setOpenModelIdx}
              isModelExtraBodyOpen={f.isModelExtraBodyOpen}
              setIsModelExtraBodyOpen={f.setIsModelExtraBodyOpen}
              testStates={f.testStates}
              addModel={f.addModel}
              updateModelId={f.updateModelId}
              updateModelConfig={f.updateModelConfig}
              removeModel={f.removeModel}
              addModelKV={f.addModelKV}
              updateModelKV={f.updateModelKV}
              removeModelKV={f.removeModelKV}
              onOpenFetchModels={f.handleOpenFetchModels}
              onTestModel={f.handleTestModel}
              onDismissTestMessage={f.dismissTestMessage}
              getApiBaseUrlMap={f.getApiBaseUrlMap}
            />
          </div>
        </Modal>

        {/* Fetch Models Modal */}
        <FetchModelsModal
          isOpen={f.isFetchModelsModalOpen}
          onClose={() => f.setIsFetchModelsModalOpen(false)}
          modelsUrl={f.modelsUrl}
          setModelsUrl={f.setModelsUrl}
          isFetchingModels={f.isFetchingModels}
          fetchedModels={f.fetchedModels}
          selectedModelIds={f.selectedModelIds}
          fetchError={f.fetchError}
          isOAuthMode={f.isOAuthMode}
          onFetch={f.handleFetchModels}
          onToggleSelection={f.toggleModelSelection}
          onAddSelected={f.handleAddSelectedModels}
        />

        {/* Delete Provider Modal */}
        <DeleteProviderModal
          provider={f.deleteModalProvider}
          affectedAliases={f.affectedAliases}
          deleteModalLoading={f.deleteModalLoading}
          onClose={() => f.setDeleteModalProvider(null)}
          onDelete={f.handleDelete}
        />
      </PageContainer>
    </div>
  );
};
