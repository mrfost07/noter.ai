package api

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/lithammer/shortuuid/v4"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/llm"
)

// StartChatGPTOAuth registers this open-source app with the selected ChatGPT account.
func (s *APIService) StartChatGPTOAuth(ctx context.Context, request *apipb.StartChatGPTOAuthRequest) (*apipb.StartChatGPTOAuthResponse, error) {
	if err := s.requireAIConnectionAdmin(ctx); err != nil {
		return nil, err
	}
	if !s.aiOAuthSignInMu.TryLock() {
		return nil, status.Error(codes.FailedPrecondition, "Another AI connection is in progress. Finish or cancel it first.")
	}
	defer s.aiOAuthSignInMu.Unlock()
	setting, err := s.chatGPTInstallationSetting(ctx)
	if err != nil {
		return nil, err
	}
	providerID := strings.TrimSpace(request.GetProviderId())
	if len(providerID) > 128 {
		return nil, status.Error(codes.InvalidArgument, "The connection ID is too long.")
	}
	previous := llm.ChatGPTCredentials{}
	for _, provider := range setting.Providers {
		if provider.Id != providerID {
			continue
		}
		if provider.Type != storepb.AIProviderType_CHATGPT {
			return nil, status.Error(codes.InvalidArgument, "Add ChatGPT as a separate provider connection.")
		}
		if json.Unmarshal([]byte(provider.ApiKey), &previous) != nil {
			return nil, status.Error(codes.FailedPrecondition, "This ChatGPT connection is invalid. Remove it and add a new connection.")
		}
	}
	if providerID == "" {
		providerID = shortuuid.New()
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return nil, status.Error(codes.FailedPrecondition, "Could not open the local ChatGPT callback. Try connecting again.")
	}
	defer listener.Close()
	redirectURI := "http://" + listener.Addr().String() + "/auth/callback"
	verifier, challenge, err := generatePKCE()
	if err != nil {
		return nil, status.Error(codes.Internal, "Could not prepare ChatGPT sign-in.")
	}
	state, _, err := generatePKCE()
	if err != nil {
		return nil, status.Error(codes.Internal, "Could not prepare ChatGPT sign-in.")
	}
	nonce, _, err := generatePKCE()
	if err != nil {
		return nil, status.Error(codes.Internal, "Could not prepare ChatGPT sign-in.")
	}
	type callback struct {
		code, clientID string
		err            error
	}
	result := make(chan callback, 1)
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method != http.MethodGet || subtle.ConstantTimeCompare([]byte(r.URL.Query().Get("state")), []byte(state)) != 1 {
			http.Error(w, "Invalid sign-in response.", http.StatusBadRequest)
			return
		}
		if r.URL.Query().Get("error") != "" {
			http.Error(w, "ChatGPT connection was not authorized. Return to Noter.ai.", http.StatusBadRequest)
			select {
			case result <- callback{err: status.Error(codes.PermissionDenied, "ChatGPT connection was cancelled or denied. Your previous connection was kept.")}:
			default:
			}
			return
		}
		issuedID, idErr := llm.ChatGPTCallbackClient(previous.ClientID, r.URL.Query().Get("client_id"))
		code := strings.TrimSpace(r.URL.Query().Get("code"))
		if idErr != nil || code == "" || len(code) > 8192 {
			http.Error(w, "Incomplete ChatGPT connection. Return to Noter.ai and try again.", http.StatusBadRequest)
			select {
			case result <- callback{err: status.Error(codes.FailedPrecondition, "ChatGPT registration was incomplete. Try connecting again.")}:
			default:
			}
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Noter.ai · ChatGPT connection</title></head><body style="font-family:system-ui;padding:3rem;text-align:center"><h1>Return to Noter.ai</h1><p>Your sign-in response was received. Noter.ai will verify the account and finish connecting.</p></body></html>`))
		select {
		case result <- callback{code: code, clientID: issuedID}:
		default:
		}
	})
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = server.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()
	authorizeURL := llm.ChatGPTAuthorizationURL(previous, setting.ChatgptHostId, redirectURI, state, nonce, challenge)
	if s.aiOAuthOpenBrowser != nil {
		s.aiOAuthOpenBrowser(authorizeURL)
	} else {
		openSystemBrowser(authorizeURL)
	}
	waitCtx, cancel := context.WithTimeout(ctx, oauthCallbackTimeout)
	defer cancel()
	var returned callback
	select {
	case returned = <-result:
	case <-waitCtx.Done():
		return nil, status.Error(codes.DeadlineExceeded, "ChatGPT sign-in did not finish. Return to Settings and connect again.")
	}
	if returned.err != nil {
		return nil, returned.err
	}
	// Retain a new registration even if its short-lived code expires, without replacing an active account.
	if previous.ClientID == "" {
		previous.ClientID, previous.HostID = returned.clientID, setting.ChatgptHostId
		if err := s.saveChatGPTSignIn(ctx, providerID, previous); err != nil {
			return nil, err
		}
	}
	credentials, err := llm.ExchangeChatGPTCode(ctx, s.aiOAuthHTTPClient, previous, returned.clientID, setting.ChatgptHostId, returned.code, verifier, redirectURI, nonce)
	if err != nil {
		return nil, status.Error(codes.FailedPrecondition, err.Error())
	}
	if err := s.saveChatGPTSignIn(ctx, providerID, *credentials); err != nil {
		return nil, err
	}
	return &apipb.StartChatGPTOAuthResponse{ProviderId: providerID, Connected: true, Email: credentials.Email, PlanUsageEnabled: credentials.PlanEnabled()}, nil
}

func (s *APIService) chatGPTInstallationSetting(ctx context.Context) (*storepb.InstanceAISetting, error) {
	s.aiOAuthMu.Lock()
	defer s.aiOAuthMu.Unlock()
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Error(codes.Internal, "Could not load AI settings.")
	}
	if setting == nil {
		setting = &storepb.InstanceAISetting{}
	}
	if setting.ChatgptHostId == "" {
		var random [16]byte
		if _, err := rand.Read(random[:]); err != nil {
			return nil, status.Error(codes.Internal, "Could not create this installation's identity.")
		}
		random[6] = (random[6] & 15) | 64
		random[8] = (random[8] & 63) | 128
		setting.ChatgptHostId = fmt.Sprintf("urn:uuid:%x-%x-%x-%x-%x", random[0:4], random[4:6], random[6:8], random[8:10], random[10:16])
		if _, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: setting}}); err != nil {
			return nil, status.Error(codes.Internal, "Could not save this installation's identity.")
		}
	}
	return setting, nil
}

func (s *APIService) saveChatGPTSignIn(ctx context.Context, id string, credentials llm.ChatGPTCredentials) error {
	s.aiOAuthMu.Lock()
	defer s.aiOAuthMu.Unlock()
	return s.saveChatGPTProvider(ctx, id, credentials)
}

func (s *APIService) saveChatGPTProvider(ctx context.Context, id string, credentials llm.ChatGPTCredentials) error {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return status.Error(codes.Internal, "Could not load AI connections.")
	}
	if setting == nil {
		setting = &storepb.InstanceAISetting{}
	}
	encoded, err := json.Marshal(credentials)
	if err != nil {
		return status.Error(codes.Internal, "Could not save the ChatGPT connection.")
	}
	title := "ChatGPT"
	if credentials.Email != "" {
		title += " · " + credentials.Email
	}
	next := &storepb.AIProviderConfig{Id: id, Title: title, Type: storepb.AIProviderType_CHATGPT, Endpoint: ai.DefaultEndpoint(ai.ProviderChatGPT), ApiKey: string(encoded)}
	found := false
	for index, provider := range setting.Providers {
		if provider.Id == id {
			setting.Providers[index] = next
			found = true
			break
		}
	}
	if !found {
		setting.Providers = append(setting.Providers, next)
	}
	if _, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: setting}}); err != nil {
		return status.Error(codes.Internal, "Could not save the ChatGPT connection.")
	}
	return nil
}

// DisconnectChatGPT attempts revocation and clears tokens even when the provider cannot confirm revocation.
func (s *APIService) DisconnectChatGPT(ctx context.Context, request *apipb.DisconnectChatGPTRequest) (*apipb.DisconnectChatGPTResponse, error) {
	if err := s.requireAIConnectionAdmin(ctx); err != nil {
		return nil, err
	}
	s.aiOAuthMu.Lock()
	defer s.aiOAuthMu.Unlock()
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Error(codes.Internal, "Could not load AI connections.")
	}
	for _, provider := range setting.GetProviders() {
		if provider.Id != request.GetProviderId() || provider.Type != storepb.AIProviderType_CHATGPT {
			continue
		}
		var credentials llm.ChatGPTCredentials
		if json.Unmarshal([]byte(provider.ApiKey), &credentials) != nil {
			return nil, status.Error(codes.FailedPrecondition, "The ChatGPT connection is invalid.")
		}
		revoked := llm.RevokeChatGPTSession(ctx, s.aiOAuthHTTPClient, credentials) == nil
		credentials.AccessToken, credentials.RefreshToken, credentials.IDToken = "", "", ""
		credentials.Scopes = nil
		credentials.ExpiresAt = 0
		if err := s.saveChatGPTProvider(ctx, provider.Id, credentials); err != nil {
			return nil, err
		}
		return &apipb.DisconnectChatGPTResponse{RemoteRevocationConfirmed: revoked}, nil
	}
	return nil, status.Error(codes.NotFound, "ChatGPT connection not found.")
}

func (s *APIService) refreshOAuthProvider(ctx context.Context, provider ai.ProviderConfig) (ai.ProviderConfig, error) {
	if provider.Type != ai.ProviderChatGPT && provider.Type != ai.ProviderAntigravity {
		return provider, nil
	}
	s.aiOAuthMu.Lock()
	defer s.aiOAuthMu.Unlock()
	// Re-read after acquiring the lock, so concurrent requests never reuse a rotated refresh token.
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return provider, status.Error(codes.Internal, "Could not load the AI connection.")
	}
	found := false
	for _, saved := range setting.GetProviders() {
		if saved.Id == provider.ID {
			current := convertAIProviderConfigFromStore(saved)
			if current.Type != provider.Type {
				return provider, status.Error(codes.FailedPrecondition, "The AI connection changed. Select it again in Settings.")
			}
			provider = current
			found = true
			break
		}
	}
	if !found {
		return provider, status.Error(codes.FailedPrecondition, "The AI connection was removed. Connect it again in Settings.")
	}
	if provider.Type == ai.ProviderChatGPT {
		var credentials llm.ChatGPTCredentials
		if json.Unmarshal([]byte(provider.APIKey), &credentials) != nil {
			return provider, status.Error(codes.FailedPrecondition, "Connect ChatGPT in AI & meetings first.")
		}
		if credentials.AccessToken != "" && time.Now().UnixMilli() >= credentials.ExpiresAt-60000 {
			refreshed, refreshErr := llm.RefreshChatGPTCredentials(ctx, s.aiOAuthHTTPClient, credentials)
			if refreshErr != nil {
				return provider, status.Error(codes.FailedPrecondition, refreshErr.Error())
			}
			if err := s.saveChatGPTProvider(ctx, provider.ID, *refreshed); err != nil {
				return provider, err
			}
			encoded, _ := json.Marshal(refreshed)
			provider.APIKey = string(encoded)
		}
	} else {
		var credentials llm.AntigravityOAuthCredentials
		if json.Unmarshal([]byte(provider.APIKey), &credentials) != nil {
			return provider, nil
		}
		if credentials.ClientID == "" {
			credentials.ClientID, credentials.ClientSecret, _ = s.antigravityClientConfig(ctx)
		}
		if credentials.ExpiresAt > 0 && time.Now().UnixMilli() >= credentials.ExpiresAt-60000 && credentials.RefreshToken != "" {
			refreshed, refreshErr := llm.RefreshAntigravityCredentials(ctx, s.aiOAuthHTTPClient, credentials)
			if refreshErr != nil {
				return provider, status.Error(codes.FailedPrecondition, "Antigravity could not renew the connection. Check Antigravity setup and reconnect Google.")
			}
			if _, err := s.saveAntigravityOAuthProvider(ctx, provider.ID, provider.Title, refreshed); err != nil {
				return provider, status.Error(codes.Internal, "Could not save the renewed Antigravity connection.")
			}
			credentials = *refreshed
		}
		encoded, _ := json.Marshal(credentials)
		provider.APIKey = string(encoded)
	}
	return provider, nil
}
