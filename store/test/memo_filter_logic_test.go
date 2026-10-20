package test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoFilterStartsWithCombinedAndNegated(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-pub", tc.User.ID).Content("Hello public").Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-priv", tc.User.ID).Content("Hello private").Visibility(store.Private))
	tc.CreateMemo(NewMemoBuilder("memo-bye", tc.User.ID).Content("Goodbye public").Visibility(store.Public))

	memos := tc.ListWithFilter(`content.startsWith("Hello") && visibility == "PUBLIC"`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-pub", memos[0].UID)

	memos = tc.ListWithFilter(`!content.startsWith("Hello")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-bye", memos[0].UID)
}

func TestMemoFilterLogicalAnd(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	pinnedMemo := tc.CreateMemo(NewMemoBuilder("memo-pinned-public", tc.User.ID).Content("Pinned public"))
	tc.PinMemo(pinnedMemo.ID)
	tc.CreateMemo(NewMemoBuilder("memo-unpinned-public", tc.User.ID).Content("Unpinned public"))

	memos := tc.ListWithFilter(`pinned && visibility == "PUBLIC"`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Pinned)
}

func TestMemoFilterLogicalOr(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-public", tc.User.ID).Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-private", tc.User.ID).Visibility(store.Private))
	tc.CreateMemo(NewMemoBuilder("memo-protected", tc.User.ID).Visibility(store.Protected))

	memos := tc.ListWithFilter(`visibility == "PUBLIC" || visibility == "PRIVATE"`)
	require.Len(t, memos, 2)
}

func TestMemoFilterLogicalNot(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	pinnedMemo := tc.CreateMemo(NewMemoBuilder("memo-pinned", tc.User.ID).Content("Pinned"))
	tc.PinMemo(pinnedMemo.ID)
	tc.CreateMemo(NewMemoBuilder("memo-unpinned", tc.User.ID).Content("Unpinned"))

	memos := tc.ListWithFilter(`!pinned`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Pinned)
}

func TestMemoFilterNegatedComparison(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-public", tc.User.ID).Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-private", tc.User.ID).Visibility(store.Private))

	memos := tc.ListWithFilter(`!(visibility == "PUBLIC")`)
	require.Len(t, memos, 1)
	require.Equal(t, store.Private, memos[0].Visibility)
}

func TestMemoFilterComplexLogical(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create pinned public memo with tags
	pinnedMemo := tc.CreateMemo(NewMemoBuilder("memo-pinned-tagged", tc.User.ID).
		Content("Pinned and tagged").Tags("important"))
	tc.PinMemo(pinnedMemo.ID)

	// Create unpinned memo with same tag
	tc.CreateMemo(NewMemoBuilder("memo-unpinned-tagged", tc.User.ID).
		Content("Unpinned but tagged").Tags("important"))

	// Create pinned memo without tag
	pinned2 := tc.CreateMemo(NewMemoBuilder("memo-pinned-untagged", tc.User.ID).Content("Pinned but untagged"))
	tc.PinMemo(pinned2.ID)

	// Test: pinned && tag in ["important"]
	memos := tc.ListWithFilter(`pinned && tag in ["important"]`)
	require.Len(t, memos, 1)

	// Test: (pinned || tag in ["important"]) && visibility == "PUBLIC"
	memos = tc.ListWithFilter(`(pinned || tag in ["important"]) && visibility == "PUBLIC"`)
	require.Len(t, memos, 3)

	// Test: De Morgan's Law ! (A || B) == !A && !B
	// ! (pinned || has_task_list)
	tc.CreateMemo(NewMemoBuilder("memo-no-props", tc.User.ID).Content("Nothing special"))
	memos = tc.ListWithFilter(`!(pinned || has_task_list)`)
	require.Len(t, memos, 2) // Unpinned-tagged + Nothing special (pinned-untagged is pinned)
}

func TestMemoFilterMultipleFilters(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-public-hello", tc.User.ID).Content("Hello world").Visibility(store.Public))
	tc.CreateMemo(NewMemoBuilder("memo-private-hello", tc.User.ID).Content("Hello private").Visibility(store.Private))

	// Test: Multiple filters (applied as AND)
	memos := tc.ListWithFilters(`content.contains("Hello")`, `visibility == "PUBLIC"`)
	require.Len(t, memos, 1)
	require.Contains(t, memos[0].Content, "Hello")
	require.Equal(t, store.Public, memos[0].Visibility)
}

func TestMemoFilterNoMatches(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-test", tc.User.ID).Content("Test content"))

	memos := tc.ListWithFilter(`content.contains("nonexistent12345")`)
	require.Len(t, memos, 0)
}
