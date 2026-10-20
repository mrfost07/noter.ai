package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/profile"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
	teststore "github.com/usememos/memos/store/test"
)

// newIntegrationService builds a minimal APIService backed by an in-memory
// SQLite database.  The store is closed automatically via t.Cleanup.
func newIntegrationService(t *testing.T) *APIService {
	t.Helper()
	ctx := context.Background()
	st := teststore.NewTestingStore(ctx, t)
	t.Cleanup(func() { st.Close() })
	p := &profile.Profile{Demo: true, Data: t.TempDir(), Driver: "sqlite", DSN: ":memory:"}
	return NewAPIService("test-secret", p, st)
}

// userCtx returns a context that authenticates as the given user.
func userCtx(ctx context.Context, userID int32) context.Context {
	return context.WithValue(ctx, auth.UserIDContextKey, userID)
}

// collectEventsFor reads events from ch for the given duration and returns them.
func collectEventsFor(ch <-chan []byte, d time.Duration) []string {
	var out []string
	deadline := time.After(d)
	for {
		select {
		case data := <-ch:
			out = append(out, string(data))
		case <-deadline:
			return out
		}
	}
}

func requireMemoChanged(t *testing.T, ch <-chan []byte) {
	t.Helper()
	require.Equal(t, memoChangedSSEFrame, string(mustReceive(t, ch, time.Second)))
}

func requireNoMemoChanged(t *testing.T, ch <-chan []byte) {
	t.Helper()
	select {
	case event := <-ch:
		require.Failf(t, "unexpected SSE event", "received %q", event)
	default:
	}
}

func TestAttachmentMutationsPublishMemoChangedOnlyWhenBound(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, svc, "sse-attachment-owner", store.RoleUser)
	ownerCtx := userCtx(ctx, owner.ID)
	memo, err := svc.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "attachment event memo"},
	})
	require.NoError(t, err)

	client := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(client)
	createAttachment := func(filename string, memoName *string) *apipb.Attachment {
		t.Helper()
		attachment, err := svc.CreateAttachment(ownerCtx, &apipb.CreateAttachmentRequest{Attachment: &apipb.Attachment{
			Filename: filename,
			Type:     "text/plain",
			Content:  []byte(filename),
			Memo:     memoName,
		}})
		require.NoError(t, err)
		return attachment
	}

	unbound := createAttachment("sse-unbound.txt", nil)
	requireNoMemoChanged(t, client.events)
	_, err = svc.UpdateAttachment(ownerCtx, &apipb.UpdateAttachmentRequest{
		Attachment: &apipb.Attachment{Name: unbound.Name, Filename: "sse-unbound-renamed.txt"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
	})
	require.NoError(t, err)
	requireNoMemoChanged(t, client.events)
	_, err = svc.DeleteAttachment(ownerCtx, &apipb.DeleteAttachmentRequest{Name: unbound.Name})
	require.NoError(t, err)
	requireNoMemoChanged(t, client.events)

	bound := createAttachment("sse-bound.txt", &memo.Name)
	requireMemoChanged(t, client.events)
	_, err = svc.UpdateAttachment(ownerCtx, &apipb.UpdateAttachmentRequest{
		Attachment: &apipb.Attachment{Name: bound.Name, Filename: "sse-bound-renamed.txt"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"filename"}},
	})
	require.NoError(t, err)
	requireMemoChanged(t, client.events)
	_, err = svc.DeleteAttachment(ownerCtx, &apipb.DeleteAttachmentRequest{Name: bound.Name})
	require.NoError(t, err)
	requireMemoChanged(t, client.events)

	firstUnbound := createAttachment("sse-batch-unbound-first.txt", nil)
	secondUnbound := createAttachment("sse-batch-unbound-second.txt", nil)
	requireNoMemoChanged(t, client.events)
	_, err = svc.BatchDeleteAttachments(ownerCtx, &apipb.BatchDeleteAttachmentsRequest{
		Names: []string{firstUnbound.Name, secondUnbound.Name},
	})
	require.NoError(t, err)
	requireNoMemoChanged(t, client.events)

	mixedUnbound := createAttachment("sse-batch-mixed-unbound.txt", nil)
	mixedBound := createAttachment("sse-batch-mixed-bound.txt", &memo.Name)
	requireMemoChanged(t, client.events)
	_, err = svc.BatchDeleteAttachments(ownerCtx, &apipb.BatchDeleteAttachmentsRequest{
		Names: []string{mixedUnbound.Name, mixedBound.Name},
	})
	require.NoError(t, err)
	requireMemoChanged(t, client.events)
}

