package api

import (
	"context"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

func TestAntigravityOAuthMissingConfigFailsBeforeCallbackBindOrBrowser(t *testing.T) {
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_ID", "")
	t.Setenv("NOTER_ANTIGRAVITY_CLIENT_SECRET", "")
	// Occupy the callback port so a regression can never reach browser launch.
	listener, err := net.Listen("tcp", oauthCallbackAddr)
	if err != nil {
		t.Skip("OAuth callback port is already occupied; cannot safely reserve it for this regression test")
	}
	defer listener.Close()

	service := newIntegrationService(t)
	admin := createSpaceTestUser(context.Background(), t, service, "oauth-config-check", store.RoleAdmin)
	ctx, cancel := context.WithTimeout(userCtx(context.Background(), admin.ID), time.Second)
	defer cancel()
	response, err := service.StartAntigravityOAuth(ctx, &apipb.StartAntigravityOAuthRequest{})
	require.Nil(t, response)
	require.Equal(t, codes.FailedPrecondition, status.Code(err))
	require.Contains(t, status.Convert(err).Message(), "NOTER_ANTIGRAVITY_CLIENT_ID")
	require.Contains(t, status.Convert(err).Message(), "NOTER_ANTIGRAVITY_CLIENT_SECRET")
	require.NotContains(t, status.Convert(err).Message(), "failed to bind")
}
