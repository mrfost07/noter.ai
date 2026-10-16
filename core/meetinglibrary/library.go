// Package meetinglibrary manages a user's local meeting files and their portable index.
package meetinglibrary

import (
	"bytes"
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/pkg/errors"
)

// Folder is a physical folder within a user's library.
type Folder struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	ParentID string `json:"parentId"`
	Path     string `json:"path"`
}

// Line is a transcript passage on the meeting's playback timeline.
type Line struct {
	ID          string  `json:"id"`
	Text        string  `json:"text"`
	Speaker     string  `json:"speaker"`
	Start       float64 `json:"start"`
	End         float64 `json:"end"`
	Approximate bool    `json:"approximate,omitempty"`
}

// Part is a separately playable capture session; pause gaps are not on the timeline.
type Part struct {
	ID       string  `json:"id"`
	File     string  `json:"file"`
	Type     string  `json:"type"`
	Start    float64 `json:"start"`
	End      float64 `json:"end"`
	Bytes    int64   `json:"bytes"`
	Complete bool    `json:"complete"`
}

// Meeting owns its recording, transcript, draft, and linked saved note.
type Meeting struct {
	ID         string  `json:"id"`
	Title      string  `json:"title"`
	FolderID   string  `json:"folderId"`
	Path       string  `json:"path"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
	Status     string  `json:"status"`
	Duration   float64 `json:"duration"`
	Parts      []Part  `json:"parts"`
	Transcript []Line  `json:"transcript"`
	Draft      string  `json:"draft"`
	NoteName   string  `json:"noteName"`
	Trashed    bool    `json:"trashed"`
}

// Note records the location and content hash of an explicitly saved Markdown copy.
type Note struct {
	Name      string `json:"name"`
	FolderID  string `json:"folderId"`
	MeetingID string `json:"meetingId"`
	Path      string `json:"path"`
	Hash      string `json:"hash"`
}

// Index is private to one authenticated account.
type Index struct {
	Quality  string    `json:"quality"`
	Root     string    `json:"root"`
	Folders  []Folder  `json:"folders"`
	Meetings []Meeting `json:"meetings"`
	Notes    []Note    `json:"notes"`
	Drafts   []Draft   `json:"drafts"`
}

// Draft is recovered from app-private storage; it is not a saved note.
type Draft struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Name      string `json:"name,omitempty"`
	FolderID  string `json:"folderId,omitempty"`
	MeetingID string `json:"meetingId,omitempty"`
}

// Manager serializes file and metadata changes, including idempotent capture appends.
type Manager struct {
	mu                sync.Mutex
	data, defaultRoot string
	started           time.Time
}

// New creates a manager; it never opens another user's library.
func New(data, root string) *Manager {
	return &Manager{data: data, defaultRoot: root, started: time.Now()}
}

func id() string {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}
func stamp() string             { return time.Now().UTC().Format(time.RFC3339Nano) }
func digest(data []byte) string { hash := sha256.Sum256(data); return hex.EncodeToString(hash[:]) }

// Filename makes a short Windows-safe human-readable filename.
func Filename(title string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(title) {
		if unicode.IsControl(r) || strings.ContainsRune(`<>:"/\|?*`, r) {
			b.WriteRune('_')
		} else {
			b.WriteRune(r)
		}
		if b.Len() >= 70 {
			break
		}
	}
	name := strings.Trim(b.String(), " .")
	if name == "" {
		name = "Untitled"
	}
	upper := strings.ToUpper(strings.Split(name, ".")[0])
	if regexp.MustCompile(`^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$`).MatchString(upper) {
		name = "_" + name
	}
	return name
}

func atomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".noter-write-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// SafePath confines generated paths and refuses symlinks and Windows junctions.
func SafePath(root, relative string) (string, error) {
	if filepath.IsAbs(relative) || strings.Contains(relative, ":") {
		return "", errors.New("invalid library path")
	}
	path := filepath.Join(root, filepath.FromSlash(relative))
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes library")
	}
	// EvalSymlinks also resolves Windows junctions. Check every existing ancestor.
	for current := path; ; current = filepath.Dir(current) {
		if _, err := os.Lstat(current); err == nil {
			resolved, e := filepath.EvalSymlinks(current)
			if e != nil {
				return "", e
			}
			abs, _ := filepath.Abs(current)
			if resolved != abs && (runtime.GOOS != "windows" || !strings.EqualFold(resolved, abs)) {
				return "", errors.New("linked library paths are not supported")
			}
		} else if !os.IsNotExist(err) {
			return "", err
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
	}
	return path, nil
}

