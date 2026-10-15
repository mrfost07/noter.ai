package meetinglibrary

import "os"

// Captions returns captions relative to a single playback part.
func (m *Manager) Captions(owner int32, mid, pid string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i, err := m.read(owner)
	if err != nil {
		return "", err
	}
	meeting, err := meetingByID(i, mid)
	if err != nil {
		return "", err
	}
	for _, p := range meeting.Parts {
		if p.ID != pid {
			continue
		}
		lines := []Line{}
		for _, line := range meeting.Transcript {
			if line.Start >= p.End || line.End <= p.Start {
				continue
			}
			line.Start = max(0, line.Start-p.Start)
			line.End = min(p.End-p.Start, line.End-p.Start)
			lines = append(lines, line)
		}
		return VTT(lines), nil
	}
	return "", os.ErrNotExist
}
