// Package llm implements structured text and JSON generation across
// OpenAI-compatible providers (OpenAI, Groq, DeepSeek, OpenRouter, NVIDIA, Ollama),
// Google Gemini, Anthropic Claude, and Google Antigravity CloudCode OAuth.
package llm

import (
	"bufio"
	"bytes"
	"cmp"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/provider/ai"
)

const (
	defaultHTTPTimeout        = 45 * time.Second
	maxResponseBytes          = 2 * 1024 * 1024
	maxErrorBodyBytes         = 4096
	defaultAntigravityProject = "rising-fact-p41fc"

	// AntigravityAuthorizeURL is the Google OAuth 2.0 authorization endpoint.
	AntigravityAuthorizeURL = "https://accounts.google.com/o/oauth2/v2/auth"
	// AntigravityTokenURL is the Google OAuth 2.0 token endpoint.
	AntigravityTokenURL = "https://oauth2.googleapis.com/token"
	// AntigravityRedirectURI is the loopback redirect URI used by Antigravity OAuth 2.0 PKCE.
	AntigravityRedirectURI = "http://localhost:51121/oauth-callback"
	// AntigravityLoadCodeAssistURL discovers the user's Cloud Code Assist project ID.
	AntigravityLoadCodeAssistURL = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist"
	// AntigravityOnboardURL initializes the user's Cloud Code project if missing.
	AntigravityOnboardURL = "https://cloudcode-pa.googleapis.com/v1internal:onboardUser"
	// AntigravityStreamURL is the daily Cloud Code SSE generation endpoint.
	AntigravityStreamURL = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse"
	// AntigravityModelsURL queries available models and quota fractions.
	AntigravityModelsURL = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels"
	// AntigravityUserAgent is the official Antigravity IDE version string.
	AntigravityUserAgent = "antigravity/2.5.5 windows/amd64"
	// AntigravitySetupClient identifies Google Cloud SDK headers.
	AntigravitySetupClient = "google-cloud-sdk vscode_cloudshelleditor/0.1"
	// AntigravityClientMetadata is the required Client-Metadata payload.
	AntigravityClientMetadata = `{"ideType":"ANTIGRAVITY","platform":"PLATFORM_UNSPECIFIED","pluginType":"GEMINI"}`
	// DefaultAntigravityProjectID is the fallback Cloud Code project ID.
	DefaultAntigravityProjectID = defaultAntigravityProject
)

var errAntigravityOAuthNotConfigured = errors.New("Antigravity OAuth is not configured; set NOTER_ANTIGRAVITY_CLIENT_ID and NOTER_ANTIGRAVITY_CLIENT_SECRET before connecting or refreshing tokens")

func antigravityOAuthClientConfig() (clientID, clientSecret string, err error) {
	clientID = strings.TrimSpace(os.Getenv("NOTER_ANTIGRAVITY_CLIENT_ID"))
	clientSecret = strings.TrimSpace(os.Getenv("NOTER_ANTIGRAVITY_CLIENT_SECRET"))
	if clientID == "" && clientSecret == "" {
		clientID, clientSecret = BundledAntigravityOAuthClient()
	}
	if clientID == "" || clientSecret == "" {
		return "", "", errAntigravityOAuthNotConfigured
	}
	return clientID, clientSecret, nil
}

// AntigravityOAuthClientID returns the configured OAuth client ID after validating application credentials.
func AntigravityOAuthClientID() (string, error) {
	clientID, _, err := antigravityOAuthClientConfig()
	return clientID, err
}

// AntigravityModel describes an available Antigravity model discovered from the API.
type AntigravityModel struct {
	ID             string  `json:"id"`
	Label          string  `json:"label"`
	RemainingQuota float64 `json:"remaining_quota"`
}

