package meetinglibrary

import "github.com/pkg/errors"

// SaveDraft persists recovery text independently of saved notes and browser origin.
func (m *Manager) SaveDraft(owner int32, draft Draft) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		if draft.ID == "" || len(draft.ID) > 200 || len(draft.Content) > 2<<20 {
			return errors.New("invalid note draft")
		}
		for n := range i.Drafts {
			if i.Drafts[n].ID == draft.ID {
				i.Drafts[n] = draft
				return nil
			}
		}
		if len(i.Drafts) >= 200 {
			return errors.New("too many recovered drafts; save or discard older drafts")
		}
		i.Drafts = append(i.Drafts, draft)
		return nil
	})
}

// DiscardDraft removes only a recovery copy, never the saved note.
func (m *Manager) DiscardDraft(owner int32, id string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		for n, d := range i.Drafts {
			if d.ID == id {
				i.Drafts = append(i.Drafts[:n], i.Drafts[n+1:]...)
				break
			}
		}
		return nil
	})
}
