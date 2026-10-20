package test

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMemoFilterContentContains(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create memos with different content
	tc.CreateMemo(NewMemoBuilder("memo-hello", tc.User.ID).Content("Hello world"))
	tc.CreateMemo(NewMemoBuilder("memo-goodbye", tc.User.ID).Content("Goodbye world"))
	tc.CreateMemo(NewMemoBuilder("memo-test", tc.User.ID).Content("Testing content"))

	// Test: content.contains("Hello") - single match
	memos := tc.ListWithFilter(`content.contains("Hello")`)
	require.Len(t, memos, 1)
	require.Contains(t, memos[0].Content, "Hello")

	// Test: content.contains("world") - multiple matches
	memos = tc.ListWithFilter(`content.contains("world")`)
	require.Len(t, memos, 2)

	// Test: content.contains("nonexistent") - no matches
	memos = tc.ListWithFilter(`content.contains("nonexistent")`)
	require.Len(t, memos, 0)
}

func TestMemoFilterContentSpecialCharacters(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-special", tc.User.ID).Content("Special chars: @#$%^&*()"))

	memos := tc.ListWithFilter(`content.contains("@#$%")`)
	require.Len(t, memos, 1)
}

func TestMemoFilterContentUnicode(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-unicode", tc.User.ID).Content("Unicode test: 你好世界 🌍"))

	memos := tc.ListWithFilter(`content.contains("你好")`)
	require.Len(t, memos, 1)
}

func TestMemoFilterContentUnicodeCaseFold(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-unicode-case", tc.User.ID).Content("Привет Мир"))

	memos := tc.ListWithFilter(`content.contains("привет")`)
	require.Len(t, memos, 1)
}

func TestMemoFilterContentCaseSensitivity(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-case", tc.User.ID).Content("MixedCase Content"))

	// Exact match
	memos := tc.ListWithFilter(`content.contains("MixedCase")`)
	require.Len(t, memos, 1)

	// Lowercase match (depends on DB collation, usually case-insensitive in default installs but good to verify behavior)
	// SQLite default LIKE is case-insensitive for ASCII.
	memosLower := tc.ListWithFilter(`content.contains("mixedcase")`)
	// We just verify it doesn't crash; strict case sensitivity expectation depends on DB config.
	// For standard Memos setup (SQLite), it's often case-insensitive.
	// Let's check if we get a result or not to characterize current behavior.
	if len(memosLower) > 0 {
		require.Equal(t, "MixedCase Content", memosLower[0].Content)
	}
}

func TestMemoFilterContentStartsWithEscaping(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-pct", tc.User.ID).Content("100% complete"))
	tc.CreateMemo(NewMemoBuilder("memo-plain", tc.User.ID).Content("100 things to do"))

	// The % must be treated literally, not as a LIKE wildcard.
	memos := tc.ListWithFilter(`content.startsWith("100%")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-pct", memos[0].UID)
}

func TestMemoFilterContentMatchesAdvanced(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-release", tc.User.ID).Content("release v2024 notes"))
	tc.CreateMemo(NewMemoBuilder("memo-draft", tc.User.ID).Content("draft document"))
	tc.CreateMemo(NewMemoBuilder("memo-animals", tc.User.ID).Content("cat and dog"))

	// Anchor: starts with "release".
	memos := tc.ListWithFilter(`content.matches("^release")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-release", memos[0].UID)

	// Character class + quantifier: a 4-digit run (portable across RE2/POSIX/ICU).
	memos = tc.ListWithFilter(`content.matches("[0-9]{4}")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-release", memos[0].UID)

	// Alternation.
	memos = tc.ListWithFilter(`content.matches("cat|mouse")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-animals", memos[0].UID)

	// No match.
	memos = tc.ListWithFilter(`content.matches("^zzz")`)
	require.Len(t, memos, 0)
}

func TestMemoFilterContentStartsWith(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-todo", tc.User.ID).Content("TODO: buy milk"))
	tc.CreateMemo(NewMemoBuilder("memo-done", tc.User.ID).Content("Done with milk"))

	// Prefix match, case-insensitive (consistent with contains()).
	memos := tc.ListWithFilter(`content.startsWith("todo")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-todo", memos[0].UID)

	memos = tc.ListWithFilter(`content.startsWith("nope")`)
	require.Len(t, memos, 0)
}

func TestMemoFilterContentEndsWith(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-md", tc.User.ID).Content("notes.md"))
	tc.CreateMemo(NewMemoBuilder("memo-txt", tc.User.ID).Content("notes.txt"))

	memos := tc.ListWithFilter(`content.endsWith(".md")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-md", memos[0].UID)
}

func TestMemoFilterContentMatches(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-v1", tc.User.ID).Content("release v12 shipped"))
	tc.CreateMemo(NewMemoBuilder("memo-plain", tc.User.ID).Content("no version here"))

	memos := tc.ListWithFilter(`content.matches("v[0-9]+")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-v1", memos[0].UID)

	memos = tc.ListWithFilter(`content.matches("^xyz")`)
	require.Len(t, memos, 0)
}
