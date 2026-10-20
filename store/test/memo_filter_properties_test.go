package test

import (
	"testing"

	"github.com/stretchr/testify/require"

	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestMemoFilterHasTaskList(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-with-tasks", tc.User.ID).
		Content("- [ ] Task 1\n- [x] Task 2").
		Property(func(p *storepb.MemoPayload_Property) { p.HasTaskList = true }))
	tc.CreateMemo(NewMemoBuilder("memo-no-tasks", tc.User.ID).Content("No tasks here"))

	// Test: has_task_list (predicate)
	memos := tc.ListWithFilter(`has_task_list`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Payload.Property.HasTaskList)

	// Test: has_task_list == true
	memos = tc.ListWithFilter(`has_task_list == true`)
	require.Len(t, memos, 1)

	// Test: has_task_list == false matches memos whose payload omits the flag
	memos = tc.ListWithFilter(`has_task_list == false`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Payload.GetProperty().GetHasTaskList())

	// Test: has_task_list != true
	memos = tc.ListWithFilter(`has_task_list != true`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Payload.GetProperty().GetHasTaskList())
}

func TestMemoFilterHasLink(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-with-link", tc.User.ID).
		Content("Check out https://example.com").
		Property(func(p *storepb.MemoPayload_Property) { p.HasLink = true }))
	tc.CreateMemo(NewMemoBuilder("memo-no-link", tc.User.ID).Content("No links"))

	memos := tc.ListWithFilter(`has_link`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Payload.Property.HasLink)

	// Test: has_link == false matches memos whose payload omits the flag
	memos = tc.ListWithFilter(`has_link == false`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Payload.GetProperty().GetHasLink())

	// Test: has_link != true
	memos = tc.ListWithFilter(`has_link != true`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Payload.GetProperty().GetHasLink())

	// Test: has_link != false
	memos = tc.ListWithFilter(`has_link != false`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Payload.GetProperty().GetHasLink())
}

func TestMemoFilterHasCode(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-with-code", tc.User.ID).
		Content("```go\nfmt.Println(\"Hello\")\n```").
		Property(func(p *storepb.MemoPayload_Property) { p.HasCode = true }))
	tc.CreateMemo(NewMemoBuilder("memo-no-code", tc.User.ID).Content("No code"))

	memos := tc.ListWithFilter(`has_code`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Payload.Property.HasCode)

	// Test: has_code == false matches memos whose payload omits the flag
	memos = tc.ListWithFilter(`has_code == false`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Payload.GetProperty().GetHasCode())
}

func TestMemoFilterHasIncompleteTasks(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-incomplete", tc.User.ID).
		Content("- [ ] Incomplete task").
		Property(func(p *storepb.MemoPayload_Property) {
			p.HasTaskList = true
			p.HasIncompleteTasks = true
		}))
	tc.CreateMemo(NewMemoBuilder("memo-complete", tc.User.ID).
		Content("- [x] Complete task").
		Property(func(p *storepb.MemoPayload_Property) {
			p.HasTaskList = true
			p.HasIncompleteTasks = false
		}))

	memos := tc.ListWithFilter(`has_incomplete_tasks`)
	require.Len(t, memos, 1)
	require.True(t, memos[0].Payload.Property.HasIncompleteTasks)

	// Test: has_incomplete_tasks == false matches memos whose payload omits the flag
	memos = tc.ListWithFilter(`has_incomplete_tasks == false`)
	require.Len(t, memos, 1)
	require.False(t, memos[0].Payload.GetProperty().GetHasIncompleteTasks())
}

func TestMemoFilterCombinedJSONBool(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Memo with all properties
	tc.CreateMemo(NewMemoBuilder("memo-all-props", tc.User.ID).
		Content("All properties").
		Property(func(p *storepb.MemoPayload_Property) {
			p.HasLink = true
			p.HasTaskList = true
			p.HasCode = true
			p.HasIncompleteTasks = true
		}))

	// Memo with only link
	tc.CreateMemo(NewMemoBuilder("memo-only-link", tc.User.ID).
		Content("Only link").
		Property(func(p *storepb.MemoPayload_Property) { p.HasLink = true }))

	// Test: has_link && has_code
	memos := tc.ListWithFilter(`has_link && has_code`)
	require.Len(t, memos, 1)

	// Test: has_task_list && has_incomplete_tasks
	memos = tc.ListWithFilter(`has_task_list && has_incomplete_tasks`)
	require.Len(t, memos, 1)

	// Test: has_link || has_code
	memos = tc.ListWithFilter(`has_link || has_code`)
	require.Len(t, memos, 2)
}

func TestMemoFilterNullPayload(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-null-payload", tc.User.ID).Content("Null payload"))

	// Test: has_link should not crash and return no results
	memos := tc.ListWithFilter(`has_link`)
	require.Len(t, memos, 0)
}

func TestMemoFilterJSONBooleanLogic(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// 1. Memo with task list (true) and NO link (null)
	tc.CreateMemo(NewMemoBuilder("memo-task-only", tc.User.ID).
		Content("Task only").
		Property(func(p *storepb.MemoPayload_Property) { p.HasTaskList = true }))

	// 2. Memo with link (true) and NO task list (null)
	tc.CreateMemo(NewMemoBuilder("memo-link-only", tc.User.ID).
		Content("Link only").
		Property(func(p *storepb.MemoPayload_Property) { p.HasLink = true }))

	// 3. Memo with both (true)
	tc.CreateMemo(NewMemoBuilder("memo-both", tc.User.ID).
		Content("Both").
		Property(func(p *storepb.MemoPayload_Property) {
			p.HasTaskList = true
			p.HasLink = true
		}))

	// 4. Memo with neither (null)
	tc.CreateMemo(NewMemoBuilder("memo-neither", tc.User.ID).Content("Neither"))

	// Test A: has_task_list || has_link
	// Expected: 3 memos (task-only, link-only, both). Neither should be excluded.
	// This specifically tests the NULL handling in OR logic (NULL || TRUE should be TRUE)
	memos := tc.ListWithFilter(`has_task_list || has_link`)
	require.Len(t, memos, 3, "Should find 3 memos with OR logic")

	// Test B: !has_task_list
	// Expected: 2 memos (link-only, neither). Memos where has_task_list is NULL or FALSE.
	// Note: If NULL is not handled, !NULL is still NULL (false-y in WHERE), so "neither" might be missed depending on logic.
	// In our implementation, we want missing fields to behave as false.
	memos = tc.ListWithFilter(`!has_task_list`)
	require.Len(t, memos, 2, "Should find 2 memos where task list is false or missing")

	// Test C: has_task_list && !has_link
	// Expected: 1 memo (task-only).
	memos = tc.ListWithFilter(`has_task_list && !has_link`)
	require.Len(t, memos, 1, "Should find 1 memo (task only)")
}
