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

func TestTranscribe(t *testing.T) {
	ctx := context.Background()

	t.Run("requires authentication", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		_, err := ts.Service.Transcribe(ctx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "user not authenticated")
	})

	t.Run("transcribes audio file using persisted transcription setting", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "alice")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/audio/transcriptions", r.URL.Path)
			require.Equal(t, "Bearer sk-test", r.Header.Get("Authorization"))
			require.NoError(t, r.ParseMultipartForm(10<<20))
			require.Equal(t, "whisper-1", r.FormValue("model"))
			require.Equal(t, "fr", r.FormValue("language"))
			require.Equal(t, "names: Alice", r.FormValue("prompt"))

			file, header, err := r.FormFile("file")
			require.NoError(t, err)
			defer file.Close()
			require.Equal(t, "voice.wav", header.Filename)

			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{
				"text": "transcribed text",
			}))
		}))
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "openai-main",
						Model:      "whisper-1",
						Language:   "fr",
						Prompt:     "names: Alice",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "transcribed text", resp.Text)
	})

	t.Run("returns provider error without rewriting it", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "notfound-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.NotFoundHandler())
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "openai-main",
					},
				},
			},
		})
		require.NoError(t, err)

		_, err = ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "failed to transcribe audio")
	})

	t.Run("transcribes audio file with Gemini provider", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "gemini-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		geminiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/v1beta/models/gemini-2.5-flash:generateContent", r.URL.Path)
			require.Equal(t, "gemini-key", r.Header.Get("x-goog-api-key"))
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"candidates": []map[string]any{
					{
						"finishReason": "STOP",
						"content": map[string]any{
							"parts": []map[string]string{{"text": "gemini transcript"}},
						},
					},
				},
			}))
		}))
		defer geminiServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "gemini-main",
							Title:    "Gemini",
							Type:     storepb.AIProviderType_GEMINI,
							Endpoint: geminiServer.URL + "/v1beta",
							ApiKey:   "gemini-key",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "gemini-main",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("mp3 bytes")},
				Filename:    "voice.mp3",
				ContentType: "audio/mp3",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "gemini transcript", resp.Text)
	})

	t.Run("falls back to engine default model when transcription model is empty", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "bob")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		openAIServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.NoError(t, r.ParseMultipartForm(10<<20))
			require.Equal(t, "whisper-1", r.FormValue("model"))
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]string{
				"text": "built-in model",
			}))
		}))
		defer openAIServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "openai-main",
							Title:    "OpenAI",
							Type:     storepb.AIProviderType_OPENAI,
							Endpoint: openAIServer.URL,
							ApiKey:   "sk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "openai-main",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "built-in model", resp.Text)
	})

	t.Run("rejects non-audio content before provider call", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "charlie")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("not audio")},
				Filename:    "notes.txt",
				ContentType: "text/plain",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "not supported")
	})

	t.Run("returns FailedPrecondition when transcription is not configured", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "alice-empty")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "transcription is not configured")
	})

	t.Run("transcribes audio file with Deepgram provider", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "dg-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		dgServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "Token dg-secret", r.Header.Get("Authorization"))
			require.Equal(t, "nova-3", r.URL.Query().Get("model"))
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"results": map[string]any{
					"channels": []map[string]any{
						{
							"alternatives": []map[string]string{
								{"transcript": "deepgram meeting transcript"},
							},
						},
					},
				},
			}))
		}))
		defer dgServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "dg-main",
							Title:    "Deepgram",
							Type:     storepb.AIProviderType_DEEPGRAM,
							Endpoint: dgServer.URL,
							ApiKey:   "dg-secret",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "dg-main",
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.Transcribe(userCtx, &apipb.TranscribeRequest{
			Audio: &apipb.TranscriptionAudio{
				Source:      &apipb.TranscriptionAudio_Content{Content: []byte("RIFF")},
				Filename:    "voice.wav",
				ContentType: "audio/wav",
			},
		})
		require.NoError(t, err)
		require.Equal(t, "deepgram meeting transcript", resp.Text)
	})
}

