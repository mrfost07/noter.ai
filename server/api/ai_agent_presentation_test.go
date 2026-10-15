package api

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAgentUsesReadableNoteTitles(t *testing.T) {
	require.Equal(t, "Launch review", agentNoteTitle("\n# Launch review\n\nScope details", "fallback"))
	require.Equal(t, "Fallback title", agentNoteTitle("", "Fallback title\nPreview"))
	require.Equal(t, "Untitled note", agentNoteTitle("\n#\n", ""))
	require.Equal(t, 101, len([]rune(agentNoteTitle(strings.Repeat("界", 150), ""))))
}
