package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/provider/ai/llm"
	"github.com/usememos/memos/store"
)

func TestAntigravitySetupPersistsWithoutEnvironmentAndNeverReturnsSecret(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "")
	service := newIntegrationService(t)
	admin := createSpaceTestUser(context.Background(), t, service, "oauth-setup-owner", store.RoleAdmin)
	ctx := userCtx(context.Background(), admin.ID)
	ready, err := service.GetAIConnectionStatus(ctx, &apipb.GetAIConnectionStatusRequest{})
	require.NoError(t, err)
	require.False(t, ready.AntigravityConfigured)
	_, err = service.ConfigureAntigravityOAuth(context.Background(), &apipb.ConfigureAntigravityOAuthRequest{ClientId: "fixture.apps.googleusercontent.com", ClientSecret: "fixture-private-secret"})
	require.Equal(t, codes.Unauthenticated, status.Code(err))
	_, err = service.ConfigureAntigravityOAuth(ctx, &apipb.ConfigureAntigravityOAuthRequest{ClientId: "invalid", ClientSecret: "fixture-private-secret"})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
	ready, err = service.ConfigureAntigravityOAuth(ctx, &apipb.ConfigureAntigravityOAuthRequest{ClientId: "fixture.apps.googleusercontent.com", ClientSecret: "fixture-private-secret"})
	require.NoError(t, err)
	require.True(t, ready.AntigravityConfigured)
	require.NotContains(t, protojson.Format(ready), "fixture-private-secret")
	second := NewAPIService(service.Secret, service.Profile, service.Store)
	id, secret, err := second.antigravityClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, "fixture.apps.googleusercontent.com", id)
	require.Equal(t, "fixture-private-secret", secret)
	_, err = second.ConfigureAntigravityOAuth(ctx, &apipb.ConfigureAntigravityOAuthRequest{ClientId: id})
	require.NoError(t, err)
	_, err = second.ConfigureAntigravityOAuth(ctx, &apipb.ConfigureAntigravityOAuthRequest{ClientId: "other.apps.googleusercontent.com"})
	require.Equal(t, codes.InvalidArgument, status.Code(err))
	_, err = second.UpdateInstanceSetting(ctx, &apipb.UpdateInstanceSettingRequest{InstanceSetting: &apipb.InstanceSetting{Name: "instance/settings/AI", Value: &apipb.InstanceSetting_AiSetting{AiSetting: &apipb.InstanceSetting_AISetting{}}}})
	require.NoError(t, err)
	id, secret, err = second.antigravityClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, "fixture.apps.googleusercontent.com", id)
	require.Equal(t, "fixture-private-secret", secret)
	setting, err := second.GetInstanceSetting(ctx, &apipb.GetInstanceSettingRequest{Name: "instance/settings/AI"})
	require.NoError(t, err)
	require.NotContains(t, protojson.Format(setting), "fixture-private-secret")
	regular := createSpaceTestUser(context.Background(), t, service, "oauth-setup-member", store.RoleUser)
	_, err = second.GetAIConnectionStatus(userCtx(context.Background(), regular.ID), &apipb.GetAIConnectionStatusRequest{})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

type aiOAuthTestTransport func(*http.Request) (*http.Response, error)

