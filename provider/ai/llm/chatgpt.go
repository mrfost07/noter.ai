package llm

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/pkg/errors"
)

const (
	ChatGPTIssuer       = "https://auth.openai.com"
	ChatGPTAuthorizeURL = ChatGPTIssuer + "/api/accounts/authorize"
	ChatGPTTokenURL     = ChatGPTIssuer + "/api/accounts/oauth/token"
	ChatGPTResource     = "https://api.openai.com/v1"
	ChatGPTPlanScope    = "chatgpt.tokens.use.direct"
)

// ChatGPTCredentials belongs to one verified identity and its separately issued OAuth client.
// It is stored only in the private backend settings, never returned as an API key to the UI.
type ChatGPTCredentials struct {
	ClientID     string   `json:"client_id"`
	HostID       string   `json:"ext_agent_host_id"`
	Subject      string   `json:"subject"`
	Email        string   `json:"email"`
	IDToken      string   `json:"id_token"`
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	Scopes       []string `json:"scopes"`
	ExpiresAt    int64    `json:"expires_at"`
}

// PlanEnabled distinguishes account identity from authorization to use the ChatGPT plan.
func (c ChatGPTCredentials) PlanEnabled() bool {
	return c.AccessToken != "" && c.Subject != "" && slices.Contains(c.Scopes, ChatGPTPlanScope) && slices.Contains(c.Scopes, "resource.invoke")
}

// ChatGPTAuthorizationURL creates the official open-source PKCE authorization request.
func ChatGPTAuthorizationURL(previous ChatGPTCredentials, hostID, redirectURI, state, nonce, challenge string) string {
	id := previous.ClientID
	if id == "" {
		id = "dynamic_agent_client"
	}
	params := url.Values{
		"client_id": {id}, "ext_agent_host_id": {hostID}, "response_type": {"code"}, "redirect_uri": {redirectURI},
		"scope":    {"openid profile email offline_access resource.invoke " + ChatGPTPlanScope},
		"resource": {ChatGPTResource}, "state": {state}, "nonce": {nonce}, "code_challenge_method": {"S256"}, "code_challenge": {challenge},
	}
	if id == "dynamic_agent_client" {
		params.Set("agent_name_hint", "Noter.ai")
	} else {
		if previous.IDToken != "" {
			params.Set("id_token_hint", previous.IDToken)
		}
		if previous.Email != "" {
			params.Set("login_hint", previous.Email)
		}
	}
	return ChatGPTAuthorizeURL + "?" + params.Encode()
}

// ChatGPTCallbackClient validates the registration ID before the authorization code is exchanged.
func ChatGPTCallbackClient(previousID, callbackID string) (string, error) {
	if previousID != "" {
		if callbackID != "" && callbackID != previousID {
			return "", errors.New("connection: ChatGPT returned a different account registration. The existing connection was kept")
		}
		return previousID, nil
	}
	if callbackID == "" || callbackID == "dynamic_agent_client" || len(callbackID) > 512 {
		return "", errors.New("connection: ChatGPT registration did not return an issued client ID. Try connecting again")
	}
	return callbackID, nil
}

type chatGPTTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
	Scope        string `json:"scope"`
}

func oauthHTTPClient(client *http.Client) *http.Client {
	if client != nil {
		return client
	}
	return &http.Client{Timeout: 30 * time.Second}
}

func chatGPTTokenRequest(ctx context.Context, client *http.Client, form url.Values) (*chatGPTTokenResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, ChatGPTTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errors.New("connection: Could not prepare ChatGPT authentication")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := oauthHTTPClient(client).Do(request)
	if err != nil {
		return nil, errors.New("connection: Could not reach ChatGPT authentication. Check your connection and try again")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, openAIHTTPError(response)
	}
	var token chatGPTTokenResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes)).Decode(&token); err != nil {
		return nil, errors.New("connection: ChatGPT returned an invalid token response")
	}
	if token.AccessToken == "" || !strings.EqualFold(token.TokenType, "Bearer") || token.ExpiresIn <= 0 {
		return nil, errors.New("connection: ChatGPT did not return usable credentials. Connect again")
	}
	return &token, nil
}

