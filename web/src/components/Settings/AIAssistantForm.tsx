import { KeyRoundIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";
import AIAccountConnection from "./AIAccountConnection";
import { ConnectionTestButton } from "./AIConnectionTestButton";
import { ProviderModelSelector } from "./AIProviderModelSelector";
import { getDefaultModelForProvider, getProviderTypeLabel, LLM_PROVIDER_PRESETS, providerRequiresApiKey } from "./aiProviderPresets";
import type { LocalAIAssistantConfig, LocalAIProvider } from "./aiSettingsState";

interface AIAssistantFormProps {
  providers: LocalAIProvider[];
  config: LocalAIAssistantConfig;
  onSave: (provider: LocalAIProvider, next: LocalAIAssistantConfig) => Promise<void>;
  onAntigravityConnected: (provider: LocalAIProvider) => Promise<void>;
}

export const AIAssistantForm = ({ providers, config, onSave, onAntigravityConnected }: AIAssistantFormProps) => {
  const currentProvider = useMemo(() => {
    return providers.find((p) => p.id === config.providerId);
  }, [providers, config.providerId]);

  const [selectedType, setSelectedType] = useState<InstanceSetting_AIProviderType>(() => {
    if (currentProvider) return currentProvider.type;
    return InstanceSetting_AIProviderType.ANTIGRAVITY;
  });

  useEffect(() => {
    if (currentProvider && currentProvider.type !== selectedType) {
      setSelectedType(currentProvider.type);
    }
  }, [currentProvider?.id, currentProvider?.type]);

  const activeProvider = useMemo<LocalAIProvider>(() => {
    const existing = currentProvider?.type === selectedType ? currentProvider : providers.find((p) => p.type === selectedType);
    if (existing) return existing;
    const preset = LLM_PROVIDER_PRESETS.find((p) => p.type === selectedType);
    return {
      id: uuidv4(),
      title: preset ? preset.label : "AI Provider",
      type: selectedType,
      endpoint: preset ? preset.defaultEndpoint : "",
      apiKey: "",
      apiKeySet: false,
      apiKeyHint: "",
    };
  }, [providers, selectedType, currentProvider]);

  const [providerDraft, setProviderDraft] = useState<LocalAIProvider>(activeProvider);
  useEffect(() => {
    setProviderDraft(activeProvider);
  }, [activeProvider]);

  const [model, setModel] = useState<string>(() => {
    return config.model || getDefaultModelForProvider(selectedType, false);
  });
  useEffect(() => {
    setModel(config.model || getDefaultModelForProvider(currentProvider?.type ?? InstanceSetting_AIProviderType.ANTIGRAVITY, false));
  }, [config.providerId, config.model]);

  const handleTypeChange = (typeVal: string) => {
    const nextType = Number(typeVal) as InstanceSetting_AIProviderType;
    setSelectedType(nextType);
    const existing = providers.find((p) => p.type === nextType);
    const nextModel = getDefaultModelForProvider(nextType, false);
    setModel(nextModel);
    if (existing) {
      setProviderDraft(existing);
    } else {
      const preset = LLM_PROVIDER_PRESETS.find((p) => p.type === nextType);
      setProviderDraft({
        id: uuidv4(),
        title: preset ? preset.label : "AI Provider",
        type: nextType,
        endpoint: preset ? preset.defaultEndpoint : "",
        apiKey: "",
        apiKeySet: false,
        apiKeyHint: "",
      });
    }
  };

  const handleSave = async () => {
    const nextConfig: LocalAIAssistantConfig = {
      providerId: providerDraft.id,
      model: model.trim(),
    };
    await onSave(providerDraft, nextConfig);
  };

  const presetInfo = LLM_PROVIDER_PRESETS.find((p) => p.type === selectedType);
  const isAntigravity = selectedType === InstanceSetting_AIProviderType.ANTIGRAVITY;
  const isKeyRequired = providerRequiresApiKey(selectedType);

  return (
    <div className="grid grid-cols-1 gap-4 max-w-3xl">
      {/* AI Provider Selector */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold">Meeting AI provider</Label>
        <Select value={String(selectedType)} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-full">
            <SelectValue>{getProviderTypeLabel(selectedType)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {LLM_PROVIDER_PRESETS.map((preset) => (
              <SelectItem key={preset.type} value={String(preset.type)}>
                <div className="flex items-center justify-between w-full gap-2">
                  <span className="font-medium">{preset.label}</span>
                  <span className="text-xs text-muted-foreground">{preset.subtitle}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Credentials Banner / Input */}
      {isAntigravity || selectedType === InstanceSetting_AIProviderType.CHATGPT ? (
        <AIAccountConnection
          key={providerDraft.id}
          provider={providerDraft}
          accounts={
            selectedType === InstanceSetting_AIProviderType.CHATGPT
              ? providers.filter((item) => item.type === InstanceSetting_AIProviderType.CHATGPT)
              : undefined
          }
          onSelectAccount={
            selectedType === InstanceSetting_AIProviderType.CHATGPT
              ? (account) => {
                  setProviderDraft(account);
                  setModel("");
                }
              : undefined
          }
          onConnected={async (connected) => {
            setProviderDraft(connected);
            await onAntigravityConnected(connected);
          }}
        />
      ) : isKeyRequired ? (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/20 p-3.5">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold flex items-center gap-1.5">
              <KeyRoundIcon className="size-3.5 text-muted-foreground" />
              {presetInfo?.label} API Key
            </Label>
            {providerDraft.apiKeySet && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                Key saved ({providerDraft.apiKeyHint || "Active"})
              </span>
            )}
          </div>
          <Input
            type="password"
            value={providerDraft.apiKey}
            onChange={(e) => setProviderDraft({ ...providerDraft, apiKey: e.target.value })}
            placeholder={
              providerDraft.apiKeySet ? "•••••••••••••••• (Leave blank to keep current key)" : presetInfo?.keyPlaceholder || "Enter API Key"
            }
            className="h-8 text-xs font-mono"
          />
        </div>
      ) : null}

      {/* Model Selection Tiles Grid */}
      <ProviderModelSelector provider={providerDraft} selectedModel={model} onSelectModel={setModel} isSTT={false} />

      <p role="status" className="text-xs leading-5 text-muted-foreground">
        {config.providerId === providerDraft.id && config.model === model
          ? `Saved model: ${model}. Used automatically on future app launches.`
          : "Save this choice to reuse it for meeting notes and the note assistant."}
      </p>

      {/* Action Row */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <ConnectionTestButton provider={providerDraft} model={model} capability="LLM" />
        <Button
          onClick={() => void handleSave()}
          size="sm"
          disabled={
            (isAntigravity && !providerDraft.apiKeySet) ||
            (selectedType === InstanceSetting_AIProviderType.CHATGPT &&
              (!providerDraft.apiKeySet || !providerDraft.oauthPlanEnabled || !model.trim()))
          }
        >
          Save meeting AI
        </Button>
      </div>
    </div>
  );
};
