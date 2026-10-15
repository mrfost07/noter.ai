package meetinglibrary

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func setup(t *testing.T) (*Manager, *Index, string, string) {
	t.Helper()
	data := t.TempDir()
	root := t.TempDir()
	m := New(data, root)
	i, err := m.CreateMeeting(1, "Client review", "")
	require.NoError(t, err)
	return m, i, data, root
}

func TestCaptureDurabilityAndAccountIsolation(t *testing.T) {
	m, i, data, root := setup(t)
	mid := i.Meetings[0].ID
	i, err := m.BeginPart(1, mid, "video/webm")
	require.NoError(t, err)
	pid := i.Meetings[0].Parts[0].ID
	size, err := m.Append(1, mid, pid, 0, []byte("first"), 2)
	require.NoError(t, err)
	require.EqualValues(t, 5, size)
	size, err = m.Append(1, mid, pid, 0, []byte("first"), 2)
	require.NoError(t, err)
	require.EqualValues(t, 5, size)
	_, err = m.Append(1, mid, pid, 0, []byte("other"), 2)
	require.ErrorContains(t, err, "differs")
	_, err = m.Append(1, mid, pid, 8, []byte("gap"), 3)
	require.Error(t, err)
	_, _, err = m.Media(2, mid, pid)
	require.Error(t, err)
	restarted := New(data, root)
	i, err = restarted.Get(1)
	require.NoError(t, err)
	require.Equal(t, "interrupted", i.Meetings[0].Status)
	require.Equal(t, 2.0, i.Meetings[0].Duration)
	i, err = restarted.FinishPart(1, mid, pid, 2)
	require.NoError(t, err)
	path, _, err := restarted.Media(1, mid, pid)
	require.NoError(t, err)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "first", string(content))
	require.True(t, i.Meetings[0].Parts[0].Complete)
	_, err = restarted.Append(1, mid, pid, 5, []byte("late"), 3)
	require.Error(t, err)
	i, err = restarted.BeginPart(1, mid, "audio/webm")
	require.NoError(t, err)
	require.Equal(t, 2.0, i.Meetings[0].Parts[1].Start)
}

func TestTranscriptDraftAndSavedNoteAreIndependent(t *testing.T) {
	m, i, _, _ := setup(t)
	mid := i.Meetings[0].ID
	draft := "# Draft only"
	lines := []Line{{ID: "line-a", Text: "Ship Friday --> confirmed", Speaker: "Client 1", Start: 1.2, End: 4}}
	i, err := m.UpdateMeeting(1, mid, nil, nil, &draft, &lines, nil)
	require.NoError(t, err)
	require.Empty(t, i.Notes)
	caption, err := os.ReadFile(filepath.Join(i.Root, filepath.FromSlash(i.Meetings[0].Path), "transcript.vtt"))
	require.NoError(t, err)
	require.Contains(t, string(caption), "00:00:01.200 --> 00:00:04.000")
	require.Contains(t, string(caption), "Ship Friday → confirmed")
	i, err = m.SyncNote(1, "memos/note-one", "Review", draft, nil, &mid)
	require.NoError(t, err)
	require.Equal(t, "memos/note-one", i.Meetings[0].NoteName)
	path := filepath.Join(i.Root, filepath.FromSlash(i.Notes[0].Path))
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, draft, string(content))
	draft = "# Unsaved AI edits"
	_, err = m.UpdateMeeting(1, mid, nil, nil, &draft, nil, nil)
	require.NoError(t, err)
	content, err = os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "# Draft only", string(content))
	require.NoError(t, os.WriteFile(path, []byte("Edited in another editor"), 0600))
	_, err = m.SyncNote(1, "memos/note-one", "Review", "Overwrite", nil, nil)
	require.ErrorContains(t, err, "edited outside")
	content, err = os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "Edited in another editor", string(content))
}

func TestMovesKeepLinksAndPhysicalFiles(t *testing.T) {
	m, i, _, _ := setup(t)
	mid := i.Meetings[0].ID
	_, err := m.SyncNote(1, "memos/note-one", "Review", "Saved", nil, &mid)
	require.NoError(t, err)
	i, err = m.CreateFolder(1, "Atlas", "")
	require.NoError(t, err)
	fid := i.Folders[0].ID
	old := filepath.Join(i.Root, filepath.FromSlash(i.Meetings[0].Path))
	i, err = m.UpdateMeeting(1, mid, nil, &fid, nil, nil, nil)
	require.NoError(t, err)
	require.NoDirExists(t, old)
	require.FileExists(t, filepath.Join(i.Root, filepath.FromSlash(i.Notes[0].Path)))
	require.Equal(t, mid, i.Notes[0].MeetingID)
	i, err = m.RenameFolder(1, fid, "Atlas revised")
	require.NoError(t, err)
	require.Contains(t, i.Folders[0].Path, "Atlas revised")
	require.Contains(t, i.Meetings[0].Path, "Atlas revised")
	require.FileExists(t, filepath.Join(i.Root, filepath.FromSlash(i.Notes[0].Path)))
}

func TestRelocationCopiesVerifiesAndRetainsOldLibrary(t *testing.T) {
	m, _, _, _ := setup(t)
	i, err := m.SyncNote(1, "memos/ordinary", "Ordinary", "Important note", nil, nil)
	require.NoError(t, err)
	oldRoot := i.Root
	destination := filepath.Join(t.TempDir(), "new-library")
	i, err = m.Relocate(1, destination)
	require.NoError(t, err)
	require.Equal(t, destination, i.Root)
	require.FileExists(t, filepath.Join(oldRoot, filepath.FromSlash(i.Notes[0].Path)))
	require.FileExists(t, filepath.Join(destination, filepath.FromSlash(i.Notes[0].Path)))
	_, err = m.Relocate(1, oldRoot)
	require.ErrorContains(t, err, "empty destination")
}