func TestDeleteAttachmentPublishesBeforeStorageCleanupFailure(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner := createSpaceTestUser(ctx, t, svc, "sse-attachment-cleanup-owner", store.RoleUser)
	ownerCtx := userCtx(ctx, owner.ID)
	memo, err := svc.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "attachment cleanup failure"},
	})
	require.NoError(t, err)
	attachment, err := svc.CreateAttachment(ownerCtx, &apipb.CreateAttachmentRequest{Attachment: &apipb.Attachment{
		Filename: "cleanup.txt",
		Type:     "text/plain",
		Content:  []byte("attachment"),
		Memo:     &memo.Name,
	}})
	require.NoError(t, err)

	client := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(client)
	_, err = svc.DeleteAttachment(store.WithDeleteAttachmentStorageFailpoint(ownerCtx), &apipb.DeleteAttachmentRequest{Name: attachment.Name})
	require.Equal(t, codes.Internal, status.Code(err))
	require.ErrorContains(t, err, "attachments were deleted but storage cleanup failed")
	requireMemoChanged(t, client.events)
	requireNoMemoChanged(t, client.events)

	attachmentUID, err := ExtractAttachmentUIDFromName(attachment.Name)
	require.NoError(t, err)
	storedAttachment, err := svc.Store.GetAttachment(ctx, &store.FindAttachment{UID: &attachmentUID})
	require.NoError(t, err)
	require.Nil(t, storedAttachment, "the database deletion must remain committed")
}

func TestUpdateMemoSSEBroadcastsToAllSubscribers(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "audience-owner", Role: store.RoleAdmin, Email: "audience-owner@example.com",
	})
	require.NoError(t, err)
	ownerCtx := userCtx(ctx, owner.ID)
	memo, err := svc.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "before update"},
	})
	require.NoError(t, err)

	ownerClient := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(ownerClient)
	otherClient := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(otherClient)

	_, err = svc.UpdateMemo(ownerCtx, &apipb.UpdateMemoRequest{
		Memo:       &apipb.Memo{Name: memo.Name, Content: "after update"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	requireMemoChanged(t, ownerClient.events)
	requireMemoChanged(t, otherClient.events)
}

func TestCreateMemoWithAttachment_NoDuplicateUpdatedSSEBroadcast(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)

	user, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "user", Role: store.RoleAdmin, Email: "user@example.com",
	})
	require.NoError(t, err)
	uctx := userCtx(ctx, user.ID)

	attachment, err := svc.CreateAttachment(uctx, &apipb.CreateAttachmentRequest{
		Attachment: &apipb.Attachment{
			Filename: "test.txt",
			Size:     5,
			Type:     "text/plain",
			Content:  []byte("hello"),
		},
	})
	require.NoError(t, err)

	client := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(client)

	_, err = svc.CreateMemo(uctx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "memo with initial attachment",
			Attachments: []*apipb.Attachment{
				{Name: attachment.Name},
			},
		},
	})
	require.NoError(t, err)

	events := collectEventsFor(client.events, 150*time.Millisecond)

	require.Len(t, events, 1, "expected exactly one SSE event for memo creation with attachment, got: %v", events)
	assert.Equal(t, memoChangedSSEFrame, events[0])
}

