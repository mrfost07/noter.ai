package test

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

func TestCreateMemoAcceptsUUID(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "test-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	const memoID = "21ec98aa-9a8f-458c-a2a3-c7dc69b6f591"
	memo, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "Created with a UUID",
		},
		MemoId: memoID,
	})
	require.NoError(t, err)
	require.Equal(t, "memos/"+memoID, memo.Name)
}

func TestCreateAndUpdateMemoRebuildsTagPayload(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateRegularUser(ctx, "tag-payload-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memo, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "#book/fiction #Work #work #A\u200dB https://example.com/#hidden",
		},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"book", "book/fiction", "Work", "work", "AB"}, memo.Tags)

	memo, err = ts.Service.UpdateMemo(userCtx, &apipb.UpdateMemoRequest{
		Memo: &apipb.Memo{
			Name:    memo.Name,
			Content: "#next #A\u200dB",
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	require.Equal(t, []string{"next", "AB"}, memo.Tags)

	stored, err := ts.Service.GetMemo(userCtx, &apipb.GetMemoRequest{Name: memo.Name})
	require.NoError(t, err)
	require.Equal(t, []string{"next", "AB"}, stored.Tags)
}

func TestListMemosTimeOrderBy(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	user, err := ts.CreateHostUser(ctx, "time-order-user")
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)

	memoEarlyCreateLateUpdate, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "early create late update",

			CreateTime: timestamppb.New(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)),
			UpdateTime: timestamppb.New(time.Date(2020, 1, 3, 0, 0, 0, 0, time.UTC)),
		},
	})
	require.NoError(t, err)
	memoMiddleCreateEarlyUpdate, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "middle create early update",

			CreateTime: timestamppb.New(time.Date(2020, 1, 2, 0, 0, 0, 0, time.UTC)),
			UpdateTime: timestamppb.New(time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC)),
		},
	})
	require.NoError(t, err)
	memoLateCreateMiddleUpdate, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "late create middle update",

			CreateTime: timestamppb.New(time.Date(2020, 1, 3, 0, 0, 0, 0, time.UTC)),
			UpdateTime: timestamppb.New(time.Date(2020, 1, 2, 0, 0, 0, 0, time.UTC)),
		},
	})
	require.NoError(t, err)

	tests := []struct {
		name      string
		orderBy   string
		wantNames []string
	}{
		{
			name:    "default create time",
			orderBy: "",
			wantNames: []string{
				memoLateCreateMiddleUpdate.Name,
				memoMiddleCreateEarlyUpdate.Name,
				memoEarlyCreateLateUpdate.Name,
			},
		},
		{
			name:    "explicit create time",
			orderBy: "create_time desc",
			wantNames: []string{
				memoLateCreateMiddleUpdate.Name,
				memoMiddleCreateEarlyUpdate.Name,
				memoEarlyCreateLateUpdate.Name,
			},
		},
		{
			name:    "explicit update time",
			orderBy: "update_time desc",
			wantNames: []string{
				memoEarlyCreateLateUpdate.Name,
				memoLateCreateMiddleUpdate.Name,
				memoMiddleCreateEarlyUpdate.Name,
			},
		},
		{
			name:    "pinned with explicit create time",
			orderBy: "pinned desc, create_time desc",
			wantNames: []string{
				memoLateCreateMiddleUpdate.Name,
				memoMiddleCreateEarlyUpdate.Name,
				memoEarlyCreateLateUpdate.Name,
			},
		},
		{
			name:    "explicit create time ascending",
			orderBy: "create_time asc",
			wantNames: []string{
				memoEarlyCreateLateUpdate.Name,
				memoMiddleCreateEarlyUpdate.Name,
				memoLateCreateMiddleUpdate.Name,
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			resp, err := ts.Service.ListMemos(userCtx, &apipb.ListMemosRequest{
				PageSize: 10,
				OrderBy:  test.orderBy,
			})
			require.NoError(t, err)
			require.Len(t, resp.Memos, len(test.wantNames))

			gotNames := make([]string, 0, len(resp.Memos))
			for _, memo := range resp.Memos {
				gotNames = append(gotNames, memo.Name)
			}
			require.Equal(t, test.wantNames, gotNames)
		})
	}

	_, err = ts.Service.ListMemos(userCtx, &apipb.ListMemosRequest{
		PageSize: 10,
		OrderBy:  "display_time desc",
	})
	require.Error(t, err)
}

func TestListMemosSkipsMemosWithMissingCreators(t *testing.T) {
	ctx := context.Background()

	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "memo-visible-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	orphanCreator, err := ts.CreateRegularUser(ctx, "memo-orphan-creator")
	require.NoError(t, err)
	orphanCtx := ts.CreateUserContext(ctx, orphanCreator.ID)

	ownerMemo, err := ts.Service.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "owner memo",
		},
	})
	require.NoError(t, err)

	_, err = ts.Service.CreateMemo(orphanCtx, &apipb.CreateMemoRequest{
		Memo: &apipb.Memo{
			Content: "orphan memo",
		},
	})
	require.NoError(t, err)

	_, err = ts.Store.DeleteUser(ctx, &store.DeleteUser{ID: orphanCreator.ID})
	require.NoError(t, err)

	resp, err := ts.Service.ListMemos(ownerCtx, &apipb.ListMemosRequest{PageSize: 10})
	require.NoError(t, err)
	require.Len(t, resp.Memos, 1)
	require.Equal(t, ownerMemo.Name, resp.Memos[0].Name)
}

// TestCreateMemoWithCustomTimestamps tests that custom timestamps can be set when creating memos and comments.
// This addresses issue #5483: https://github.com/usememos/memos/issues/5483