func (transport aiOAuthTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestChatGPTCallbackRejectsStateAndRetainsRegistrationForRetry(t *testing.T) {
	service := newIntegrationService(t)
	admin := createSpaceTestUser(context.Background(), t, service, "chatgpt-owner", store.RoleAdmin)
	ctx, cancel := context.WithTimeout(userCtx(context.Background(), admin.ID), 5*time.Second)
	defer cancel()
	var firstHost string
	service.aiOAuthHTTPClient = &http.Client{Transport: aiOAuthTestTransport(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, llm.ChatGPTTokenURL, request.URL.String())
		require.NoError(t, request.ParseForm())
		require.Equal(t, "issued-fixture-client", request.Form.Get("client_id"))
		require.NotEmpty(t, request.Form.Get("code_verifier"))
		require.Equal(t, llm.ChatGPTResource, request.Form.Get("resource"))
		return &http.Response{StatusCode: 401, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"error":"invalid_grant"}`)), Request: request}, nil
	})}
	service.aiOAuthOpenBrowser = func(value string) {
		u, err := url.Parse(value)
		require.NoError(t, err)
		require.Equal(t, "dynamic_agent_client", u.Query().Get("client_id"))
		require.Equal(t, "Noter.ai", u.Query().Get("agent_name_hint"))
		firstHost = u.Query().Get("ext_agent_host_id")
		require.True(t, strings.HasPrefix(firstHost, "urn:uuid:"))
		callback, err := url.Parse(u.Query().Get("redirect_uri"))
		require.NoError(t, err)
		require.Equal(t, "127.0.0.1", callback.Hostname())
		require.Equal(t, "/auth/callback", callback.Path)
		q := url.Values{"state": {"wrong-state"}, "code": {"fixture-code"}, "client_id": {"issued-fixture-client"}}
		callback.RawQuery = q.Encode()
		response, err := http.Get(callback.String())
		require.NoError(t, err)
		require.Equal(t, 400, response.StatusCode)
		_ = response.Body.Close()
		q.Set("state", u.Query().Get("state"))
		callback.RawQuery = q.Encode()
		response, err = http.Get(callback.String())
		require.NoError(t, err)
		require.Equal(t, 200, response.StatusCode)
		_ = response.Body.Close()
	}
	_, err := service.StartChatGPTOAuth(ctx, &apipb.StartChatGPTOAuthRequest{ProviderId: "test-connection"})
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
	setting, err := service.Store.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	require.Equal(t, firstHost, setting.ChatgptHostId)
	require.Len(t, setting.Providers, 1)
	var credentials llm.ChatGPTCredentials
	require.NoError(t, json.Unmarshal([]byte(setting.Providers[0].ApiKey), &credentials))
	require.Equal(t, "issued-fixture-client", credentials.ClientID)
	require.Empty(t, credentials.AccessToken)
	service.aiOAuthOpenBrowser = func(value string) {
		u, err := url.Parse(value)
		require.NoError(t, err)
		require.Equal(t, "issued-fixture-client", u.Query().Get("client_id"))
		require.Equal(t, firstHost, u.Query().Get("ext_agent_host_id"))
		require.Empty(t, u.Query().Get("agent_name_hint"))
		callback, err := url.Parse(u.Query().Get("redirect_uri"))
		require.NoError(t, err)
		callback.RawQuery = url.Values{"state": {u.Query().Get("state")}, "error": {"access_denied"}}.Encode()
		response, err := http.Get(callback.String())
		require.NoError(t, err)
		_ = response.Body.Close()
	}
	_, err = service.StartChatGPTOAuth(ctx, &apipb.StartChatGPTOAuthRequest{ProviderId: "test-connection"})
	require.Equal(t, codes.PermissionDenied, status.Code(err))
}

func TestChatGPTCredentialsAreWriteOnlyAndCannotBeInjectedThroughSettings(t *testing.T) {
	credentials := llm.ChatGPTCredentials{ClientID: "issued-client", Subject: "account", Email: "test@example.com", AccessToken: "fixture-access-private", RefreshToken: "fixture-refresh-private", IDToken: "fixture-id-private", Scopes: []string{llm.ChatGPTPlanScope, "resource.invoke"}, ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
	encoded, err := json.Marshal(credentials)
	require.NoError(t, err)
	converted := convertInstanceAISettingFromStore(&storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{{Id: "account", Type: storepb.AIProviderType_CHATGPT, ApiKey: string(encoded)}}})
	require.True(t, converted.Providers[0].OauthPlanEnabled)
	require.Equal(t, "test@example.com", converted.Providers[0].OauthAccount)
	text := protojson.Format(converted)
	require.NotContains(t, text, "fixture-access-private")
	require.NotContains(t, text, "fixture-refresh-private")
	require.NotContains(t, text, "fixture-id-private")
	service := newIntegrationService(t)
	err = service.prepareInstanceAISettingForUpdate(context.Background(), &storepb.InstanceAISetting{Providers: []*storepb.AIProviderConfig{{Id: "injected", Title: "Injected", Type: storepb.AIProviderType_CHATGPT, ApiKey: string(encoded)}}})
	require.ErrorContains(t, err, "Continue with ChatGPT")
}

func TestAntigravitySavedSetupCompletesSignInAndPersistsRenewal(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "")
	reservation, err := net.Listen("tcp", oauthCallbackAddr)
	if err != nil {
		t.Skip("OAuth callback port is occupied by another connection")
	}
	require.NoError(t, reservation.Close())
	service := newIntegrationService(t)
	admin := createSpaceTestUser(context.Background(), t, service, "google-flow-owner", store.RoleAdmin)
	ctx, cancel := context.WithTimeout(userCtx(context.Background(), admin.ID), 5*time.Second)
	defer cancel()
	_, err = service.ConfigureAntigravityOAuth(ctx, &apipb.ConfigureAntigravityOAuthRequest{ClientId: "fixture.apps.googleusercontent.com", ClientSecret: "fixture-private-secret"})
	require.NoError(t, err)
	refreshes := 0
	service.aiOAuthHTTPClient = &http.Client{Transport: aiOAuthTestTransport(func(request *http.Request) (*http.Response, error) {
		body := `{"cloudaicompanionProject":"fixture-project"}`
		if request.URL.String() == llm.AntigravityTokenURL {
			require.NoError(t, request.ParseForm())
			require.Equal(t, "fixture.apps.googleusercontent.com", request.Form.Get("client_id"))
			require.Equal(t, "fixture-private-secret", request.Form.Get("client_secret"))
			if request.Form.Get("grant_type") == "refresh_token" {
				refreshes++
				require.Equal(t, "fixture-refresh", request.Form.Get("refresh_token"))
				body = `{"access_token":"fixture-renewed","refresh_token":"fixture-rotated","expires_in":3600}`
			} else {
				require.Equal(t, "fixture-code", request.Form.Get("code"))
				require.NotEmpty(t, request.Form.Get("code_verifier"))
				require.Equal(t, llm.AntigravityRedirectURI, request.Form.Get("redirect_uri"))
				body = `{"access_token":"fixture-access","refresh_token":"fixture-refresh","expires_in":3600}`
			}
		} else {
			require.Equal(t, llm.AntigravityLoadCodeAssistURL, request.URL.String())
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: request}, nil
	})}
	service.aiOAuthOpenBrowser = func(value string) {
		authorize, parseErr := url.Parse(value)
		require.NoError(t, parseErr)
		require.Equal(t, "fixture.apps.googleusercontent.com", authorize.Query().Get("client_id"))
		require.Equal(t, "S256", authorize.Query().Get("code_challenge_method"))
		callback, parseErr := url.Parse(authorize.Query().Get("redirect_uri"))
		require.NoError(t, parseErr)
		callback.RawQuery = url.Values{"state": {authorize.Query().Get("state")}, "code": {"fixture-code"}}.Encode()
		response, callbackErr := http.Get(callback.String())
		require.NoError(t, callbackErr)
		require.Equal(t, 200, response.StatusCode)
		_ = response.Body.Close()
	}
	response, err := service.StartAntigravityOAuth(ctx, &apipb.StartAntigravityOAuthRequest{ProviderId: "google-fixture"})
	require.NoError(t, err)
	require.True(t, response.Connected)
	setting, err := service.Store.GetInstanceAISetting(ctx)
	require.NoError(t, err)
	var credentials llm.AntigravityOAuthCredentials
	require.NoError(t, json.Unmarshal([]byte(setting.Providers[0].ApiKey), &credentials))
	require.Equal(t, "fixture-private-secret", credentials.ClientSecret)
	credentials.ExpiresAt = 1
	encoded, err := json.Marshal(credentials)
	require.NoError(t, err)
	setting.Providers[0].ApiKey = string(encoded)
	_, err = service.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: setting}})
	require.NoError(t, err)
	for range 2 {
		resolved, resolveErr := service.resolveAIProvider(ctx, setting, "google-fixture")
		require.NoError(t, resolveErr)
		var renewed llm.AntigravityOAuthCredentials
		require.NoError(t, json.Unmarshal([]byte(resolved.APIKey), &renewed))
		require.Equal(t, "fixture-renewed", renewed.AccessToken)
		require.Equal(t, "fixture-rotated", renewed.RefreshToken)
	}
	require.Equal(t, 1, refreshes)
	public := convertInstanceAISettingFromStore(setting)
	require.NotContains(t, protojson.Format(public), "fixture-private-secret")
}

func TestDesktopAntigravityBuildNeedsNoManualClientSetup(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "")
	previous := llm.DesktopAntigravityClient
	t.Cleanup(func() { llm.DesktopAntigravityClient = previous })
	llm.DesktopAntigravityClient = base64.StdEncoding.EncodeToString([]byte(`{"installed":{"client_id":"publisher.apps.googleusercontent.com","client_secret":"fixture-desktop-configuration"}}`))
	service := newIntegrationService(t)
	admin := createSpaceTestUser(context.Background(), t, service, "bundled-oauth-owner", store.RoleAdmin)
	ctx := userCtx(context.Background(), admin.ID)
	ready, err := service.GetAIConnectionStatus(ctx, &apipb.GetAIConnectionStatusRequest{})
	require.NoError(t, err)
	require.True(t, ready.AntigravityConfigured)
	require.Equal(t, "publisher.apps.googleusercontent.com", ready.AntigravityClientId)
	require.NotContains(t, protojson.Format(ready), "fixture-desktop-configuration")
	_, err = service.ConfigureAntigravityOAuth(ctx, &apipb.ConfigureAntigravityOAuthRequest{ClientId: "custom.apps.googleusercontent.com", ClientSecret: "fixture-custom-client"})
	require.NoError(t, err)
	id, secret, err := service.antigravityClientConfig(ctx)
	require.NoError(t, err)
	require.Equal(t, "custom.apps.googleusercontent.com", id)
	require.Equal(t, "fixture-custom-client", secret)
	llm.DesktopAntigravityClient = base64.StdEncoding.EncodeToString([]byte(`{"web":{"client_id":"confidential.apps.googleusercontent.com","client_secret":"fixture-web-secret"}}`))
	id, secret = llm.BundledAntigravityOAuthClient()
	require.Empty(t, id)
	require.Empty(t, secret)
}

func TestChatGPTRefreshRejectsRemovedOrChangedConnections(t *testing.T) {
	for _, changed := range []bool{false, true} {
		t.Run(map[bool]string{false: "removed", true: "changed"}[changed], func(t *testing.T) {
			service := newIntegrationService(t)
			setting := &storepb.InstanceAISetting{}
			if changed {
				setting.Providers = []*storepb.AIProviderConfig{{Id: "old-connection", Type: storepb.AIProviderType_OPENAI, ApiKey: "fixture-new-key"}}
			}
			_, err := service.Store.UpsertInstanceSetting(context.Background(), &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: setting}})
			require.NoError(t, err)
			service.aiOAuthHTTPClient = &http.Client{Transport: aiOAuthTestTransport(func(*http.Request) (*http.Response, error) {
				t.Error("Removed or replaced credentials must not be used")
				return nil, nil
			})}
			_, err = service.refreshOAuthProvider(context.Background(), ai.ProviderConfig{ID: "old-connection", Type: ai.ProviderChatGPT, APIKey: `{"access_token":"fixture-old-token","expires_at":1}`})
			require.Equal(t, codes.FailedPrecondition, status.Code(err))
		})
	}
}
