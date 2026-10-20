package api

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/require"

	apipb "github.com/usememos/memos/proto/gen/api"
)

func TestMeetingNotesKeepCategorizedDetails(t *testing.T) {
	notes, err := parseMeetingNotesJSON(`{
  "tasksForYou":["**Priya** will send the schema by **Friday**"],
  "midMeetingChanges":["The launch moved from November 12 to November 15"],
  "clientDecisions":["Approved the PostgreSQL design"],
  "crucialInfo":[
    "Title: Atlas launch review",
    "Summary: Reviewed the rollout and approved the revised schedule",
    "Detail: The export bug blocks the pilot",
    "Date: Launch on **November 15 at 10 AM**",
    "Person: **Priya** owns the schema",
    "Metric: Budget capped at **$12,000**",
    "Resource: Specification at https://example.test/atlas"
  ],
  "followUpQuestions":[]
}`)
	require.NoError(t, err)
	markdown := formatMeetingNotesMarkdown(notes)
	require.Contains(t, markdown, "# Atlas launch review #meeting-notes")
	for _, heading := range []string{"Summary", "Discussion & key details", "Dates & deadlines", "People & responsibilities", "Numbers & constraints", "Links & resources", "Decisions", "Action items", "Scope changes"} {
		require.Contains(t, markdown, "## "+heading)
	}
	require.Contains(t, markdown, "- Launch on **November 15 at 10 AM**")
	require.Contains(t, markdown, "- [ ] **Priya** will send the schema by **Friday**")
	require.NotContains(t, markdown, "## Open questions")
	require.NotContains(t, markdown, "## Transcript")
}

func TestMeetingNotesRetainLegacyInformation(t *testing.T) {
	markdown := formatMeetingNotesMarkdown(&apipb.MeetingNotesState{CrucialInfo: []string{"Legacy project details stay readable"}})
	require.Contains(t, markdown, "## Discussion & key details")
	require.Contains(t, markdown, "Legacy project details stay readable")
}

func TestEmptyMeetingAnalysisIsNotAnOrganizedDraft(t *testing.T) {
	_, err := parseMeetingNotesJSON(`{}`)
	require.ErrorContains(t, err, "AI returned no meeting notes")
}

func TestMeetingNotesTruncateAtUTF8Boundaries(t *testing.T) {
	for _, character := range []string{"é", "会", "📅"} {
		t.Run(character, func(t *testing.T) {
			prefix := strings.Repeat("a", maxMeetingNotesItemLength-1)
			input := prefix + character + " review"
			notes, err := parseMeetingNotesJSON(`{"crucialInfo":["` + input + `"]}`)
			require.NoError(t, err)
			require.Equal(t, []string{prefix}, notes.GetCrucialInfo())
			require.True(t, utf8.ValidString(notes.GetCrucialInfo()[0]))
			require.True(t, utf8.ValidString(formatMeetingNotesMarkdown(notes)))
		})
	}
	// A complete multibyte character that fits at the exact limit is retained.
	input := strings.Repeat("a", maxMeetingNotesItemLength-len("📅")) + "📅"
	require.Equal(t, []string{input}, sanitizeNoteSlice([]string{input + " more"}))
}
