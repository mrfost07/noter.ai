package openai_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/stt"
	sttopenai "github.com/usememos/memos/provider/ai/stt/openai"
)

func TestTranscribe(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/audio/transcriptions", r.URL.Path)
		require.Equal(t, "Bearer test-key", r.Header.Get("Authorization"))
		require.NoError(t, r.ParseMultipartForm(10<<20))
		require.Equal(t, "gpt-4o-transcribe", r.FormValue("model"))
		require.Equal(t, "json", r.FormValue("response_format"))
		require.Equal(t, "domain words", r.FormValue("prompt"))
		require.Equal(t, "en", r.FormValue("language"))

		file, header, err := r.FormFile("file")
		require.NoError(t, err)
		defer file.Close()
		require.Equal(t, "voice.wav", header.Filename)
		require.Equal(t, "audio/wav", header.Header.Get("Content-Type"))

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"text":     "hello world",
			"language": "en",
			"duration": 1.5,
		}))
	}))
	defer server.Close()

	transcriber, err := sttopenai.New(ai.ProviderConfig{
		Type:     ai.ProviderOpenAI,
		Endpoint: server.URL,
		APIKey:   "test-key",
	}, stt.ApplyOptions(nil))
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	response, err := transcriber.Transcribe(ctx, stt.Request{
		Model:       "gpt-4o-transcribe",
		Filename:    "voice.wav",
		ContentType: "audio/wav",
		Audio:       strings.NewReader("RIFF"),
		Prompt:      "domain words",
		Language:    "en",
	})
	require.NoError(t, err)
	require.Equal(t, "hello world", response.Text)
	require.Equal(t, "en", response.Language)
	// Note: Duration intentionally omitted from stt.Response — not exposed in the new contract.
}

func TestWhisperPreservesSegmentTiming(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseMultipartForm(10<<20))
		require.Equal(t, "verbose_json", r.FormValue("response_format"))
		require.Equal(t, "segment", r.FormValue("timestamp_granularities[]"))
		w.Header().Set("Content-Type", "application/json")
		_, err := w.Write([]byte(`{"text":"Ship Friday","language":"en","segments":[{"text":"Ship Friday","start":1.25,"end":3.5}]}`))
		require.NoError(t, err)
	}))
	defer server.Close()
	transcriber, err := sttopenai.New(ai.ProviderConfig{Type: ai.ProviderGroq, Endpoint: server.URL, APIKey: "test-key"}, stt.ApplyOptions(nil))
	require.NoError(t, err)
	response, err := transcriber.Transcribe(context.Background(), stt.Request{Model: "whisper-large-v3-turbo", Audio: strings.NewReader("audio")})
	require.NoError(t, err)
	require.Equal(t, []stt.Segment{{Text: "Ship Friday", Start: 1.25, End: 3.5}}, response.Segments)
}

func TestWhisperFiltersConfidentSilenceWithoutDeletingSpokenThanks(t *testing.T) {
	for _, test := range []struct {
		name, segments, want string
		count                int
	}{
		{"quiet", `[{"text":"Thank you.","start":0,"end":4,"no_speech_prob":0.98,"avg_logprob":-1.8}]`, "", 0},
		{"spoken thanks", `[{"text":"Thank you.","start":0,"end":1,"no_speech_prob":0.8,"avg_logprob":-0.2}]`, "Thank you.", 1},
		{"mixed", `[{"text":"Thank you.","start":0,"end":1,"no_speech_prob":0.99,"avg_logprob":-2},{"text":"Ship Friday.","start":1,"end":3,"no_speech_prob":0.01,"avg_logprob":-0.2}]`, "Ship Friday.", 1},
		{"missing confidence", `[{"text":"Thank you.","start":0,"end":1,"no_speech_prob":0.99}]`, "Thank you.", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			var segments []struct {
				Text string `json:"text"`
			}
			require.NoError(t, json.Unmarshal([]byte(test.segments), &segments))
			var allText []string
			for _, segment := range segments {
				allText = append(allText, segment.Text)
			}
			rawText, err := json.Marshal(strings.Join(allText, " "))
			require.NoError(t, err)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, err := w.Write([]byte(`{"text":` + string(rawText) + `,"segments":` + test.segments + `}`))
				require.NoError(t, err)
			}))
			defer server.Close()
			transcriber, err := sttopenai.New(ai.ProviderConfig{Type: ai.ProviderGroq, Endpoint: server.URL, APIKey: "test-key"}, stt.ApplyOptions(nil))
			require.NoError(t, err)
			response, err := transcriber.Transcribe(context.Background(), stt.Request{Model: "whisper-large-v3-turbo", Audio: strings.NewReader("audio")})
			require.NoError(t, err)
			require.Equal(t, test.want, response.Text)
			require.Len(t, response.Segments, test.count)
		})
	}
}
