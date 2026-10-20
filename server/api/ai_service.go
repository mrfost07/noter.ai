package api

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/llm"
)

func (s *APIService) resolveAIProvider(ctx context.Context, setting *storepb.InstanceAISetting, providerID string) (ai.ProviderConfig, error) {
	providers := make([]ai.ProviderConfig, 0, len(setting.GetProviders()))
	for _, provider := range setting.GetProviders() {
		if provider == nil {
			continue
		}
		providers = append(providers, convertAIProviderConfigFromStore(provider))
	}

	provider, err := ai.FindProvider(providers, providerID)
	if err != nil {
		return ai.ProviderConfig{}, status.Errorf(codes.FailedPrecondition, "transcription provider is not configured")
	}
	return s.refreshOAuthProvider(ctx, *provider)
}

func convertAIProviderConfigFromStore(provider *storepb.AIProviderConfig) ai.ProviderConfig {
	return ai.ProviderConfig{
		ID:       provider.GetId(),
		Title:    provider.GetTitle(),
		Type:     convertAIProviderTypeFromStore(provider.GetType()),
		Endpoint: provider.GetEndpoint(),
		APIKey:   provider.GetApiKey(),
	}
}

func convertAIProviderTypeFromStore(providerType storepb.AIProviderType) ai.ProviderType {
	switch providerType {
	case storepb.AIProviderType_CHATGPT:
		return ai.ProviderChatGPT
	case storepb.AIProviderType_OPENAI:
		return ai.ProviderOpenAI
	case storepb.AIProviderType_GEMINI:
		return ai.ProviderGemini
	case storepb.AIProviderType_GROQ:
		return ai.ProviderGroq
	case storepb.AIProviderType_DEEPGRAM:
		return ai.ProviderDeepgram
	case storepb.AIProviderType_ELEVENLABS:
		return ai.ProviderElevenLabs
	case storepb.AIProviderType_ANTIGRAVITY:
		return ai.ProviderAntigravity
	case storepb.AIProviderType_ANTHROPIC:
		return ai.ProviderAnthropic
	case storepb.AIProviderType_DEEPSEEK:
		return ai.ProviderDeepSeek
	case storepb.AIProviderType_OPENROUTER:
		return ai.ProviderOpenRouter
	case storepb.AIProviderType_NVIDIA:
		return ai.ProviderNVIDIA
	case storepb.AIProviderType_OLLAMA:
		return ai.ProviderOllama
	case storepb.AIProviderType_LOCAL_WHISPER:
		return ai.ProviderLocalWhisper
	case storepb.AIProviderType_AZURE_STT:
		return ai.ProviderAzureSTT
	case storepb.AIProviderType_IBM_STT:
		return ai.ProviderIBMSTT
	default:
		return ""
	}
}

