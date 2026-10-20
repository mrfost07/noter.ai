package meetinglibrary

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

type moveJournal struct {
	Index  *Index `json:"index"`
	Source string `json:"source"`
	Target string `json:"target"`
}

func (m *Manager) journalPath(owner int32) string { return m.indexPath(owner) + ".move" }
func (m *Manager) recoverMove(owner int32) error {
	data, err := os.ReadFile(m.journalPath(owner))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var op moveJournal
	if err = json.Unmarshal(data, &op); err != nil {
		return err
	}
	if op.Index == nil {
		return errors.New("invalid folder recovery journal")
	}
	source, err := SafePath(op.Index.Root, op.Source)
	if err != nil {
		return err
	}
	target, err := SafePath(op.Index.Root, op.Target)
	if err != nil {
		return err
	}
	_, sourceErr := os.Stat(source)
	_, targetErr := os.Stat(target)
	if os.IsNotExist(sourceErr) && targetErr == nil {
		if err = m.save(owner, op.Index); err != nil {
			return err
		}
	} else if sourceErr != nil {
		return errors.New("folder move needs recovery; source and destination were retained in the journal")
	}
	return os.Remove(m.journalPath(owner))
}
func (m *Manager) commitMove(owner int32, index *Index, oldRel, newRel string) error {
	source, err := SafePath(index.Root, oldRel)
	if err != nil {
		return err
	}
	target, err := SafePath(index.Root, newRel)
	if err != nil {
		return err
	}
	if _, err = os.Stat(target); err == nil {
		return errors.New("destination already exists")
	}
	if !os.IsNotExist(err) {
		return err
	}
	data, _ := json.Marshal(moveJournal{Index: index, Source: oldRel, Target: newRel})
	if err = atomic(m.journalPath(owner), data); err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	if err = os.Rename(source, target); err != nil {
		return err
	}
	if err = m.save(owner, index); err != nil {
		return err
	}
	return os.Remove(m.journalPath(owner))
}

// RenameFolder renames the physical directory and preserves every item ID.
func (m *Manager) RenameFolder(owner int32, fid, title string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		if strings.TrimSpace(title) == "" || len(title) > 120 {
			return errors.New("folder title is required (maximum 120 characters)")
		}
		var old, next string
		for n := range i.Folders {
			f := &i.Folders[n]
			if f.ID == fid {
				old = f.Path
				next = filepath.ToSlash(filepath.Join(filepath.Dir(old), Filename(title)+"--"+fid[:8]))
				f.Title = strings.TrimSpace(title)
				break
			}
		}
		if old == "" {
			return os.ErrNotExist
		}
		if old == next {
			return nil
		}
		replace := func(path string) string {
			if path == old {
				return next
			}
			if strings.HasPrefix(path, old+"/") {
				return next + strings.TrimPrefix(path, old)
			}
			return path
		}
		for _, meeting := range i.Meetings {
			if replace(meeting.Path) != meeting.Path && meeting.Status == "recording" {
				return errors.New("pause capture before renaming its folder")
			}
		}
		for n := range i.Folders {
			i.Folders[n].Path = replace(i.Folders[n].Path)
		}
		for n := range i.Meetings {
			i.Meetings[n].Path = replace(i.Meetings[n].Path)
		}
		for n := range i.Notes {
			i.Notes[n].Path = replace(i.Notes[n].Path)
		}
		if err := m.commitMove(owner, i, old, next); err != nil {
			return err
		}
		for n := range i.Meetings {
			if strings.HasPrefix(i.Meetings[n].Path, next+"/") {
				if err := manifest(i, &i.Meetings[n]); err != nil {
					return err
				}
			}
		}
		return nil
	})
}
