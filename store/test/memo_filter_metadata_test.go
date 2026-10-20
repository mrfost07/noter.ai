package test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoFilterVisibilityEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-public", tc.User.ID).Content("Public memo").Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-private", tc.User.ID).Content("Private memo").Visibility(store.Private))
	tc.CreateMemo(NewMemoBuilder("memo-protected", tc.User.ID).Content("Protected memo").Visibility(store.Protected))

	// Test: visibility == "PUBLIC"
	memos := tc.ListWithFilter(`visibility == "PUBLIC"`)
	require.Len(t, memos, 1)
	require.Equal(t, store.Public, memos[0].Visibility)

	// Test: visibility == "PRIVATE"
	memos = tc.ListWithFilter(`visibility == "PRIVATE"`)
	require.Len(t, memos, 1)
	require.Equal(t, store.Private, memos[0].Visibility)
}

func TestMemoFilterVisibilityNotEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-public", tc.User.ID).Content("Public memo").Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-private", tc.User.ID).Content("Private memo").Visibility(store.Private))

	memos := tc.ListWithFilter(`visibility != "PUBLIC"`)
	require.Len(t, memos, 1)
	require.Equal(t, store.Private, memos[0].Visibility)
}

func TestMemoFilterVisibilityInList(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-pub", tc.User.ID).Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-priv", tc.User.ID).Visibility(store.Private))
	tc.CreateMemo(NewMemoBuilder("memo-prot", tc.User.ID).Visibility(store.Protected))

	memos := tc.ListWithFilter(`visibility in ["PUBLIC", "PRIVATE"]`)
	require.Len(t, memos, 2)
}

func TestMemoFilterPinnedEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	pinnedMemo := tc.CreateMemo(NewMemoBuilder("memo-pinned", tc.User.ID).Content("Pinned memo"))
	tc.PinMemo(pinnedMemo.ID)
	tc.CreateMemo(NewMemoBuilder("memo-unpinned", tc.User.ID).Content("Unpinned memo"))

	// Test: pinned == true
	memos := tc.ListWithFilter(`pinned == true`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Pinned)

	// Test: pinned == false
	memos = tc.ListWithFilter(`pinned == false`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Pinned)
}

func TestMemoFilterPinnedPredicate(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	pinnedMemo := tc.CreateMemo(NewMemoBuilder("memo-pinned", tc.User.ID).Content("Pinned memo"))
	tc.PinMemo(pinnedMemo.ID)
	tc.CreateMemo(NewMemoBuilder("memo-unpinned", tc.User.ID).Content("Unpinned memo"))

	memos := tc.ListWithFilter(`pinned`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Pinned)
}

func TestMemoFilterCreatorEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	user2, err := tc.Store.CreateUser(tc.Ctx, &store.User{
		Username: "user2",
		Role:     store.RoleUser,
		Email:    "user2@example.com",
		Nickname: "User 2",
	})
	require.NoError(t, err)

	tc.CreateMemo(NewMemoBuilder("memo-user1", tc.User.ID).Content("User 1 memo"))
	tc.CreateMemo(NewMemoBuilder("memo-user2", user2.ID).Content("User 2 memo"))

	memos := tc.ListWithFilter(`creator == "users/` + tc.User.Username + `"`)
	require.Len(t, memos, 1)
	require.Equal(t, tc.User.ID, memos[0].CreatorID)
}

func TestMemoFilterCreatorIdEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	user2, err := tc.Store.CreateUser(tc.Ctx, &store.User{
		Username: "user2",
		Role:     store.RoleUser,
		Email:    "user2@example.com",
		Nickname: "User 2",
	})
	require.NoError(t, err)

	tc.CreateMemo(NewMemoBuilder("memo-user1", tc.User.ID).Content("User 1 memo"))
	tc.CreateMemo(NewMemoBuilder("memo-user2", user2.ID).Content("User 2 memo"))

	memos := tc.ListWithFilter(`creator_id == ` + formatInt(int(tc.User.ID)))
	require.Len(t, memos, 1)
	require.Equal(t, tc.User.ID, memos[0].CreatorID)
}

func TestMemoFilterCreatorIdNotEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	user2, err := tc.Store.CreateUser(tc.Ctx, &store.User{
		Username: "user2",
		Role:     store.RoleUser,
		Email:    "user2@example.com",
		Nickname: "User 2",
	})
	require.NoError(t, err)

	tc.CreateMemo(NewMemoBuilder("memo-user1", tc.User.ID).Content("User 1 memo"))
	tc.CreateMemo(NewMemoBuilder("memo-user2", user2.ID).Content("User 2 memo"))

	memos := tc.ListWithFilter(`creator_id != ` + formatInt(int(tc.User.ID)))
	require.Len(t, memos, 1)
	require.Equal(t, user2.ID, memos[0].CreatorID)
}