func (m *Manager) indexPath(owner int32) string {
	return filepath.Join(m.data, fmt.Sprintf("noter-library-%d.json", owner))
}
func (m *Manager) read(owner int32) (*Index, error) {
	if owner <= 0 {
		return nil, errors.New("library owner is required")
	}
	if err := m.recoverMove(owner); err != nil {
		return nil, err
	}
	i := &Index{Root: filepath.Join(m.defaultRoot, fmt.Sprintf("account-%d", owner)), Folders: []Folder{}, Meetings: []Meeting{}, Notes: []Note{}, Drafts: []Draft{}, Quality: "balanced"}
	data, err := os.ReadFile(m.indexPath(owner))
	if err == nil {
		if err = json.Unmarshal(data, i); err != nil {
			return nil, errors.Wrap(err, "library index is damaged; files were retained")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	if _, err = SafePath(i.Root, ""); err != nil {
		return nil, err
	}
	return i, nil
}
func (m *Manager) save(owner int32, i *Index) error {
	data, err := json.MarshalIndent(i, "", "  ")
	if err != nil {
		return err
	}
	return atomic(m.indexPath(owner), data)
}
func (m *Manager) mutate(owner int32, fn func(*Index) error) (*Index, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i, err := m.read(owner)
	if err != nil {
		return nil, err
	}
	if err = fn(i); err != nil {
		return nil, err
	}
	if err = m.save(owner, i); err != nil {
		return nil, err
	}
	return i, nil
}

// Get returns the account's index and flags captures interrupted by a server restart.
func (m *Manager) Get(owner int32) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		if err := os.MkdirAll(i.Root, 0700); err != nil {
			return err
		}
		for n := range i.Meetings {
			meeting := &i.Meetings[n]
			updated, _ := time.Parse(time.RFC3339Nano, meeting.UpdatedAt)
			if meeting.Status == "recording" && updated.Before(m.started) {
				meeting.Status = "interrupted"
			}
		}
		return nil
	})
}

func folderPath(i *Index, folder string) (string, error) {
	if folder == "" {
		return "Inbox", nil
	}
	for _, f := range i.Folders {
		if f.ID == folder {
			return f.Path, nil
		}
	}
	return "", errors.New("folder not found")
}
func meetingByID(i *Index, mid string) (*Meeting, error) {
	for n := range i.Meetings {
		if i.Meetings[n].ID == mid {
			return &i.Meetings[n], nil
		}
	}
	return nil, os.ErrNotExist
}
func manifest(i *Index, meeting *Meeting) error {
	path, err := SafePath(i.Root, filepath.Join(meeting.Path, "meeting.json"))
	if err != nil {
		return err
	}
	data, _ := json.MarshalIndent(meeting, "", "  ")
	return atomic(path, data)
}

// CreateFolder creates an actual client/project directory.
func (m *Manager) CreateFolder(owner int32, title, parent string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		if strings.TrimSpace(title) == "" || len(title) > 120 {
			return errors.New("folder title is required (maximum 120 characters)")
		}
		base := ""
		if parent != "" {
			var err error
			base, err = folderPath(i, parent)
			if err != nil {
				return err
			}
			if len(strings.Split(filepath.ToSlash(base), "/")) >= 4 {
				return errors.New("folders support four levels")
			}
		}
		fid := id()
		rel := filepath.Join(base, Filename(title)+"--"+fid[:8])
		path, err := SafePath(i.Root, rel)
		if err != nil {
			return err
		}
		if err = os.MkdirAll(path, 0700); err != nil {
			return err
		}
		i.Folders = append(i.Folders, Folder{ID: fid, Title: strings.TrimSpace(title), ParentID: parent, Path: filepath.ToSlash(rel)})
		return nil
	})
}

