import { create } from "@bufbuild/protobuf";
import { isEqual } from "lodash-es";
import { MoreVerticalIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { aiServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { DisconnectChatGPTRequestSchema } from "@/types/proto/api/ai_service_pb";
import {
  InstanceSetting_AIProviderType,
  InstanceSetting_AISettingSchema,
  InstanceSetting_AssistantConfigSchema,
  InstanceSetting_Key,
  InstanceSetting_TranscriptionConfig,
  InstanceSetting_TranscriptionConfigSchema,
  InstanceSettingSchema,
} from "@/types/proto/api/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import { AIAssistantForm } from "./AIAssistantForm";
import { AIProviderDialog } from "./AIProviderDialog";
import { TranscriptionForm } from "./AITranscriptionForm";
import { getDefaultModelForProvider, getProviderTypeLabel, providerRequiresApiKey } from "./aiProviderPresets";
import type { LocalAIAssistantConfig, LocalAIProvider, LocalTranscription } from "./aiSettingsState";
import {
  AI_ASSISTANT_CONFIG_STORAGE_KEY,
  loadAIAssistantConfig,
  newProvider,
  toLocalProvider,
  toLocalTranscription,
  toProviderConfig,
  toTranscriptionConfig,
} from "./aiSettingsState";
import SettingGroup from "./SettingGroup";
import { SettingPanel } from "./SettingList";
import SettingSection from "./SettingSection";
import SettingTable from "./SettingTable";
import useInstanceSettingUpdater, { buildInstanceSettingName } from "./useInstanceSettingUpdater";

const byokNotes = ["setting.ai.byok-key-note", "setting.ai.byok-storage-note", "setting.ai.byok-model-note"] as const;

const AISection = () => {
  const t = useTranslate();
  const saveInstanceSetting = useInstanceSettingUpdater();
  const { aiSetting: originalSetting, fetchSetting } = useInstance();
  const [providers, setProviders] = useState<LocalAIProvider[]>(() => originalSetting.providers.map(toLocalProvider));
  const [transcription, setTranscription] = useState<LocalTranscription>(() => toLocalTranscription(originalSetting.transcription));
  const [, setSavedAssistantConfig] = useState<LocalAIAssistantConfig>(() => loadAIAssistantConfig());
  const [assistantConfig, setAssistantConfig] = useState<LocalAIAssistantConfig>(
    () => originalSetting.assistant ?? loadAIAssistantConfig(),
  );
  useEffect(() => {
    if (originalSetting.assistant) {
      const config = { providerId: originalSetting.assistant.providerId, model: originalSetting.assistant.model };
      setAssistantConfig(config);
      try {
        window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, JSON.stringify(config));
      } catch {
        /* Server settings remain authoritative. */
      }
    }
  }, [originalSetting.assistant]);
  const [editingProvider, setEditingProvider] = useState<LocalAIProvider | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<LocalAIProvider | undefined>();

  useEffect(() => {
    setProviders(originalSetting.providers.map(toLocalProvider));
  }, [originalSetting.providers]);

  const lastSyncedTranscription = useRef<LocalTranscription>(toLocalTranscription(originalSetting.transcription));
  useEffect(() => {
    const next = toLocalTranscription(originalSetting.transcription);
    if (!isEqual(lastSyncedTranscription.current, next)) {
      setTranscription(next);
      lastSyncedTranscription.current = next;
    }
  }, [originalSetting.transcription]);

  const persistAISetting = async (
    nextProviders: LocalAIProvider[],
    nextTranscription: InstanceSetting_TranscriptionConfig | undefined,
    errorContext: string,
    nextAssistant?: LocalAIAssistantConfig,
  ) => {
    return saveInstanceSetting({
      key: InstanceSetting_Key.AI,
      setting: create(InstanceSettingSchema, {
        name: buildInstanceSettingName(InstanceSetting_Key.AI),
        value: {
          case: "aiSetting",
          value: create(InstanceSetting_AISettingSchema, {
            providers: nextProviders.map(toProviderConfig),
            transcription: nextTranscription,
            assistant: nextAssistant ? create(InstanceSetting_AssistantConfigSchema, nextAssistant) : undefined,
          }),
        },
      }),
      errorContext,
    });
  };

  const handleCreateProvider = () => {
    setEditingProvider(newProvider());
  };

  const handleEditProvider = (provider: LocalAIProvider) => {
    setEditingProvider({ ...provider, apiKey: "" });
  };

  const handleSaveProvider = async (provider: LocalAIProvider) => {
    const title = provider.title.trim() || (provider.type === InstanceSetting_AIProviderType.ANTIGRAVITY ? "Google Antigravity" : "");
    const endpoint = provider.endpoint.trim();

    if (!title) {
      toast.error(t("setting.ai.provider-title-required"));
      return;
    }
    if (
      [InstanceSetting_AIProviderType.ANTIGRAVITY, InstanceSetting_AIProviderType.CHATGPT].includes(provider.type) &&
      !provider.apiKeySet
    ) {
      toast.error("Connect the account before saving this provider.");
      return;
    }
    if (providerRequiresApiKey(provider.type) && !provider.apiKeySet && !provider.apiKey.trim()) {
      toast.error(t("setting.ai.api-key-required"));
      return;
    }

    const normalizedProvider = { ...provider, title, endpoint };
    const exists = providers.some((item) => item.id === normalizedProvider.id);
    const nextProviders = exists
      ? providers.map((item) => (item.id === normalizedProvider.id ? normalizedProvider : item))
      : [...providers, normalizedProvider];

    const ok = await persistAISetting(nextProviders, undefined, "Update AI provider");
    if (!ok) return;
    setProviders(nextProviders);
    setEditingProvider(undefined);
  };

  const handleAntigravityConnected = async (connected: LocalAIProvider) => {
    setProviders((prev) => {
      const exists = prev.some((p) => p.id === connected.id);
      return exists ? prev.map((p) => (p.id === connected.id ? connected : p)) : [...prev, connected];
    });

    if (!assistantConfig.providerId) {
      const nextAssistant = { providerId: connected.id, model: getDefaultModelForProvider(connected.type, false) };
      setAssistantConfig(nextAssistant);
      setSavedAssistantConfig(nextAssistant);
      window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, JSON.stringify(nextAssistant));
    }

    if (!transcription.providerId && connected.type === InstanceSetting_AIProviderType.ANTIGRAVITY) {
      setTranscription((prev) => ({
        ...prev,
        providerId: connected.id,
        model: prev.model || "gemini-2.5-flash",
      }));
    }

    try {
      await fetchSetting(InstanceSetting_Key.AI, true);
    } catch (e) {
      console.warn("Failed to refetch AI setting:", e);
    }
  };

  const handleDeleteProvider = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    if (target.type === InstanceSetting_AIProviderType.CHATGPT) {
      try {
        const result = await aiServiceClient.disconnectChatGPT(create(DisconnectChatGPTRequestSchema, { providerId: target.id }));
        if (!result.remoteRevocationConfirmed)
          toast.error("Signed out locally. Remote revocation was not confirmed; disconnect Noter.ai in ChatGPT Settings too.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not disconnect ChatGPT.");
        return;
      }
    }
    const nextProviders = providers.filter((provider) => provider.id !== target.id);

    const persistedTranscription = originalSetting.transcription;
    const nextTranscription = persistedTranscription
      ? create(
          InstanceSetting_TranscriptionConfigSchema,
          persistedTranscription.providerId === target.id ? {} : { ...persistedTranscription },
        )
      : undefined;

    if (nextTranscription?.speakerProviderId === target.id) {
      nextTranscription.speakerProviderId = "";
      nextTranscription.speakerModel = "";
    }
    const nextAssistant = assistantConfig.providerId === target.id ? { providerId: "", model: "" } : assistantConfig;
    const ok = await persistAISetting(nextProviders, nextTranscription, "Delete AI provider", nextAssistant);
    if (!ok) return;
    setProviders(nextProviders);
    if (transcription.providerId === target.id) {
      setTranscription((prev) => ({ ...prev, providerId: "" }));
    }
    if (assistantConfig.providerId === target.id) {
      const cleared = { ...assistantConfig, providerId: "" };
      setAssistantConfig(cleared);
      setSavedAssistantConfig(cleared);
      window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, JSON.stringify(cleared));
    }
    setDeleteTarget(undefined);
  };

  const handleSaveTranscriptionWithProvider = async (activeProvider: LocalAIProvider, nextTranscription: LocalTranscription) => {
    const exists = providers.some((p) => p.id === activeProvider.id);
    const nextProviders = exists ? providers.map((p) => (p.id === activeProvider.id ? activeProvider : p)) : [...providers, activeProvider];

    const ok = await persistAISetting(nextProviders, toTranscriptionConfig(nextTranscription), "Update transcription");
    if (ok) {
      setProviders(nextProviders);
      setTranscription(nextTranscription);
      toast.success("Transcription settings saved!");
    }
  };

  const handleSaveAssistantWithProvider = async (activeProvider: LocalAIProvider, nextConfig: LocalAIAssistantConfig) => {
    const exists = providers.some((p) => p.id === activeProvider.id);
    const nextProviders = exists ? providers.map((p) => (p.id === activeProvider.id ? activeProvider : p)) : [...providers, activeProvider];

    const ok = await persistAISetting(nextProviders, undefined, "Update meeting AI", nextConfig);
    if (ok) {
      setProviders(nextProviders);
      window.localStorage.setItem(AI_ASSISTANT_CONFIG_STORAGE_KEY, JSON.stringify(nextConfig));
      setAssistantConfig(nextConfig);
      setSavedAssistantConfig(nextConfig);
      toast.success("Meeting AI saved for future app launches.");
    }
  };

  return (
    <SettingSection
      title={t("setting.ai.label")}
      actions={
        <Button onClick={handleCreateProvider}>
          <PlusIcon className="w-4 h-4 mr-2" />
          {t("setting.ai.add-provider")}
        </Button>
      }
    >
      <SettingPanel className="bg-muted/30 px-4 py-3">
        <div className="flex max-w-3xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
              {t("setting.ai.byok-label")}
            </span>
            <h4 className="text-sm font-semibold text-foreground">{t("setting.ai.byok-title")}</h4>
          </div>
          <p className="text-sm text-muted-foreground">{t("setting.ai.byok-description")}</p>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {byokNotes.map((note) => (
              <li key={note} className="flex gap-2">
                <span className="mt-2 size-1 rounded-full bg-muted-foreground/60" aria-hidden />
                <span>{t(note)}</span>
              </li>
            ))}
          </ul>
        </div>
      </SettingPanel>

      {/* Transcription Group */}
      <SettingGroup
        title={t("setting.ai.transcription-title")}
        description="Choose the provider that turns microphone and shared audio into text. Save once to keep this choice across app launches."
        showSeparator
      >
        <TranscriptionForm
          providers={providers}
          transcription={transcription}
          onSave={handleSaveTranscriptionWithProvider}
          onAntigravityConnected={handleAntigravityConnected}
        />
      </SettingGroup>

      {/* AI Assistant Group */}
      <SettingGroup
        title="Meeting AI & note assistant"
        description="Choose the model that organizes conversations and helps with your notes. Your saved model is reused; refreshing models is optional."
        showSeparator
      >
        <AIAssistantForm
          providers={providers}
          config={assistantConfig}
          onSave={handleSaveAssistantWithProvider}
          onAntigravityConnected={handleAntigravityConnected}
        />
      </SettingGroup>

      {/* Integrations Table */}
      <SettingGroup
        title={t("setting.ai.integrations-title")}
        description="Configured API keys and OAuth connections for speech and intelligence models."
      >
        <SettingTable
          columns={[
            {
              key: "title",
              header: t("common.name"),
              render: (_, provider: LocalAIProvider) => (
                <div className="flex flex-col gap-0.5">
                  <span className="text-foreground font-medium">{provider.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">{provider.id}</span>
                </div>
              ),
            },
            {
              key: "type",
              header: t("setting.ai.provider-type"),
              render: (_, provider: LocalAIProvider) => <span>{getProviderTypeLabel(provider.type)}</span>,
            },
            {
              key: "endpoint",
              header: t("setting.ai.endpoint"),
              render: (_, provider: LocalAIProvider) => (
                <span className="font-mono text-xs">{provider.endpoint || t("setting.ai.default-endpoint")}</span>
              ),
            },
            {
              key: "apiKeySet",
              header: t("setting.ai.api-key"),
              render: (_, provider: LocalAIProvider) => (
                <span className="font-mono text-xs">
                  {provider.apiKeySet
                    ? provider.type === InstanceSetting_AIProviderType.ANTIGRAVITY
                      ? "Google OAuth ✓"
                      : provider.apiKeyHint || t("setting.ai.configured")
                    : "-"}
                </span>
              ),
            },
            {
              key: "actions",
              header: "",
              className: "text-right",
              render: (_, provider: LocalAIProvider) => (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
                    <MoreVerticalIcon className="w-4 h-auto" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={2}>
                    <DropdownMenuItem onClick={() => handleEditProvider(provider)}>{t("common.edit")}</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setDeleteTarget(provider)} className="text-destructive focus:text-destructive">
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            },
          ]}
          data={providers}
          emptyMessage={t("setting.ai.no-providers")}
          getRowKey={(provider) => provider.id}
        />
      </SettingGroup>

      <AIProviderDialog
        provider={editingProvider}
        onOpenChange={(open) => !open && setEditingProvider(undefined)}
        onSave={handleSaveProvider}
        onAntigravityConnected={handleAntigravityConnected}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(undefined)}
        title={deleteTarget ? t("setting.ai.delete-provider", { title: deleteTarget.title }) : ""}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteProvider}
        confirmVariant="destructive"
      />
    </SettingSection>
  );
};

export default AISection;