// ResolveAntigravityWireModel normalizes model identifiers to their internal Antigravity tiered wire names.
func ResolveAntigravityWireModel(model string) string {
	normalized := strings.ToLower(strings.TrimSpace(model))
	normalized = strings.TrimPrefix(normalized, "models/")
	if strings.HasPrefix(normalized, "gemini-3.8-flash") && !strings.Contains(normalized, "-tiered") && !strings.Contains(normalized, "-high") && !strings.Contains(normalized, "-medium") && !strings.Contains(normalized, "-low") {
		return "gemini-3.8-flash-tiered"
	}
	if strings.HasPrefix(normalized, "gemini-3.7-flash") && !strings.Contains(normalized, "-tiered") && !strings.Contains(normalized, "-high") && !strings.Contains(normalized, "-medium") && !strings.Contains(normalized, "-low") {
		return "gemini-3.7-flash-tiered"
	}
	if strings.HasPrefix(normalized, "gemini-3.6-flash") && !strings.Contains(normalized, "-tiered") && !strings.Contains(normalized, "-high") && !strings.Contains(normalized, "-medium") && !strings.Contains(normalized, "-low") {
		return "gemini-3.6-flash-tiered"
	}
	if normalized == "gemini-3.1-pro-high" || normalized == "gemini-3.1-pro" {
		return "gemini-pro-agent"
	}
	return normalized
}

// AntigravityScopes lists the OAuth 2.0 scopes requested during Antigravity sign-in.
var AntigravityScopes = []string{
	"openid",
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
}

// AntigravityOAuthCredentials holds the OAuth 2.0 tokens and discovered project ID for Antigravity.
type AntigravityOAuthCredentials struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresAt    int64  `json:"expires_at"`
	ProjectID    string `json:"project_id"`
	ClientID     string `json:"client_id,omitempty"`
	ClientSecret string `json:"client_secret,omitempty"`
}

// Request is the input to an LLM text/JSON generation call.
type Request struct {
	Model                string
	SystemPrompt         string
	UserPrompt           string
	ResponseJSON         bool
	Temperature          float32
	AntigravityProjectID string
	AudioContent         []byte
	AudioContentType     string
}

// Response is the output from an LLM generation call.
type Response struct {
	Text string
}

// Client calls any of the supported LLM providers.
type Client struct {
	cfg        ai.ProviderConfig
	httpClient *http.Client
}

// New creates a multi-provider LLM client after validating configuration.
func New(cfg ai.ProviderConfig, httpClient *http.Client) (*Client, error) {
	if ai.RequiresAPIKey(cfg.Type) && strings.TrimSpace(cfg.APIKey) == "" {
		return nil, errors.Errorf("%s API key is required", cfg.Type)
	}
	if err := ai.ValidateEndpoint(cfg.Type, cfg.Endpoint); err != nil {
		return nil, err
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	return &Client{cfg: cfg, httpClient: httpClient}, nil
}

// Generate routes the prompt to the configured LLM provider.
func (c *Client) Generate(ctx context.Context, req Request) (*Response, error) {
	if strings.TrimSpace(req.UserPrompt) == "" && len(req.AudioContent) == 0 {
		return nil, errors.New("user prompt or audio content is required")
	}
	switch c.cfg.Type {
	case ai.ProviderChatGPT:
		return c.generateChatGPT(ctx, req)
	case ai.ProviderGemini:
		return c.generateGemini(ctx, req)
	case ai.ProviderAntigravity:
		return c.generateAntigravity(ctx, req)
	case ai.ProviderAnthropic:
		return c.generateAnthropic(ctx, req)
	case ai.ProviderOpenAI, ai.ProviderGroq, ai.ProviderDeepSeek, ai.ProviderOpenRouter, ai.ProviderNVIDIA, ai.ProviderOllama:
		return c.generateOpenAICompatible(ctx, req)
	default:
		return nil, errors.Wrapf(ai.ErrCapabilityUnsupported, "provider type %q does not support LLM generation", c.cfg.Type)
	}
}

func (c *Client) generateOpenAICompatible(ctx context.Context, req Request) (*Response, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(c.cfg.Endpoint), "/")
	if endpoint == "" {
		endpoint = ai.DefaultEndpoint(c.cfg.Type)
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		defaultModel, err := ai.DefaultLLMModel(c.cfg.Type)
		if err != nil {
			return nil, err
		}
		model = defaultModel
	}

	payload := map[string]any{
		"model": model,
		"messages": []map[string]string{
			{"role": "system", "content": req.SystemPrompt},
			{"role": "user", "content": req.UserPrompt},
		},
		"temperature": req.Temperature,
	}
	if req.ResponseJSON {
		payload["response_format"] = map[string]string{"type": "json_object"}
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal OpenAI-compatible payload")
	}

	targetURL := endpoint
	if !strings.HasSuffix(targetURL, "/chat/completions") {
		targetURL += "/chat/completions"
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create chat completions request")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey := strings.TrimSpace(c.cfg.APIKey); apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "chat completions request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		if c.cfg.Type == ai.ProviderOpenAI {
			return nil, openAIHTTPError(resp)
		}
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("LLM provider error (%d): %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode chat completions response")
	}
	if len(result.Choices) == 0 {
		return nil, errors.New("LLM returned no choices")
	}
	return &Response{Text: strings.TrimSpace(result.Choices[0].Message.Content)}, nil
}