func TestAnalyzeMeetingTranscript(t *testing.T) {
	ctx := context.Background()

	t.Run("requires authentication", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		_, err := ts.Service.AnalyzeMeetingTranscript(ctx, &apipb.AnalyzeMeetingTranscriptRequest{
			Transcript: "[14:00:01] [Client]: Hello",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "user not authenticated")
	})

	t.Run("rejects empty transcript", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "analyst-empty")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		_, err = ts.Service.AnalyzeMeetingTranscript(userCtx, &apipb.AnalyzeMeetingTranscriptRequest{
			Transcript: "   ",
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "transcript is required")
	})

	t.Run("analyzes speaker-tagged transcript and formats structured GFM markdown", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "analyst-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			require.Equal(t, "/chat/completions", r.URL.Path)
			require.Equal(t, "Bearer gsk-test", r.Header.Get("Authorization"))
			var input struct {
				Messages []struct {
					Role    string `json:"role"`
					Content string `json:"content"`
				} `json:"messages"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&input))
			require.Len(t, input.Messages, 2)
			require.Contains(t, input.Messages[0].Content, "COMPLETE updated state")
			require.Contains(t, input.Messages[0].Content, "Date:")
			require.Contains(t, input.Messages[1].Content, "Existing scope revision")
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"message": map[string]string{
							"content": `{"tasksForYou":["Send PostgreSQL schema by Friday","Send PostgreSQL schema by Friday"],"clientDecisions":["Approved $12k MVP budget"],"crucialInfo":["Target launch Nov 15"],"followUpQuestions":["Which SSO provider do you use?"]}`,
						},
					},
				},
			}))
		}))
		defer llmServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "groq-main",
							Title:    "Groq",
							Type:     storepb.AIProviderType_GROQ,
							Endpoint: llmServer.URL,
							ApiKey:   "gsk-test",
						},
					},
					Transcription: &storepb.TranscriptionConfig{
						ProviderId: "groq-main",
					},
				},
			},
		})
		require.NoError(t, err)

		active, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "Active draft"}})
		require.NoError(t, err)
		related, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "PostgreSQL schema specification"}})
		require.NoError(t, err)
		resp, err := ts.Service.AnalyzeMeetingTranscript(userCtx, &apipb.AnalyzeMeetingTranscriptRequest{
			MemoName:      active.GetName(),
			PreviousState: &apipb.MeetingNotesState{MidMeetingChanges: []string{"Existing scope revision"}},
			Transcript:    "[14:02:05] [Client]: We approve the $12k MVP budget for Nov 15.\n[14:02:12] [You]: I will send the PostgreSQL schema by Friday.",
		})
		require.NoError(t, err)
		require.NotNil(t, resp.GetNotes())
		// Deduplicated tasksForYou
		require.Equal(t, []string{"Send PostgreSQL schema by Friday"}, resp.GetNotes().GetTasksForYou())
		require.Equal(t, []string{"Approved $12k MVP budget"}, resp.GetNotes().GetClientDecisions())
		require.Equal(t, []string{"Target launch Nov 15"}, resp.GetNotes().GetCrucialInfo())
		require.Equal(t, []string{"Which SSO provider do you use?"}, resp.GetNotes().GetFollowUpQuestions())
		require.Contains(t, resp.GetMarkdown(), "- [ ] Send PostgreSQL schema by Friday")
		require.Contains(t, resp.GetMarkdown(), "#meeting-notes")
		require.Contains(t, resp.GetRelatedMemoNames(), related.GetName())
		stored, err := ts.Service.GetMemo(userCtx, &apipb.GetMemoRequest{Name: active.GetName()})
		require.NoError(t, err)
		require.Empty(t, stored.GetRelations(), "analysis must not save note links before draft review")
	})

	t.Run("extracts urgent tasks, mid-meeting changes, and omits empty sections", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "urgent-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		llmServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"message": map[string]string{
							"content": `{"tasksForYou":["🚨 [URGENT] Fix auth token leak by today"],"midMeetingChanges":["Switch from Stripe to LemonSqueezy due to merchant restrictions"],"clientDecisions":["Approved LemonSqueezy integration"],"crucialInfo":["Launch date stays next Monday"],"followUpQuestions":[]}`,
						},
					},
				},
			}))
		}))
		defer llmServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "groq-urgent",
							Title:    "Groq Urgent",
							Type:     storepb.AIProviderType_GROQ,
							Endpoint: llmServer.URL,
							ApiKey:   "gsk-test",
						},
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.AnalyzeMeetingTranscript(userCtx, &apipb.AnalyzeMeetingTranscriptRequest{
			Transcript: "[10:00:00] [Client]: We need to switch from Stripe to LemonSqueezy immediately. Fix the token leak by today!",
			ProviderId: "groq-urgent",
		})
		require.NoError(t, err)
		require.NotNil(t, resp.GetNotes())
		require.Equal(t, []string{"🚨 [URGENT] Fix auth token leak by today"}, resp.GetNotes().GetTasksForYou())
		require.Equal(t, []string{"Switch from Stripe to LemonSqueezy due to merchant restrictions"}, resp.GetNotes().GetMidMeetingChanges())
		require.Contains(t, resp.GetMarkdown(), "## Action items")
		require.Contains(t, resp.GetMarkdown(), "- [ ] 🚨 [URGENT] Fix auth token leak by today")
		require.Contains(t, resp.GetMarkdown(), "## Scope changes")
		require.Contains(t, resp.GetMarkdown(), "- Switch from Stripe to LemonSqueezy due to merchant restrictions")
		require.NotContains(t, resp.GetMarkdown(), "## Open questions")
	})

	t.Run("rejects oversized transcript over 256 KiB", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "analyst-oversized")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		huge := make([]byte, (256*1024)+10)
		for i := range huge {
			huge[i] = 'a'
		}
		_, err = ts.Service.AnalyzeMeetingTranscript(userCtx, &apipb.AnalyzeMeetingTranscriptRequest{
			Transcript: string(huge),
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "256 KiB")
	})
}

func TestAISettingValidationAndSecurity(t *testing.T) {
	ctx := context.Background()

	t.Run("supports keyless local providers and rejects non-http endpoint schemes", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		admin, err := ts.CreateHostUser(ctx, "admin-ai")
		require.NoError(t, err)
		adminCtx := ts.CreateUserContext(ctx, admin.ID)

		// 1. Keyless OLLAMA and LOCAL_WHISPER providers succeed and populate default endpoints
		updated, err := ts.Service.UpdateInstanceSetting(adminCtx, &apipb.UpdateInstanceSettingRequest{
			InstanceSetting: &apipb.InstanceSetting{
				Name: "instance/settings/AI",
				Value: &apipb.InstanceSetting_AiSetting{
					AiSetting: &apipb.InstanceSetting_AISetting{
						Providers: []*apipb.InstanceSetting_AIProviderConfig{
							{
								Id:    "local-ollama",
								Title: "Local Ollama",
								Type:  apipb.InstanceSetting_OLLAMA,
							},
							{
								Id:    "local-whisper",
								Title: "Local Whisper",
								Type:  apipb.InstanceSetting_LOCAL_WHISPER,
							},
							{
								Id:     "cloud-groq",
								Title:  "Groq Cloud",
								Type:   apipb.InstanceSetting_GROQ,
								ApiKey: "gsk-secret-9876",
							},
						},
						Transcription: &apipb.InstanceSetting_TranscriptionConfig{
							ProviderId: "local-whisper",
						},
					},
				},
			},
		})
		require.NoError(t, err)
		providers := updated.GetAiSetting().GetProviders()
		require.Len(t, providers, 3)
		require.Equal(t, "http://127.0.0.1:11434/v1", providers[0].GetEndpoint())
		require.False(t, providers[0].GetApiKeySet())
		require.Equal(t, "http://127.0.0.1:8000/v1", providers[1].GetEndpoint())
		require.Equal(t, "https://api.groq.com/openai/v1", providers[2].GetEndpoint())
		require.True(t, providers[2].GetApiKeySet())
		require.Equal(t, "gsk-...9876", providers[2].GetApiKeyHint())
		require.Empty(t, providers[2].GetApiKey())

		// 2. Rejects dangerous endpoint scheme (file:// or javascript:)
		_, err = ts.Service.UpdateInstanceSetting(adminCtx, &apipb.UpdateInstanceSettingRequest{
			InstanceSetting: &apipb.InstanceSetting{
				Name: "instance/settings/AI",
				Value: &apipb.InstanceSetting_AiSetting{
					AiSetting: &apipb.InstanceSetting_AISetting{
						Providers: []*apipb.InstanceSetting_AIProviderConfig{
							{
								Id:       "bad-endpoint",
								Title:    "Bad Endpoint",
								Type:     apipb.InstanceSetting_OPENAI,
								Endpoint: "file:///etc/passwd",
								ApiKey:   "sk-test",
							},
						},
					},
				},
			},
		})
		require.Error(t, err)
		require.Contains(t, err.Error(), "http or https")
	})
}

func TestRunAgentTaskAndMeetingAutoLink(t *testing.T) {
	ctx := context.Background()

	t.Run("executes multi-step autonomous agent tool loop to create and link memos", func(t *testing.T) {
		ts := NewTestService(t)
		defer ts.Cleanup()

		user, err := ts.CreateRegularUser(ctx, "agent-user")
		require.NoError(t, err)
		userCtx := ts.CreateUserContext(ctx, user.ID)

		step := 0
		agentLLMServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			step++
			w.Header().Set("Content-Type", "application/json")
			var content string
			if step == 1 {
				content = `{"thought":"Create the requested meeting memo","tool":"create_memo","args":{"content":"# Okta SSO Architecture\n- [ ] Deliver SAML diagram by Thursday","visibility":"PRIVATE"},"final_reply":""}`
			} else {
				content = `{"thought":"Done creating memo","tool":"","args":{},"final_reply":"Created your Okta SSO Architecture memo with the Thursday action item."}`
			}
			require.NoError(t, json.NewEncoder(w).Encode(map[string]any{
				"choices": []map[string]any{
					{
						"message": map[string]string{
							"content": content,
						},
					},
				},
			}))
		}))
		defer agentLLMServer.Close()

		_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
			Key: storepb.InstanceSettingKey_AI,
			Value: &storepb.InstanceSetting_AiSetting{
				AiSetting: &storepb.InstanceAISetting{
					Providers: []*storepb.AIProviderConfig{
						{
							Id:       "ollama-agent",
							Title:    "Ollama Agent",
							Type:     storepb.AIProviderType_OLLAMA,
							Endpoint: agentLLMServer.URL + "/v1",
						},
					},
				},
			},
		})
		require.NoError(t, err)

		resp, err := ts.Service.RunAgentTask(userCtx, &apipb.RunAgentTaskRequest{
			Instruction: "Create a private memo for the Okta SSO Architecture meeting with a task to deliver the SAML diagram by Thursday.",
			ProviderId:  "ollama-agent",
		})
		require.NoError(t, err)
		require.Equal(t, "Created your Okta SSO Architecture memo with the Thursday action item.", resp.GetReply())
		require.Len(t, resp.GetActions(), 1)
		require.Equal(t, "create_memo", resp.GetActions()[0].GetTool())
		require.Contains(t, resp.GetActions()[0].GetMemoName(), "memos/")
	})
}
