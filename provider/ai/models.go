package ai

import "github.com/pkg/errors"

const (
	// DefaultOpenAITranscriptionModel is the built-in OpenAI transcription model.
	DefaultOpenAITranscriptionModel = "whisper-1"
	// DefaultGeminiTranscriptionModel is the built-in Gemini transcription model.
	DefaultGeminiTranscriptionModel = "gemini-2.5-flash"
	// DefaultGroqTranscriptionModel is the built-in Groq Whisper transcription model.
	DefaultGroqTranscriptionModel = "whisper-large-v3-turbo"
	// DefaultDeepgramTranscriptionModel is the built-in Deepgram transcription model.
	DefaultDeepgramTranscriptionModel = "nova-3"
	// DefaultElevenLabsTranscriptionModel is the built-in ElevenLabs Scribe transcription model.
	DefaultElevenLabsTranscriptionModel = "scribe_v1"
	// DefaultNVIDIATranscriptionModel is the built-in NVIDIA NIM transcription model.
	DefaultNVIDIATranscriptionModel = "nvidia/parakeet-ctc-1.1b"
	// DefaultLocalWhisperTranscriptionModel is the built-in local Whisper transcription model.
	DefaultLocalWhisperTranscriptionModel = "whisper-large-v3-turbo"
	// DefaultAzureTranscriptionModel is the built-in Azure Speech model identifier.
	DefaultAzureTranscriptionModel = "conversation"
	// DefaultIBMTranscriptionModel is the built-in IBM Watson STT model identifier.
	DefaultIBMTranscriptionModel = "en-US_Multimedia"
)

// DefaultTranscriptionModel returns the built-in transcription model for a provider.
func DefaultTranscriptionModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderOpenAI:
		return DefaultOpenAITranscriptionModel, nil
	case ProviderGemini, ProviderAntigravity:
		return DefaultGeminiTranscriptionModel, nil
	case ProviderGroq:
		return DefaultGroqTranscriptionModel, nil
	case ProviderDeepgram:
		return DefaultDeepgramTranscriptionModel, nil
	case ProviderElevenLabs:
		return DefaultElevenLabsTranscriptionModel, nil
	case ProviderNVIDIA:
		return DefaultNVIDIATranscriptionModel, nil
	case ProviderLocalWhisper:
		return DefaultLocalWhisperTranscriptionModel, nil
	case ProviderAzureSTT:
		return DefaultAzureTranscriptionModel, nil
	case ProviderIBMSTT:
		return DefaultIBMTranscriptionModel, nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q", providerType)
	}
}

// DefaultLLMModel returns the built-in LLM text/JSON generation model for a provider.
func DefaultLLMModel(providerType ProviderType) (string, error) {
	switch providerType {
	case ProviderOpenAI:
		return "gpt-4o-mini", nil
	case ProviderGemini, ProviderAntigravity:
		return "gemini-2.5-flash", nil
	case ProviderAnthropic:
		return "claude-3-7-sonnet-latest", nil
	case ProviderGroq:
		return "llama-3.3-70b-versatile", nil
	case ProviderDeepSeek:
		return "deepseek-chat", nil
	case ProviderOpenRouter:
		return "google/gemini-2.5-flash", nil
	case ProviderNVIDIA:
		return "meta/llama-3.1-70b-instruct", nil
	case ProviderOllama:
		return "llama3.2", nil
	default:
		return "", errors.Wrapf(ErrCapabilityUnsupported, "provider type %q does not support LLM generation", providerType)
	}
}