func (c *Client) generateGemini(ctx context.Context, req Request) (*Response, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(c.cfg.Endpoint), "/")
	if baseURL == "" {
		baseURL = ai.DefaultEndpoint(ai.ProviderGemini)
	}
	model := strings.TrimPrefix(strings.TrimSpace(req.Model), "models/")
	if model == "" {
		model = ai.DefaultGeminiTranscriptionModel
	}

	genConfig := map[string]any{
		"temperature": req.Temperature,
	}
	if req.ResponseJSON {
		genConfig["responseMimeType"] = "application/json"
	}

	payload := map[string]any{
		"systemInstruction": map[string]any{
			"parts": []map[string]string{{"text": req.SystemPrompt}},
		},
		"contents": []map[string]any{
			{
				"role":  "user",
				"parts": []map[string]string{{"text": req.UserPrompt}},
			},
		},
		"generationConfig": genConfig,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal Gemini payload")
	}
	targetURL := baseURL + "/models/" + model + ":generateContent"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, errors.Wrap(err, "failed to build Gemini request")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-goog-api-key", c.cfg.APIKey)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "Gemini HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("Gemini error (%d): %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode Gemini response")
	}
	if len(result.Candidates) == 0 || len(result.Candidates[0].Content.Parts) == 0 {
		return nil, errors.New("Gemini returned empty candidates")
	}
	return &Response{Text: strings.TrimSpace(result.Candidates[0].Content.Parts[0].Text)}, nil
}

func (c *Client) generateAnthropic(ctx context.Context, req Request) (*Response, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(c.cfg.Endpoint), "/")
	if endpoint == "" {
		endpoint = ai.DefaultEndpoint(ai.ProviderAnthropic)
	}
	if !strings.HasSuffix(endpoint, "/messages") {
		endpoint += "/messages"
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = "claude-3-7-sonnet-latest"
	}

	payload := map[string]any{
		"model":      model,
		"max_tokens": 4096,
		"system":     req.SystemPrompt,
		"messages": []map[string]string{
			{"role": "user", "content": req.UserPrompt},
		},
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal Anthropic payload")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Anthropic request")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("x-api-key", c.cfg.APIKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "Anthropic HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("Anthropic error (%d): %s", resp.StatusCode, string(raw))
	}

	var result struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&result); err != nil {
		return nil, errors.Wrap(err, "failed to decode Anthropic response")
	}
	if len(result.Content) == 0 {
		return nil, errors.New("Anthropic returned empty content")
	}
	return &Response{Text: strings.TrimSpace(result.Content[0].Text)}, nil
}