// CreateMeeting creates a recoverable manifest before recording starts.
func (m *Manager) CreateMeeting(owner int32, title, folder string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		base, err := folderPath(i, folder)
		if err != nil {
			return err
		}
		mid := id()
		if strings.TrimSpace(title) == "" {
			title = "Meeting"
		}
		if len(title) > 200 {
			return errors.New("meeting title is too long")
		}
		meeting := Meeting{ID: mid, Title: strings.TrimSpace(title), FolderID: folder, Path: filepath.ToSlash(filepath.Join(base, "Meetings", time.Now().Format("2006-01-02_")+Filename(title)+"--"+mid[:8])), CreatedAt: stamp(), UpdatedAt: stamp(), Status: "draft", Parts: []Part{}, Transcript: []Line{}}
		if err = manifest(i, &meeting); err != nil {
			return err
		}
		i.Meetings = append(i.Meetings, meeting)
		return nil
	})
}

// BeginPart starts a separately playable segment when capture starts or resumes.
func (m *Manager) BeginPart(owner int32, mid, mimeType string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		meeting, err := meetingByID(i, mid)
		if err != nil {
			return err
		}
		if meeting.Trashed {
			return errors.New("restore this meeting before recording")
		}
		if len(meeting.Parts) > 0 && !meeting.Parts[len(meeting.Parts)-1].Complete && meeting.Status == "recording" {
			return errors.New("capture is already active")
		}
		ext := "webm"
		if strings.HasPrefix(mimeType, "video/mp4") || strings.HasPrefix(mimeType, "audio/mp4") {
			ext = "mp4"
		} else if !strings.HasPrefix(mimeType, "video/webm") && !strings.HasPrefix(mimeType, "audio/webm") {
			return errors.New("unsupported recording format")
		}
		pid := id()
		p := Part{ID: pid, File: "recording-" + pid[:8] + "." + ext, Type: mimeType, Start: meeting.Duration, End: meeting.Duration}
		path, err := SafePath(i.Root, filepath.Join(meeting.Path, p.File))
		if err != nil {
			return err
		}
		if err = atomic(path, nil); err != nil {
			return err
		}
		meeting.Parts = append(meeting.Parts, p)
		meeting.Status = "recording"
		meeting.UpdatedAt = stamp()
		return manifest(i, meeting)
	})
}

// Append writes bounded capture chunks directly to disk with retry-safe byte offsets.
func (m *Manager) Append(owner int32, mid, pid string, offset int64, data []byte, elapsed float64) (int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if offset < 0 || len(data) > 8<<20 || elapsed < 0 || elapsed > 86400 || math.IsNaN(elapsed) || math.IsInf(elapsed, 0) {
		return 0, errors.New("invalid recording chunk")
	}
	i, err := m.read(owner)
	if err != nil {
		return 0, err
	}
	meeting, err := meetingByID(i, mid)
	if err != nil {
		return 0, err
	}
	var p *Part
	for n := range meeting.Parts {
		if meeting.Parts[n].ID == pid {
			p = &meeting.Parts[n]
			break
		}
	}
	if p == nil {
		return 0, os.ErrNotExist
	}
	if p.Complete || meeting.Trashed {
		return 0, errors.New("recording is closed")
	}
	path, err := SafePath(i.Root, filepath.Join(meeting.Path, p.File))
	if err != nil {
		return 0, err
	}
	f, err := os.OpenFile(path, os.O_RDWR, 0600)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return 0, err
	}
	size := info.Size()
	if offset < size {
		if offset+int64(len(data)) > size {
			return size, errors.New("recording offset conflict")
		}
		stored := make([]byte, len(data))
		if _, err = f.ReadAt(stored, offset); err != nil {
			return size, err
		}
		if !bytes.Equal(stored, data) {
			return size, errors.New("recording retry differs from stored bytes")
		}
		return size, nil
	}
	if offset != size {
		return size, errors.New("recording offset conflict")
	}
	written, err := f.WriteAt(data, offset)
	if err != nil {
		return size + int64(written), err
	}
	if err = f.Sync(); err != nil {
		return size + int64(written), err
	}
	p.Bytes = size + int64(written)
	p.End = math.Max(p.End, p.Start+elapsed)
	meeting.Duration = math.Max(meeting.Duration, p.End)
	meeting.UpdatedAt = stamp()
	if err = m.save(owner, i); err != nil {
		return p.Bytes, err
	}
	return p.Bytes, nil
}

