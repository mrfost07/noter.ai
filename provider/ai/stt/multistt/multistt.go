// Package multistt implements stt.Transcriber for Deepgram, ElevenLabs Scribe,
// Microsoft Azure Speech, and IBM Watson Speech-to-Text REST APIs.
package multistt

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/stt"
)

const maxErrorBodyBytes = 4096

// Transcriber implements stt.Transcriber for Deepgram, ElevenLabs, Azure Speech, and IBM Watson.
type Transcriber struct {
	cfg        ai.ProviderConfig
	httpClient *http.Client
}

// New constructs a multi-provider REST Transcriber.
func New(cfg ai.ProviderConfig, options stt.Options) (*Transcriber, error) {
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.Errorf("%s API key is required", cfg.Type)
	}
	if err := ai.ValidateEndpoint(cfg.Type, cfg.Endpoint); err != nil {
		return nil, err
	}
	client := options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &Transcriber{
		cfg:        cfg,
		httpClient: client,
	}, nil
}

// Transcribe routes the audio request to the configured STT provider.
func (t *Transcriber) Transcribe(ctx context.Context, req stt.Request) (*stt.Response, error) {
	if req.Audio == nil {
		return nil, errors.New("audio is required")
	}
	switch t.cfg.Type {
	case ai.ProviderDeepgram:
		return t.transcribeDeepgram(ctx, req)
	case ai.ProviderElevenLabs:
		return t.transcribeElevenLabs(ctx, req)
	case ai.ProviderAzureSTT:
		return t.transcribeAzure(ctx, req)
	case ai.ProviderIBMSTT:
		return t.transcribeIBM(ctx, req)
	default:
		return nil, errors.Errorf("unsupported multi-stt provider type %q", t.cfg.Type)
	}
}

func (t *Transcriber) transcribeDeepgram(ctx context.Context, req stt.Request) (*stt.Response, error) {
	endpoint := strings.TrimSpace(t.cfg.Endpoint)
	if endpoint == "" {
		endpoint = ai.DefaultEndpoint(ai.ProviderDeepgram)
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = ai.DefaultDeepgramTranscriptionModel
	}

	u, err := url.Parse(endpoint)
	if err != nil {
		return nil, errors.Wrap(err, "invalid Deepgram endpoint")
	}
	q := u.Query()
	q.Set("model", model)
	q.Set("smart_format", "true")
	q.Set("punctuate", "true")
	if req.Diarize {
		q.Set("diarize", "true")
		q.Set("utterances", "true")
	}
	if lang := strings.TrimSpace(req.Language); lang != "" {
		q.Set("language", lang)
	}
	u.RawQuery = q.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), req.Audio)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Deepgram request")
	}
	contentType := normalizeMediaType(req.ContentType, "audio/wav")
	httpReq.Header.Set("Content-Type", contentType)
	httpReq.Header.Set("Authorization", "Token "+t.cfg.APIKey)
	if req.Size > 0 && httpReq.ContentLength <= 0 {
		httpReq.ContentLength = req.Size
	}

	resp, err := t.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "Deepgram HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("Deepgram error (%d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Results struct {
			Utterances []struct {
				Transcript string  `json:"transcript"`
				Start      float64 `json:"start"`
				End        float64 `json:"end"`
				Speaker    *int    `json:"speaker"`
			} `json:"utterances"`
			Channels []struct {
				Alternatives []struct {
					Transcript string `json:"transcript"`
				} `json:"alternatives"`
			} `json:"channels"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode Deepgram response")
	}

	var text string
	if len(result.Results.Channels) > 0 && len(result.Results.Channels[0].Alternatives) > 0 {
		text = strings.TrimSpace(result.Results.Channels[0].Alternatives[0].Transcript)
	}
	response := &stt.Response{Text: text, Language: req.Language}
	if req.Diarize {
		for _, turn := range result.Results.Utterances {
			speaker := ""
			if turn.Speaker != nil {
				speaker = fmt.Sprint(*turn.Speaker)
			}
			response.Segments = append(response.Segments, stt.Segment{Text: strings.TrimSpace(turn.Transcript), Start: turn.Start, End: turn.End, Speaker: speaker})
		}
	}
	return response, nil
}

func (t *Transcriber) transcribeElevenLabs(ctx context.Context, req stt.Request) (*stt.Response, error) {
	endpoint := strings.TrimSpace(t.cfg.Endpoint)
	if endpoint == "" {
		endpoint = ai.DefaultEndpoint(ai.ProviderElevenLabs)
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = ai.DefaultElevenLabsTranscriptionModel
	}
	filename := strings.TrimSpace(req.Filename)
	if filename == "" {
		filename = "chunk.wav"
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("model_id", model); err != nil {
		return nil, errors.Wrap(err, "failed to write ElevenLabs model_id")
	}
	if err := writer.WriteField("diarize", fmt.Sprint(req.Diarize)); err != nil {
		return nil, errors.Wrap(err, "failed to write ElevenLabs diarization option")
	}
	if lang := strings.TrimSpace(req.Language); lang != "" {
		if err := writer.WriteField("language_code", lang); err != nil {
			return nil, errors.Wrap(err, "failed to write ElevenLabs language_code")
		}
	}
	part, err := writer.CreateFormFile("file", filename)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create ElevenLabs form file")
	}
	if _, err := io.Copy(part, req.Audio); err != nil {
		return nil, errors.Wrap(err, "failed to copy audio into ElevenLabs form")
	}
	if err := writer.Close(); err != nil {
		return nil, errors.Wrap(err, "failed to close ElevenLabs multipart writer")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create ElevenLabs request")
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())
	httpReq.Header.Set("xi-api-key", t.cfg.APIKey)

	resp, err := t.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "ElevenLabs HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("ElevenLabs error (%d): %s", resp.StatusCode, string(errBody))
	}

	var result struct {
		Text         string `json:"text"`
		LanguageCode string `json:"language_code"`
		Words        []struct {
			Text      string  `json:"text"`
			Type      string  `json:"type"`
			Start     float64 `json:"start"`
			End       float64 `json:"end"`
			SpeakerID string  `json:"speaker_id"`
		} `json:"words"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode ElevenLabs response")
	}
	response := &stt.Response{
		Text:     strings.TrimSpace(result.Text),
		Language: result.LanguageCode,
	}
	if req.Diarize {
		for _, word := range result.Words {
			if word.Type == "audio_event" || strings.TrimSpace(word.Text) == "" {
				continue
			}
			last := len(response.Segments) - 1
			if last >= 0 && response.Segments[last].Speaker == word.SpeakerID {
				response.Segments[last].Text += " " + strings.TrimSpace(word.Text)
				response.Segments[last].End = word.End
			} else {
				response.Segments = append(response.Segments, stt.Segment{Text: strings.TrimSpace(word.Text), Start: word.Start, End: word.End, Speaker: word.SpeakerID})
			}
		}
	}
	return response, nil
}

