package test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestMemoFilterTagsAll(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-all-work", tc.User.ID).Content("all work").Tags("work", "work/a", "work/b"))
	tc.CreateMemo(NewMemoBuilder("memo-mixed", tc.User.ID).Content("mixed").Tags("work", "work/a", "home"))
	tc.CreateMemo(NewMemoBuilder("memo-untagged", tc.User.ID).Content("untagged"))

	// Every tag belongs to the work hierarchy: only the all-work memo qualifies.
	memos := tc.ListWithFilter(`tags.all(t, t.startsWith("work"))`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-all-work", memos[0].UID)

	// Untagged memos must NOT match (non-empty guard, decision B).
	require.NotContains(t, uids(memos), "memo-untagged")
}

func TestMemoFilterTagsAllEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-only-x", tc.User.ID).Content("only x").Tags("x"))
	tc.CreateMemo(NewMemoBuilder("memo-x-and-y", tc.User.ID).Content("x and y").Tags("x", "y"))

	memos := tc.ListWithFilter(`tags.all(t, t == "x")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-only-x", memos[0].UID)
	tc.CreateMemo(NewMemoBuilder("memo-upper-work", tc.User.ID).Tags("Work"))
	tc.CreateMemo(NewMemoBuilder("memo-lower-work", tc.User.ID).Tags("work"))
	memos = tc.ListWithFilter(`tags.all(t, t == "work")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-lower-work", memos[0].UID)

	longTag := strings.Repeat("a", 513)
	tc.CreateMemo(NewMemoBuilder("memo-long-tag", tc.User.ID).Tags(longTag))
	memos = tc.ListWithFilter(`tags.all(t, t == "` + longTag + `")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-long-tag", memos[0].UID)
}

func TestMemoFilterTagsAllMorePredicates(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-all-done", tc.User.ID).Tags("done", "well-done"))
	tc.CreateMemo(NewMemoBuilder("memo-mixed", tc.User.ID).Tags("done", "todo"))
	tc.CreateMemo(NewMemoBuilder("memo-single", tc.User.ID).Tags("solo-done"))

	// endsWith: every tag ends with "done".
	memos := tc.ListWithFilter(`tags.all(t, t.endsWith("done"))`)
	require.ElementsMatch(t, []string{"memo-all-done", "memo-single"}, uids(memos))

	// contains: every tag contains "o".
	memos = tc.ListWithFilter(`tags.all(t, t.contains("o"))`)
	require.ElementsMatch(t, []string{"memo-all-done", "memo-mixed", "memo-single"}, uids(memos))
}

func TestMemoFilterTagsAllNegatedAndCombined(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-work", tc.User.ID).Content("work memo").Tags("work", "work/a", "work/b"))
	tc.CreateMemo(NewMemoBuilder("memo-mixed", tc.User.ID).Content("mixed memo").Tags("work", "work/a", "home"))
	tc.CreateMemo(NewMemoBuilder("memo-untagged", tc.User.ID).Content("untagged memo"))

	// Negation: NOT all-work. The untagged memo's all() is false (non-empty guard),
	// so !all() is true and it is included.
	memos := tc.ListWithFilter(`!tags.all(t, t.startsWith("work"))`)
	require.ElementsMatch(t, []string{"memo-mixed", "memo-untagged"}, uids(memos))

	// Combined with a content filter.
	memos = tc.ListWithFilter(`tags.all(t, t.startsWith("work")) && content.contains("work")`)
	require.Len(t, memos, 1)
	require.Equal(t, "memo-work", memos[0].UID)
}

func TestMemoFilterTagInList(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-work", tc.User.ID).Content("Work memo").Tags("work", "important"))
	tc.CreateMemo(NewMemoBuilder("memo-personal", tc.User.ID).Content("Personal memo").Tags("personal", "fun"))
	tc.CreateMemo(NewMemoBuilder("memo-no-tags", tc.User.ID).Content("No tags"))

	// Test: tag in ["work"]
	memos := tc.ListWithFilter(`tag in ["work"]`)
	require.Len(t, memos, 1)
	require.Contains(t, memos[0].Payload.Tags, "work")

	// Test: tag in ["work", "personal"]
	memos = tc.ListWithFilter(`tag in ["work", "personal"]`)
	require.Len(t, memos, 2)
}

func TestMemoFilterElementInTags(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-tagged", tc.User.ID).Content("Tagged memo").Tags("project", "todo"))
	tc.CreateMemo(NewMemoBuilder("memo-untagged", tc.User.ID).Content("Untagged memo"))

	// Test: "project" in tags
	memos := tc.ListWithFilter(`"project" in tags`)
	require.Len(t, memos, 1)

	// Test: "nonexistent" in tags
	memos = tc.ListWithFilter(`"nonexistent" in tags`)
	require.Len(t, memos, 0)
}

func TestMemoFilterHierarchicalTags(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-book", tc.User.ID).Content("Book memo").Tags("book"))
	tc.CreateMemo(NewMemoBuilder("memo-book-fiction", tc.User.ID).Content("Fiction book memo").Tags("book", "book/fiction"))

	// Implied ancestors are stored in the memo tag set, so exact membership matches both memos.
	memos := tc.ListWithFilter(`tag in ["book"]`)
	require.Len(t, memos, 2)
}

func TestMemoFilterTagMembershipIsExact(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()
	const (
		composedTag   = "caf\u00e9"
		decomposedTag = "cafe\u0301"
	)

	tc.CreateMemo(NewMemoBuilder("memo-underscore", tc.User.ID).Tags("a_b"))
	tc.CreateMemo(NewMemoBuilder("memo-letter", tc.User.ID).Tags("axb"))
	tc.CreateMemo(NewMemoBuilder("memo-percent", tc.User.ID).Tags("a%b"))
	tc.CreateMemo(NewMemoBuilder("memo-letters", tc.User.ID).Tags("aZZb"))
	tc.CreateMemo(NewMemoBuilder("memo-upper", tc.User.ID).Tags("Work"))
	tc.CreateMemo(NewMemoBuilder("memo-lower", tc.User.ID).Tags("work"))
	tc.CreateMemo(NewMemoBuilder("memo-composed", tc.User.ID).Tags(composedTag))
	tc.CreateMemo(NewMemoBuilder("memo-decomposed", tc.User.ID).Tags(decomposedTag))
	tc.CreateMemo(NewMemoBuilder("memo-book", tc.User.ID).Tags("book"))
	tc.CreateMemo(NewMemoBuilder("memo-descendant-only", tc.User.ID).Tags("book/fiction"))

	for _, test := range []struct {
		filter string
		want   string
	}{
		{filter: `tag in ["a_b"]`, want: "memo-underscore"},
		{filter: `tag in ["a%b"]`, want: "memo-percent"},
		{filter: `tag in ["Work"]`, want: "memo-upper"},
		{filter: `tag in ["work"]`, want: "memo-lower"},
		{filter: `tag in ["` + composedTag + `"]`, want: "memo-composed"},
		{filter: `tag in ["` + decomposedTag + `"]`, want: "memo-decomposed"},
		{filter: `tag in ["book"]`, want: "memo-book"},
		{filter: `"work" in tags`, want: "memo-lower"},
	} {
		memos := tc.ListWithFilter(test.filter)
		require.Len(t, memos, 1, test.filter)
		require.Equal(t, test.want, memos[0].UID, test.filter)
	}

	for _, test := range []struct {
		filter string
		want   string
	}{
		{filter: `tags.exists(t, t.startsWith("a_"))`, want: "memo-underscore"},
		{filter: `tags.exists(t, t.endsWith("%b"))`, want: "memo-percent"},
		{filter: `tags.exists(t, t.contains("a%b"))`, want: "memo-percent"},
		{filter: `tags.all(t, t.startsWith("a_"))`, want: "memo-underscore"},
		{filter: `tags.exists_one(t, t.contains("a%b"))`, want: "memo-percent"},
	} {
		memos := tc.ListWithFilter(test.filter)
		require.Len(t, memos, 1, test.filter)
		require.Equal(t, test.want, memos[0].UID, test.filter)
	}

	require.Empty(t, tc.ListWithFilter(`tags.exists(t, t.contains("A_"))`))
}

func TestMemoFilterEmptyTags(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-empty-tags", tc.User.ID).Content("Empty tags").Tags())

	memos := tc.ListWithFilter(`tag in ["anything"]`)
	require.Len(t, memos, 0)
}

func TestMemoFilterTagsExistsStartsWith(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create memos with different tags
	tc.CreateMemo(NewMemoBuilder("memo-archive1", tc.User.ID).
		Content("Archived project memo").
		Tags("archive/project", "done"))

	tc.CreateMemo(NewMemoBuilder("memo-archive2", tc.User.ID).
		Content("Archived work memo").
		Tags("archive/work", "old"))

	tc.CreateMemo(NewMemoBuilder("memo-active", tc.User.ID).
		Content("Active project memo").
		Tags("project/active", "todo"))

	tc.CreateMemo(NewMemoBuilder("memo-homelab", tc.User.ID).
		Content("Homelab memo").
		Tags("homelab/memos", "tech"))

	// Test: tags.exists(t, t.startsWith("archive")) - should match archived memos
	memos := tc.ListWithFilter(`tags.exists(t, t.startsWith("archive"))`)
	require.Len(t, memos, 2, "Should find 2 archived memos")
	for _, memo := range memos {
		hasArchiveTag := false
		for _, tag := range memo.Payload.Tags {
			if len(tag) >= 7 && tag[:7] == "archive" {
				hasArchiveTag = true
				break
			}
		}
		require.True(t, hasArchiveTag, "Memo should have tag starting with 'archive'")
	}

	// Test: !tags.exists(t, t.startsWith("archive")) - should match non-archived memos
	memos = tc.ListWithFilter(`!tags.exists(t, t.startsWith("archive"))`)
	require.Len(t, memos, 2, "Should find 2 non-archived memos")

	// Test: tags.exists(t, t.startsWith("project")) - should match project memos
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("project"))`)
	require.Len(t, memos, 1, "Should find 1 project memo")

	// Test: tags.exists(t, t.startsWith("homelab")) - should match homelab memos
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("homelab"))`)
	require.Len(t, memos, 1, "Should find 1 homelab memo")

	// Test: tags.exists(t, t.startsWith("nonexistent")) - should match nothing
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("nonexistent"))`)
	require.Len(t, memos, 0, "Should find no memos")
}

