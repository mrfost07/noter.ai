package api

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

func TestAssistantUpdatesManagedMarkdownAndReportsExternalConflict(t *testing.T) {
	s := newIntegrationService(t)
	owner := createSpaceTestUser(context.Background(), t, s, "assistant-library", store.RoleAdmin)
	ctx := userCtx(context.Background(), owner.ID)
	note, err := s.CreateMemo(ctx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "# Before"}})
	require.NoError(t, err)
	_, err = s.meetingLibrary.SyncNote(owner.ID, note.Name, "Before", note.Content, nil, nil)
	require.NoError(t, err)
	update := func(content string) (*apipb.AgentToolAction, any) {
		args, marshalErr := json.Marshal(map[string]string{"name": note.Name, "content": content})
		require.NoError(t, marshalErr)
		return s.executeAgentTool(ctx, "update_memo", args)
	}
	action, _ := update("# After\n\nDeadline Friday")
	require.Equal(t, "Updated note", action.Summary)
	content, err := s.meetingLibrary.NoteFile(owner.ID, note.Name)
	require.NoError(t, err)
	require.Equal(t, "# After\n\nDeadline Friday", content)
	i, err := s.meetingLibrary.Get(owner.ID)
	require.NoError(t, err)
	path := filepath.Join(i.Root, filepath.FromSlash(i.Notes[0].Path))
	require.NoError(t, os.WriteFile(path, []byte("External change"), 0600))
	action, result := update("# Saved inside Noter.ai")
	require.Contains(t, action.Summary, "local Markdown needs review")
	require.Contains(t, result.(map[string]string)["warning"], "edited outside")
	content, err = s.meetingLibrary.NoteFile(owner.ID, note.Name)
	require.NoError(t, err)
	require.Equal(t, "External change", content)
	saved, err := s.GetMemo(ctx, &apipb.GetMemoRequest{Name: note.Name})
	require.NoError(t, err)
	require.Equal(t, "# Saved inside Noter.ai", saved.Content)
}
