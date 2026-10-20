// Package openai implements stt.Transcriber against the OpenAI
// /audio/transcriptions endpoint (and any compatible third-party endpoint
// such as Groq Whisper, faster-whisper self-hosted, or Azure Whisper).
package openai

import (
	"context"
	"mime"
	"net/url"
	"strings"

	openaisdk "github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/pkg/errors"

	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/stt"
)

const defaultEndpoint = "https://api.openai.com/v1"

// Transcriber implements stt.Transcriber for OpenAI-compatible STT endpoints.
type Transcriber struct {
	client openaisdk.Client
}

// New constructs a Transcriber from a provider config.
func New(cfg ai.ProviderConfig, options stt.Options) (*Transcriber, error) {
	rawEndpoint := strings.TrimSpace(cfg.Endpoint)
	if rawEndpoint == "" {
		rawEndpoint = ai.DefaultEndpoint(cfg.Type)
	}
	endpoint, err := normalizeEndpoint(rawEndpoint)
	if err != nil {
		return nil, err
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		if !ai.RequiresAPIKey(cfg.Type) {
			apiKey = "local-whisper"
		} else {
			return nil, errors.New("OpenAI API key is required")
		}
	}
	return &Transcriber{
		client: openaisdk.NewClient(
			openaioption.WithAPIKey(apiKey),
			openaioption.WithBaseURL(endpoint),
			openaioption.WithHTTPClient(options.HTTPClient),
		),
	}, nil
}

// Transcribe sends the audio to /audio/transcriptions.
func (t *Transcriber) Transcribe(ctx context.Context, req stt.Request) (*stt.Response, error) {
	if strings.TrimSpace(req.Model) == "" {
		return nil, errors.New("model is required")
	}
	if req.Audio == nil {
		return nil, errors.New("audio is required")
	}

	filename, contentType, err := normalizeAudioMetadata(req)
	if err != nil {
		return nil, err
	}

	params := openaisdk.AudioTranscriptionNewParams{
		File:           openaisdk.File(req.Audio, filename, contentType),
		Model:          openaisdk.AudioModel(req.Model),
		ResponseFormat: openaisdk.AudioResponseFormatJSON,
	}
	if strings.Contains(strings.ToLower(req.Model), "whisper") {
		params.ResponseFormat = openaisdk.AudioResponseFormatVerboseJSON
		params.TimestampGranularities = []string{"segment"}
	}
	if req.Prompt != "" {
		params.Prompt = openaisdk.String(req.Prompt)
	}
	if req.Language != "" {
		params.Language = openaisdk.String(req.Language)
	}

	resp, err := t.client.Audio.Transcriptions.New(ctx, params)
	if err != nil {
		return nil, errors.Wrap(err, "failed to send OpenAI transcription request")
	}
	result := &stt.Response{
		Text:     resp.Text,
		Language: resp.Language,
	}
	filtered := false
	for _, segment := range resp.Segments {
		// Match Whisper's silence rule only when both confidence fields were
		// actually returned. Genuine short acknowledgements remain valid speech.
		if segment.JSON.NoSpeechProb.Valid() && segment.JSON.AvgLogprob.Valid() && segment.NoSpeechProb > 0.6 && segment.AvgLogprob < -1 {
			filtered = true
			continue
		}
		result.Segments = append(result.Segments, stt.Segment{Text: segment.Text, Start: segment.Start, End: segment.End})
	}
	if filtered {
		text := make([]string, 0, len(result.Segments))
		for _, segment := range result.Segments {
			if value := strings.TrimSpace(segment.Text); value != "" {
				text = append(text, value)
			}
		}
		result.Text = strings.Join(text, " ")
	}
	return result, nil
}

func normalizeEndpoint(endpoint string) (string, error) {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = defaultEndpoint
	}
	if _, err := url.ParseRequestURI(endpoint); err != nil {
		return "", errors.Wrap(err, "invalid OpenAI endpoint")
	}
	return strings.TrimRight(endpoint, "/"), nil
}

func normalizeAudioMetadata(req stt.Request) (string, string, error) {
	filename := strings.TrimSpace(req.Filename)
	contentType := strings.TrimSpace(req.ContentType)
	if contentType == "" {
		contentType = "audio/webm"
	} else {
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil {
			return "", "", errors.Wrap(err, "invalid audio content type")
		}
		contentType = mediaType
	}
	if filename == "" {
		filename = "audio"
	}
	filename = sanitizeFilename(filename)
	if !strings.Contains(filename, ".") {
		switch contentType {
		case "audio/wav", "audio/x-wav":
			filename += ".wav"
		case "audio/mp4", "audio/x-m4a", "audio/m4a":
			filename += ".m4a"
		case "audio/mpeg", "audio/mp3":
			filename += ".mp3"
		case "audio/ogg":
			filename += ".ogg"
		case "audio/flac", "audio/x-flac":
			filename += ".flac"
		default:
			filename += ".webm"
		}
	}
	return filename, contentType, nil
}

func sanitizeFilename(filename string) string {
	filename = strings.NewReplacer("\r", "_", "\n", "_").Replace(filename)
	if strings.TrimSpace(filename) == "" {
		return "audio"
	}
	return filename
}