func TestMemoFilterTagsExistsContains(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create memos with different tags
	tc.CreateMemo(NewMemoBuilder("memo-todo1", tc.User.ID).
		Content("Todo task 1").
		Tags("project/todo", "urgent"))

	tc.CreateMemo(NewMemoBuilder("memo-todo2", tc.User.ID).
		Content("Todo task 2").
		Tags("work/todo-list", "pending"))

	tc.CreateMemo(NewMemoBuilder("memo-done", tc.User.ID).
		Content("Done task").
		Tags("project/completed", "done"))

	// Test: tags.exists(t, t.contains("todo")) - should match todos
	memos := tc.ListWithFilter(`tags.exists(t, t.contains("todo"))`)
	require.Len(t, memos, 2, "Should find 2 todo memos")

	// Test: tags.exists(t, t.contains("done")) - should match done
	memos = tc.ListWithFilter(`tags.exists(t, t.contains("done"))`)
	require.Len(t, memos, 1, "Should find 1 done memo")

	// Test: !tags.exists(t, t.contains("todo")) - should exclude todos
	memos = tc.ListWithFilter(`!tags.exists(t, t.contains("todo"))`)
	require.Len(t, memos, 1, "Should find 1 non-todo memo")
}

func TestMemoFilterTagsExistsEquals(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	tc.CreateMemo(NewMemoBuilder("memo-1231", tc.User.ID).
		Content("Memo with exact numeric tag").
		Tags("1231", "project"))

	tc.CreateMemo(NewMemoBuilder("memo-1231-suffix", tc.User.ID).
		Content("Memo with related tag").
		Tags("tag/1231", "other"))

	tc.CreateMemo(NewMemoBuilder("memo-other", tc.User.ID).
		Content("Memo with different tag").
		Tags("9999"))

	memos := tc.ListWithFilter(`tags.exists(t, t == "1231")`)
	require.Len(t, memos, 1, "Should find only the memo with exact matching tag")
	require.Equal(t, "memo-1231", memos[0].UID)

	memos = tc.ListWithFilter(`!tags.exists(t, t == "1231")`)
	require.Len(t, memos, 2, "Should exclude only the memo with exact matching tag")
}