func TestInvalidMetadataDoesNotMoveFiles(t *testing.T) {
	m, i, _, _ := setup(t)
	mid := i.Meetings[0].ID
	old := i.Meetings[0].Path
	i, err := m.CreateFolder(1, "Destination", "")
	require.NoError(t, err)
	fid := i.Folders[0].ID
	bad := []Line{{ID: "bad", Start: math.NaN()}}
	_, err = m.UpdateMeeting(1, mid, nil, &fid, nil, &bad, nil)
	require.Error(t, err)
	i, err = m.Get(1)
	require.NoError(t, err)
	require.Equal(t, old, i.Meetings[0].Path)
	require.DirExists(t, filepath.Join(i.Root, filepath.FromSlash(old)))
	_, err = SafePath(i.Root, "../elsewhere")
	require.Error(t, err)
	_, err = SafePath(i.Root, "C:\\elsewhere")
	require.Error(t, err)
	require.Equal(t, "_CON", Filename("CON"))
	require.NotContains(t, Filename("Client: A/B?*"), "/")
}

func TestDraftRecoveryIsPrivateAndAccountScoped(t *testing.T) {
	m, _, data, root := setup(t)
	_, err := m.SaveDraft(1, Draft{ID: "draft", Title: "Thought", Content: "Unsaved text"})
	require.NoError(t, err)
	restarted := New(data, root)
	i, err := restarted.Get(1)
	require.NoError(t, err)
	require.Equal(t, "Unsaved text", i.Drafts[0].Content)
	require.Empty(t, i.Notes)
	other, err := restarted.Get(2)
	require.NoError(t, err)
	require.Empty(t, other.Drafts)
	i, err = restarted.DiscardDraft(1, "draft")
	require.NoError(t, err)
	require.Empty(t, i.Drafts)
}

func TestInterruptedFolderMoveRecoversIndex(t *testing.T) {
	m, _, data, root := setup(t)
	i, err := m.CreateFolder(1, "Before", "")
	require.NoError(t, err)
	source := i.Folders[0].Path
	target := "After--folder"
	i.Folders[0].Path = target
	i.Folders[0].Title = "After"
	journal, _ := json.Marshal(moveJournal{Index: i, Source: source, Target: target})
	require.NoError(t, atomic(m.journalPath(1), journal))
	require.NoError(t, os.Rename(filepath.Join(i.Root, source), filepath.Join(i.Root, target)))
	restarted := New(data, root)
	i, err = restarted.Get(1)
	require.NoError(t, err)
	require.Equal(t, target, i.Folders[0].Path)
	require.NoFileExists(t, m.journalPath(1))
}

func TestWebMDurationRepairStreamsContainer(t *testing.T) {
	path := filepath.Join(t.TempDir(), "recording.webm")
	info := []byte{0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40}
	fixture := append([]byte{0x18, 0x53, 0x80, 0x67, 0xff, 0x15, 0x49, 0xa9, 0x66, byte(0x80 + len(info))}, info...)
	fixture = append(fixture, bytes.Repeat([]byte("frames"), 50000)...)
	require.NoError(t, os.WriteFile(path, fixture, 0600))
	require.NoError(t, repairWebMDuration(path, 12.5))
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	offset := bytes.Index(data, []byte{0x44, 0x89, 0x88})
	require.Positive(t, offset)
	require.Equal(t, 12500.0, math.Float64frombits(binary.BigEndian.Uint64(data[offset+3:offset+11])))
	require.True(t, strings.HasSuffix(string(data), strings.Repeat("frames", 50000)))
	size := len(data)
	require.NoError(t, repairWebMDuration(path, 12.5))
	data, err = os.ReadFile(path)
	require.NoError(t, err)
	require.Len(t, data, size)
}

func TestCaptionsFollowResumedPartTimeline(t *testing.T) {
	m, i, _, _ := setup(t)
	mid := i.Meetings[0].ID
	i, err := m.BeginPart(1, mid, "audio/webm")
	require.NoError(t, err)
	_, err = m.FinishPart(1, mid, i.Meetings[0].Parts[0].ID, 10)
	require.NoError(t, err)
	i, err = m.BeginPart(1, mid, "audio/webm")
	require.NoError(t, err)
	pid := i.Meetings[0].Parts[1].ID
	_, err = m.FinishPart(1, mid, pid, 8)
	require.NoError(t, err)
	lines := []Line{
		{ID: "old", Text: "Before resume", Speaker: "Client 1", Start: 2, End: 4},
		{ID: "overlap", Text: "Overlapping turn", Speaker: "Client 1", Start: 9, End: 12},
		{ID: "new", Text: "<script>details</script>", Speaker: "Client 2", Start: 13, End: 15},
	}
	_, err = m.UpdateMeeting(1, mid, nil, nil, nil, &lines, nil)
	require.NoError(t, err)
	captions, err := m.Captions(1, mid, pid)
	require.NoError(t, err)
	require.NotContains(t, captions, "Before resume")
	require.Contains(t, captions, "00:00:00.000 --> 00:00:02.000")
	require.Contains(t, captions, "00:00:03.000 --> 00:00:05.000")
	require.NotContains(t, captions, "<script>")
}
