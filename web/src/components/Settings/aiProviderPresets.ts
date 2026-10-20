import { InstanceSetting_AIProviderType } from "@/types/proto/api/instance_service_pb";

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