// TestAIProvider tests connection and credentials for an AI provider and model.
func (s *APIService) TestAIProvider(ctx context.Context, request *apipb.TestAIProviderRequest) (*apipb.TestAIProviderResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	start := time.Now()
	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
	}

	var provider ai.ProviderConfig
	if request.GetProviderId() != "" {
		p, pErr := s.resolveAIProvider(ctx, aiSetting, request.GetProviderId())
		if pErr != nil {
			//nolint:nilerr // A failed probe is response data, so settings can display its status without a transport failure.
			return &apipb.TestAIProviderResponse{
				Success: false,
				Message: pErr.Error(),
			}, nil
		}
		provider = p
	} else if request.GetProviderType() != "" {
		provider = ai.ProviderConfig{
			ID:       "draft",
			Title:    "Draft Provider",
			Type:     ai.ProviderType(request.GetProviderType()),
			Endpoint: request.GetEndpoint(),
			APIKey:   request.GetApiKey(),
		}
	} else {
		return &apipb.TestAIProviderResponse{
			Success: false,
			Message: "provider_id or provider_type is required",
		}, nil
	}

	capability := strings.ToUpper(strings.TrimSpace(request.GetCapability()))
	if capability == "STT" {
		model := strings.TrimSpace(request.GetModel())
		if model == "" {
			if def, mErr := ai.DefaultTranscriptionModel(provider.Type); mErr == nil {
				model = def
			}
		}
		silentWAV := generateSilentWAVBytes(16000, 500)
		persisted := aiSetting.GetTranscription()
		var text string
		switch provider.Type {
		case ai.ProviderOpenAI, ai.ProviderGroq, ai.ProviderNVIDIA, ai.ProviderLocalWhisper:
			text, err = s.transcribeViaSTT(ctx, provider, persisted, model, silentWAV, "test.wav", "audio/wav")
		case ai.ProviderGemini:
			text, err = s.transcribeViaAudioLLM(ctx, provider, persisted, model, silentWAV, "audio/wav")
		case ai.ProviderAntigravity:
			text, err = s.transcribeViaAntigravity(ctx, provider, persisted, model, silentWAV, "audio/wav")
		case ai.ProviderDeepgram, ai.ProviderElevenLabs, ai.ProviderAzureSTT, ai.ProviderIBMSTT:
			text, err = s.transcribeViaMultiSTT(ctx, provider, persisted, model, silentWAV, "test.wav", "audio/wav")
		default:
			return &apipb.TestAIProviderResponse{
				Success: false,
				Message: fmt.Sprintf("provider type %s does not support speech transcription", provider.Type),
			}, nil
		}
		latency := time.Since(start).Milliseconds()
		if err != nil {
			//nolint:nilerr // Provider failure is the probe result; authentication and server failures still use transport errors.
			return &apipb.TestAIProviderResponse{
				Success:   false,
				Message:   err.Error(),
				LatencyMs: latency,
			}, nil
		}
		_ = text
		return &apipb.TestAIProviderResponse{
			Success:   true,
			Message:   fmt.Sprintf("Transcription connected successfully (%dms)", latency),
			LatencyMs: latency,
		}, nil
	}

	// Default: Test LLM
	model := strings.TrimSpace(request.GetModel())
	if model == "" {
		if def, mErr := ai.DefaultLLMModel(provider.Type); mErr == nil {
			model = def
		}
	}

	client, err := llm.New(provider, nil)
	if err != nil {
		//nolint:nilerr // Invalid provider configuration is returned as a structured failed connection test.
		return &apipb.TestAIProviderResponse{
			Success: false,
			Message: err.Error(),
		}, nil
	}

	genResp, err := client.Generate(ctx, llm.Request{
		Model:       model,
		UserPrompt:  "Ping test. Reply with 'pong'.",
		Temperature: 0.1,
	})
	latency := time.Since(start).Milliseconds()
	if err != nil {
		//nolint:nilerr // Preserve the connection-test response contract, including provider diagnostics and latency.
		return &apipb.TestAIProviderResponse{
			Success:   false,
			Message:   err.Error(),
			LatencyMs: latency,
		}, nil
	}
	_ = genResp
	return &apipb.TestAIProviderResponse{
		Success:   true,
		Message:   fmt.Sprintf("Connected successfully (%dms)", latency),
		LatencyMs: latency,
	}, nil
}

// FetchAvailableModels dynamically retrieves available models with live quota and capability information.
func (s *APIService) FetchAvailableModels(ctx context.Context, request *apipb.FetchAvailableModelsRequest) (*apipb.FetchAvailableModelsResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}

	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
	}

	provider, err := s.resolveAIProvider(ctx, aiSetting, request.GetProviderId())
	if err != nil {
		for _, saved := range aiSetting.GetProviders() {
			if saved.Id == request.GetProviderId() {
				return nil, err
			}
		}
		// Fallback to default catalog based on provider type if provider ID matches type
		//nolint:nilerr // Catalog lookup intentionally supports provider-type fallback without a configured provider ID.
		return &apipb.FetchAvailableModelsResponse{
			Models: getDefaultModelCatalog(ai.ProviderType(strings.ToUpper(request.GetProviderId()))),
		}, nil
	}

	if provider.Type == ai.ProviderChatGPT {
		var credentials llm.ChatGPTCredentials
		if json.Unmarshal([]byte(provider.APIKey), &credentials) != nil {
			return nil, status.Error(codes.FailedPrecondition, "Connect ChatGPT first.")
		}
		models, err := llm.FetchChatGPTModels(ctx, s.aiOAuthHTTPClient, credentials)
		if err != nil {
			return nil, status.Error(codes.FailedPrecondition, err.Error())
		}
		result := make([]*apipb.ModelInfo, 0, len(models))
		for _, model := range models {
			result = append(result, &apipb.ModelInfo{Id: model.ID, Label: model.Label, Description: "Available to your ChatGPT account", RemainingQuota: -1})
		}
		return &apipb.FetchAvailableModelsResponse{Models: result}, nil
	}
	if provider.Type == ai.ProviderAntigravity {
		var creds llm.AntigravityOAuthCredentials
		if strings.HasPrefix(strings.TrimSpace(provider.APIKey), "{") {
			_ = json.Unmarshal([]byte(provider.APIKey), &creds)
		}
		if creds.AccessToken != "" {
			models, fErr := llm.FetchAntigravityModels(ctx, nil, creds.AccessToken, creds.ProjectID)
			if fErr == nil && len(models) > 0 {
				res := make([]*apipb.ModelInfo, 0, len(models))
				for _, m := range models {
					isDef := m.ID == "gemini-2.5-flash"
					desc := "Account model · quota not reported"
					if m.RemainingQuota >= 0 {
						desc = fmt.Sprintf("%.0f%% quota remaining", m.RemainingQuota*100)
					}
					if m.ID == "gemini-2.5-flash" {
						desc = "Recommended · 1M context · " + desc
					}
					res = append(res, &apipb.ModelInfo{
						Id:             m.ID,
						Label:          m.Label,
						Description:    desc,
						RemainingQuota: m.RemainingQuota,
						IsDefault:      isDef,
					})
				}
				return &apipb.FetchAvailableModelsResponse{Models: res}, nil
			}
		}
	}

	// Fallback/curated catalog for provider type
	return &apipb.FetchAvailableModelsResponse{
		Models: getDefaultModelCatalog(provider.Type),
	}, nil
}

