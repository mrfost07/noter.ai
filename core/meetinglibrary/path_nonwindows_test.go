//go:build !windows

package meetinglibrary

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestSafePathRejectsSymbolicLinkAncestors(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	sentinel := filepath.Join(outside, "note.md")
	require.NoError(t, os.WriteFile(sentinel, []byte("outside remains unchanged"), 0600))
	link := filepath.Join(root, "redirect")
	require.NoError(t, os.Symlink(outside, link))
	for _, relative := range []string{"redirect", "redirect/note.md", "redirect/new-folder/note.md"} {
		_, err := SafePath(root, relative)
		require.ErrorContains(t, err, "linked library paths")
	}
	_, err := SafePath(link, "new-note.md")
	require.ErrorContains(t, err, "linked library paths")
	content, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "outside remains unchanged", string(content))
	require.NoFileExists(t, filepath.Join(outside, "new-note.md"))
}