func TestDeleteMemoCleansAttachmentStorage(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)
	owner, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "delete-cleanup-owner", Role: store.RoleAdmin, Email: "delete-cleanup-owner@example.com",
	})
	require.NoError(t, err)
	ownerCtx := userCtx(ctx, owner.ID)
	memo, err := svc.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "attachment cleanup"},
	})
	require.NoError(t, err)
	memoUID, err := ExtractMemoUIDFromName(memo.Name)
	require.NoError(t, err)
	storedMemo, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.NotNil(t, storedMemo)
	attachmentPath := filepath.Join(t.TempDir(), "sse-delete-cleanup.txt")
	require.NoError(t, os.WriteFile(attachmentPath, []byte("cleanup"), 0o600))
	attachment, err := svc.Store.CreateAttachment(ctx, &store.Attachment{
		UID:         "sse-delete-cleanup",
		CreatorID:   owner.ID,
		Filename:    "cleanup.txt",
		Type:        "text/plain",
		Size:        7,
		Blob:        []byte("cleanup"),
		StorageType: storepb.AttachmentStorageType_LOCAL,
		Reference:   attachmentPath,
		MemoID:      &storedMemo.ID,
	})
	require.NoError(t, err)

	client := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(client)
	_, err = svc.DeleteMemo(ownerCtx, &apipb.DeleteMemoRequest{Name: memo.Name})
	require.NoError(t, err, "committed deletion must not be reported as a failure")
	requireMemoChanged(t, client.events)

	deletedMemo, err := svc.Store.GetMemo(ctx, &store.FindMemo{UID: &memoUID})
	require.NoError(t, err)
	require.Nil(t, deletedMemo)
	deletedAttachment, err := svc.Store.GetAttachment(ctx, &store.FindAttachment{ID: &attachment.ID})
	require.NoError(t, err)
	require.Nil(t, deletedAttachment)
	_, err = os.Stat(attachmentPath)
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestSetMemoAttachmentsPublishesMemoChanged(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)

	user, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "user", Role: store.RoleAdmin, Email: "user@example.com",
	})
	require.NoError(t, err)
	uctx := userCtx(ctx, user.ID)

	memo, err := svc.CreateMemo(uctx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "memo with attachments"},
	})
	require.NoError(t, err)

	attachment, err := svc.CreateAttachment(uctx, &apipb.CreateAttachmentRequest{
		Attachment: &apipb.Attachment{
			Filename: "test.txt",
			Size:     5,
			Type:     "text/plain",
			Content:  []byte("hello"),
		},
	})
	require.NoError(t, err)

	client := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(client)

	_, err = svc.SetMemoAttachments(uctx, &apipb.SetMemoAttachmentsRequest{
		Name: memo.Name,
		Attachments: []*apipb.Attachment{
			{Name: attachment.Name},
		},
	})
	require.NoError(t, err)

	requireMemoChanged(t, client.events)
	mustNotReceive(t, client.events, 100*time.Millisecond)
}

func TestSetMemoRelationsPublishesMemoChanged(t *testing.T) {
	ctx := context.Background()
	svc := newIntegrationService(t)

	user, err := svc.Store.CreateUser(ctx, &store.User{
		Username: "user", Role: store.RoleAdmin, Email: "user@example.com",
	})
	require.NoError(t, err)
	uctx := userCtx(ctx, user.ID)

	memo1, err := svc.CreateMemo(uctx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "memo one"},
	})
	require.NoError(t, err)
	memo2, err := svc.CreateMemo(uctx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{Content: "memo two"},
	})
	require.NoError(t, err)

	client := svc.SSEHub.Subscribe()
	defer svc.SSEHub.Unsubscribe(client)

	_, err = svc.SetMemoRelations(uctx, &apipb.SetMemoRelationsRequest{
		Name: memo1.Name,
		Relations: []*apipb.MemoRelation{
			{
				RelatedMemo: &apipb.MemoRelation_MemoRef{Name: memo2.Name},
				Type:        apipb.MemoRelation_REFERENCE,
			},
		},
	})
	require.NoError(t, err)

	requireMemoChanged(t, client.events)
	mustNotReceive(t, client.events, 100*time.Millisecond)
}