func TestMemoFilterTagsExistsEndsWith(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create memos with different tag endings
	tc.CreateMemo(NewMemoBuilder("memo-bug", tc.User.ID).
		Content("Bug report").
		Tags("project/bug", "critical"))

	tc.CreateMemo(NewMemoBuilder("memo-debug", tc.User.ID).
		Content("Debug session").
		Tags("work/debug", "dev"))

	tc.CreateMemo(NewMemoBuilder("memo-feature", tc.User.ID).
		Content("New feature").
		Tags("project/feature", "new"))

	// Test: tags.exists(t, t.endsWith("bug")) - should match bug-related tags
	memos := tc.ListWithFilter(`tags.exists(t, t.endsWith("bug"))`)
	require.Len(t, memos, 2, "Should find 2 bug-related memos")

	// Test: tags.exists(t, t.endsWith("feature")) - should match feature
	memos = tc.ListWithFilter(`tags.exists(t, t.endsWith("feature"))`)
	require.Len(t, memos, 1, "Should find 1 feature memo")

	// Test: !tags.exists(t, t.endsWith("bug")) - should exclude bug-related
	memos = tc.ListWithFilter(`!tags.exists(t, t.endsWith("bug"))`)
	require.Len(t, memos, 1, "Should find 1 non-bug memo")
}