// FinishPart closes a capture part. Completed bytes survive a failed transcript or AI request.
func (m *Manager) FinishPart(owner int32, mid, pid string, duration float64) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		if math.IsNaN(duration) || math.IsInf(duration, 0) || duration < 0 || duration > 86400 {
			return errors.New("invalid duration")
		}
		meeting, err := meetingByID(i, mid)
		if err != nil {
			return err
		}
		for n := range meeting.Parts {
			p := &meeting.Parts[n]
			if p.ID != pid {
				continue
			}
			if p.Complete {
				return nil
			}
			path, err := SafePath(i.Root, filepath.Join(meeting.Path, p.File))
			if err != nil {
				return err
			}
			info, err := os.Stat(path)
			if err != nil {
				return err
			}
			p.Bytes = info.Size()
			p.End = p.Start + duration
			p.Complete = true
			meeting.Duration = math.Max(meeting.Duration, p.End)
			meeting.Status = "ready"
			if p.Bytes == 0 {
				meeting.Status = "interrupted"
			}
			meeting.UpdatedAt = stamp()
			if strings.Contains(p.Type, "webm") && p.Bytes > 0 {
				if err = repairWebMDuration(path, duration); err != nil {
					return err
				}
				if repaired, statErr := os.Stat(path); statErr == nil {
					p.Bytes = repaired.Size()
				}
			}
			return manifest(i, meeting)
		}
		return os.ErrNotExist
	})
}

func (m *Manager) moveMeetingFolder(owner int32, i *Index, meeting *Meeting, folder string) error {
	if folder == meeting.FolderID {
		return nil
	}
	if meeting.Status == "recording" {
		return errors.New("pause capture before moving a meeting")
	}
	base, err := folderPath(i, folder)
	if err != nil {
		return err
	}
	oldRel := meeting.Path
	newRel := filepath.ToSlash(filepath.Join(base, "Meetings", filepath.Base(oldRel)))
	meeting.Path = newRel
	meeting.FolderID = folder
	for n := range i.Notes {
		if i.Notes[n].MeetingID == meeting.ID {
			i.Notes[n].Path = filepath.ToSlash(filepath.Join(newRel, "notes.md"))
			i.Notes[n].FolderID = folder
		}
	}
	return m.commitMove(owner, i, oldRel, newRel)
}

// UpdateMeeting persists transcript recovery and explicit draft edits without saving a note.
func (m *Manager) UpdateMeeting(owner int32, mid string, title, folder, draft *string, lines *[]Line, trashed *bool) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		meeting, err := meetingByID(i, mid)
		if err != nil {
			return err
		}
		if title != nil && (strings.TrimSpace(*title) == "" || len(*title) > 200) {
			return errors.New("meeting title is required")
		}
		if draft != nil && len(*draft) > 2<<20 {
			return errors.New("draft is too large")
		}
		if lines != nil {
			if len(*lines) > 100000 {
				return errors.New("transcript is too large")
			}
			seen := map[string]bool{}
			for _, l := range *lines {
				if l.ID == "" || seen[l.ID] || len(l.Text) > 100000 || l.Start < 0 || l.End < l.Start || math.IsNaN(l.Start) || math.IsNaN(l.End) || math.IsInf(l.Start, 0) || math.IsInf(l.End, 0) {
					return errors.New("invalid transcript segment")
				}
				seen[l.ID] = true
			}
		}
		if trashed != nil && meeting.Status == "recording" {
			return errors.New("stop capture before archiving")
		}
		if title != nil {
			meeting.Title = strings.TrimSpace(*title)
		}
		if draft != nil {
			meeting.Draft = *draft
		}
		if trashed != nil {
			meeting.Trashed = *trashed
		}
		if lines != nil {
			meeting.Transcript = *lines
			slices.SortStableFunc(meeting.Transcript, func(a, b Line) int { return cmp.Compare(a.Start, b.Start) })
		}
		meeting.UpdatedAt = stamp()
		if folder != nil {
			if err = m.moveMeetingFolder(owner, i, meeting, *folder); err != nil {
				return err
			}
		}
		if lines != nil {
			data, _ := json.MarshalIndent(meeting.Transcript, "", "  ")
			path, err := SafePath(i.Root, filepath.Join(meeting.Path, "transcript.json"))
			if err != nil {
				return err
			}
			if err = atomic(path, data); err != nil {
				return err
			}
			path, err = SafePath(i.Root, filepath.Join(meeting.Path, "transcript.vtt"))
			if err != nil {
				return err
			}
			if err = atomic(path, []byte(VTT(meeting.Transcript))); err != nil {
				return err
			}
		}
		return manifest(i, meeting)
	})
}