func (c *Client) generateAntigravity(ctx context.Context, req Request) (*Response, error) {
	endpoint := strings.TrimSpace(c.cfg.Endpoint)
	if endpoint == "" || strings.HasSuffix(endpoint, "/v1internal:generateContent") {
		endpoint = AntigravityStreamURL
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = "gemini-2.5-flash"
	}

	accessToken := strings.TrimSpace(c.cfg.APIKey)
	projectID := strings.TrimSpace(req.AntigravityProjectID)

	if strings.HasPrefix(accessToken, "{") {
		var creds AntigravityOAuthCredentials
		if err := json.Unmarshal([]byte(accessToken), &creds); err == nil && creds.AccessToken != "" {
			if creds.ExpiresAt > 0 && time.Now().UnixMilli() >= creds.ExpiresAt-60000 && creds.RefreshToken != "" {
				if refreshed, refErr := RefreshAntigravityCredentials(ctx, c.httpClient, creds); refErr == nil {
					creds = *refreshed
				} else if errors.Is(refErr, errAntigravityOAuthNotConfigured) {
					return nil, refErr
				}
			}
			accessToken = creds.AccessToken
			if projectID == "" && creds.ProjectID != "" {
				projectID = creds.ProjectID
			}
		}
	}

	if projectID == "" {
		projectID = defaultAntigravityProject
	}

	userParts := make([]map[string]any, 0, 2)
	if len(req.AudioContent) > 0 {
		mimeType := req.AudioContentType
		if mimeType == "" {
			mimeType = "audio/webm"
		}
		userParts = append(userParts, map[string]any{
			"inlineData": map[string]string{
				"mimeType": mimeType,
				"data":     base64.StdEncoding.EncodeToString(req.AudioContent),
			},
		})
	}
	if strings.TrimSpace(req.UserPrompt) != "" {
		userParts = append(userParts, map[string]any{"text": req.UserPrompt})
	}

	contents := []map[string]any{
		{
			"role":  "user",
			"parts": userParts,
		},
	}

	wireModel := ResolveAntigravityWireModel(model)
	genConfig := map[string]any{
		"candidateCount":  1,
		"maxOutputTokens": 4096,
		"temperature":     0.45,
	}

	requestObj := map[string]any{
		"contents":         contents,
		"generationConfig": genConfig,
	}
	if strings.TrimSpace(req.SystemPrompt) != "" {
		requestObj["systemInstruction"] = map[string]any{
			"parts": []map[string]string{{"text": req.SystemPrompt}},
		}
	}

	randBytes := make([]byte, 8)
	_, _ = rand.Read(randBytes)
	reqID := fmt.Sprintf("agent-%x", randBytes)

	payload := map[string]any{
		"model":       wireModel,
		"userAgent":   "antigravity",
		"requestType": "agent",
		"project":     projectID,
		"requestId":   reqID,
		"request":     requestObj,
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, errors.Wrap(err, "failed to marshal Antigravity payload")
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Antigravity request")
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+accessToken)
	httpReq.Header.Set("User-Agent", AntigravityUserAgent)
	httpReq.Header.Set("X-Goog-Api-Client", AntigravitySetupClient)
	httpReq.Header.Set("Client-Metadata", AntigravityClientMetadata)
	httpReq.Header.Set("x-request-source", "local")
	httpReq.Header.Set("Accept", "text/event-stream, application/json")

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, errors.Wrap(err, "Antigravity HTTP request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("Antigravity error (%d): %s", resp.StatusCode, string(raw))
	}

	respBodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, errors.Wrap(err, "failed to read Antigravity response")
	}

	// 1. Try parsing SSE response lines
	if bytes.Contains(respBodyBytes, []byte("data:")) {
		var combined strings.Builder
		scanner := bufio.NewScanner(bytes.NewReader(respBodyBytes))
		for scanner.Scan() {
			line := strings.TrimSpace(scanner.Text())
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "" || data == "[DONE]" {
				continue
			}
			var sseObj struct {
				Response struct {
					Candidates []struct {
						Content struct {
							Parts []struct {
								Text             string `json:"text"`
								ThoughtSignature string `json:"thoughtSignature"`
							} `json:"parts"`
						} `json:"content"`
					} `json:"candidates"`
				} `json:"response"`
			}
			if jErr := json.Unmarshal([]byte(data), &sseObj); jErr == nil {
				for _, cand := range sseObj.Response.Candidates {
					for _, part := range cand.Content.Parts {
						if part.ThoughtSignature == "" && part.Text != "" {
							combined.WriteString(part.Text)
						}
					}
				}
			}
		}
		if text := strings.TrimSpace(combined.String()); text != "" {
			return &Response{Text: text}, nil
		}
	}

	// 2. Fall back to standard JSON parsing
	var result struct {
		Response struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		} `json:"response"`
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(respBodyBytes, &result); err == nil {
		candidates := result.Response.Candidates
		if len(candidates) == 0 {
			candidates = result.Candidates
		}
		if len(candidates) > 0 && len(candidates[0].Content.Parts) > 0 {
			var sb strings.Builder
			for _, part := range candidates[0].Content.Parts {
				sb.WriteString(part.Text)
			}
			if text := strings.TrimSpace(sb.String()); text != "" {
				return &Response{Text: text}, nil
			}
		}
	}

	return nil, errors.New("Antigravity returned empty response")
}

