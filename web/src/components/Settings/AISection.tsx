import { create } from "@bufbuild/protobuf";
import { isEqual } from "lodash-es";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  KeyRoundIcon,
  LoaderCircleIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  SparklesIcon,
  Volume2Icon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { v4 as uuidv4 } from "uuid";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
import { Textarea } from "@/components/ui/textarea";
import { aiServiceClient } from "@/connect";
import { useInstance } from "@/contexts/InstanceContext";
import { cn } from "@/lib/utils";
import {
  DisconnectChatGPTRequestSchema,
  FetchAvailableModelsRequestSchema,
  TestAIProviderRequestSchema,
} from "@/types/proto/api/ai_service_pb";
import {
  InstanceSetting_AIProviderConfig,
  InstanceSetting_AIProviderConfigSchema,
  InstanceSetting_AIProviderType,
  InstanceSetting_AISettingSchema,
  InstanceSetting_AssistantConfigSchema,
  InstanceSetting_Key,
  InstanceSetting_TranscriptionConfig,
  InstanceSetting_TranscriptionConfigSchema,
  InstanceSettingSchema,
} from "@/types/proto/api/instance_service_pb";
import { useTranslate } from "@/utils/i18n";
import AIAccountConnection from "./AIAccountConnection";
import SettingGroup from "./SettingGroup";
import { SettingPanel } from "./SettingList";
import SettingSection from "./SettingSection";
import SettingTable from "./SettingTable";
import useInstanceSettingUpdater, { buildInstanceSettingName } from "./useInstanceSettingUpdater";

export const AI_ASSISTANT_CONFIG_STORAGE_KEY = "memos-ai-assistant-config";

export interface LocalAIAssistantConfig {
  providerId: string;
  model: string;
}

