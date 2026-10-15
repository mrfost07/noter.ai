package test

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

func TestPersonalNoteWorkspace(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	owner, err := ts.CreateRegularUser(ctx, "noter-owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "noter-other")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	otherCtx := ts.CreateUserContext(ctx, other.ID)
	note, err := ts.Service.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "# Meeting\n- [ ] Fix export"}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(note.Name, "memos/")
	stored, err := ts.Store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	require.NoError(t, err)
	require.Equal(t, store.Private, stored.Visibility)
	require.Nil(t, stored.SpaceID)
	list, err := ts.Service.ListMemos(ownerCtx, &apipb.ListMemosRequest{Filter: `content.contains("export")`, OrderBy: "pinned desc, update_time desc"})
	require.NoError(t, err)
	require.Len(t, list.Memos, 1)
	list, err = ts.Service.ListMemos(otherCtx, &apipb.ListMemosRequest{})
	require.NoError(t, err)
	require.Empty(t, list.Memos)
	_, err = ts.Service.GetMemo(otherCtx, &apipb.GetMemoRequest{Name: note.Name})
	require.Contains(t, []codes.Code{codes.PermissionDenied, codes.NotFound}, status.Code(err))
	_, err = ts.Service.UpdateMemo(otherCtx, &apipb.UpdateMemoRequest{Memo: &apipb.Memo{Name: note.Name, Content: "overwrite"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}}})
	require.Error(t, err)
	updated, err := ts.Service.UpdateMemo(ownerCtx, &apipb.UpdateMemoRequest{Memo: &apipb.Memo{Name: note.Name, Content: "# Meeting\n- [x] Fix export"}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content", "update_time"}}})
	require.NoError(t, err)
	require.Contains(t, updated.Content, "[x]")
	_, err = ts.Service.UpdateMemo(ownerCtx, &apipb.UpdateMemoRequest{Memo: &apipb.Memo{Name: note.Name, State: apipb.State_ARCHIVED}, UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"state"}}})
	require.NoError(t, err)
	list, err = ts.Service.ListMemos(ownerCtx, &apipb.ListMemosRequest{State: apipb.State_ARCHIVED})
	require.NoError(t, err)
	require.Len(t, list.Memos, 1)
}