// SyncNote creates a managed saved copy and refuses to overwrite external edits.
func (m *Manager) SyncNote(owner int32, name, title, content string, folder, mid *string) (*Index, error) {
	return m.syncNote(owner, name, title, content, folder, mid, false)
}

// SyncExistingNote updates a managed Markdown copy without registering an unrelated note.
func (m *Manager) SyncExistingNote(owner int32, name, title, content string) error {
	_, err := m.syncNote(owner, name, title, content, nil, nil, true)
	return err
}

func (m *Manager) syncNote(owner int32, name, title, content string, folder, mid *string, existingOnly bool) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		var note *Note
		for n := range i.Notes {
			if i.Notes[n].Name == name {
				note = &i.Notes[n]
				break
			}
		}
		if note == nil {
			if existingOnly {
				return nil
			}
			i.Notes = append(i.Notes, Note{Name: name})
			note = &i.Notes[len(i.Notes)-1]
		}
		oldMeetingID := note.MeetingID
		oldPath := note.Path
		if oldPath != "" {
			path, err := SafePath(i.Root, oldPath)
			if err != nil {
				return err
			}
			data, err := os.ReadFile(path)
			if err == nil && digest(data) != note.Hash && digest(data) != digest([]byte(content)) {
				return errors.New("local Markdown was edited outside Noter.ai; import it before replacing this copy")
			}
			if err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		if folder != nil {
			note.FolderID = *folder
		}
		if mid != nil {
			note.MeetingID = *mid
		}
		base, err := folderPath(i, note.FolderID)
		if err != nil {
			return err
		}
		rel := filepath.Join(base, "Notes", Filename(title)+"--"+Filename(strings.TrimPrefix(name, "memos/"))+".md")
		if note.MeetingID != "" {
			meeting, err := meetingByID(i, note.MeetingID)
			if err != nil {
				return err
			}
			if meeting.NoteName != "" && meeting.NoteName != name {
				return errors.New("meeting already has a linked note")
			}
			if folder != nil && oldMeetingID == note.MeetingID {
				if err = m.moveMeetingFolder(owner, i, meeting, *folder); err != nil {
					return err
				}
			}
			meeting.NoteName = name
			meeting.Draft = content
			note.FolderID = meeting.FolderID
			rel = filepath.Join(meeting.Path, "notes.md")
			if err = manifest(i, meeting); err != nil {
				return err
			}
		}
		path, err := SafePath(i.Root, rel)
		if err != nil {
			return err
		}
		if err = atomic(path, []byte(content)); err != nil {
			return err
		}
		note.Path = filepath.ToSlash(rel)
		note.Hash = digest([]byte(content))
		if oldMeetingID != "" && oldMeetingID != note.MeetingID {
			if previous, previousErr := meetingByID(i, oldMeetingID); previousErr == nil && previous.NoteName == name {
				previous.NoteName = ""
				previous.UpdatedAt = stamp()
				if err = manifest(i, previous); err != nil {
					return err
				}
			}
		}
		if oldPath != "" && oldPath != note.Path {
			old, err := SafePath(i.Root, oldPath)
			if err != nil {
				return err
			}
			if err = os.Remove(old); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		return nil
	})
}