type chatGPTIdentity struct {
	jwt.RegisteredClaims
	Email string `json:"email"`
	Nonce string `json:"nonce"`
}

func chatGPTMetadata(ctx context.Context, client *http.Client) (map[string]string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, ChatGPTIssuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return nil, err
	}
	response, err := oauthHTTPClient(client).Do(request)
	if err != nil {
		return nil, errors.New("connection: Could not load ChatGPT identity verification metadata")
	}
	defer response.Body.Close()
	var raw struct {
		Issuer     string `json:"issuer"`
		JWKS       string `json:"jwks_uri"`
		Revocation string `json:"revocation_endpoint"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes)).Decode(&raw) != nil || raw.Issuer != ChatGPTIssuer {
		return nil, errors.New("connection: ChatGPT identity metadata could not be verified")
	}
	return map[string]string{"jwks": raw.JWKS, "revocation": raw.Revocation}, nil
}

func trustedChatGPTURL(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Host == "auth.openai.com" && u.User == nil && u.RawQuery == "" && u.Fragment == ""
}

func verifyChatGPTIdentity(ctx context.Context, client *http.Client, token, clientID, nonce string) (*chatGPTIdentity, error) {
	metadata, err := chatGPTMetadata(ctx, client)
	if err != nil {
		return nil, err
	}
	if !trustedChatGPTURL(metadata["jwks"]) {
		return nil, errors.New("connection: ChatGPT published an unexpected identity-key endpoint")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, metadata["jwks"], nil)
	if err != nil {
		return nil, err
	}
	response, err := oauthHTTPClient(client).Do(request)
	if err != nil {
		return nil, errors.New("connection: Could not load ChatGPT identity verification keys")
	}
	defer response.Body.Close()
	var keys struct {
		Keys []struct {
			Kid string `json:"kid"`
			Kty string `json:"kty"`
			Alg string `json:"alg"`
			Use string `json:"use"`
			N   string `json:"n"`
			E   string `json:"e"`
		} `json:"keys"`
	}
	if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes)).Decode(&keys) != nil {
		return nil, errors.New("connection: ChatGPT identity verification keys are unavailable")
	}
	identity := &chatGPTIdentity{}
	_, err = jwt.ParseWithClaims(token, identity, func(t *jwt.Token) (any, error) {
		kid, ok := t.Header["kid"].(string)
		if !ok {
			return nil, errors.New("connection: ChatGPT did not identify the signing key")
		}
		for _, key := range keys.Keys {
			if kid == "" || key.Kid != kid || key.Kty != "RSA" || (key.Use != "" && key.Use != "sig") || (key.Alg != "" && key.Alg != "RS256") {
				continue
			}
			n, nErr := base64.RawURLEncoding.DecodeString(key.N)
			e, eErr := base64.RawURLEncoding.DecodeString(key.E)
			if nErr != nil || eErr != nil || len(n) < 256 || len(e) > 4 || len(e) == 0 {
				continue
			}
			exponent := 0
			for _, b := range e {
				exponent = exponent<<8 | int(b)
			}
			if exponent < 3 {
				continue
			}
			return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: exponent}, nil
		}
		return nil, errors.New("connection: Unknown ChatGPT signing key")
	}, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(ChatGPTIssuer), jwt.WithAudience(clientID), jwt.WithExpirationRequired())
	if err != nil || identity.Subject == "" || (nonce != "" && identity.Nonce != nonce) {
		return nil, errors.New("connection: ChatGPT identity verification failed. The previous connection was kept")
	}
	return identity, nil
}

// ExchangeChatGPTCode validates identity and granted permissions before returning account credentials.
func ExchangeChatGPTCode(ctx context.Context, client *http.Client, previous ChatGPTCredentials, issuedID, hostID, code, verifier, redirectURI, nonce string) (*ChatGPTCredentials, error) {
	token, err := chatGPTTokenRequest(ctx, client, url.Values{"grant_type": {"authorization_code"}, "client_id": {issuedID}, "code": {code}, "code_verifier": {verifier}, "redirect_uri": {redirectURI}, "resource": {ChatGPTResource}})
	if err != nil {
		return nil, err
	}
	identity, err := verifyChatGPTIdentity(ctx, client, token.IDToken, issuedID, nonce)
	if err != nil {
		return nil, err
	}
	if previous.Subject != "" && previous.Subject != identity.Subject {
		return nil, errors.New("connection: A different ChatGPT account was returned. Add it as a separate connection")
	}
	credentials := &ChatGPTCredentials{ClientID: issuedID, HostID: hostID, Subject: identity.Subject, Email: identity.Email, IDToken: token.IDToken, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, Scopes: strings.Fields(token.Scope), ExpiresAt: time.Now().UnixMilli() + token.ExpiresIn*1000}
	return credentials, nil
}

// RefreshChatGPTCredentials rotates a session without changing its account registration.
func RefreshChatGPTCredentials(ctx context.Context, client *http.Client, previous ChatGPTCredentials) (*ChatGPTCredentials, error) {
	if previous.RefreshToken == "" || previous.ClientID == "" {
		return nil, errors.New("connection: Reconnect ChatGPT to renew this session")
	}
	token, err := chatGPTTokenRequest(ctx, client, url.Values{"grant_type": {"refresh_token"}, "client_id": {previous.ClientID}, "refresh_token": {previous.RefreshToken}, "resource": {ChatGPTResource}})
	if err != nil {
		return nil, err
	}
	if token.RefreshToken == "" {
		return nil, errors.New("connection: ChatGPT did not return a replacement refresh token. Reconnect the account")
	}
	next := previous
	if token.IDToken != "" {
		identity, identityErr := verifyChatGPTIdentity(ctx, client, token.IDToken, previous.ClientID, "")
		if identityErr != nil {
			return nil, identityErr
		}
		if identity.Subject != previous.Subject {
			return nil, errors.New("connection: ChatGPT refresh returned a different identity")
		}
		next.IDToken, next.Email = token.IDToken, identity.Email
	}
	next.AccessToken, next.RefreshToken = token.AccessToken, token.RefreshToken
	if token.Scope != "" {
		next.Scopes = strings.Fields(token.Scope)
	}
	next.ExpiresAt = time.Now().UnixMilli() + token.ExpiresIn*1000
	return &next, nil
}

// RevokeChatGPTSession ends this registration's renewable session using published metadata.
func RevokeChatGPTSession(ctx context.Context, client *http.Client, credentials ChatGPTCredentials) error {
	if credentials.RefreshToken == "" {
		return nil
	}
	metadata, err := chatGPTMetadata(ctx, client)
	if err != nil {
		return err
	}
	if !trustedChatGPTURL(metadata["revocation"]) {
		return errors.New("connection: ChatGPT did not publish a trusted revocation endpoint")
	}
	form := url.Values{"token": {credentials.RefreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {credentials.ClientID}}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata["revocation"], strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := oauthHTTPClient(client).Do(request)
	if err != nil {
		return errors.New("connection: ChatGPT remote sign-out could not be confirmed")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return errors.New("connection: ChatGPT remote sign-out could not be confirmed")
	}
	return nil
}

func openAIHTTPError(response *http.Response) error {
	var body struct {
		Error json.RawMessage `json:"error"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, maxErrorBodyBytes)).Decode(&body)
	var detail struct {
		Code string `json:"code"`
		Type string `json:"type"`
	}
	_ = json.Unmarshal(body.Error, &detail)
	if detail.Code == "insufficient_quota" || detail.Type == "insufficient_quota" {
		return errors.New("connection: OpenAI API credits or billing are unavailable. Add credits in the OpenAI Platform, or choose a connected ChatGPT plan. Reinstalling Noter.ai will not change API billing")
	}
	switch response.StatusCode {
	case 401, 403:
		return errors.New("connection: OpenAI rejected this connection. Reconnect ChatGPT, or check the API key and model access for the selected API provider")
	case 429:
		return errors.New("connection: OpenAI temporarily limited this connection. Wait before trying again and check the account's usage limits")
	default:
		return errors.Errorf("connection: OpenAI request failed (HTTP %d). Try again or check the provider status", response.StatusCode)
	}
}

