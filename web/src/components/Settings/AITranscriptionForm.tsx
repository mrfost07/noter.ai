import { KeyRoundIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import AIAccountConnection from "./AIAccountConnection";
import { ConnectionTestButton } from "./AIConnectionTestButton";
import { ProviderModelSelector } from "./AIProviderModelSelector";
import { getDefaultModelForProvider, getProviderTypeLabel, providerRequiresApiKey, STT_PROVIDER_PRESETS } from "./aiProviderPresets";
import type { LocalAIProvider, LocalTranscription } from "./aiSettingsState";

interface TranscriptionFormProps {
  providers: LocalAIProvider[];
  transcription: LocalTranscription;
  onSave: (provider: LocalAIProvider, next: LocalTranscription) => Promise<void>;
  onAntigravityConnected: (provider: LocalAIProvider) => Promise<void>;
}

const TranscriptionForm = ({ providers, transcription, onSave, onAntigravityConnected }: TranscriptionFormProps) => {
  const t = useTranslate();

  // Find currently linked provider, or default to GROQ / existing
  const currentProvider = useMemo(() => {
    return providers.find((p) => p.id === transcription.providerId);
  }, [providers, transcription.providerId]);

  // Selected provider type in the UI
  const [selectedType, setSelectedType] = useState<InstanceSetting_AIProviderType>(() => {
    if (currentProvider) return currentProvider.type;
    return InstanceSetting_AIProviderType.GROQ;
  });

  // Keep selectedType updated if linked provider changes
  useEffect(() => {
    if (currentProvider && currentProvider.type !== selectedType) {
      setSelectedType(currentProvider.type);
    }
  }, [currentProvider?.id, currentProvider?.type]);

  // Active provider draft corresponding to selectedType
  const activeProvider = useMemo<LocalAIProvider>(() => {
    const existing = currentProvider?.type === selectedType ? currentProvider : providers.find((p) => p.type === selectedType);
    if (existing) return existing;
    const preset = STT_PROVIDER_PRESETS.find((p) => p.type === selectedType);
    return {
      id: uuidv4(),
      title: preset ? preset.label : "Speech Provider",
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
    return transcription.model || getDefaultModelForProvider(selectedType, true);
  });

  const [language, setLanguage] = useState<string>(transcription.language);
  const [prompt, setPrompt] = useState<string>(transcription.prompt);
  const [speakerProviderId, setSpeakerProviderId] = useState(transcription.speakerProviderId ?? "");
  useEffect(() => {
    setModel(transcription.model || getDefaultModelForProvider(currentProvider?.type ?? InstanceSetting_AIProviderType.GROQ, true));
    setLanguage(transcription.language);
    setPrompt(transcription.prompt);
    setSpeakerProviderId(transcription.speakerProviderId ?? "");
  }, [transcription]);

  const handleTypeChange = (typeVal: string) => {
    const nextType = Number(typeVal) as InstanceSetting_AIProviderType;
    setSelectedType(nextType);
    const existing = providers.find((p) => p.type === nextType);
    const nextModel = getDefaultModelForProvider(nextType, true);
    setModel(nextModel);
    if (existing) {
      setProviderDraft(existing);
    } else {
      const preset = STT_PROVIDER_PRESETS.find((p) => p.type === nextType);
      setProviderDraft({
        id: uuidv4(),
        title: preset ? preset.label : "Speech Provider",
        type: nextType,
        endpoint: preset ? preset.defaultEndpoint : "",
        apiKey: "",
        apiKeySet: false,
        apiKeyHint: "",
      });
    }
  };

  const handleSave = async () => {
    const nextTrans: LocalTranscription = {
      providerId: providerDraft.id,
      model: model.trim(),
      language: language.trim(),
      prompt,
      speakerProviderId,
      speakerModel: speakerProviderId === transcription.speakerProviderId ? (transcription.speakerModel ?? "") : "",
    };
    await onSave(providerDraft, nextTrans);
  };

  const presetInfo = STT_PROVIDER_PRESETS.find((p) => p.type === selectedType);
  const isAntigravity = selectedType === InstanceSetting_AIProviderType.ANTIGRAVITY;
  const isKeyRequired = providerRequiresApiKey(selectedType);

  return (
    <div className="grid grid-cols-1 gap-4 max-w-3xl">
      {/* Speech Provider Selector */}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs font-semibold">Speech Transcription Provider</Label>
        <Select value={String(selectedType)} onValueChange={handleTypeChange}>
          <SelectTrigger className="w-full">
            <SelectValue>{getProviderTypeLabel(selectedType)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STT_PROVIDER_PRESETS.map((preset) => (
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
      <ProviderModelSelector provider={providerDraft} selectedModel={model} onSelectModel={setModel} isSTT={true} />

      {/* Language & Prompt */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs font-semibold">{t("setting.ai.transcription-language")}</Label>
          <Input
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder={t("setting.ai.transcription-language-placeholder")}
            maxLength={32}
            className="h-8 text-xs"
          />
          <p className="text-[11px] text-muted-foreground">{t("setting.ai.transcription-language-help")}</p>
        </div>

        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label className="text-xs font-semibold">{t("setting.ai.transcription-prompt")}</Label>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t("setting.ai.transcription-prompt-placeholder")}
            rows={2}
            maxLength={4096}
            className="text-xs"
          />
          <p className="text-[11px] text-muted-foreground">{t("setting.ai.transcription-prompt-help")}</p>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <Label htmlFor="noter-speaker-provider">Speaker recognition (optional)</Label>
        <select
          id="noter-speaker-provider"
          value={speakerProviderId}
          onChange={(event) => setSpeakerProviderId(event.target.value)}
          className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
        >
          <option value="">Off — keep shared audio grouped</option>
          {providers
            .filter((provider) =>
              [InstanceSetting_AIProviderType.DEEPGRAM, InstanceSetting_AIProviderType.ELEVENLABS].includes(provider.type),
            )
            .map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.title}
              </option>
            ))}
        </select>
        <p className="text-xs leading-5 text-muted-foreground">
          Groq stays your live transcriber. Add a Deepgram or ElevenLabs connection to label Client 1, Client 2, and other voices after
          recording stops. Only shared audio is sent to this optional provider; its normal usage charges apply. Speaker numbers are local to
          each recording.
        </p>
      </div>

      {/* Action Row */}
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <ConnectionTestButton provider={providerDraft} model={model} capability="STT" />
        <Button onClick={() => void handleSave()} size="sm" disabled={isAntigravity && !providerDraft.apiKeySet}>
          Save audio settings
        </Button>
      </div>
    </div>
  );
};

export { TranscriptionForm };