export const loadAIAssistantConfig = (): LocalAIAssistantConfig => {
  try {
    const raw = window.localStorage.getItem(AI_ASSISTANT_CONFIG_STORAGE_KEY);
    if (!raw) return { providerId: "", model: "" };
    const parsed = JSON.parse(raw) as Partial<LocalAIAssistantConfig>;
    return {
      providerId: typeof parsed.providerId === "string" ? parsed.providerId : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return { providerId: "", model: "" };
  }
};

export type LocalAIProvider = {
  id: string;
  title: string;
  type: InstanceSetting_AIProviderType;
  endpoint: string;
  apiKey: string;
  apiKeySet: boolean;
  apiKeyHint: string;
  oauthAccount?: string;
  oauthPlanEnabled?: boolean;
};

type LocalTranscription = {
  providerId: string;
  model: string;
  language: string;
  prompt: string;
  speakerProviderId?: string;
  speakerModel?: string;
};

export interface ModelTileOption {
  id: string;
  label: string;
  badge?: string;
  description: string;
  isDefault?: boolean;
  remainingQuota?: number;
}

export interface PresetProviderInfo {
  type: InstanceSetting_AIProviderType;
  label: string;
  subtitle: string;
  defaultEndpoint: string;
  keyPlaceholder?: string;
}

export const STT_PROVIDER_PRESETS: PresetProviderInfo[] = [
  {
    type: InstanceSetting_AIProviderType.GROQ,
    label: "Groq Whisper",
    subtitle: "Ultra-fast REST transcription with Whisper V3 Turbo",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    keyPlaceholder: "gsk_...",
  },
  {
    type: InstanceSetting_AIProviderType.ANTIGRAVITY,
    label: "Google Antigravity",
    subtitle: "Google Cloud Code native multimodal audio speech reasoning",
    defaultEndpoint: "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
  },
  {
    type: InstanceSetting_AIProviderType.DEEPGRAM,
    label: "Deepgram Nova-3",
    subtitle: "Streaming Nova-3 with 300 ms endpointing",
    defaultEndpoint: "https://api.deepgram.com/v1/listen",
    keyPlaceholder: "Token ...",
  },
  {
    type: InstanceSetting_AIProviderType.OPENAI,
    label: "OpenAI Whisper",
    subtitle: "Official OpenAI Whisper speech recognition API",
    defaultEndpoint: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
  },
  {
    type: InstanceSetting_AIProviderType.ELEVENLABS,
    label: "ElevenLabs Scribe",
    subtitle: "Scribe v2 Realtime streaming speech-to-text",
    defaultEndpoint: "https://api.elevenlabs.io/v1/speech-to-text",
    keyPlaceholder: "xi-api-key",
  },
  {
    type: InstanceSetting_AIProviderType.NVIDIA,
    label: "Nvidia NIM",
    subtitle: "Parakeet CTC / RNNT low-latency streaming ASR",
    defaultEndpoint: "https://integrate.api.nvidia.com/v1",
    keyPlaceholder: "nvapi-...",
  },
  {
    type: InstanceSetting_AIProviderType.LOCAL_WHISPER,
    label: "Local Whisper",
    subtitle: "100% on-device private local inference",
    defaultEndpoint: "http://127.0.0.1:8000/v1",
  },
  {
    type: InstanceSetting_AIProviderType.AZURE_STT,
    label: "Azure Speech",
    subtitle: "Microsoft Cognitive Services STT",
    defaultEndpoint: "https://eastus.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1",
    keyPlaceholder: "Azure Speech Key",
  },
  {
    type: InstanceSetting_AIProviderType.IBM_STT,
    label: "IBM Watson STT",
    subtitle: "IBM Watson Cloud Speech-to-Text service",
    defaultEndpoint: "https://api.us-south.speech-to-text.watson.cloud.ibm.com/v1/recognize",
    keyPlaceholder: "apikey:...",
  },
];

export const LLM_PROVIDER_PRESETS: PresetProviderInfo[] = [
  {
    type: InstanceSetting_AIProviderType.CHATGPT,
    label: "ChatGPT account",
    subtitle: "Sign in and authorize ChatGPT plan usage",
    defaultEndpoint: "https://api.openai.com/v1",
  },
  {
    type: InstanceSetting_AIProviderType.ANTIGRAVITY,
    label: "Google Antigravity",
    subtitle: "Google OAuth access to available models",
    defaultEndpoint: "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse",
  },
  {
    type: InstanceSetting_AIProviderType.GROQ,
    label: "Groq",
    subtitle: "Ultra-fast open flagship LLMs at 300+ tps",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    keyPlaceholder: "gsk_...",
  },
  {
    type: InstanceSetting_AIProviderType.OPENAI,
    label: "OpenAI API",
    subtitle: "API key · separate OpenAI Platform billing",
    defaultEndpoint: "https://api.openai.com/v1",
    keyPlaceholder: "sk-...",
  },
  {
    type: InstanceSetting_AIProviderType.ANTHROPIC,
    label: "Anthropic Claude",
    subtitle: "Claude 3.7 Sonnet hybrid reasoning & coding",
    defaultEndpoint: "https://api.anthropic.com/v1/messages",
    keyPlaceholder: "sk-ant-...",
  },
  {
    type: InstanceSetting_AIProviderType.DEEPSEEK,
    label: "DeepSeek",
    subtitle: "DeepSeek-V3 and DeepSeek-R1 reasoning models",
    defaultEndpoint: "https://api.deepseek.com/v1",
    keyPlaceholder: "sk-...",
  },
  {
    type: InstanceSetting_AIProviderType.OPENROUTER,
    label: "OpenRouter",
    subtitle: "Unified gateway routing to all major model APIs",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    keyPlaceholder: "sk-or-...",
  },
  {
    type: InstanceSetting_AIProviderType.NVIDIA,
    label: "Nvidia NIM",
    subtitle: "Hosted high-performance NIM microservices",
    defaultEndpoint: "https://integrate.api.nvidia.com/v1",
    keyPlaceholder: "nvapi-...",
  },
  {
    type: InstanceSetting_AIProviderType.OLLAMA,
    label: "Ollama (Local)",
    subtitle: "Run open models locally on your device",
    defaultEndpoint: "http://127.0.0.1:11434/v1",
  },
];

export const getProviderTypeLabel = (type: InstanceSetting_AIProviderType) => {
  const match = [...LLM_PROVIDER_PRESETS, ...STT_PROVIDER_PRESETS].find((p) => p.type === type);
  if (match) return match.label;
  return InstanceSetting_AIProviderType[type] ?? "UNKNOWN";
};

export const providerRequiresApiKey = (type: InstanceSetting_AIProviderType) =>
  type !== InstanceSetting_AIProviderType.OLLAMA &&
  type !== InstanceSetting_AIProviderType.LOCAL_WHISPER &&
  type !== InstanceSetting_AIProviderType.ANTIGRAVITY &&
  type !== InstanceSetting_AIProviderType.CHATGPT;

const byokNotes = ["setting.ai.byok-key-note", "setting.ai.byok-storage-note", "setting.ai.byok-model-note"] as const;

export const getCuratedSTTModels = (type: InstanceSetting_AIProviderType): ModelTileOption[] => {
  switch (type) {
    case InstanceSetting_AIProviderType.GROQ:
      return [
        {
          id: "whisper-large-v3-turbo",
          label: "V3 Turbo",
          badge: "Fastest",
          description: "Ultra-fast REST Whisper transcription",
          isDefault: true,
        },
        {
          id: "whisper-large-v3",
          label: "V3",
          badge: "Most Accurate",
          description: "Maximum accuracy multilingual Whisper",
        },
      ];
    case InstanceSetting_AIProviderType.ANTIGRAVITY:
      return [
        {
          id: "gemini-2.5-flash",
          label: "Gemini 2.5 Flash",
          badge: "Recommended · 1M Context",
          description: "Ultra-fast speech recognition & native multimodal audio reasoning",
          isDefault: true,
        },
        {
          id: "gemini-2.5-pro",
          label: "Gemini 2.5 Pro",
          badge: "Deep Reasoning",
          description: "Deep audio understanding with 1M context",
        },
      ];
    case InstanceSetting_AIProviderType.OPENAI:
      return [
        {
          id: "whisper-1",
          label: "Whisper-1",
          badge: "Standard",
          description: "Official OpenAI Whisper speech recognition endpoint",
          isDefault: true,
        },
      ];
    case InstanceSetting_AIProviderType.DEEPGRAM:
      return [
        {
          id: "nova-3",
          label: "Nova-3",
          badge: "Fastest",
          description: "Streaming Nova-3 with 300 ms endpointing",
          isDefault: true,
        },
        {
          id: "nova-2",
          label: "Nova-2",
          badge: "Standard",
          description: "Proven high-accuracy speech model",
        },
        {
          id: "nova-2-meeting",
          label: "Nova-2 Meeting",
          badge: "Multi-Speaker",
          description: "Tuned for conferences & multi-speaker meetings",
        },
      ];
    case InstanceSetting_AIProviderType.ELEVENLABS:
      return [
        {
          id: "scribe_v2",
          label: "Scribe V2",
          badge: "High-Fidelity",
          description: "Streaming Scribe v2 Realtime API",
          isDefault: true,
        },
        {
          id: "scribe_v1",
          label: "Scribe V1",
          badge: "Standard",
          description: "Standard Scribe v1 audio transcription",
        },
      ];
    case InstanceSetting_AIProviderType.NVIDIA:
      return [
        {
          id: "nvidia/parakeet-ctc-1.1b-asr",
          label: "Parakeet CTC 1.1B",
          badge: "Fast ASR",
          description: "Low-latency multilingual ASR",
          isDefault: true,
        },
        {
          id: "nvidia/parakeet-rnnt-1.1b",
          label: "Parakeet RNNT 1.1B",
          badge: "Streaming",
          description: "Realtime streaming speech recognition",
        },
      ];
    case InstanceSetting_AIProviderType.LOCAL_WHISPER:
      return [
        {
          id: "whisper-large-v3-turbo",
          label: "V3 Turbo (Local)",
          badge: "Private",
          description: "100% on-device private inference",
          isDefault: true,
        },
        {
          id: "whisper-base",
          label: "Whisper Base (Local)",
          badge: "Lightweight",
          description: "Fast local speech recognition",
        },
      ];
    default:
      return [];
  }
};

export const getCuratedLLMModels = (type: InstanceSetting_AIProviderType): ModelTileOption[] => {
  switch (type) {
    case InstanceSetting_AIProviderType.ANTIGRAVITY:
      return [
        {
          id: "gemini-2.5-flash",
          label: "Gemini 2.5 Flash",
          badge: "Recommended · 1M Context",
          description: "Ultra-fast multimodal reasoning at scale with zero API keys",
          isDefault: true,
        },
        {
          id: "gemini-2.5-pro",
          label: "Gemini 2.5 Pro",
          badge: "Deep Reasoning",
          description: "Deep thinking & complex task reasoning",
        },
        {
          id: "claude-sonnet-4-6",
          label: "Claude Sonnet 4.6",
          badge: "Claude on Antigravity",
          description: "Anthropic Claude reasoning model hosted via Cloud Code",
        },
      ];
    case InstanceSetting_AIProviderType.GROQ:
      return [
        {
          id: "llama-3.3-70b-versatile",
          label: "Llama 3.3 70B",
          badge: "Recommended · 300 tps",
          description: "High-speed open flagship model for meeting structuring & notes",
          isDefault: true,
        },
        {
          id: "llama-3.1-8b-instant",
          label: "Llama 3.1 8B Instant",
          badge: "Ultra-Fast",
          description: "Instant sub-second reasoning",
        },
        {
          id: "mixtral-8x7b-32768",
          label: "Mixtral 8x7B",
          badge: "32k Context",
          description: "Balanced mixture of experts",
        },
      ];
    case InstanceSetting_AIProviderType.OPENAI:
      return [
        {
          id: "gpt-4o",
          label: "GPT-4o",
          badge: "Flagship",
          description: "High intelligence multimodal model",
          isDefault: true,
        },
        {
          id: "gpt-4o-mini",
          label: "GPT-4o Mini",
          badge: "Fast & Efficient",
          description: "Affordable high-speed intelligence",
        },
        {
          id: "o3-mini",
          label: "o3-mini",
          badge: "Reasoning",
          description: "Fast reasoning model for math, coding & logic",
        },
      ];
    case InstanceSetting_AIProviderType.ANTHROPIC:
      return [
        {
          id: "claude-3-7-sonnet-latest",
          label: "Claude 3.7 Sonnet",
          badge: "Recommended",
          description: "Hybrid reasoning and code model",
          isDefault: true,
        },
        {
          id: "claude-3-5-sonnet-20241022",
          label: "Claude 3.5 Sonnet",
          badge: "Flagship",
          description: "High-capability analysis and reasoning",
        },
        {
          id: "claude-3-5-haiku-20241022",
          label: "Claude 3.5 Haiku",
          badge: "Fast",
          description: "Rapid lightweight assistant",
        },
      ];
    case InstanceSetting_AIProviderType.DEEPSEEK:
      return [
        {
          id: "deepseek-chat",
          label: "DeepSeek-V3",
          badge: "General",
          description: "Broad knowledge & assistant reasoning",
          isDefault: true,
        },
        {
          id: "deepseek-reasoner",
          label: "DeepSeek-R1",
          badge: "Reasoning",
          description: "Chain-of-thought deep reasoning",
        },
      ];
    case InstanceSetting_AIProviderType.OPENROUTER:
      return [
        {
          id: "anthropic/claude-3.7-sonnet",
          label: "Claude 3.7 Sonnet",
          badge: "Recommended",
          description: "Unified API multi-cloud routing",
          isDefault: true,
        },
        {
          id: "google/gemini-2.5-flash",
          label: "Gemini 2.5 Flash",
          badge: "Fast",
          description: "Ultra-fast multimodal model via OpenRouter",
        },
        {
          id: "meta-llama/llama-3.3-70b-instruct",
          label: "Llama 3.3 70B",
          badge: "Open Weights",
          description: "Open flagship model",
        },
      ];
    case InstanceSetting_AIProviderType.NVIDIA:
      return [
        {
          id: "meta/llama-3.1-70b-instruct",
          label: "Llama 3.1 70B",
          badge: "NIM Hosted",
          description: "High-performance inference hosted on Nvidia Cloud",
          isDefault: true,
        },
      ];
    case InstanceSetting_AIProviderType.OLLAMA:
      return [
        {
          id: "llama3.2",
          label: "Llama 3.2",
          badge: "Local",
          description: "On-device private inference",
          isDefault: true,
        },
        {
          id: "qwen2.5",
          label: "Qwen 2.5",
          badge: "Multilingual",
          description: "Multilingual on-device model",
        },
      ];
    default:
      return [];
  }
};

export const getDefaultModelForProvider = (type: InstanceSetting_AIProviderType, isSTT: boolean): string => {
  if (type === InstanceSetting_AIProviderType.CHATGPT) return "";
  const list = isSTT ? getCuratedSTTModels(type) : getCuratedLLMModels(type);
  const def = list.find((m) => m.isDefault);
  if (def) return def.id;
  if (list.length > 0) return list[0].id;
  return isSTT ? "whisper-large-v3-turbo" : "gemini-2.5-flash";
};

const toLocalProvider = (provider: InstanceSetting_AIProviderConfig): LocalAIProvider => ({
  id: provider.id,
  title: provider.title,
  type: provider.type,
  endpoint: provider.endpoint,
  apiKey: "",
  apiKeySet: provider.apiKeySet,
  apiKeyHint: provider.apiKeyHint,
  oauthAccount: provider.oauthAccount,
  oauthPlanEnabled: provider.oauthPlanEnabled,
});

const toLocalTranscription = (config: InstanceSetting_TranscriptionConfig | undefined): LocalTranscription => ({
  providerId: config?.providerId ?? "",
  model: config?.model ?? "",
  language: config?.language ?? "",
  prompt: config?.prompt ?? "",
  speakerProviderId: config?.speakerProviderId ?? "",
  speakerModel: config?.speakerModel ?? "",
});

const newProvider = (): LocalAIProvider => ({
  id: uuidv4(),
  title: "",
  type: InstanceSetting_AIProviderType.OPENAI,
  endpoint: "",
  apiKey: "",
  apiKeySet: false,
  apiKeyHint: "",
});

const toProviderConfig = (provider: LocalAIProvider) =>
  create(InstanceSetting_AIProviderConfigSchema, {
    id: provider.id,
    title: provider.title.trim(),
    type: provider.type,
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
  });

const toTranscriptionConfig = (transcription: LocalTranscription) =>
  create(InstanceSetting_TranscriptionConfigSchema, {
    providerId: transcription.providerId,
    model: transcription.model.trim(),
    language: transcription.language.trim(),
    prompt: transcription.prompt,
    speakerProviderId: transcription.speakerProviderId ?? "",
    speakerModel: transcription.speakerModel ?? "",
  });

/* -------------------------------------------------------------------------
 * Component: ConnectionTestButton
 * ------------------------------------------------------------------------- */
interface ConnectionTestButtonProps {
  provider: LocalAIProvider | undefined;
  model: string;
  capability: "LLM" | "STT";
  className?: string;
}

export const ConnectionTestButton = ({ provider, model, capability, className }: ConnectionTestButtonProps) => {
  const [testState, setTestState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [latency, setLatency] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const testGeneration = useRef(0);
  useEffect(() => {
    testGeneration.current++;
    setTestState("idle");
    setLatency(null);
    setErrorMessage("");
    return () => {
      testGeneration.current++;
    };
  }, [
    provider?.id,
    provider?.type,
    provider?.endpoint,
    provider?.apiKey,
    provider?.apiKeySet,
    provider?.oauthPlanEnabled,
    model,
    capability,
  ]);

  const handleTest = async () => {
    if (!provider) {
      toast.error("Please configure or select a provider first.");
      return;
    }

    const generation = ++testGeneration.current;
    setTestState("testing");
    setErrorMessage("");

    try {
      const resp = await aiServiceClient.testAIProvider(
        create(TestAIProviderRequestSchema, {
          providerId: provider.apiKeySet ? provider.id : "",
          providerType: !provider.apiKeySet ? InstanceSetting_AIProviderType[provider.type] : "",
          endpoint: provider.endpoint,
          apiKey: provider.apiKey,
          model: model.trim(),
          capability,
        }),
      );

      if (generation !== testGeneration.current) return;
      if (resp.success) {
        const ms = Math.max(0, Number(resp.latencyMs) || 0);
        setLatency(ms);
        setTestState("success");
        toast.success(`${capability} connection verified! (${ms}ms)`);
      } else {
        setTestState("error");
        setErrorMessage(resp.message || "Connection failed");
        toast.error(`Connection failed: ${resp.message}`);
      }
    } catch (err) {
      if (generation !== testGeneration.current) return;
      setTestState("error");
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      toast.error(`Test failed: ${msg}`);
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col items-start gap-2", className)}>
      <Button
        type="button"
        variant={testState === "success" ? "outline" : testState === "error" ? "destructive" : "outline"}
        size="sm"
        disabled={
          !provider ||
          testState === "testing" ||
          ([InstanceSetting_AIProviderType.ANTIGRAVITY, InstanceSetting_AIProviderType.CHATGPT].includes(provider.type) &&
            !provider.apiKeySet) ||
          (provider.type === InstanceSetting_AIProviderType.CHATGPT && (!provider.oauthPlanEnabled || !model))
        }
        onClick={() => void handleTest()}
        className={cn(
          "h-8 px-3 text-xs transition-all",
          testState === "success" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10",
        )}
      >
        {testState === "testing" ? (
          <>
            <LoaderCircleIcon className="size-3.5 mr-1.5 animate-spin" />
            Testing...
          </>
        ) : testState === "success" ? (
          <>
            <CheckCircle2Icon className="size-3.5 mr-1.5 text-emerald-500" />
            Connected ✓ {latency ? `(${latency}ms)` : ""}
          </>
        ) : testState === "error" ? (
          <>
            <AlertCircleIcon className="size-3.5 mr-1.5" />
            Test Failed
          </>
        ) : (
          <>
            {capability === "STT" ? <Volume2Icon className="size-3.5 mr-1.5" /> : <ZapIcon className="size-3.5 mr-1.5" />}
            {capability === "STT" ? "Check audio" : "Check AI"}
          </>
        )}
      </Button>
      {testState === "error" && errorMessage && (
        <span role="alert" className="max-w-prose text-sm leading-5 text-destructive">
          {errorMessage}
        </span>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------
 * Component: ProviderModelSelector
 * ------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------
 * Main AISection Component
 * ------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------
 * TranscriptionForm Component
 * ------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------
 * AIAssistantForm Component
 * ------------------------------------------------------------------------- */
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

/* -------------------------------------------------------------------------
 * AIProviderDialog Component
 * ------------------------------------------------------------------------- */
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

export default AISection;
