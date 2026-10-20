package llm

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/provider/ai"
)

func TestChatGPTAuthorizationSeparatesInitialAndReturningRegistrations(t *testing.T) {
	initial, err := url.Parse(ChatGPTAuthorizationURL(ChatGPTCredentials{}, "urn:uuid:test-host", "http://127.0.0.1:1455/auth/callback", "state", "nonce", "challenge"))
	require.NoError(t, err)
	require.Equal(t, "dynamic_agent_client", initial.Query().Get("client_id"))
	require.Equal(t, "Noter.ai", initial.Query().Get("agent_name_hint"))
	require.Equal(t, "urn:uuid:test-host", initial.Query().Get("ext_agent_host_id"))
	require.Equal(t, "S256", initial.Query().Get("code_challenge_method"))
	require.Equal(t, ChatGPTResource, initial.Query().Get("resource"))
	returning, _ := url.Parse(ChatGPTAuthorizationURL(ChatGPTCredentials{ClientID: "issued-id", IDToken: "retained-id", Email: "test@example.com"}, "urn:uuid:test-host", "http://127.0.0.1:5555/auth/callback", "new-state", "new-nonce", "new-challenge"))
	require.Equal(t, "issued-id", returning.Query().Get("client_id"))
	require.Empty(t, returning.Query().Get("agent_name_hint"))
	require.Equal(t, "retained-id", returning.Query().Get("id_token_hint"))
	require.Equal(t, "test@example.com", returning.Query().Get("login_hint"))
	for _, tc := range []struct {
		previous, returned string
		valid              bool
	}{{"", "", false}, {"", "dynamic_agent_client", false}, {"", "issued-id", true}, {"issued-id", "different", false}, {"issued-id", "", true}, {"issued-id", "issued-id", true}} {
		_, err := ChatGPTCallbackClient(tc.previous, tc.returned)
		require.Equal(t, tc.valid, err == nil)
	}
}

type chatGPTFixture struct {
	key       *rsa.PrivateKey
	claims    jwt.MapClaims
	scopes    string
	tokenForm url.Values
	calls     []string
}

func newChatGPTFixture(t *testing.T) *chatGPTFixture {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	return &chatGPTFixture{key: key, scopes: "openid resource.invoke " + ChatGPTPlanScope, claims: jwt.MapClaims{"iss": ChatGPTIssuer, "aud": "issued-id", "sub": "account-one", "email": "test@example.com", "nonce": "expected-nonce", "exp": time.Now().Add(time.Hour).Unix()}}
}

func (fixture *chatGPTFixture) RoundTrip(request *http.Request) (*http.Response, error) {
	fixture.calls = append(fixture.calls, request.URL.Path)
	var body any
	switch request.URL.Path {
	case "/api/accounts/oauth/token":
		_ = request.ParseForm()
		fixture.tokenForm = request.PostForm
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, fixture.claims)
		token.Header["kid"] = "fixture-key"
		signed, err := token.SignedString(fixture.key)
		if err != nil {
			return nil, err
		}
		body = map[string]any{"access_token": "fixture-access", "refresh_token": "rotated-refresh", "id_token": signed, "expires_in": 3600, "token_type": "Bearer", "scope": fixture.scopes}
	case "/.well-known/openid-configuration":
		body = map[string]any{"issuer": ChatGPTIssuer, "jwks_uri": ChatGPTIssuer + "/jwks", "revocation_endpoint": ChatGPTIssuer + "/revoke"}
	case "/jwks":
		body = map[string]any{"keys": []map[string]string{{"kid": "fixture-key", "kty": "RSA", "alg": "RS256", "use": "sig", "n": base64.RawURLEncoding.EncodeToString(fixture.key.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(fixture.key.E)).Bytes())}}}
	case "/revoke":
		_ = request.ParseForm()
		fixture.tokenForm = request.PostForm
		body = map[string]any{}
	default:
		body = map[string]any{}
	}
	encoded, _ := json.Marshal(body)
	return oauthResponse(request, string(encoded)), nil
}

func TestChatGPTExchangeVerifiesIdentityAndGrantedPlanPermission(t *testing.T) {
	fixture := newChatGPTFixture(t)
	client := &http.Client{Transport: fixture}
	credentials, err := ExchangeChatGPTCode(context.Background(), client, ChatGPTCredentials{}, "issued-id", "host", "test-code", "verifier", "http://127.0.0.1:1455/auth/callback", "expected-nonce")
	require.NoError(t, err)
	require.True(t, credentials.PlanEnabled())
	require.Equal(t, "account-one", credentials.Subject)
	require.Equal(t, "issued-id", fixture.tokenForm.Get("client_id"))
	require.Equal(t, "verifier", fixture.tokenForm.Get("code_verifier"))
	require.Equal(t, "http://127.0.0.1:1455/auth/callback", fixture.tokenForm.Get("redirect_uri"))
	require.Equal(t, ChatGPTResource, fixture.tokenForm.Get("resource"))
	require.Empty(t, fixture.tokenForm.Get("client_secret"))
	fixture.scopes = "openid email"
	identityOnly, err := ExchangeChatGPTCode(context.Background(), client, ChatGPTCredentials{}, "issued-id", "host", "test-code", "verifier", "http://127.0.0.1:1455/auth/callback", "expected-nonce")
	require.NoError(t, err)
	require.False(t, identityOnly.PlanEnabled())
	for _, tc := range []struct {
		name, claim string
		value       any
	}{{"wrong issuer", "iss", "https://untrusted.example"}, {"wrong audience", "aud", "other-client"}, {"wrong nonce", "nonce", "other-nonce"}, {"expired", "exp", time.Now().Add(-time.Hour).Unix()}, {"missing expiry", "exp", nil}, {"missing subject", "sub", ""}} {
		t.Run(tc.name, func(t *testing.T) {
			old := fixture.claims[tc.claim]
			fixture.claims[tc.claim] = tc.value
			defer func() { fixture.claims[tc.claim] = old }()
			_, err := ExchangeChatGPTCode(context.Background(), client, ChatGPTCredentials{}, "issued-id", "host", "code", "verifier", "http://127.0.0.1:1455/auth/callback", "expected-nonce")
			require.Error(t, err)
			require.NotContains(t, err.Error(), "fixture-access")
		})
	}
	_, err = ExchangeChatGPTCode(context.Background(), client, ChatGPTCredentials{Subject: "different-account"}, "issued-id", "host", "code", "verifier", "http://127.0.0.1:1455/auth/callback", "expected-nonce")
	require.ErrorContains(t, err, "different ChatGPT account")
}

