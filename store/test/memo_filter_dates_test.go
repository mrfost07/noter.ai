package test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestMemoFilterCreatedTsComparison(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	nowSec := time.Now().Unix()
	tc.CreateMemo(NewMemoBuilder("memo-ts", tc.User.ID).Content("Timestamp test"))

	// Test: created_ts < future (should match)
	memos := tc.ListWithFilter(`created_ts < timestamp(` + formatInt64(nowSec+3600) + `)`)
	require.Len(t, memos, 1)

	// Test: created_ts > past (should match)
	memos = tc.ListWithFilter(`created_ts > timestamp(` + formatInt64(nowSec-3600) + `)`)
	require.Len(t, memos, 1)

	// Test: created_ts > future (should not match)
	memos = tc.ListWithFilter(`created_ts > timestamp(` + formatInt64(nowSec+3600) + `)`)
	require.Len(t, memos, 0)
}

func TestMemoFilterCreatedTsWithNow(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-ts-test", tc.User.ID).Content("Timestamp test"))

	// Test: created_ts < now + 5s (buffer for container clock drift)
	memos := tc.ListWithFilter(`created_ts < now + duration("5s")`)
	require.Len(t, memos, 1)

	// Test: created_ts > now + 5s (should not match)
	memos = tc.ListWithFilter(`created_ts > now + duration("5s")`)
	require.Len(t, memos, 0)
}

func TestMemoFilterCreatedTsArithmetic(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-ts-arith", tc.User.ID).Content("Timestamp arithmetic test"))

	// Test: created_ts >= now - 1h (memos created in last hour)
	memos := tc.ListWithFilter(`created_ts >= now - duration("1h")`)
	require.Len(t, memos, 1)

	// Test: created_ts < now - 24h (memos older than 1 day - should be empty)
	memos = tc.ListWithFilter(`created_ts < now - duration("24h")`)
	require.Len(t, memos, 0)

	// Test: chained duration arithmetic - created_ts >= now - 30m - 30m
	memos = tc.ListWithFilter(`created_ts >= now - duration("30m") - duration("30m")`)
	require.Len(t, memos, 1)
}

func TestMemoFilterUpdatedTs(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	memo := tc.CreateMemo(NewMemoBuilder("memo-updated", tc.User.ID).Content("Will be updated"))

	// Update the memo
	newContent := "Updated content"
	err := tc.Store.UpdateMemo(tc.Ctx, &store.UpdateMemo{
		ID:      memo.ID,
		Content: &newContent,
	})
	require.NoError(t, err)

	// Test: updated_ts >= now - 60s (updated in last minute)
	memos := tc.ListWithFilter(`updated_ts >= now - duration("60s")`)
	require.Len(t, memos, 1)

	// Test: updated_ts > now + 1h (should be empty)
	memos = tc.ListWithFilter(`updated_ts > now + duration("1h")`)
	require.Len(t, memos, 0)
}

func TestMemoFilterAllComparisonOperators(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-ops", tc.User.ID).Content("Comparison operators test"))

	// Test: < (less than)
	memos := tc.ListWithFilter(`created_ts < now + duration("1h")`)
	require.Len(t, memos, 1)

	// Test: <= (less than or equal) with buffer for clock drift
	memos = tc.ListWithFilter(`created_ts < now + duration("5s")`)
	require.Len(t, memos, 1)

	// Test: > (greater than)
	memos = tc.ListWithFilter(`created_ts > now - duration("1h")`)
	require.Len(t, memos, 1)

	// Test: >= (greater than or equal)
	memos = tc.ListWithFilter(`created_ts >= now - duration("60s")`)
	require.Len(t, memos, 1)
}
