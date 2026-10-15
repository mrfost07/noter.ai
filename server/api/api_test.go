package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestRemovedAPIVersionRoutesReturnGone(t *testing.T) {
	svc, _ := newUploadTestService(t)
	e := echo.New()
	require.NoError(t, svc.RegisterGateway(context.Background(), e))

	tests := []struct {
		method   string
		path     string
		wantCode any
	}{
		{http.MethodGet, "/api/v1/memos", float64(12)},
		{http.MethodPost, "/api/v1/auth/signin", float64(12)},
		{http.MethodPost, "/memos.api.v1.MemoService/ListMemos", "unimplemented"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader("{}"))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			e.ServeHTTP(rec, req)

			require.Equal(t, http.StatusGone, rec.Code)
			var body map[string]any
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			require.Equal(t, tt.wantCode, body["code"])
			require.Equal(t, removedAPIMessage, body["message"])
		})
	}

	// The current routes are unaffected.
	req := httptest.NewRequest(http.MethodGet, "/api/instance/profile", nil)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code)
}

func createSpaceTestUser(ctx context.Context, t *testing.T, service *APIService, username string, role store.Role) *store.User {
	t.Helper()
	user, err := service.Store.CreateUser(ctx, &store.User{
		Username: username,
		Role:     role,
		Email:    username + "@example.com",
	})
	require.NoError(t, err)
	return user
}