// ExchangeAntigravityAuthCode exchanges an OAuth 2.0 PKCE authorization code for Antigravity tokens
// and discovers the Cloud Code project ID.
func ExchangeAntigravityAuthCode(ctx context.Context, httpClient *http.Client, code, codeVerifier, redirectURI string) (*AntigravityOAuthCredentials, error) {
	clientID, clientSecret, err := antigravityOAuthClientConfig()
	if err != nil {
		return nil, err
	}
	return ExchangeAntigravityAuthCodeWithClient(ctx, httpClient, code, codeVerifier, redirectURI, clientID, clientSecret)
}

// ExchangeAntigravityAuthCodeWithClient uses this installation's explicitly configured OAuth client.
func ExchangeAntigravityAuthCodeWithClient(ctx context.Context, httpClient *http.Client, code, codeVerifier, redirectURI, clientID, clientSecret string) (*AntigravityOAuthCredentials, error) {
	if strings.TrimSpace(clientID) == "" || strings.TrimSpace(clientSecret) == "" {
		return nil, errAntigravityOAuthNotConfigured
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	if redirectURI == "" {
		redirectURI = AntigravityRedirectURI
	}

	form := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"code":          {code},
		"grant_type":    {"authorization_code"},
		"redirect_uri":  {redirectURI},
		"code_verifier": {codeVerifier},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, AntigravityTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create token exchange request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "token exchange request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, errors.Errorf("connection: Google rejected the OAuth connection (HTTP %d). Check the client ID, client secret, redirect URI and account access in Antigravity setup", resp.StatusCode)
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&tokenResp); err != nil {
		return nil, errors.Wrap(err, "failed to decode OAuth token response")
	}
	if strings.TrimSpace(tokenResp.AccessToken) == "" {
		return nil, errors.New("OAuth token response did not include access_token")
	}
	if strings.TrimSpace(tokenResp.RefreshToken) == "" || tokenResp.ExpiresIn <= 0 {
		return nil, errors.New("connection: Google did not return a renewable session. Sign in again and allow offline access")
	}

	projectID := DiscoverAntigravityProjectID(ctx, httpClient, tokenResp.AccessToken)
	return &AntigravityOAuthCredentials{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		ExpiresAt:    time.Now().UnixMilli() + tokenResp.ExpiresIn*1000,
		ProjectID:    projectID,
	}, nil
}

// RefreshAntigravityToken refreshes an expired Antigravity OAuth access token using its refresh token.
func RefreshAntigravityToken(ctx context.Context, httpClient *http.Client, refreshToken, existingProjectID string) (*AntigravityOAuthCredentials, error) {
	clientID, clientSecret, err := antigravityOAuthClientConfig()
	if err != nil {
		return nil, err
	}
	return RefreshAntigravityCredentials(ctx, httpClient, AntigravityOAuthCredentials{RefreshToken: refreshToken, ProjectID: existingProjectID, ClientID: clientID, ClientSecret: clientSecret})
}

