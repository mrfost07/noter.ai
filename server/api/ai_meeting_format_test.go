package api

import (
	"testing"

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
