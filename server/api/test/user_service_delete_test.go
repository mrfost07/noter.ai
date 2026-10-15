package test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/api"
	"github.com/usememos/memos/store"
)

func TestDeleteUserSelfDeleteCleansAccountDataAndAuthCookies(t *testing.T) {
	t.Parallel()

	ts := NewTestService(t)
	defer ts.Cleanup()

	ctx := context.Background()
	user, err := ts.CreateRegularUser(ctx, "alice")
	require.NoError(t, err)

	_, err = ts.Store.CreateUserIdentity(ctx, &store.UserIdentity{
		UserID:    user.ID,
		Provider:  "google",
		ExternUID: "alice-google-sub",
	})
	require.NoError(t, err)

	err = ts.Store.AddUserRefreshToken(ctx, user.ID, &storepb.RefreshTokensUserSetting_RefreshToken{
		TokenId:   "refresh-token-id",
		ExpiresAt: timestamppb.New(time.Now().Add(time.Hour)),
		CreatedAt: timestamppb.Now(),
	})
	require.NoError(t, err)

	headerCtx := api.WithHeaderCarrier(ctx)
	authCtx := ts.CreateUserContext(headerCtx, user.ID)
	_, err = ts.Service.DeleteUser(authCtx, &apipb.DeleteUserRequest{
		Name: api.BuildUserName(user.Username),
	})
	require.NoError(t, err)

	deletedUser, err := ts.Store.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)
	require.Nil(t, deletedUser)

	identities, err := ts.Store.ListUserIdentities(ctx, &store.FindUserIdentity{UserID: &user.ID})
	require.NoError(t, err)
	require.Empty(t, identities)

	refreshSetting, err := ts.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &user.ID,
		Key:    storepb.UserSetting_REFRESH_TOKENS,
	})
	require.NoError(t, err)
	require.Nil(t, refreshSetting)

	carrier := api.GetHeaderCarrier(authCtx)
	require.NotNil(t, carrier)
	require.Contains(t, strings.ToLower(carrier.Get("Set-Cookie")), "memos_refresh=")
}

func TestDeleteUserSpaceMembershipGuardIgnoresForce(t *testing.T) {
	for _, tc := range []struct {
		name   string
		force  bool
		suffix string
	}{
		{name: "without force", suffix: "normal"},
		{name: "with force", force: true, suffix: "force"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ts := NewTestService(t)
			defer ts.Cleanup()

			ctx := context.Background()
			user, err := ts.CreateRegularUser(ctx, "membership-delete-"+tc.suffix)
			require.NoError(t, err)
			space, err := ts.Store.CreateSpace(ctx, &store.Space{UID: "membership-delete-" + tc.suffix, Title: "Membership guard"}, user.ID)
			require.NoError(t, err)
			memo, err := ts.Service.CreateMemo(ts.CreateUserContext(ctx, user.ID), &apipb.CreateMemoRequest{Memo: &apipb.Memo{
				Content: "must survive failed account deletion",
			}})
			require.NoError(t, err)

			_, err = ts.Service.DeleteUser(ts.CreateUserContext(ctx, user.ID), &apipb.DeleteUserRequest{
				Name:  api.BuildUserName(user.Username),
				Force: tc.force,
			})
			require.Equal(t, codes.FailedPrecondition, status.Code(err))
			require.ErrorContains(t, err, "leave all spaces")

			remainingUser, err := ts.Store.GetUser(ctx, &store.FindUser{ID: &user.ID})
			require.NoError(t, err)
			require.NotNil(t, remainingUser)
			membership, err := ts.Store.GetSpaceMember(ctx, &store.FindSpaceMember{SpaceID: &space.ID, UserID: &user.ID, ViewerUserID: &user.ID})
			require.NoError(t, err)
			require.NotNil(t, membership)
			memoUID, err := api.ExtractMemoUIDFromName(memo.Name)
			require.NoError(t, err)
			remainingMemo, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
			require.NoError(t, err)
			require.NotNil(t, remainingMemo)
		})
	}
}

