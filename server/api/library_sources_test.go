package api

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/core/meetinglibrary"
)

func TestMeetingSourcesUseOnlyKnownTranscriptTimes(t *testing.T) {
	m := &meetinglibrary.Meeting{ID: "meeting1", Transcript: []meetinglibrary.Line{{ID: "line1", Start: 122.5, End: 124}}}
	result := linkMeetingSources("Launch Friday [cite:line1]. Invented [cite:other].", m)
	require.Contains(t, result, "[02:02](/?meeting=meeting1&t=122.500#segment-line1)")
	require.NotContains(t, result, "other")
	require.NotContains(t, result, "[cite:")
}

func TestMeetingSourceGroupsNeverExposeRawIdentifiers(t *testing.T) {
	m := &meetinglibrary.Meeting{ID: "meeting1", Transcript: []meetinglibrary.Line{
		{ID: "line1", Start: 12, End: 15}, {ID: "line2", Start: 22, End: 25},
	}}
	result := linkMeetingSources("Launch [cite:line1, line2, unknown, line1].", m)
	require.Contains(t, result, "[00:12]")
	require.Contains(t, result, "[00:22]")
	require.NotContains(t, result, "[cite:")
	require.NotContains(t, result, "unknown")
}

func TestMeetingAnswersKeepMarkdownWithoutCitationNoise(t *testing.T) {
	answer := "## Main topic\n\nReviewed **customer feedback** [cite:6fd8f1b7-3293-493d-af23-9d8567bd2fbc, other-id].\n\n- Launch **Friday** [00:12](/?meeting=m1&t=12#segment-id).\n- Budget is **$12,000**."
	result := cleanMeetingAnswer(answer)
	require.Contains(t, result, "## Main topic")
	require.Contains(t, result, "Reviewed **customer feedback**.")
	require.Contains(t, result, "- Launch **Friday**.")
	require.Contains(t, result, "- Budget is **$12,000**.")
	require.NotContains(t, result, "cite:")
	require.NotContains(t, result, "6fd8f1b7")
	require.NotContains(t, result, "00:12")
	require.NotContains(t, result, "segment-id")
}