func (c *Client) generateChatGPT(ctx context.Context, request Request) (*Response, error) {
	var credentials ChatGPTCredentials
	if json.Unmarshal([]byte(c.cfg.APIKey), &credentials) != nil || !credentials.PlanEnabled() {
		return nil, errors.New("connection: ChatGPT plan usage is not enabled. Connect ChatGPT and allow plan usage before asking AI")
	}
	if time.Now().UnixMilli() >= credentials.ExpiresAt {
		return nil, errors.New("connection: The ChatGPT session expired. Reconnect the account")
	}
	if strings.TrimSpace(request.Model) == "" {
		return nil, errors.New("connection: Refresh ChatGPT models and choose one available to your account")
	}
	payload := map[string]any{"model": request.Model, "input": []map[string]string{{"role": "user", "content": request.UserPrompt}}, "instructions": request.SystemPrompt, "store": false, "stream": true}
	if request.ResponseJSON {
		payload["text"] = map[string]any{"format": map[string]string{"type": "json_object"}}
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, ChatGPTResource+"/responses", bytes.NewReader(encoded))
	if err != nil {
		return nil, err
	}
	httpRequest.Header.Set("Authorization", "Bearer "+credentials.AccessToken)
	httpRequest.Header.Set("Content-Type", "application/json")
	response, err := c.httpClient.Do(httpRequest)
	if err != nil {
		return nil, errors.New("connection: Could not reach OpenAI. Check your connection and try again")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, openAIHTTPError(response)
	}
	scanner := bufio.NewScanner(io.LimitReader(response.Body, 16*maxResponseBytes))
	scanner.Buffer(make([]byte, 4096), maxResponseBytes)
	var text strings.Builder
	completed := false
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "data:") {
			continue
		}
		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "[DONE]" {
			continue
		}
		var event struct {
			Type  string `json:"type"`
			Delta string `json:"delta"`
		}
		if json.Unmarshal([]byte(data), &event) != nil {
			return nil, errors.New("connection: ChatGPT returned an invalid response stream")
		}
		switch event.Type {
		case "response.output_text.delta":
			if text.Len()+len(event.Delta) > maxResponseBytes {
				return nil, errors.New("connection: ChatGPT response exceeded the supported size")
			}
			text.WriteString(event.Delta)
		case "response.completed":
			completed = true
		case "response.failed", "response.incomplete", "error":
			return nil, errors.New("connection: ChatGPT did not finish the answer. Check ChatGPT plan usage and try again; the partial answer was not saved")
		default:
			// Other lifecycle and metadata events do not contain answer text.
		}
	}
	if scanner.Err() != nil || !completed {
		return nil, errors.New("connection: ChatGPT's connection ended before the answer completed. Try again")
	}
	if strings.TrimSpace(text.String()) == "" {
		return nil, errors.New("connection: ChatGPT returned no answer text")
	}
	return &Response{Text: text.String()}, nil
}

// FetchChatGPTModels returns the current account's visible model catalog in server order.
func FetchChatGPTModels(ctx context.Context, client *http.Client, credentials ChatGPTCredentials) ([]AntigravityModel, error) {
	if !credentials.PlanEnabled() {
		return nil, errors.New("connection: Enable ChatGPT plan usage before refreshing models")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, ChatGPTResource+"/models", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+credentials.AccessToken)
	response, err := oauthHTTPClient(client).Do(request)
	if err != nil {
		return nil, errors.New("connection: Could not load your ChatGPT models")
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, openAIHTTPError(response)
	}
	var catalog struct {
		Models []struct {
			Slug       string `json:"slug"`
			Name       string `json:"display_name"`
			Visibility string `json:"visibility"`
		} `json:"models"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, maxResponseBytes)).Decode(&catalog) != nil {
		return nil, errors.New("connection: ChatGPT returned an invalid model catalog")
	}
	models := make([]AntigravityModel, 0, len(catalog.Models))
	for _, model := range catalog.Models {
		if model.Visibility == "list" && model.Slug != "" {
			models = append(models, AntigravityModel{ID: model.Slug, Label: model.Name, RemainingQuota: -1})
		}
	}
	return models, nil
}
