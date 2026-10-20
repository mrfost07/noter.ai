import { create } from "@bufbuild/protobuf";
import { RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiServiceClient } from "@/connect";
import { cn } from "@/lib/utils";
import { FetchAvailableModelsRequestSchema } from "@/types/proto/api/ai_service_pb";
import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";
import { getCuratedLLMModels, getCuratedSTTModels, type ModelTileOption } from "./aiProviderPresets";
import type { LocalAIProvider } from "./aiSettingsState";

interface ProviderModelSelectorProps {
  provider: LocalAIProvider | undefined;
  selectedModel: string;
  onSelectModel: (model: string) => void;
  isSTT: boolean;
}

export const ProviderModelSelector = ({ provider, selectedModel, onSelectModel, isSTT }: ProviderModelSelectorProps) => {
  const [isDetecting, setIsDetecting] = useState(false);
  const detectionGeneration = useRef(0);
  useEffect(() => {
    detectionGeneration.current++;
    setDetectedModels([]);
    setIsDetecting(false);
  }, [provider?.id, provider?.type]);
  const [detectedModels, setDetectedModels] = useState<ModelTileOption[]>([]);
  const [showCustomInput, setShowCustomInput] = useState(false);

  const curated = useMemo(() => {
    if (!provider) return [];
    return isSTT ? getCuratedSTTModels(provider.type) : getCuratedLLMModels(provider.type);
  }, [provider, isSTT]);

  const effectiveModels: ModelTileOption[] = useMemo(() => {
    const models = detectedModels.length ? detectedModels : curated;
    if (selectedModel && !models.some((model) => model.id === selectedModel)) {
      return [
        { id: selectedModel, label: selectedModel, badge: "Selected", description: "Your saved model. Refreshing the list is optional." },
        ...models,
      ];
    }
    return models;
  }, [detectedModels, curated, selectedModel]);

  useEffect(() => {
    if (selectedModel && effectiveModels.length > 0 && !effectiveModels.some((m) => m.id === selectedModel)) {
      setShowCustomInput(true);
    }
  }, [selectedModel, effectiveModels]);

  const handleDetectModels = async () => {
    if (!provider) return;
    const generation = ++detectionGeneration.current;
    setIsDetecting(true);
    try {
      const resp = await aiServiceClient.fetchAvailableModels(
        create(FetchAvailableModelsRequestSchema, {
          providerId: provider.id,
        }),
      );

      if (generation !== detectionGeneration.current) return;
      if (resp.models && resp.models.length > 0) {
        const mapped: ModelTileOption[] = resp.models.map((m) => {
          let badge = m.isDefault ? "Default" : undefined;
          if (m.remainingQuota >= 0) {
            badge = `${Math.round(m.remainingQuota * 100)}% quota`;
          }
          return {
            id: m.id,
            label: m.label || m.id,
            badge,
            description: m.description,
            isDefault: m.isDefault,
            remainingQuota: m.remainingQuota,
          };
        });
        setDetectedModels(mapped);
        toast.success(`Model list refreshed (${mapped.length} models).`);

        if (!selectedModel) {
          const def = mapped.find((m) => m.isDefault) || mapped[0];
          if (def) onSelectModel(def.id);
        }
      } else {
        toast.error("No models reported by provider API.");
      }
    } catch (err) {
      if (generation === detectionGeneration.current) toast.error(err instanceof Error ? err.message : "Failed to detect models");
    } finally {
      if (generation === detectionGeneration.current) setIsDetecting(false);
    }
  };

  if (!provider) {
    return (
      <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        Select a provider above to choose models.
      </div>
    );
  }

  const isAntigravity = provider.type === InstanceSetting_AIProviderType.ANTIGRAVITY;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
          <SparklesIcon className="size-3.5 text-primary" />
          {isSTT ? "Transcription model" : "Meeting AI model"}
        </label>
        <div className="flex items-center gap-2">
          {(isAntigravity ||
            provider.type === InstanceSetting_AIProviderType.CHATGPT ||
            provider.type === InstanceSetting_AIProviderType.OLLAMA ||
            provider.type === InstanceSetting_AIProviderType.GROQ) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleDetectModels()}
              disabled={
                isDetecting ||
                (provider.type === InstanceSetting_AIProviderType.CHATGPT && (!provider.apiKeySet || !provider.oauthPlanEnabled))
              }
              className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
            >
              <RefreshCwIcon className={cn("size-3 mr-1", isDetecting && "animate-spin")} />
              {isDetecting ? "Refreshing…" : "Refresh models"}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowCustomInput((v) => !v)}
            className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
          >
            {showCustomInput ? "Hide Custom" : "Custom ID"}
          </Button>
        </div>
      </div>

      {effectiveModels.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {effectiveModels.map((m) => {
            const isSelected = selectedModel === m.id;
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectModel(m.id)}
                className={cn(
                  "relative flex flex-col justify-between rounded-lg p-3 text-left transition-all border",
                  "hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isSelected ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/30" : "border-border bg-card hover:bg-muted/40",
                )}
              >
                <div className="flex items-start justify-between gap-1.5 w-full">
                  <span className={cn("text-xs font-semibold leading-tight line-clamp-1", isSelected ? "text-primary" : "text-foreground")}>
                    {m.label}
                  </span>
                  {m.badge && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none",
                        isSelected
                          ? "bg-primary text-primary-foreground font-semibold"
                          : "bg-muted text-muted-foreground border border-border",
                      )}
                    >
                      {m.badge}
                    </span>
                  )}
                </div>

                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground line-clamp-2">{m.description}</p>

                {m.remainingQuota !== undefined && m.remainingQuota >= 0 && (
                  <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {Math.round(m.remainingQuota * 100)}% quota remaining
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {provider.type === InstanceSetting_AIProviderType.CHATGPT && effectiveModels.length === 0 && (
        <p className="text-sm leading-5 text-muted-foreground">
          {provider.apiKeySet && provider.oauthPlanEnabled
            ? "Refresh models to choose one available to this account."
            : "Connect ChatGPT and enable plan usage to see your available models."}
        </p>
      )}

      {showCustomInput && (
        <div className="space-y-1 rounded-lg border border-border/80 bg-muted/20 p-3 mt-2">
          <Label className="text-xs text-muted-foreground">Model ID</Label>
          <Input
            value={selectedModel}
            onChange={(e) => onSelectModel(e.target.value)}
            placeholder={isSTT ? "whisper-large-v3-turbo" : "gemini-2.5-flash"}
            className="h-8 text-xs font-mono"
            maxLength={256}
          />
          <p className="text-[11px] text-muted-foreground">Enter an exact model ID string if using an unlisted or fine-tuned model.</p>
        </div>
      )}
    </div>
  );
};