func generateSilentWAVBytes(sampleRate, durationMs int) []byte {
	numChannels := 1
	bytesPerSample := 2
	numSamples := (sampleRate * durationMs) / 1000
	dataSize := numSamples * numChannels * bytesPerSample
	fileSize := 36 + dataSize

	buf := make([]byte, 44+dataSize)
	copy(buf[0:4], "RIFF")
	buf[4] = byte(fileSize)
	buf[5] = byte(fileSize >> 8)
	buf[6] = byte(fileSize >> 16)
	buf[7] = byte(fileSize >> 24)
	copy(buf[8:12], "WAVE")

	copy(buf[12:16], "fmt ")
	buf[16] = 16
	buf[20] = 1
	buf[22] = byte(numChannels)
	buf[24] = byte(sampleRate)
	buf[25] = byte(sampleRate >> 8)
	buf[26] = byte(sampleRate >> 16)
	buf[27] = byte(sampleRate >> 24)
	byteRate := sampleRate * numChannels * bytesPerSample
	buf[28] = byte(byteRate)
	buf[29] = byte(byteRate >> 8)
	buf[30] = byte(byteRate >> 16)
	buf[31] = byte(byteRate >> 24)
	blockAlign := numChannels * bytesPerSample
	buf[32] = byte(blockAlign)
	buf[34] = 16

	copy(buf[36:40], "data")
	buf[40] = byte(dataSize)
	buf[41] = byte(dataSize >> 8)
	buf[42] = byte(dataSize >> 16)
	buf[43] = byte(dataSize >> 24)
	return buf
}

