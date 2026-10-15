package llm_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/llm"
)

func TestOpenAICompatibleAndOllamaGenerate(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/chat/completions", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"message": map[string]string{
						"content": `{"tasksForYou":["Send schema"]}`,
					},
				},
			},
		}))
	}))
	defer server.Close()

	// Keyless Ollama provider succeeds without APIKey
	ollamaClient, err := llm.New(ai.ProviderConfig{
		Type:     ai.ProviderOllama,
		Endpoint: server.URL,
	}, server.Client())
	require.NoError(t, err)

	resp, err := ollamaClient.Generate(context.Background(), llm.Request{
		SystemPrompt: "You are an analyst.",
		UserPrompt:   "[Client]: Please send schema.",
		ResponseJSON: true,
	})
	require.NoError(t, err)
	require.Equal(t, `{"tasksForYou":["Send schema"]}`, resp.Text)
}

func TestAnthropicAndAntigravityGenerate(t *testing.T) {
	t.Parallel()

	anthropicServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "sk-ant", r.Header.Get("x-api-key"))
		require.Equal(t, "2023-06-01", r.Header.Get("anthropic-version"))
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"content": []map[string]string{
				{"text": "anthropic response"},
			},
		}))
	}))
	defer anthropicServer.Close()

	antClient, err := llm.New(ai.ProviderConfig{
		Type:     ai.ProviderAnthropic,
		Endpoint: anthropicServer.URL,
		APIKey:   "sk-ant",
	}, anthropicServer.Client())
	require.NoError(t, err)

	antResp, err := antClient.Generate(context.Background(), llm.Request{
		SystemPrompt: "system",
		UserPrompt:   "hello",
	})
	require.NoError(t, err)
	require.Equal(t, "anthropic response", antResp.Text)

	agServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer oauth-token", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
			"response": map[string]any{
				"candidates": []map[string]any{
					{
						"content": map[string]any{
							"parts": []map[string]string{
								{"text": "antigravity response"},
							},
						},
					},
				},
			},
		}))
	}))
	defer agServer.Close()

	agClient, err := llm.New(ai.ProviderConfig{
		Type:     ai.ProviderAntigravity,
		Endpoint: agServer.URL,
		APIKey:   "oauth-token",
	}, agServer.Client())
	require.NoError(t, err)

	agResp, err := agClient.Generate(context.Background(), llm.Request{
		SystemPrompt: "system",
		UserPrompt:   "hello",
	})
	require.NoError(t, err)
	require.Equal(t, "antigravity response", agResp.Text)
}
