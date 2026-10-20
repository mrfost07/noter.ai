package ai

import (
	"net/url"
	"strings"

	"github.com/pkg/errors"
)

// ProviderType identifies an AI provider implementation.
type ProviderType string

const (
	// ProviderOpenAI is OpenAI's hosted API.
	ProviderOpenAI ProviderType = "OPENAI"
	// ProviderChatGPT uses the account's authorized ChatGPT plan through the Responses API.
	ProviderChatGPT ProviderType = "CHATGPT"
	// ProviderGemini is Google's Gemini API.
	ProviderGemini ProviderType = "GEMINI"
	// ProviderGroq is Groq's OpenAI-compatible API.
	ProviderGroq ProviderType = "GROQ"
	// ProviderDeepgram is Deepgram's Speech-to-Text API.
	ProviderDeepgram ProviderType = "DEEPGRAM"
	// ProviderElevenLabs is ElevenLabs' Scribe Speech-to-Text API.
	ProviderElevenLabs ProviderType = "ELEVENLABS"
	// ProviderAntigravity is Google Antigravity's CloudCode OAuth API.
	ProviderAntigravity ProviderType = "ANTIGRAVITY"
	// ProviderAnthropic is Anthropic's Claude Messages API.
	ProviderAnthropic ProviderType = "ANTHROPIC"
	// ProviderDeepSeek is DeepSeek's OpenAI-compatible API.
	ProviderDeepSeek ProviderType = "DEEPSEEK"
	// ProviderOpenRouter is OpenRouter's OpenAI-compatible API.
	ProviderOpenRouter ProviderType = "OPENROUTER"
	// ProviderNVIDIA is NVIDIA NIM's OpenAI-compatible API.
	ProviderNVIDIA ProviderType = "NVIDIA"
	// ProviderOllama is a local Ollama OpenAI-compatible API.
	ProviderOllama ProviderType = "OLLAMA"
	// ProviderLocalWhisper is a local Faster-Whisper / Whisper ONNX OpenAI-compatible STT API.
	ProviderLocalWhisper ProviderType = "LOCAL_WHISPER"
	// ProviderAzureSTT is Microsoft Azure Speech-to-Text REST API.
	ProviderAzureSTT ProviderType = "AZURE_STT"
	// ProviderIBMSTT is IBM Watson Speech-to-Text REST API.
	ProviderIBMSTT ProviderType = "IBM_STT"
)

// ProviderConfig configures a callable AI provider connection.
type ProviderConfig struct {
	ID       string
	Title    string
	Type     ProviderType
	Endpoint string
	APIKey   string
}

// RequiresAPIKey reports whether a provider type requires a non-empty API key or OAuth token.
// Local self-hosted providers (Ollama and Local Whisper) may operate without an API key.
func RequiresAPIKey(providerType ProviderType) bool {
	switch providerType {
	case ProviderOllama, ProviderLocalWhisper:
		return false
	default:
		return true
	}
}

// DefaultEndpoint returns the default endpoint for a provider type.
func DefaultEndpoint(providerType ProviderType) string {
	switch providerType {
	case ProviderOpenAI, ProviderChatGPT:
		return "https://api.openai.com/v1"
	case ProviderGemini:
		return "https://generativelanguage.googleapis.com/v1beta"
	case ProviderGroq:
		return "https://api.groq.com/openai/v1"
	case ProviderDeepgram:
		return "https://api.deepgram.com/v1/listen"
	case ProviderElevenLabs:
		return "https://api.elevenlabs.io/v1/speech-to-text"
	case ProviderAntigravity:
		return "https://cloudcode-pa.googleapis.com/v1internal:generateContent"
	case ProviderAnthropic:
		return "https://api.anthropic.com/v1/messages"
	case ProviderDeepSeek:
		return "https://api.deepseek.com/v1"
	case ProviderOpenRouter:
		return "https://openrouter.ai/api/v1"
	case ProviderNVIDIA:
		return "https://integrate.api.nvidia.com/v1"
	case ProviderOllama:
		return "http://127.0.0.1:11434/v1"
	case ProviderLocalWhisper:
		return "http://127.0.0.1:8000/v1"
	default:
		return ""
	}
}

// ValidateEndpoint validates that a custom provider endpoint uses http or https and has a valid host.
// For AZURE_STT, a plain region identifier (e.g. "eastus") or an https:// URL is accepted.
func ValidateEndpoint(providerType ProviderType, endpoint string) error {
	endpoint = strings.TrimSpace(endpoint)
	if providerType == ProviderChatGPT && endpoint != "" && endpoint != DefaultEndpoint(ProviderChatGPT) {
		return errors.New("ChatGPT connections use the official OpenAI Responses API endpoint")
	}
	if endpoint == "" {
		return nil
	}
	if providerType == ProviderAzureSTT && !strings.Contains(endpoint, "://") {
		for _, r := range endpoint {
			if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') && (r < '0' || r > '9') && r != '-' {
				return errors.New("invalid Azure Speech region identifier")
			}
		}
		return nil
	}
	parsed, err := url.ParseRequestURI(endpoint)
	if err != nil {
		return errors.Wrap(err, "invalid provider endpoint URL")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return errors.Errorf("unsupported endpoint URL scheme %q; must be http or https", parsed.Scheme)
	}
	if strings.TrimSpace(parsed.Host) == "" {
		return errors.New("provider endpoint URL must include a host")
	}
	return nil
}