func TestChatGPTRefreshRotatesTokensAndRevokesWithIssuedClient(t *testing.T) {
	fixture := newChatGPTFixture(t)
	previous := ChatGPTCredentials{ClientID: "issued-id", HostID: "host", Subject: "account-one", AccessToken: "old-access", RefreshToken: "old-refresh", Scopes: []string{ChatGPTPlanScope, "resource.invoke"}}
	next, err := RefreshChatGPTCredentials(context.Background(), &http.Client{Transport: fixture}, previous)
	require.NoError(t, err)
	require.Equal(t, "issued-id", fixture.tokenForm.Get("client_id"))
	require.Equal(t, "old-refresh", fixture.tokenForm.Get("refresh_token"))
	require.Empty(t, fixture.tokenForm.Get("scope"))
	require.Equal(t, "rotated-refresh", next.RefreshToken)
	require.Equal(t, previous.HostID, next.HostID)
	require.NoError(t, RevokeChatGPTSession(context.Background(), &http.Client{Transport: fixture}, *next))
	require.Equal(t, "rotated-refresh", fixture.tokenForm.Get("token"))
	require.Equal(t, "issued-id", fixture.tokenForm.Get("client_id"))
}

func TestChatGPTResponsesRequiresCompletedInferenceAndProtectsTokens(t *testing.T) {
	credentials := ChatGPTCredentials{ClientID: "issued-id", Subject: "account-one", AccessToken: "fixture-access", Scopes: []string{ChatGPTPlanScope, "resource.invoke"}, ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
	encoded, _ := json.Marshal(credentials)
	for _, tc := range []struct {
		name, events string
		valid        bool
	}{{"complete", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"pong\"}\n\ndata: {\"type\":\"response.completed\"}\n\n", true}, {"interrupted", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\n", false}, {"failed after text", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"partial\"}\n\ndata: {\"type\":\"response.failed\"}\n\n", false}, {"incomplete", "data: {\"type\":\"response.incomplete\"}\n\n", false}} {
		t.Run(tc.name, func(t *testing.T) {
			client, err := New(ai.ProviderConfig{Type: ai.ProviderChatGPT, APIKey: string(encoded)}, &http.Client{Transport: oauthFixtureTransport(func(request *http.Request) (*http.Response, error) {
				require.Equal(t, ChatGPTResource+"/responses", request.URL.String())
				require.Equal(t, "Bearer fixture-access", request.Header.Get("Authorization"))
				var payload map[string]any
				require.NoError(t, json.NewDecoder(request.Body).Decode(&payload))
				require.Equal(t, false, payload["store"])
				require.Equal(t, true, payload["stream"])
				return oauthResponse(request, tc.events), nil
			})})
			require.NoError(t, err)
			response, err := client.Generate(context.Background(), Request{Model: "account-model", UserPrompt: "Ping"})
			require.Equal(t, tc.valid, err == nil)
			if tc.valid {
				require.Equal(t, "pong", response.Text)
			} else {
				require.Nil(t, response)
				require.NotContains(t, err.Error(), "fixture-access")
			}
		})
	}
}

func TestChatGPTModelCatalogUsesVisibleAccountModelsInServerOrder(t *testing.T) {
	credentials := ChatGPTCredentials{AccessToken: "fixture-access", Subject: "account-one", Scopes: []string{ChatGPTPlanScope, "resource.invoke"}}
	models, err := FetchChatGPTModels(context.Background(), &http.Client{Transport: oauthFixtureTransport(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, ChatGPTResource+"/models", request.URL.String())
		return oauthResponse(request, `{"models":[{"slug":"second","display_name":"Second","visibility":"list"},{"slug":"hidden","visibility":"hidden"},{"slug":"first","display_name":"First","visibility":"list"}]}`), nil
	})}, credentials)
	require.NoError(t, err)
	require.Len(t, models, 2)
	require.Equal(t, "second", models[0].ID)
	require.Equal(t, "first", models[1].ID)
}

func TestOpenAIQuotaErrorExplainsSeparateBillingWithoutEchoingProviderData(t *testing.T) {
	response := &http.Response{StatusCode: 429, Body: io.NopCloser(strings.NewReader(`{"error":{"code":"insufficient_quota","message":"do not echo fixture-private-token"}}`))}
	err := openAIHTTPError(response)
	require.ErrorContains(t, err, "API credits or billing")
	require.NotContains(t, err.Error(), "fixture-private-token")
}
