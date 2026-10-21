package meetinglibrary

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"

	"github.com/pkg/errors"
	"github.com/stretchr/testify/require"
)

func shortLibraryPath(t *testing.T, path string) string {
	t.Helper()
	input, err := syscall.UTF16PtrFromString(path)
	require.NoError(t, err)
	buffer := make([]uint16, 32768)
	n, err := syscall.GetShortPathName(input, &buffer[0], uint32(len(buffer)))
	require.NoError(t, err)
	require.Less(t, int(n), len(buffer))
	short := syscall.UTF16ToString(buffer[:n])
	if strings.EqualFold(short, path) {
		t.Skip("the temporary volume does not provide an 8.3 alias")
	}
	return short
}

func TestSafePathAcceptsWindowsShortName(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Noter library with a long directory name")
	require.NoError(t, os.Mkdir(root, 0700))
	short := shortLibraryPath(t, root)
	resolved, err := filepath.EvalSymlinks(short)
	require.NoError(t, err)
	require.NotEqual(t, strings.ToLower(short), strings.ToLower(resolved), "the fixture must exercise short-name expansion")

	path, err := SafePath(short, "new-folder/note.md")
	require.NoError(t, err)
	require.Equal(t, filepath.Join(short, "new-folder", "note.md"), path)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0700))
	require.NoError(t, os.WriteFile(path, []byte("saved through the short-name library"), 0600))
	content, err := os.ReadFile(filepath.Join(root, "new-folder", "note.md"))
	require.NoError(t, err)
	require.Equal(t, "saved through the short-name library", string(content))
}

func TestSafePathRejectsWindowsParentAliases(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "library")
	require.NoError(t, os.Mkdir(root, 0700))
	sentinel := filepath.Join(base, "outside.md")
	require.NoError(t, os.WriteFile(sentinel, []byte("outside remains unchanged"), 0600))
	// Short-name normalization must not accept Win32 parent-like spellings.
	for _, relative := range []string{"../outside.md", ".. /outside.md", ".. ./outside.md"} {
		_, err := SafePath(root, relative)
		require.Error(t, err, "parent alias must be rejected: %s", relative)
	}
	content, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "outside remains unchanged", string(content))
}

func TestSafePathRejectsWindowsJunction(t *testing.T) {
	root := filepath.Join(t.TempDir(), "Noter library with a long directory name")
	require.NoError(t, os.Mkdir(root, 0700))
	outside := t.TempDir()
	sentinel := filepath.Join(outside, "note.md")
	require.NoError(t, os.WriteFile(sentinel, []byte("outside remains unchanged"), 0600))
	link := filepath.Join(root, "redirect")
	command := exec.Command("cmd", "/d", "/c", "mklink", "/J", link, outside)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	output, err := command.CombinedOutput()
	require.NoError(t, err, "junction fixture: %s", output)
	t.Cleanup(func() { _ = os.Remove(link) })

	for _, relative := range []string{"redirect", "redirect/note.md", "redirect/new-folder/new-note.md"} {
		_, err := SafePath(root, relative)
		require.Error(t, err, "junction path must be rejected: %s", relative)
	}
	_, err = SafePath(link, "new-note.md")
	require.ErrorContains(t, err, "linked library paths", "a junction ancestor must also be rejected")
	t.Run("short-name root", func(t *testing.T) {
		_, err := SafePath(shortLibraryPath(t, root), "redirect/new-note.md")
		require.ErrorContains(t, err, "linked library paths")
	})
	content, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "outside remains unchanged", string(content))
	require.NoFileExists(t, filepath.Join(outside, "new-note.md"))
	require.NoDirExists(t, filepath.Join(outside, "new-folder"))
}

func TestSafePathRejectsWindowsSymbolicLink(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	sentinel := filepath.Join(outside, "note.md")
	require.NoError(t, os.WriteFile(sentinel, []byte("outside remains unchanged"), 0600))
	link := filepath.Join(root, "redirect")
	err := os.Symlink(outside, link)
	if errors.Is(err, syscall.ERROR_PRIVILEGE_NOT_HELD) {
		t.Skip("symbolic-link fixture requires Windows Developer Mode or the symlink privilege; junction rejection is tested separately")
	}
	require.NoError(t, err)
	t.Cleanup(func() { _ = os.Remove(link) })
	for _, relative := range []string{"redirect", "redirect/note.md", "redirect/new-folder/note.md"} {
		_, err := SafePath(root, relative)
		require.ErrorContains(t, err, "linked library paths")
	}
	_, err = SafePath(link, "new-note.md")
	require.ErrorContains(t, err, "linked library paths")
	content, err := os.ReadFile(sentinel)
	require.NoError(t, err)
	require.Equal(t, "outside remains unchanged", string(content))
	require.NoFileExists(t, filepath.Join(outside, "new-note.md"))
}
