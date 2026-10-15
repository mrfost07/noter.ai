package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestNoterSavedAssistantDefaults(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()
	admin, err := ts.CreateHostUser(ctx, "noter-settings")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, admin.ID)
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "saved-account-model", body.Model)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"{\"crucialInfo\":[\"Title: Launch review\",\"Date: Launch on Friday\"]}"},"finish_reason":"stop"}]}`))
	}))
	defer fixture.Close()
	_, err = ts.Service.UpdateInstanceSetting(userCtx, &apipb.UpdateInstanceSettingRequest{InstanceSetting: &apipb.InstanceSetting{
		Name: "instance/settings/AI", Value: &apipb.InstanceSetting_AiSetting{AiSetting: &apipb.InstanceSetting_AISetting{
			Providers: []*apipb.InstanceSetting_AIProviderConfig{{Id: "chosen", Title: "Noter fixture", Type: apipb.InstanceSetting_OPENAI, Endpoint: fixture.URL, ApiKey: "fake-key"}},
			Assistant: &apipb.InstanceSetting_AssistantConfig{ProviderId: "chosen", Model: "saved-account-model"},
		}},
	}})
	require.NoError(t, err)
	saved, err := ts.Service.GetInstanceSetting(userCtx, &apipb.GetInstanceSettingRequest{Name: "instance/settings/AI"})
	require.NoError(t, err)
	require.Equal(t, "saved-account-model", saved.GetAiSetting().GetAssistant().GetModel())
	// Requests from another browser origin can omit all local preferences.
	response, err := ts.Service.AnalyzeMeetingTranscript(userCtx, &apipb.AnalyzeMeetingTranscriptRequest{Transcript: "Launch on Friday."})
	require.NoError(t, err)
	require.Contains(t, response.Markdown, "Dates & deadlines")
	// A provider/key edit that omits assistant defaults must retain them.
	_, err = ts.Service.UpdateInstanceSetting(userCtx, &apipb.UpdateInstanceSettingRequest{InstanceSetting: &apipb.InstanceSetting{
		Name: "instance/settings/AI", Value: &apipb.InstanceSetting_AiSetting{AiSetting: &apipb.InstanceSetting_AISetting{
			Providers: []*apipb.InstanceSetting_AIProviderConfig{{Id: "chosen", Title: "Renamed fixture", Type: apipb.InstanceSetting_OPENAI, Endpoint: fixture.URL}},
		}},
	}})
	require.NoError(t, err)
	persisted, err := ts.Store.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	require.Equal(t, "saved-account-model", persisted.GetAssistant().GetModel())
	require.Equal(t, "fake-key", persisted.GetProviders()[0].GetApiKey())
}

func TestNoterOptionalSpeakersKeepGroq(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()
	user, err := ts.CreateRegularUser(ctx, "speaker-fixture")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "nova-3", r.URL.Query().Get("model"))
		require.Equal(t, "true", r.URL.Query().Get("diarize"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":{"channels":[{"alternatives":[{"transcript":"First. Second."}]}],"utterances":[{"speaker":0,"start":0,"end":1,"transcript":"First."},{"speaker":1,"start":2,"end":3,"transcript":"Second."}]}}`))
	}))
	defer fixture.Close()
	_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
		Providers:     []*storepb.AIProviderConfig{{Id: "live-groq", Type: storepb.AIProviderType_GROQ, ApiKey: "fake-groq"}, {Id: "speakers", Type: storepb.AIProviderType_DEEPGRAM, Endpoint: fixture.URL, ApiKey: "fake-dg"}},
		Transcription: &storepb.TranscriptionConfig{ProviderId: "live-groq", Model: "whisper-large-v3-turbo", SpeakerProviderId: "speakers"},
	}}})
	require.NoError(t, err)
	audio := &apipb.TranscriptionAudio{Source: &apipb.TranscriptionAudio_Content{Content: []byte("audio")}, Filename: "meeting.webm", ContentType: "audio/webm"}
	result, err := ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{Audio: audio, Diarize: true})
	require.NoError(t, err)
	require.Len(t, result.Segments, 2)
	require.Equal(t, "0", result.Segments[0].Speaker)
	require.Equal(t, "1", result.Segments[1].Speaker)
	persisted, err := ts.Store.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	require.Equal(t, "live-groq", persisted.GetTranscription().GetProviderId())
	require.Equal(t, "whisper-large-v3-turbo", persisted.GetTranscription().GetModel())
	_, err = ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{Audio: audio, Diarize: true, ProviderId: "live-groq"})
	require.ErrorContains(t, err, "speaker recognition requires Deepgram or ElevenLabs")
}
