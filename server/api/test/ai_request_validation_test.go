package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestTranscribeRequestBoundaries(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()
	user, err := ts.CreateRegularUser(ctx, "transcription-boundaries")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	var providerCalls atomic.Int32
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("parse transcription form: %v", err)
			http.Error(w, "invalid multipart form", http.StatusBadRequest)
			return
		}
		if model := r.FormValue("model"); model != strings.Repeat("m", 256) {
			t.Errorf("provider received unexpected model %q", model)
		}
		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(map[string]string{"text": "Boundary accepted."}); err != nil {
			t.Errorf("encode transcription fixture response: %v", err)
		}
	}))
	defer fixture.Close()
	_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Providers:     []*storepb.AIProviderConfig{{Id: "boundary-provider", Type: storepb.AIProviderType_OPENAI, Endpoint: fixture.URL, ApiKey: "fixture-key"}},
			Transcription: &storepb.TranscriptionConfig{ProviderId: "boundary-provider"},
		}},
	})
	require.NoError(t, err)

	audio := func(contentType string) *apipb.TranscriptionAudio {
		return &apipb.TranscriptionAudio{Source: &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")}, Filename: "voice.wav", ContentType: contentType}
	}
	for _, test := range []struct {
		name    string
		request *apipb.TranscribeRequest
		message string
	}{
		{name: "missing audio", request: &apipb.TranscribeRequest{}, message: "audio is required"},
		{name: "remote URI", request: &apipb.TranscribeRequest{Audio: &apipb.TranscriptionAudio{Source: &apipb.TranscriptionAudio_Uri{Uri: "https://example.invalid/audio.wav"}}}, message: "uri is not supported"},
		{name: "empty content", request: &apipb.TranscribeRequest{Audio: &apipb.TranscriptionAudio{}}, message: "content is required"},
		{name: "malformed MIME parameters", request: &apipb.TranscribeRequest{Audio: audio("audio/wav; broken")}, message: "not supported"},
		{name: "overlong model override", request: &apipb.TranscribeRequest{Audio: audio("audio/wav"), Model: strings.Repeat("m", 257)}, message: "model is too long"},
	} {
		t.Run(test.name, func(t *testing.T) {
			response, err := ts.Service.Transcribe(userCtx, test.request)
			require.Nil(t, response)
			require.Equal(t, codes.InvalidArgument, status.Code(err))
			require.ErrorContains(t, err, test.message)
			require.Zero(t, providerCalls.Load(), "invalid requests must not reach the configured provider")
		})
	}
	t.Run("exact model and filename limits with MIME parameters", func(t *testing.T) {
		valid := audio("Audio/Wav; codecs=pcm")
		valid.Filename = strings.Repeat("v", 251) + ".wav"
		response, err := ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{Audio: valid, Model: " " + strings.Repeat("m", 256) + " "})
		require.NoError(t, err)
		require.Equal(t, "Boundary accepted.", response.GetText())
		require.EqualValues(t, 1, providerCalls.Load())
	})
}
