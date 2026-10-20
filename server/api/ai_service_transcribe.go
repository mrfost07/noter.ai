package api

import (
	"bytes"
	"context"
	"mime"
	"net/http"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/ratelimit"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/audiollm"
	audiollmgemini "github.com/usememos/memos/provider/ai/audiollm/gemini"
	"github.com/usememos/memos/provider/ai/llm"
	"github.com/usememos/memos/provider/ai/stt"
	"github.com/usememos/memos/provider/ai/stt/multistt"
	sttopenai "github.com/usememos/memos/provider/ai/stt/openai"
)

const (
	maxTranscriptionAudioSizeBytes = 25 * MebiByte
	maxTranscriptionFilenameLength = 255
)

var supportedTranscriptionContentTypes = map[string]bool{
	"audio/aac":    true,
	"audio/aiff":   true,
	"audio/flac":   true,
	"audio/mpeg":   true,
	"audio/mp3":    true,
	"audio/mp4":    true,
	"audio/mpga":   true,
	"audio/ogg":    true,
	"audio/wav":    true,
	"audio/x-wav":  true,
	"audio/x-flac": true,
	"audio/x-m4a":  true,
	"audio/webm":   true,
	"video/mp4":    true,
	"video/mpeg":   true,
	"video/webm":   true,
}

// Transcribe transcribes an audio file using an instance AI provider.
func (s *APIService) Transcribe(ctx context.Context, request *apipb.TranscribeRequest) (*apipb.TranscribeResponse, error) {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user: %v", err)
	}
	if user == nil {
		return nil, status.Errorf(codes.Unauthenticated, "user not authenticated")
	}
	if err := s.throttleAndCharge(ratelimit.ScopeTranscribeUser, userKey(user.ID), 1); err != nil {
		return nil, err
	}

	if request.Audio == nil {
		return nil, status.Errorf(codes.InvalidArgument, "audio is required")
	}
	if request.Audio.GetUri() != "" {
		return nil, status.Errorf(codes.InvalidArgument, "audio uri is not supported")
	}
	content := request.Audio.GetContent()
	if len(content) == 0 {
		return nil, status.Errorf(codes.InvalidArgument, "audio content is required")
	}
	if len(content) > maxTranscriptionAudioSizeBytes {
		return nil, status.Errorf(codes.InvalidArgument, "audio file is too large; maximum size is 25 MiB")
	}
	filename := strings.TrimSpace(request.Audio.GetFilename())
	if len(filename) > maxTranscriptionFilenameLength {
		return nil, status.Errorf(codes.InvalidArgument, "filename is too long; maximum length is %d characters", maxTranscriptionFilenameLength)
	}
	contentType := strings.TrimSpace(request.Audio.GetContentType())
	if contentType == "" {
		contentType = http.DetectContentType(content)
	}
	if !isSupportedTranscriptionContentType(contentType) {
		return nil, status.Errorf(codes.InvalidArgument, "audio content type %q is not supported", contentType)
	}

	aiSetting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get AI setting: %v", err)
	}
	persisted := aiSetting.GetTranscription()

	providerID := strings.TrimSpace(request.GetProviderId())
	if providerID == "" {
		if request.GetDiarize() {
			providerID = persisted.GetSpeakerProviderId()
		} else {
			providerID = persisted.GetProviderId()
		}
	}
	if providerID == "" {
		return nil, status.Errorf(codes.FailedPrecondition, "transcription is not configured")
	}

	provider, err := s.resolveAIProvider(ctx, aiSetting, providerID)
	if err != nil {
		return nil, err
	}

	model := strings.TrimSpace(request.GetModel())
	if model == "" {
		if request.GetDiarize() {
			model = persisted.GetSpeakerModel()
		} else {
			model = persisted.GetModel()
		}
	}
	if model == "" {
		defaultModel, err := ai.DefaultTranscriptionModel(provider.Type)
		if err != nil {
			return nil, status.Errorf(codes.InvalidArgument, "%v", err)
		}
		model = defaultModel
	}

	if request.GetDiarize() {
		if provider.Type != ai.ProviderDeepgram && provider.Type != ai.ProviderElevenLabs {
			return nil, status.Errorf(codes.FailedPrecondition, "speaker recognition requires Deepgram or ElevenLabs; Groq Whisper remains available for live transcription")
		}
		transcriber, err := multistt.New(provider, stt.ApplyOptions(nil))
		if err != nil {
			return nil, status.Errorf(codes.FailedPrecondition, "failed to initialize speaker recognition: %v", err)
		}
		result, err := transcriber.Transcribe(ctx, stt.Request{
			Audio: bytes.NewReader(content), Size: int64(len(content)), Filename: filename, ContentType: contentType,
			Model: model, Language: persisted.GetLanguage(), Diarize: true,
		})
		if err != nil {
			s.refund(ratelimit.ScopeTranscribeUser, userKey(user.ID), 1)
			return nil, status.Errorf(codes.Internal, "speaker recognition failed: %v", err)
		}
		response := &apipb.TranscribeResponse{Text: result.Text}
		for _, turn := range result.Segments {
			response.Segments = append(response.Segments, &apipb.TranscriptionSegment{Text: turn.Text, Start: turn.Start, End: turn.End, Speaker: turn.Speaker})
		}
		return response, nil
	}
	var text string
	switch provider.Type {
	case ai.ProviderOpenAI, ai.ProviderGroq, ai.ProviderNVIDIA, ai.ProviderLocalWhisper:
		transcriber, initErr := sttopenai.New(provider, stt.ApplyOptions(nil))
		if initErr != nil {
			return nil, status.Errorf(codes.FailedPrecondition, "failed to create transcriber: %v", initErr)
		}
		result, sttErr := transcriber.Transcribe(ctx, stt.Request{Audio: bytes.NewReader(content), Size: int64(len(content)), Filename: filename, ContentType: contentType, Model: model, Prompt: persisted.GetPrompt(), Language: persisted.GetLanguage()})
		if sttErr != nil {
			err = sttErr
			break
		}
		response := &apipb.TranscribeResponse{Text: result.Text}
		for _, segment := range result.Segments {
			response.Segments = append(response.Segments, &apipb.TranscriptionSegment{Text: segment.Text, Start: segment.Start, End: segment.End})
		}
		return response, nil
	case ai.ProviderGemini:
		text, err = s.transcribeViaAudioLLM(ctx, provider, persisted, model, content, contentType)
	case ai.ProviderAntigravity:
		text, err = s.transcribeViaAntigravity(ctx, provider, persisted, model, content, contentType)
	case ai.ProviderDeepgram, ai.ProviderElevenLabs, ai.ProviderAzureSTT, ai.ProviderIBMSTT:
		text, err = s.transcribeViaMultiSTT(ctx, provider, persisted, model, content, filename, contentType)
	default:
		return nil, status.Errorf(codes.FailedPrecondition,
			"provider type %q is not supported for transcription", provider.Type)
	}
	if err != nil {
		s.refund(ratelimit.ScopeTranscribeUser, userKey(user.ID), 1)
		return nil, status.Errorf(codes.Internal, "failed to transcribe audio: %v", err)
	}
	return &apipb.TranscribeResponse{Text: text}, nil
}

