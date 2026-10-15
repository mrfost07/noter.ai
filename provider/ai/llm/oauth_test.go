package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/provider/ai"
)

type oauthFixtureTransport func(*http.Request) (*http.Response, error)

func (transport oauthFixtureTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func oauthResponse(request *http.Request, body string) *http.Response {
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    request,
	}
}

func TestAntigravityMissingApplicationCredentialsNeverCallsHTTP(t *testing.T) {
	for _, test := range []struct {
		name, clientID, clientSecret string
	}{
		{name: "both missing"},
		{name: "secret missing", clientID: "private-test-client-id"},
		{name: "client ID missing", clientSecret: "private-test-client-secret"},
		{name: "whitespace only", clientID: " \t", clientSecret: "\n"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", test.clientID)
			t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", test.clientSecret)
			calls := 0
			client := &http.Client{Transport: oauthFixtureTransport(func(request *http.Request) (*http.Response, error) {
				calls++
				return oauthResponse(request, `{}`), nil
			})}

			id, configErr := AntigravityOAuthClientID()
			require.Empty(t, id)
			require.ErrorIs(t, configErr, errAntigravityOAuthNotConfigured)
			credentials, err := ExchangeAntigravityAuthCode(context.Background(), client, "code", "verifier", "")
			require.Nil(t, credentials)
			require.ErrorIs(t, err, errAntigravityOAuthNotConfigured)
			credentials, err = RefreshAntigravityToken(context.Background(), client, "refresh-token", "project")
			require.Nil(t, credentials)
			require.ErrorIs(t, err, errAntigravityOAuthNotConfigured)
			require.NotContains(t, err.Error(), "private-test-client")
			require.Zero(t, calls)
		})
	}
}

func TestAntigravityRefreshReadsConfiguredCredentialsOnEveryCall(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "test-client-id")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "first-test-secret")
	var secrets []string
	client := &http.Client{Transport: oauthFixtureTransport(func(request *http.Request) (*http.Response, error) {
		require.Equal(t, AntigravityTokenURL, request.URL.String())
		require.Equal(t, http.MethodPost, request.Method)
		require.Equal(t, "application/x-www-form-urlencoded", request.Header.Get("Content-Type"))
		require.NoError(t, request.ParseForm())
		require.Equal(t, "test-client-id", request.Form.Get("client_id"))
		require.Equal(t, "refresh_token", request.Form.Get("grant_type"))
		require.Equal(t, "existing-refresh-token", request.Form.Get("refresh_token"))
		secrets = append(secrets, request.Form.Get("client_secret"))
		return oauthResponse(request, `{"access_token":"refreshed-test-token","expires_in":300}`), nil
	})}

	for _, secret := range []string{"first-test-secret", "second-test-secret"} {
		t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", secret)
		before := time.Now().UnixMilli()
		credentials, err := RefreshAntigravityToken(context.Background(), client, "existing-refresh-token", "existing-project")
		require.NoError(t, err)
		require.Equal(t, "refreshed-test-token", credentials.AccessToken)
		require.Equal(t, "existing-refresh-token", credentials.RefreshToken)
		require.Equal(t, "existing-project", credentials.ProjectID)
		require.GreaterOrEqual(t, credentials.ExpiresAt, before+300000)
	}
	require.Equal(t, []string{"first-test-secret", "second-test-secret"}, secrets)
}

func TestAntigravityExchangePreservesPKCEWithConfiguredCredentials(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "test-client-id")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "test-client-secret")
	calls := 0
	client := &http.Client{Transport: oauthFixtureTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		if request.URL.String() == AntigravityTokenURL {
			require.NoError(t, request.ParseForm())
			require.Equal(t, "test-client-id", request.Form.Get("client_id"))
			require.Equal(t, "test-client-secret", request.Form.Get("client_secret"))
			require.Equal(t, "authorization_code", request.Form.Get("grant_type"))
			require.Equal(t, "test-authorization-code", request.Form.Get("code"))
			require.Equal(t, "test-pkce-verifier", request.Form.Get("code_verifier"))
			require.Equal(t, AntigravityRedirectURI, request.Form.Get("redirect_uri"))
			return oauthResponse(request, `{"access_token":"test-access-token","refresh_token":"test-refresh-token","expires_in":300}`), nil
		}
		require.Equal(t, AntigravityLoadCodeAssistURL, request.URL.String())
		require.Equal(t, "Bearer test-access-token", request.Header.Get("Authorization"))
		return oauthResponse(request, `{"cloudaicompanionProject":"test-project"}`), nil
	})}

	credentials, err := ExchangeAntigravityAuthCode(context.Background(), client, "test-authorization-code", "test-pkce-verifier", "")
	require.NoError(t, err)
	require.Equal(t, "test-access-token", credentials.AccessToken)
	require.Equal(t, "test-refresh-token", credentials.RefreshToken)
	require.Equal(t, "test-project", credentials.ProjectID)
	require.Equal(t, 2, calls)
}

func TestAntigravityExpiredCredentialsRequireApplicationConfigBeforeGeneration(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "")
	calls := 0
	httpClient := &http.Client{Transport: oauthFixtureTransport(func(request *http.Request) (*http.Response, error) {
		calls++
		return oauthResponse(request, `{}`), nil
	})}
	encoded, err := json.Marshal(AntigravityOAuthCredentials{
		AccessToken: "expired-test-token", RefreshToken: "test-refresh-token", ExpiresAt: 1, ProjectID: "test-project",
	})
	require.NoError(t, err)
	client, err := New(ai.ProviderConfig{Type: ai.ProviderAntigravity, APIKey: string(encoded)}, httpClient)
	require.NoError(t, err)
	response, err := client.Generate(context.Background(), Request{UserPrompt: "Test prompt"})
	require.Nil(t, response)
	require.ErrorIs(t, err, errAntigravityOAuthNotConfigured)
	require.Zero(t, calls)
}