// RefreshAntigravityCredentials retains the client used to issue this connection's refresh token.
func RefreshAntigravityCredentials(ctx context.Context, httpClient *http.Client, credentials AntigravityOAuthCredentials) (*AntigravityOAuthCredentials, error) {
	if strings.TrimSpace(credentials.RefreshToken) == "" {
		return nil, errors.New("connection: This Google connection has no refresh token. Sign in again")
	}
	clientID, clientSecret := credentials.ClientID, credentials.ClientSecret
	if clientID == "" || clientSecret == "" {
		var err error
		clientID, clientSecret, err = antigravityOAuthClientConfig()
		if err != nil {
			return nil, err
		}
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultHTTPTimeout}
	}
	form := url.Values{
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"refresh_token": {credentials.RefreshToken},
		"grant_type":    {"refresh_token"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, AntigravityTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, errors.Wrap(err, "failed to create token refresh request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, errors.Wrap(err, "token refresh request failed")
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, errors.Errorf("connection: Google could not renew this OAuth connection (HTTP %d). Reconnect Google in AI & meetings", resp.StatusCode)
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int64  `json:"expires_in"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&tokenResp); err != nil {
		return nil, errors.Wrap(err, "failed to decode token refresh response")
	}
	if strings.TrimSpace(tokenResp.AccessToken) == "" {
		return nil, errors.New("refreshed OAuth token is empty")
	}
	if tokenResp.ExpiresIn <= 0 {
		return nil, errors.New("connection: Google returned an expired session. Sign in again")
	}

	projectID := strings.TrimSpace(credentials.ProjectID)
	if tokenResp.RefreshToken != "" {
		credentials.RefreshToken = tokenResp.RefreshToken
	}
	if projectID == "" {
		projectID = DiscoverAntigravityProjectID(ctx, httpClient, tokenResp.AccessToken)
	}
	return &AntigravityOAuthCredentials{
		ClientID:     clientID,
		ClientSecret: clientSecret,
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: credentials.RefreshToken,
		ExpiresAt:    time.Now().UnixMilli() + tokenResp.ExpiresIn*1000,
		ProjectID:    projectID,
	}, nil
}

// DiscoverAntigravityProjectID queries loadCodeAssist and onboardUser for the user's Cloud Code project ID,
// falling back to DefaultAntigravityProjectID ("rising-fact-p41fc") if unavailable.
func DiscoverAntigravityProjectID(ctx context.Context, httpClient *http.Client, accessToken string) string {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 10 * time.Second}
	}
	bodyBytes, _ := json.Marshal(map[string]any{
		"metadata": map[string]string{
			"ideType":    "ANTIGRAVITY",
			"platform":   "PLATFORM_UNSPECIFIED",
			"pluginType": "GEMINI",
		},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, AntigravityLoadCodeAssistURL, bytes.NewReader(bodyBytes))
	if err == nil {
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("User-Agent", "google-api-nodejs-client/9.15.1")
		req.Header.Set("X-Goog-Api-Client", AntigravitySetupClient)
		req.Header.Set("Client-Metadata", AntigravityClientMetadata)

		resp, doErr := httpClient.Do(req)
		if doErr == nil {
			defer resp.Body.Close()
			if resp.StatusCode < http.StatusBadRequest {
				var data struct {
					CloudaicompanionProject any `json:"cloudaicompanionProject"`
				}
				if json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&data) == nil {
					switch v := data.CloudaicompanionProject.(type) {
					case string:
						if strings.TrimSpace(v) != "" {
							return strings.TrimSpace(v)
						}
					case map[string]any:
						if id, ok := v["id"].(string); ok && strings.TrimSpace(id) != "" {
							return strings.TrimSpace(id)
						}
					default:
						// An unexpected project representation falls through to onboarding.
					}
				}
			}
		}
	}

	// Try onboardUser if loadCodeAssist didn't return an active project
	onboardBody, _ := json.Marshal(map[string]any{
		"tierId": "standard-tier",
		"metadata": map[string]string{
			"ideType":    "ANTIGRAVITY",
			"platform":   "PLATFORM_UNSPECIFIED",
			"pluginType": "GEMINI",
		},
	})
	onboardReq, err := http.NewRequestWithContext(ctx, http.MethodPost, AntigravityOnboardURL, bytes.NewReader(onboardBody))
	if err == nil {
		onboardReq.Header.Set("Authorization", "Bearer "+accessToken)
		onboardReq.Header.Set("Content-Type", "application/json")
		onboardReq.Header.Set("User-Agent", "google-api-nodejs-client/9.15.1")
		onboardReq.Header.Set("X-Goog-Api-Client", AntigravitySetupClient)
		onboardReq.Header.Set("Client-Metadata", AntigravityClientMetadata)

		resp, doErr := httpClient.Do(onboardReq)
		if doErr == nil {
			defer resp.Body.Close()
			if resp.StatusCode < http.StatusBadRequest {
				var onboardResp struct {
					Response struct {
						CloudaicompanionProject any `json:"cloudaicompanionProject"`
					} `json:"response"`
				}
				if json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&onboardResp) == nil {
					switch v := onboardResp.Response.CloudaicompanionProject.(type) {
					case string:
						if strings.TrimSpace(v) != "" {
							return strings.TrimSpace(v)
						}
					case map[string]any:
						if id, ok := v["id"].(string); ok && strings.TrimSpace(id) != "" {
							return strings.TrimSpace(id)
						}
					default:
						// An unexpected project representation uses the default project below.
					}
				}
			}
		}
	}

	return DefaultAntigravityProjectID
}

// FetchAntigravityModels queries the daily Cloud Code endpoint for all available models and their quota remaining fraction.
func FetchAntigravityModels(ctx context.Context, httpClient *http.Client, accessToken, projectID string) ([]AntigravityModel, error) {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}
	if projectID == "" {
		projectID = DefaultAntigravityProjectID
	}
	bodyBytes, _ := json.Marshal(map[string]string{"project": projectID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, AntigravityModelsURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", AntigravityUserAgent)
	req.Header.Set("X-Goog-Api-Client", AntigravitySetupClient)
	req.Header.Set("Client-Metadata", AntigravityClientMetadata)

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		raw, _ := io.ReadAll(io.LimitReader(resp.Body, maxErrorBodyBytes))
		return nil, errors.Errorf("fetch models failed (%d): %s", resp.StatusCode, string(raw))
	}

	var data struct {
		Models map[string]struct {
			DisplayName string `json:"displayName"`
			IsInternal  bool   `json:"isInternal"`
			QuotaInfo   struct {
				RemainingFraction *float64 `json:"remainingFraction"`
			} `json:"quotaInfo"`
		} `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponseBytes)).Decode(&data); err != nil {
		return nil, err
	}

	var results []AntigravityModel
	for id, item := range data.Models {
		if item.IsInternal || item.DisplayName == "" || strings.HasPrefix(id, "gemini-3.5-flash") {
			continue
		}
		if strings.Contains(strings.ToLower(id), "image") || strings.Contains(strings.ToLower(item.DisplayName), "flash lite") {
			continue
		}
		quota := -1.0
		if item.QuotaInfo.RemainingFraction != nil {
			quota = max(0, min(1, *item.QuotaInfo.RemainingFraction))
		}
		results = append(results, AntigravityModel{
			ID:             id,
			Label:          item.DisplayName,
			RemainingQuota: quota,
		})
	}
	slices.SortFunc(results, func(a, b AntigravityModel) int {
		return cmp.Compare(a.ID, b.ID)
	})
	return results, nil
}