func (*APIService) transcribeViaSTT(
	ctx context.Context,
	provider ai.ProviderConfig,
	persisted *storepb.TranscriptionConfig,
	model string,
	content []byte,
	filename string,
	contentType string,
) (string, error) {
	transcriber, err := sttopenai.New(provider, stt.ApplyOptions(nil))
	if err != nil {
		return "", errors.Wrap(err, "failed to create STT transcriber")
	}
	resp, err := transcriber.Transcribe(ctx, stt.Request{
		Audio:       bytes.NewReader(content),
		Size:        int64(len(content)),
		Filename:    filename,
		ContentType: contentType,
		Model:       model,
		Prompt:      persisted.GetPrompt(),
		Language:    persisted.GetLanguage(),
	})
	if err != nil {
		return "", err
	}
	return resp.Text, nil
}

func (*APIService) transcribeViaMultiSTT(
	ctx context.Context,
	provider ai.ProviderConfig,
	persisted *storepb.TranscriptionConfig,
	model string,
	content []byte,
	filename string,
	contentType string,
) (string, error) {
	transcriber, err := multistt.New(provider, stt.ApplyOptions(nil))
	if err != nil {
		return "", errors.Wrap(err, "failed to create multi-STT transcriber")
	}
	resp, err := transcriber.Transcribe(ctx, stt.Request{
		Audio:       bytes.NewReader(content),
		Size:        int64(len(content)),
		Filename:    filename,
		ContentType: contentType,
		Model:       model,
		Prompt:      persisted.GetPrompt(),
		Language:    persisted.GetLanguage(),
	})
	if err != nil {
		return "", err
	}
	return resp.Text, nil
}

func (*APIService) transcribeViaAudioLLM(
	ctx context.Context,
	provider ai.ProviderConfig,
	persisted *storepb.TranscriptionConfig,
	model string,
	content []byte,
	contentType string,
) (string, error) {
	m, err := audiollmgemini.New(provider, audiollm.ApplyOptions(nil))
	if err != nil {
		return "", errors.Wrap(err, "failed to create audio LLM")
	}
	resp, err := m.GenerateFromAudio(ctx, audiollm.Request{
		Audio:        bytes.NewReader(content),
		Size:         int64(len(content)),
		ContentType:  contentType,
		Model:        model,
		Instructions: buildTranscriptionInstructions(persisted.GetPrompt(), persisted.GetLanguage()),
	})
	if err != nil {
		return "", err
	}
	if resp.FinishReason != audiollm.FinishStop {
		return "", errors.Errorf("transcription incomplete (finish reason: %s)", resp.FinishReason)
	}
	if strings.TrimSpace(resp.Text) == "" {
		return "", errors.New("transcription response did not include text")
	}
	return resp.Text, nil
}

func (*APIService) transcribeViaAntigravity(
	ctx context.Context,
	provider ai.ProviderConfig,
	persisted *storepb.TranscriptionConfig,
	model string,
	content []byte,
	contentType string,
) (string, error) {
	client, err := llm.New(provider, nil)
	if err != nil {
		return "", errors.Wrap(err, "failed to create Antigravity client")
	}
	prompt := ""
	if persisted != nil {
		prompt = buildTranscriptionInstructions(persisted.GetPrompt(), persisted.GetLanguage())
	}
	resp, err := client.Generate(ctx, llm.Request{
		Model:            model,
		UserPrompt:       prompt,
		AudioContent:     content,
		AudioContentType: contentType,
		Temperature:      0.0,
	})
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(resp.Text), nil
}

func buildTranscriptionInstructions(prompt, language string) string {
	parts := []string{
		"Transcribe the audio accurately. Return only the transcript text. " +
			"Do not summarize, explain, or add content that is not spoken.",
	}
	if language = strings.TrimSpace(language); language != "" {
		parts = append(parts, "The input language is "+language+".")
	}
	if prompt = strings.TrimSpace(prompt); prompt != "" {
		parts = append(parts, "Context and spelling hints:\n"+prompt)
	}
	return strings.Join(parts, "\n\n")
}

func isSupportedTranscriptionContentType(contentType string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil {
		return false
	}
	mediaType = strings.ToLower(mediaType)
	return supportedTranscriptionContentTypes[mediaType]
}