func getDefaultModelCatalog(providerType ai.ProviderType) []*apipb.ModelInfo {
	switch providerType {
	case ai.ProviderAntigravity:
		return []*apipb.ModelInfo{
			{Id: "gemini-2.5-flash", Label: "Gemini 2.5 Flash", Description: "Recommended · Ultra fast speech & audio reasoning · 1M context", RemainingQuota: -1, IsDefault: true},
			{Id: "gemini-2.5-pro", Label: "Gemini 2.5 Pro", Description: "Deep reasoning & complex multimodal analysis", RemainingQuota: -1},
			{Id: "claude-sonnet-4-6", Label: "Claude Sonnet 4.6", Description: "Anthropic Claude reasoning via Antigravity", RemainingQuota: -1},
		}
	case ai.ProviderGroq:
		return []*apipb.ModelInfo{
			{Id: "whisper-large-v3-turbo", Label: "Whisper V3 Turbo", Description: "Fastest · Low-latency speech transcription", RemainingQuota: -1, IsDefault: true},
			{Id: "whisper-large-v3", Label: "Whisper V3", Description: "Most Accurate · High-quality multilingual transcription", RemainingQuota: -1},
			{Id: "llama-3.3-70b-versatile", Label: "Llama 3.3 70B Versatile", Description: "Fast open flagship LLM for meeting analysis", RemainingQuota: -1, IsDefault: true},
			{Id: "llama-3.1-8b-instant", Label: "Llama 3.1 8B Instant", Description: "Instant ultra-low latency LLM", RemainingQuota: -1},
		}
	case ai.ProviderOpenAI:
		return []*apipb.ModelInfo{
			{Id: "whisper-1", Label: "Whisper 1", Description: "Standard OpenAI speech-to-text model", RemainingQuota: -1, IsDefault: true},
			{Id: "gpt-4o", Label: "GPT-4o", Description: "Flagship multimodal intelligence model", RemainingQuota: -1, IsDefault: true},
			{Id: "gpt-4o-mini", Label: "GPT-4o Mini", Description: "Fast, cost-efficient intelligence model", RemainingQuota: -1},
			{Id: "o3-mini", Label: "o3-mini", Description: "Fast reasoning model for math and code", RemainingQuota: -1},
		}
	case ai.ProviderDeepgram:
		return []*apipb.ModelInfo{
			{Id: "nova-3", Label: "Nova-3", Description: "Fastest & highest accuracy with 300ms endpointing", RemainingQuota: -1, IsDefault: true},
			{Id: "nova-2", Label: "Nova-2", Description: "Proven low-latency speech model", RemainingQuota: -1},
			{Id: "nova-2-meeting", Label: "Nova-2 Meeting", Description: "Tuned for multi-speaker conferences and meetings", RemainingQuota: -1},
		}
	case ai.ProviderElevenLabs:
		return []*apipb.ModelInfo{
			{Id: "scribe_v1", Label: "Scribe v1", Description: "High-accuracy audio transcription", RemainingQuota: -1, IsDefault: true},
			{Id: "scribe_v2", Label: "Scribe v2 Realtime", Description: "Streaming real-time speech transcription", RemainingQuota: -1},
		}
	case ai.ProviderNVIDIA:
		return []*apipb.ModelInfo{
			{Id: "nemotron-asr-streaming", Label: "Nemotron Streaming", Description: "Low-latency Nemotron streaming ASR", RemainingQuota: -1, IsDefault: true},
			{Id: "nvidia/parakeet-ctc-1.1b-asr", Label: "Parakeet CTC 1.1B", Description: "Fast English ASR model", RemainingQuota: -1},
			{Id: "meta/llama-3.1-70b-instruct", Label: "Llama 3.1 70B Instruct", Description: "NVIDIA NIM high performance LLM", RemainingQuota: -1},
		}
	case ai.ProviderAnthropic:
		return []*apipb.ModelInfo{
			{Id: "claude-3-7-sonnet-latest", Label: "Claude 3.7 Sonnet", Description: "Hybrid reasoning and coding model", RemainingQuota: -1, IsDefault: true},
			{Id: "claude-3-5-sonnet-20241022", Label: "Claude 3.5 Sonnet", Description: "High-capability analysis and reasoning", RemainingQuota: -1},
			{Id: "claude-3-5-haiku-20241022", Label: "Claude 3.5 Haiku", Description: "Fast and lightweight assistant model", RemainingQuota: -1},
		}
	case ai.ProviderDeepSeek:
		return []*apipb.ModelInfo{
			{Id: "deepseek-chat", Label: "DeepSeek-V3", Description: "General reasoning and assistant chat", RemainingQuota: -1, IsDefault: true},
			{Id: "deepseek-reasoner", Label: "DeepSeek-R1", Description: "Chain-of-thought deep reasoning model", RemainingQuota: -1},
		}
	case ai.ProviderOpenRouter:
		return []*apipb.ModelInfo{
			{Id: "anthropic/claude-3.7-sonnet", Label: "Claude 3.7 Sonnet", Description: "Top-tier hybrid reasoning model", RemainingQuota: -1, IsDefault: true},
			{Id: "google/gemini-2.5-flash", Label: "Gemini 2.5 Flash", Description: "Ultra-fast multimodal model via OpenRouter", RemainingQuota: -1},
			{Id: "meta-llama/llama-3.3-70b-instruct", Label: "Llama 3.3 70B", Description: "Open weight flagship LLM", RemainingQuota: -1},
		}
	case ai.ProviderOllama:
		return []*apipb.ModelInfo{
			{Id: "llama3.2", Label: "Llama 3.2", Description: "Lightweight on-device local model", RemainingQuota: -1, IsDefault: true},
			{Id: "qwen2.5", Label: "Qwen 2.5", Description: "Multilingual on-device local model", RemainingQuota: -1},
		}
	case ai.ProviderLocalWhisper:
		return []*apipb.ModelInfo{
			{Id: "whisper-large-v3-turbo", Label: "Whisper V3 Turbo (Local)", Description: "Fastest on-device private inference", RemainingQuota: -1, IsDefault: true},
			{Id: "whisper-base", Label: "Whisper Base (Local)", Description: "Lightweight on-device speech model", RemainingQuota: -1},
		}
	default:
		return nil
	}
}
