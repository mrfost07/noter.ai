package api

import (
	"context"
	"os"
	"strings"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai/llm"
	"github.com/usememos/memos/store"
)

func (s *APIService) requireAIConnectionAdmin(ctx context.Context) error {
	user, err := s.fetchCurrentUser(ctx)
	if err != nil {
		return status.Error(codes.Internal, "Could not verify the signed-in user.")
	}
	if user == nil {
		return status.Error(codes.Unauthenticated, "Sign in to Noter.ai first.")
	}
	if user.Role != store.RoleAdmin {
		return status.Error(codes.PermissionDenied, "Only the workspace owner can manage AI connections.")
	}
	return nil
}

func (s *APIService) antigravityClientConfig(ctx context.Context) (string, string, error) {
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return "", "", errors.New("connection: Could not load Antigravity setup")
	}
	id, secret := setting.GetAntigravityClientId(), setting.GetAntigravityClientSecret()
	if id == "" && secret == "" {
		id = strings.TrimSpace(os.Getenv("NOTER_ANTIGRAVITY_CLIENT_ID"))
		secret = strings.TrimSpace(os.Getenv("NOTER_ANTIGRAVITY_CLIENT_SECRET"))
	}
	if id == "" && secret == "" {
		id, secret = llm.BundledAntigravityOAuthClient()
	}
	if id == "" || secret == "" {
		return "", "", errors.New("connection: Antigravity needs application setup. Open AI & meetings → Antigravity setup and enter the authorized client configuration. Advanced deployments can set NOTER_ANTIGRAVITY_CLIENT_ID and NOTER_ANTIGRAVITY_CLIENT_SECRET")
	}
	return id, secret, nil
}

// GetAIConnectionStatus exposes readiness, never client secrets or account tokens.
func (s *APIService) GetAIConnectionStatus(ctx context.Context, _ *apipb.GetAIConnectionStatusRequest) (*apipb.GetAIConnectionStatusResponse, error) {
	if err := s.requireAIConnectionAdmin(ctx); err != nil {
		return nil, err
	}
	id, _, err := s.antigravityClientConfig(ctx)
	return &apipb.GetAIConnectionStatusResponse{AntigravityConfigured: err == nil, AntigravityClientId: id}, nil
}

// ConfigureAntigravityOAuth persists write-only application credentials for this installation.
func (s *APIService) ConfigureAntigravityOAuth(ctx context.Context, request *apipb.ConfigureAntigravityOAuthRequest) (*apipb.GetAIConnectionStatusResponse, error) {
	if err := s.requireAIConnectionAdmin(ctx); err != nil {
		return nil, err
	}
	s.aiOAuthMu.Lock()
	defer s.aiOAuthMu.Unlock()
	id, secret := strings.TrimSpace(request.GetClientId()), strings.TrimSpace(request.GetClientSecret())
	if len(id) > 512 || !strings.HasSuffix(id, ".apps.googleusercontent.com") || strings.ContainsAny(id, " \t\r\n") {
		return nil, status.Error(codes.InvalidArgument, "Enter the Google OAuth client ID ending in .apps.googleusercontent.com.")
	}
	if len(secret) > 2048 {
		return nil, status.Error(codes.InvalidArgument, "The OAuth client secret is too long.")
	}
	setting, err := s.Store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, status.Error(codes.Internal, "Could not load AI settings.")
	}
	if setting == nil {
		setting = &storepb.InstanceAISetting{}
	}
	if secret == "" && id == setting.AntigravityClientId {
		secret = setting.AntigravityClientSecret
	}
	if secret == "" {
		return nil, status.Error(codes.InvalidArgument, "Enter the client secret for this client ID.")
	}
	setting.AntigravityClientId, setting.AntigravityClientSecret = id, secret
	if _, err := s.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{Key: storepb.InstanceSettingKey_AI, Value: &storepb.InstanceSetting_AiSetting{AiSetting: setting}}); err != nil {
		return nil, status.Error(codes.Internal, "Could not save Antigravity setup.")
	}
	return &apipb.GetAIConnectionStatusResponse{AntigravityConfigured: true, AntigravityClientId: id}, nil
}