func TestMemoFilterTagsExistsCombinedWithOtherFilters(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create memos with tags and other properties
	tc.CreateMemo(NewMemoBuilder("memo-archived-old", tc.User.ID).
		Content("Old archived memo").
		Tags("archive/old", "done"))

	tc.CreateMemo(NewMemoBuilder("memo-archived-recent", tc.User.ID).
		Content("Recent archived memo with TODO").
		Tags("archive/recent", "done"))

	tc.CreateMemo(NewMemoBuilder("memo-active-todo", tc.User.ID).
		Content("Active TODO").
		Tags("project/active", "todo"))

	// Test: Combine tag filter with content filter
	memos := tc.ListWithFilter(`tags.exists(t, t.startsWith("archive")) && content.contains("TODO")`)
	require.Len(t, memos, 1, "Should find 1 archived memo with TODO in content")

	// Test: OR condition with tag filters
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("archive")) || tags.exists(t, t.contains("todo"))`)
	require.Len(t, memos, 3, "Should find all memos (archived or with todo tag)")

	// Test: Complex filter - archived but not containing "Recent"
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("archive")) && !content.contains("Recent")`)
	require.Len(t, memos, 1, "Should find 1 old archived memo")
}

func TestMemoFilterTagsExistsEmptyAndNullCases(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create memo with no tags
	tc.CreateMemo(NewMemoBuilder("memo-no-tags", tc.User.ID).
		Content("Memo without tags"))

	// Create memo with tags
	tc.CreateMemo(NewMemoBuilder("memo-with-tags", tc.User.ID).
		Content("Memo with tags").
		Tags("tag1", "tag2"))

	// Test: tags.exists should not match memos without tags
	memos := tc.ListWithFilter(`tags.exists(t, t.startsWith("tag"))`)
	require.Len(t, memos, 1, "Should only find memo with tags")

	// Test: Negation should match memos without matching tags
	memos = tc.ListWithFilter(`!tags.exists(t, t.startsWith("tag"))`)
	require.Len(t, memos, 1, "Should find memo without matching tags")
}

func TestMemoFilterIssue5480_ArchiveWorkflow(t *testing.T) {
	t.Parallel()
	tc := NewMemoFilterTestContext(t)
	defer tc.Close()

	// Create a realistic scenario as described in issue #5480
	// User has hierarchical tags and archives memos by prefixing with "archive"

	// Active memos
	tc.CreateMemo(NewMemoBuilder("memo-homelab", tc.User.ID).
		Content("Setting up Memos").
		Tags("homelab/memos", "tech"))

	tc.CreateMemo(NewMemoBuilder("memo-project-alpha", tc.User.ID).
		Content("Project Alpha notes").
		Tags("work/project-alpha", "active"))

	// Archived memos (user prefixed tags with "archive")
	tc.CreateMemo(NewMemoBuilder("memo-old-homelab", tc.User.ID).
		Content("Old homelab setup").
		Tags("archive/homelab/old-server", "done"))

	tc.CreateMemo(NewMemoBuilder("memo-old-project", tc.User.ID).
		Content("Old project beta").
		Tags("archive/work/project-beta", "completed"))

	tc.CreateMemo(NewMemoBuilder("memo-archived-personal", tc.User.ID).
		Content("Archived personal note").
		Tags("archive/personal/2024", "old"))

	// Test: Filter out ALL archived memos using startsWith
	memos := tc.ListWithFilter(`!tags.exists(t, t.startsWith("archive"))`)
	require.Len(t, memos, 2, "Should only show active memos (not archived)")
	for _, memo := range memos {
		for _, tag := range memo.Payload.Tags {
			require.NotContains(t, tag, "archive", "Active memos should not have archive prefix")
		}
	}

	// Test: Show ONLY archived memos
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("archive"))`)
	require.Len(t, memos, 3, "Should find all archived memos")
	for _, memo := range memos {
		hasArchiveTag := false
		for _, tag := range memo.Payload.Tags {
			if len(tag) >= 7 && tag[:7] == "archive" {
				hasArchiveTag = true
				break
			}
		}
		require.True(t, hasArchiveTag, "All returned memos should have archive prefix")
	}

	// Test: Filter archived homelab memos specifically
	memos = tc.ListWithFilter(`tags.exists(t, t.startsWith("archive/homelab"))`)
	require.Len(t, memos, 1, "Should find only archived homelab memos")
}
