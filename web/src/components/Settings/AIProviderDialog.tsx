import { useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import AIAccountConnection from "./AIAccountConnection";
import { ConnectionTestButton } from "./AIConnectionTestButton";
import { getDefaultModelForProvider, getProviderTypeLabel, LLM_PROVIDER_PRESETS, STT_PROVIDER_PRESETS } from "./aiProviderPresets";
import type { LocalAIProvider } from "./aiSettingsState";
import { newProvider } from "./aiSettingsState";

interface AIProviderDialogProps {
  provider?: LocalAIProvider;
  onOpenChange: (open: boolean) => void;
  onSave: (provider: LocalAIProvider) => void;
  onAntigravityConnected: (provider: LocalAIProvider) => Promise<void>;
}

const AIProviderDialog = ({ provider, onOpenChange, onSave, onAntigravityConnected }: AIProviderDialogProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState<LocalAIProvider>(() => provider ?? newProvider());

  useEffect(() => {
    const next = provider ?? newProvider();
    setDraft(next);
  }, [provider]);

  const updateDraft = (partial: Partial<LocalAIProvider>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  };

  const handleSave = () => {
    onSave(draft);
  };

  const isAntigravity = draft.type === InstanceSetting_AIProviderType.ANTIGRAVITY;

  return (
    <Dialog open={!!provider} onOpenChange={onOpenChange}>
      <DialogContent size="2xl">
        <DialogHeader>
          <DialogTitle>{provider?.apiKeySet ? t("setting.ai.edit-provider") : t("setting.ai.add-provider")}</DialogTitle>
          <DialogDescription>{t("setting.ai.dialog-description")}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.provider-title")}</Label>
            <Input
              value={draft.title}
              onChange={(e) => updateDraft({ title: e.target.value })}
              placeholder={isAntigravity ? "Google Antigravity" : "OpenAI"}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>{t("setting.ai.provider-type")}</Label>
            <Select
              value={String(draft.type)}
              onValueChange={(value) => {
                const nextType = Number(value) as InstanceSetting_AIProviderType;
                updateDraft({
                  type: nextType,
                  id: nextType === draft.type ? draft.id : uuidv4(),
                  apiKey: "",
                  apiKeySet: nextType === draft.type && draft.apiKeySet,
                  oauthAccount: "",
                  oauthPlanEnabled: false,
                  endpoint: LLM_PROVIDER_PRESETS.find((preset) => preset.type === nextType)?.defaultEndpoint ?? "",
                  title:
                    nextType === InstanceSetting_AIProviderType.ANTIGRAVITY && !draft.title.trim()
                      ? "Google Antigravity"
                      : draft.title || getProviderTypeLabel(nextType),
                });
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue>{getProviderTypeLabel(draft.type)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>AI / LLM Providers</SelectLabel>
                  {LLM_PROVIDER_PRESETS.map((preset) => (
                    <SelectItem key={preset.type} value={String(preset.type)}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Transcription (STT) Providers</SelectLabel>
                  {STT_PROVIDER_PRESETS.map((preset) => (
                    <SelectItem key={preset.type} value={String(preset.type)}>
                      {preset.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {isAntigravity || draft.type === InstanceSetting_AIProviderType.CHATGPT ? (
            <div className="sm:col-span-2">
              <AIAccountConnection
                key={draft.id}
                provider={draft}
                onConnected={async (connected) => {
                  updateDraft(connected);
                  await onAntigravityConnected(connected);
                }}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>{t("setting.ai.endpoint")}</Label>
                <Input
                  value={draft.endpoint}
                  onChange={(e) => updateDraft({ endpoint: e.target.value })}
                  placeholder={getDefaultEndpointPlaceholder(draft.type)}
                />
                <p className="text-xs text-muted-foreground">{t("setting.ai.endpoint-hint")}</p>
              </div>

              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>{t("setting.ai.api-key")}</Label>
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => updateDraft({ apiKey: e.target.value })}
                  placeholder={draft.apiKeySet ? t("setting.ai.keep-api-key") : ""}
                />
                {draft.apiKeySet && (
                  <p className="text-xs text-muted-foreground">{t("setting.ai.current-key", { key: draft.apiKeyHint || "-" })}</p>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between w-full">
          <div>
            {!isAntigravity && draft.apiKeySet && (
              <ConnectionTestButton provider={draft} model={getDefaultModelForProvider(draft.type, false)} capability="LLM" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {draft.apiKeySet && isAntigravity ? "Close" : t("common.cancel")}
            </Button>
            <Button onClick={handleSave}>{draft.apiKeySet && isAntigravity ? "Done" : t("common.save")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const getDefaultEndpointPlaceholder = (type: InstanceSetting_AIProviderType) => {
  switch (type) {
    case InstanceSetting_AIProviderType.OPENAI:
      return "https://api.openai.com/v1";
    case InstanceSetting_AIProviderType.GEMINI:
      return "https://generativelanguage.googleapis.com/v1beta";
    case InstanceSetting_AIProviderType.GROQ:
      return "https://api.groq.com/openai/v1";
    case InstanceSetting_AIProviderType.DEEPGRAM:
      return "https://api.deepgram.com/v1/listen";
    case InstanceSetting_AIProviderType.ELEVENLABS:
      return "https://api.elevenlabs.io/v1/speech-to-text";
    case InstanceSetting_AIProviderType.ANTIGRAVITY:
      return "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";
    case InstanceSetting_AIProviderType.ANTHROPIC:
      return "https://api.anthropic.com/v1/messages";
    case InstanceSetting_AIProviderType.DEEPSEEK:
      return "https://api.deepseek.com/v1";
    case InstanceSetting_AIProviderType.OPENROUTER:
      return "https://openrouter.ai/api/v1";
    case InstanceSetting_AIProviderType.NVIDIA:
      return "https://integrate.api.nvidia.com/v1";
    case InstanceSetting_AIProviderType.OLLAMA:
      return "http://127.0.0.1:11434/v1";
    case InstanceSetting_AIProviderType.LOCAL_WHISPER:
      return "http://127.0.0.1:8000/v1";
    case InstanceSetting_AIProviderType.AZURE_STT:
      return "https://eastus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1";
    case InstanceSetting_AIProviderType.IBM_STT:
      return "https://api.us-south.speech-to-text.watson.cloud.ibm.com/v1/recognize";
    default:
      return "";
  }
};

export { AIProviderDialog };