func TestDeleteUserRollbackPreservesAllResources(t *testing.T) {
	t.Parallel()

	ts := NewTestService(t)
	defer ts.Cleanup()

	ctx := context.Background()
	user, err := ts.CreateRegularUser(ctx, "rollback-owner")
	require.NoError(t, err)
	peer, err := ts.CreateRegularUser(ctx, "rollback-peer")
	require.NoError(t, err)

	userCtx := ts.CreateUserContext(ctx, user.ID)
	ownMemo, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "rollback owner memo",
		},
	})
	require.NoError(t, err)

	ownMemoUID, err := api.ExtractMemoUIDFromName(ownMemo.Name)
	require.NoError(t, err)
	ownMemoStore, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &ownMemoUID})
	require.NoError(t, err)
	require.NotNil(t, ownMemoStore)

	attachment, err := ts.Store.CreateAttachment(ctx, &store.Attachment{
		UID:       "attach-rollback-owner",
		CreatorID: user.ID,
		Filename:  "rollback.txt",
		Type:      "text/plain",
		Size:      8,
		Blob:      []byte("rollback"),
		MemoID:    &ownMemoStore.ID,
	})
	require.NoError(t, err)

	reaction, err := ts.Store.UpsertReaction(ctx, &store.Reaction{
		CreatorID:    user.ID,
		MemoID:       ownMemoStore.ID,
		ReactionType: "💥",
	})
	require.NoError(t, err)

	share, err := ts.Store.CreateMemoShare(ctx, &store.MemoShare{
		UID:       "share-rollback-owner",
		MemoID:    ownMemoStore.ID,
		CreatorID: user.ID,
	})
	require.NoError(t, err)

	inbox, err := ts.Store.CreateInbox(ctx, &store.Inbox{
		SenderID:   peer.ID,
		ReceiverID: user.ID,
		Status:     store.UNREAD,
		Message: &storepb.InboxMessage{
			Type: storepb.InboxMessage_MEMO_COMMENT,
			Payload: &storepb.InboxMessage_MemoComment{
				MemoComment: &storepb.InboxMessage_MemoCommentPayload{
					MemoId: ownMemoStore.ID,
				},
			},
		},
	})
	require.NoError(t, err)

	_, err = ts.Store.CreateUserIdentity(ctx, &store.UserIdentity{
		UserID:    user.ID,
		Provider:  "google",
		ExternUID: "rollback-owner-google-sub",
	})
	require.NoError(t, err)
	err = ts.Store.AddUserPersonalAccessToken(ctx, user.ID, &storepb.PersonalAccessTokensUserSetting_PersonalAccessToken{
		TokenId:     "pat-rollback-owner",
		TokenHash:   "pat-rollback-owner-hash",
		Description: "rollback pat",
	})
	require.NoError(t, err)

	headerCtx := api.WithHeaderCarrier(ctx)
	failCtx := store.WithDeleteUserFailpoint(headerCtx, store.DeleteUserFailpointBeforeCommit)
	authCtx := ts.CreateUserContext(failCtx, user.ID)
	_, err = ts.Service.DeleteUser(authCtx, &apipb.DeleteUserRequest{
		Name: api.BuildUserName(user.Username),
	})
	require.Error(t, err)
	require.ErrorContains(t, err, "delete user failpoint before commit")

	userAfterRollback, err := ts.Store.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)
	require.NotNil(t, userAfterRollback)

	memoAfterRollback, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &ownMemoUID})
	require.NoError(t, err)
	require.NotNil(t, memoAfterRollback)

	attachmentAfterRollback, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{ID: &attachment.ID})
	require.NoError(t, err)
	require.NotNil(t, attachmentAfterRollback)

	reactionAfterRollback, err := ts.Store.GetReaction(ctx, &store.FindReaction{ID: &reaction.ID})
	require.NoError(t, err)
	require.NotNil(t, reactionAfterRollback)

	shareAfterRollback, err := ts.Store.GetMemoShare(ctx, &store.FindMemoShare{ID: &share.ID})
	require.NoError(t, err)
	require.NotNil(t, shareAfterRollback)

	inboxesAfterRollback, err := ts.Store.ListInboxes(ctx, &store.FindInbox{ID: &inbox.ID})
	require.NoError(t, err)
	require.Len(t, inboxesAfterRollback, 1)

	identitiesAfterRollback, err := ts.Store.ListUserIdentities(ctx, &store.FindUserIdentity{UserID: &user.ID})
	require.NoError(t, err)
	require.Len(t, identitiesAfterRollback, 1)

	patSetting, err := ts.Store.GetUserSetting(ctx, &store.FindUserSetting{
		UserID: &user.ID,
		Key:    storepb.UserSetting_PERSONAL_ACCESS_TOKENS,
	})
	require.NoError(t, err)
	require.NotNil(t, patSetting)
}

func TestDeleteUserReportsPostCommitAttachmentStorageCleanupFailure(t *testing.T) {
	t.Parallel()

	ts := NewTestService(t)
	defer ts.Cleanup()

	ctx := context.Background()
	user, err := ts.CreateRegularUser(ctx, "cleanup-failure-owner")
	require.NoError(t, err)

	_, err = ts.Store.CreateAttachment(ctx, &store.Attachment{
		UID:         "attach-cleanup-failure",
		CreatorID:   user.ID,
		Filename:    "failure.txt",
		Type:        "text/plain",
		Size:        7,
		Blob:        []byte("failure"),
		StorageType: storepb.AttachmentStorageType_LOCAL,
		Reference:   "cleanup-failure.txt",
	})
	require.NoError(t, err)
	attachmentPath := filepath.Join(ts.Profile.Data, "cleanup-failure.txt")
	require.NoError(t, os.WriteFile(attachmentPath, []byte("failure"), 0o600))

	headerCtx := api.WithHeaderCarrier(ctx)
	authCtx := ts.CreateUserContext(store.WithDeleteAttachmentStorageFailpoint(headerCtx), user.ID)
	_, err = ts.Service.DeleteUser(authCtx, &apipb.DeleteUserRequest{
		Name: api.BuildUserName(user.Username),
	})
	require.Equal(t, codes.Internal, status.Code(err))
	require.ErrorContains(t, err, "user was deleted but attachment storage cleanup failed")
	require.ErrorContains(t, err, store.ErrDeleteAttachmentStorageFailpoint.Error())

	deletedUser, err := ts.Store.GetUser(ctx, &store.FindUser{ID: &user.ID})
	require.NoError(t, err)
	require.Nil(t, deletedUser)
	require.FileExists(t, attachmentPath, "storage cleanup failure happens after the database deletion commits")
}
