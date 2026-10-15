package meetinglibrary

import "github.com/pkg/errors"

// SetQuality persists the account's capture quality across launches.
func (m *Manager) SetQuality(owner int32, quality string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		if quality != "balanced" && quality != "sharp" {
			return errors.New("choose Balanced or Sharp recording quality")
		}
		i.Quality = quality
		return nil
	})
}

// Interrupt retains partial media and enables explicit recovery without a restart.
func (m *Manager) Interrupt(owner int32, mid string) (*Index, error) {
	return m.mutate(owner, func(i *Index) error {
		meeting, err := meetingByID(i, mid)
		if err != nil {
			return err
		}
		meeting.Status = "interrupted"
		meeting.UpdatedAt = stamp()
		return manifest(i, meeting)
	})
}
