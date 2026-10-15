package multistt_test

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
	"github.com/usememos/memos/provider/ai/stt/multistt"
)

func TestDeepgramTranscribe(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "Token dg-key", r.Header.Get("Authorization"))
		require.Equal(t, "nova-3", r.URL.Query().Get("model"))
		require.Equal(t, "en", r.URL.Query().Get("language"))

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"results": map[string]any{
				"channels": []map[string]any{
					{
						"alternatives": []map[string]string{
							{"transcript": "deepgram nova transcript"},
						},
					},
				},
			},
		}))
	}))
	defer server.Close()

	transcriber, err := multistt.New(ai.ProviderConfig{
		Type:     ai.ProviderDeepgram,
		Endpoint: server.URL,
		APIKey:   "dg-key",
	}, stt.ApplyOptions(nil))
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	resp, err := transcriber.Transcribe(ctx, stt.Request{
		Audio:       strings.NewReader("RIFF"),
		ContentType: "audio/wav",
		Model:       "nova-3",
		Language:    "en",
	})
	require.NoError(t, err)
	require.Equal(t, "deepgram nova transcript", resp.Text)
}

func TestDeepgramDiarization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "true", r.URL.Query().Get("diarize"))
		require.Equal(t, "true", r.URL.Query().Get("utterances"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":{"channels":[{"alternatives":[{"transcript":"Hello. Friday."}]}],"utterances":[{"speaker":0,"start":0,"end":1,"transcript":"Hello."},{"speaker":1,"start":2,"end":3,"transcript":"Friday."},{"start":4,"end":5,"transcript":"Unknown voice."}]}}`))
	}))
	defer server.Close()
	client, err := multistt.New(ai.ProviderConfig{Type: ai.ProviderDeepgram, Endpoint: server.URL, APIKey: "fixture"}, stt.ApplyOptions(nil))
	require.NoError(t, err)
	response, err := client.Transcribe(context.Background(), stt.Request{Audio: strings.NewReader("audio"), Diarize: true})
	require.NoError(t, err)
	require.Len(t, response.Segments, 3)
	require.Equal(t, "0", response.Segments[0].Speaker)
	require.Equal(t, "1", response.Segments[1].Speaker)
	require.Empty(t, response.Segments[2].Speaker)
}

func TestElevenLabsDiarization(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, r.ParseMultipartForm(1<<20))
		require.Equal(t, "true", r.FormValue("diarize"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"Hello there. Friday.","words":[{"type":"word","text":"Hello","speaker_id":"speaker_0","start":0,"end":0.5},{"type":"word","text":"there.","speaker_id":"speaker_0","start":0.5,"end":1},{"type":"word","text":"Friday.","speaker_id":"speaker_1","start":2,"end":3}]}`))
	}))
	defer server.Close()
	client, err := multistt.New(ai.ProviderConfig{Type: ai.ProviderElevenLabs, Endpoint: server.URL, APIKey: "fixture"}, stt.ApplyOptions(nil))
	require.NoError(t, err)
	response, err := client.Transcribe(context.Background(), stt.Request{Audio: strings.NewReader("audio"), Diarize: true})
	require.NoError(t, err)
	require.Len(t, response.Segments, 2)
	require.Equal(t, "Hello there.", response.Segments[0].Text)
	require.Equal(t, "speaker_1", response.Segments[1].Speaker)
}

func TestElevenLabsTranscribe(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "xi-test", r.Header.Get("xi-api-key"))
		require.NoError(t, r.ParseMultipartForm(10<<20))
		require.Equal(t, "scribe_v1", r.FormValue("model_id"))

		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]string{
			"text":          "elevenlabs transcript",
			"language_code": "en",
		}))
	}))
	defer server.Close()

	transcriber, err := multistt.New(ai.ProviderConfig{
		Type:     ai.ProviderElevenLabs,
		Endpoint: server.URL,
		APIKey:   "xi-test",
	}, stt.ApplyOptions(nil))
	require.NoError(t, err)

	resp, err := transcriber.Transcribe(context.Background(), stt.Request{
		Audio:       strings.NewReader("RIFF"),
		ContentType: "audio/wav",
		Model:       "scribe_v1",
	})
	require.NoError(t, err)
	require.Equal(t, "elevenlabs transcript", resp.Text)
}

func TestAzureAndIBMTranscribe(t *testing.T) {
	t.Parallel()

	azureServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "azure-key", r.Header.Get("Ocp-Apim-Subscription-Key"))
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]string{
			"DisplayText": "azure speech text",
		}))
	}))
	defer azureServer.Close()

	azTranscriber, err := multistt.New(ai.ProviderConfig{
		Type:     ai.ProviderAzureSTT,
		Endpoint: azureServer.URL,
		APIKey:   "azure-key",
	}, stt.ApplyOptions(nil))
	require.NoError(t, err)

	azResp, err := azTranscriber.Transcribe(context.Background(), stt.Request{
		Audio:       strings.NewReader("RIFF"),
		ContentType: "audio/wav",
	})
	require.NoError(t, err)
	require.Equal(t, "azure speech text", azResp.Text)

	ibmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/recognize", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{
					"alternatives": []map[string]string{
						{"transcript": "ibm watson text"},
					},
				},
			},
		}))
	}))
	defer ibmServer.Close()

	ibmTranscriber, err := multistt.New(ai.ProviderConfig{
		Type:     ai.ProviderIBMSTT,
		Endpoint: ibmServer.URL,
		APIKey:   "ibm-key",
	}, stt.ApplyOptions(nil))
	require.NoError(t, err)

	ibmResp, err := ibmTranscriber.Transcribe(context.Background(), stt.Request{
		Audio:       strings.NewReader("RIFF"),
		ContentType: "audio/wav",
	})
	require.NoError(t, err)
	require.Equal(t, "ibm watson text", ibmResp.Text)
}