func (t *Transcriber) transcribeAzure(ctx context.Context, req stt.Request) (*stt.Response, error) {
	rawEndpoint := strings.TrimSpace(t.cfg.Endpoint)
	if rawEndpoint == "" {
		rawEndpoint = "eastus"
	}
	lang := strings.TrimSpace(req.Language)
	if lang == "" {
		lang = "en-US"
	}

	var targetURL string
	if strings.Contains(rawEndpoint, "://") {
		u, err := url.Parse(rawEndpoint)
		if err != nil {
			return nil, errors.Wrap(err, "invalid Azure STT endpoint")
		}
		q := u.Query()
		q.Set("language", lang)
		u.RawQuery = q.Encode()
		targetURL = u.String()
	} else {
		targetURL = "https://" + rawEndpoint + ".stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=" + url.QueryEscape(lang)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, req.Audio)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Azure STT request")
	}
	httpReq.Header.Set("Ocp-Apim-Subscription-Key", t.cfg.APIKey)
	contentType := normalizeMediaType(req.ContentType, "audio/wav")
	httpReq.Header.Set("Content-Type", contentType)
	if req.Size > 0 && httpReq.ContentLength <= 0 {
		httpReq.ContentLength = req.Size
	}

	resp, err := t.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "Azure STT HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("Azure STT error (%d): %s", resp.StatusCode, string(errBody))
	}

	var result struct {
		DisplayText string `json:"DisplayText"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode Azure STT response")
	}
	return &stt.Response{Text: strings.TrimSpace(result.DisplayText), Language: lang}, nil
}

func (t *Transcriber) transcribeIBM(ctx context.Context, req stt.Request) (*stt.Response, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(t.cfg.Endpoint), "/")
	if baseURL == "" {
		return nil, errors.New("IBM Watson endpoint URL is required")
	}
	u, err := url.Parse(baseURL + "/v1/recognize")
	if err != nil {
		return nil, errors.Wrap(err, "invalid IBM STT endpoint")
	}
	if model := strings.TrimSpace(req.Model); model != "" {
		q := u.Query()
		q.Set("model", model)
		u.RawQuery = q.Encode()
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, u.String(), req.Audio)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create IBM STT request")
	}
	auth := base64.StdEncoding.EncodeToString([]byte("apikey:" + t.cfg.APIKey))
	httpReq.Header.Set("Authorization", "Basic "+auth)
	httpReq.Header.Set("Content-Type", normalizeMediaType(req.ContentType, "audio/wav"))
	if req.Size > 0 && httpReq.ContentLength <= 0 {
		httpReq.ContentLength = req.Size
	}

	resp, err := t.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "IBM STT HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		errBody, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("IBM STT error (%d): %s", resp.StatusCode, string(errBody))
	}

	var result struct {
		Results []struct {
			Alternatives []struct {
				Transcript string `json:"transcript"`
			} `json:"alternatives"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode IBM STT response")
	}
	var parts []string
	for _, r := range result.Results {
		if len(r.Alternatives) > 0 {
			if piece := strings.TrimSpace(r.Alternatives[0].Transcript); piece != "" {
				parts = append(parts, piece)
			}
		}
	}
	return &stt.Response{Text: strings.Join(parts, " ")}, nil
}

func normalizeMediaType(contentType, fallback string) string {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(contentType))
	if err != nil || mediaType == "" {
		return fallback
	}
	return strings.ToLower(mediaType)
}
