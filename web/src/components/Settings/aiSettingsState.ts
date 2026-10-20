import { create } from "@bufbuild/protobuf";
import { v4 as uuidv4 } from "uuid";
import {
  InstanceSetting_AIProviderConfig,
  InstanceSetting_AIProviderConfigSchema,
  InstanceSetting_AIProviderType,
  InstanceSetting_TranscriptionConfig,
  InstanceSetting_TranscriptionConfigSchema,
} from "@/types/proto/api/instance_service_pb";

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

export type LocalTranscription = {
  providerId: string;
  model: string;
  language: string;
  prompt: string;
  speakerProviderId?: string;
  speakerModel?: string;
};
export const toLocalProvider = (provider: InstanceSetting_AIProviderConfig): LocalAIProvider => ({
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

export const toLocalTranscription = (config: InstanceSetting_TranscriptionConfig | undefined): LocalTranscription => ({
  providerId: config?.providerId ?? "",
  model: config?.model ?? "",
  language: config?.language ?? "",
  prompt: config?.prompt ?? "",
  speakerProviderId: config?.speakerProviderId ?? "",
  speakerModel: config?.speakerModel ?? "",
});

export const newProvider = (): LocalAIProvider => ({
  id: uuidv4(),
  title: "",
  type: InstanceSetting_AIProviderType.OPENAI,
  endpoint: "",
  apiKey: "",
  apiKeySet: false,
  apiKeyHint: "",
});

export const toProviderConfig = (provider: LocalAIProvider) =>
  create(InstanceSetting_AIProviderConfigSchema, {
    id: provider.id,
    title: provider.title.trim(),
    type: provider.type,
    endpoint: provider.endpoint.trim(),
    apiKey: provider.apiKey,
  });

export const toTranscriptionConfig = (transcription: LocalTranscription) =>
  create(InstanceSetting_TranscriptionConfigSchema, {
    providerId: transcription.providerId,
    model: transcription.model.trim(),
    language: transcription.language.trim(),
    prompt: transcription.prompt,
    speakerProviderId: transcription.speakerProviderId ?? "",
    speakerModel: transcription.speakerModel ?? "",
  });