// Media opens only a recording belonging to this account and meeting.
func (m *Manager) Media(owner int32, mid, pid string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i, err := m.read(owner)
	if err != nil {
		return "", "", err
	}
	meeting, err := meetingByID(i, mid)
	if err != nil {
		return "", "", err
	}
	for _, p := range meeting.Parts {
		if p.ID == pid {
			path, err := SafePath(i.Root, filepath.Join(meeting.Path, p.File))
			return path, p.Type, err
		}
	}
	return "", "", os.ErrNotExist
}

// NoteFile returns an external copy for explicit conflict review/import.
func (m *Manager) NoteFile(owner int32, name string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i, err := m.read(owner)
	if err != nil {
		return "", err
	}
	for _, n := range i.Notes {
		if n.Name == name {
			path, err := SafePath(i.Root, n.Path)
			if err != nil {
				return "", err
			}
			data, err := os.ReadFile(path)
			return string(data), err
		}
	}
	return "", os.ErrNotExist
}

// VTT exports readable captions while keeping text from injecting cue structure.
func VTT(lines []Line) string {
	var b strings.Builder
	b.WriteString("WEBVTT\n\n")
	for n, l := range lines {
		fmt.Fprintf(&b, "%d\n%s --> %s\n%s: %s\n\n", n+1, vttTime(l.Start), vttTime(math.Max(l.End, l.Start+0.1)), html.EscapeString(strings.ReplaceAll(l.Speaker, "\n", " ")), html.EscapeString(strings.ReplaceAll(strings.ReplaceAll(l.Text, "\n", " "), "-->", "→")))
	}
	return b.String()
}
func vttTime(s float64) string {
	ms := int64(math.Round(s * 1000))
	return fmt.Sprintf("%02d:%02d:%02d.%03d", ms/3600000, ms/60000%60, ms/1000%60, ms%1000)
}

// Relocate copies into an empty destination, verifies every file, then switches the index.
// The old library is deliberately retained, and active capture prevents relocation.
func (m *Manager) Relocate(owner int32, destination string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		for _, meeting := range i.Meetings {
			if meeting.Status == "recording" {
				return errors.New("stop recording before changing library location")
			}
		}
		if !filepath.IsAbs(destination) {
			return errors.New("choose an absolute library directory")
		}
		destination = filepath.Clean(destination)
		if _, err := SafePath(destination, ""); err != nil {
			return err
		}
		if strings.EqualFold(i.Root, destination) {
			return nil
		}
		rel, _ := filepath.Rel(i.Root, destination)
		if rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel)) {
			return errors.New("choose a directory outside the current library")
		}
		entries, err := os.ReadDir(destination)
		if err == nil && len(entries) > 0 {
			return errors.New("choose an empty destination folder; existing files will not be overwritten")
		}
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		if err = os.MkdirAll(destination, 0700); err != nil {
			return err
		}
		err = filepath.WalkDir(i.Root, func(path string, d os.DirEntry, walkErr error) error {
			if os.IsNotExist(walkErr) && path == i.Root {
				return nil
			}
			if walkErr != nil {
				return walkErr
			}
			relative, err := filepath.Rel(i.Root, path)
			if err != nil {
				return err
			}
			source, err := SafePath(i.Root, relative)
			if err != nil {
				return err
			}
			target, err := SafePath(destination, relative)
			if err != nil {
				return err
			}
			if d.IsDir() {
				return os.MkdirAll(target, 0700)
			}
			if !d.Type().IsRegular() {
				return errors.New("library contains an unsupported linked file")
			}
			src, err := os.Open(source)
			if err != nil {
				return err
			}
			defer src.Close()
			out, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if err != nil {
				return err
			}
			hash := sha256.New()
			_, err = io.Copy(io.MultiWriter(out, hash), src)
			if err == nil {
				err = out.Sync()
			}
			closeErr := out.Close()
			if err == nil {
				err = closeErr
			}
			if err != nil {
				return err
			}
			check, err := os.Open(target)
			if err != nil {
				return err
			}
			defer check.Close()
			verify := sha256.New()
			if _, err = io.Copy(verify, check); err != nil {
				return err
			}
			if !bytes.Equal(hash.Sum(nil), verify.Sum(nil)) {
				return errors.New("library copy verification failed")
			}
			return nil
		})
		if err != nil {
			return err
		}
		i.Root = destination
		return nil
	})
}
