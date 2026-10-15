package test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/random"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/api"
	"github.com/usememos/memos/server/auth"
)

// TestAuthorizerPrivateInstanceRegistration verifies that registration and other
// bootstrap methods stay reachable anonymously while unrelated public methods are
// gated. CreateUser enforces the instance registration settings in the service.

// TestAuthorizerAccessTokenAlwaysWorksOnPrivateInstance verifies that a valid
// Personal Access Token authenticates through the Authorizer even on a private
// instance, and then passes the access check for an otherwise-gated method.
func TestAuthorizerAccessTokenAlwaysWorksOnPrivateInstance(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "pat-user")
	require.NoError(t, err)

	token := auth.GeneratePersonalAccessToken()
	require.NoError(t, ts.Store.AddUserPersonalAccessToken(ctx, user.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{
		TokenId:     random.UUID(),
		TokenHash:   auth.HashPersonalAccessToken(token),
		Description: "authz test PAT",
		CreatedAt:   timestamppb.Now(),
	}))

	require.NoError(t, ts.SetInstanceAccessMode(ctx, storepb.InstanceAccessMode_INSTANCE_ACCESS_MODE_PRIVATE))
	authorizer := api.NewAuthorizer(ts.Store, ts.Secret)

	result := authorizer.Authenticate(ctx, "Bearer "+token)
	require.NotNil(t, result)
	require.NotNil(t, result.User)
	require.Equal(t, user.ID, result.User.ID)

	// An authenticated caller passes access control even for a gated method.
	require.NoError(t, authorizer.CheckAccess(ctx, "/memos.api.MemoService/ListMemos", result))
}
