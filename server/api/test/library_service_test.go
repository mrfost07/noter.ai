package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v5"
	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/core/meetinglibrary"
	"github.com/usememos/memos/server/auth"
)

func TestMeetingLibraryAuthenticatedFilesAndRecovery(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()
	owner, err := ts.CreateRegularUser(ctx, "recording-owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "recording-other")
	require.NoError(t, err)
	token, _, err := auth.GenerateAccessTokenV2(owner.ID, owner.Username, string(owner.Role), string(owner.RowStatus), []byte(ts.Secret))
	require.NoError(t, err)
	otherToken, _, err := auth.GenerateAccessTokenV2(other.ID, other.Username, string(other.Role), string(other.RowStatus), []byte(ts.Secret))
	require.NoError(t, err)
	e := echo.New()
	require.NoError(t, ts.Service.RegisterGateway(ctx, e))
	call := func(method, path, body, credential string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		res := httptest.NewRecorder()
		e.ServeHTTP(res, req)
		return res
	}
	res := call("GET", "/api/library", "", "")
	require.Equal(t, http.StatusUnauthorized, res.Code)
	res = call("POST", "/api/library/meetings", `{"title":"Client launch","folderId":""}`, token)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	var response struct {
		Library meetinglibrary.Index `json:"library"`
	}
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
	mid := response.Library.Meetings[0].ID
	res = call("POST", "/api/library/meetings/"+mid+"/parts", `{"type":"video/webm"}`, token)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
	pid := response.Library.Meetings[0].Parts[0].ID
	res = call("PUT", "/api/library/meetings/"+mid+"/parts/"+pid+"?offset=0&elapsed=4", "first-frames", token)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	res = call("PUT", "/api/library/meetings/"+mid+"/parts/"+pid+"?offset=0&elapsed=4", "first-frames", token)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	res = call("GET", "/api/library/meetings/"+mid+"/media/"+pid, "", otherToken)
	require.Equal(t, http.StatusNotFound, res.Code)
	res = call("GET", "/api/library/meetings/"+mid+"/media/"+pid, "", "")
	require.Equal(t, http.StatusUnauthorized, res.Code)
	req := httptest.NewRequest("GET", "/api/library/meetings/"+mid+"/media/"+pid, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Range", "bytes=0-4")
	res = httptest.NewRecorder()
	e.ServeHTTP(res, req)
	require.Equal(t, http.StatusPartialContent, res.Code)
	require.Equal(t, "first", res.Body.String())
	require.Contains(t, res.Header().Get("Cache-Control"), "no-store")
	res = call("PATCH", "/api/library/meetings/"+mid, `{"draft":"Unsaved notes","transcript":[{"id":"segment1","text":"Launch Friday","speaker":"Client 1","start":1,"end":3}]}`, token)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
	require.Empty(t, response.Library.Notes)
	res = call("POST", "/api/library/meetings/"+mid+"/parts/"+pid+"/finish", `{"duration":4}`, token)
	require.Equal(t, http.StatusOK, res.Code, res.Body.String())
	require.NoError(t, json.Unmarshal(res.Body.Bytes(), &response))
	require.Equal(t, "ready", response.Library.Meetings[0].Status)
	res = call("POST", "/api/library/location", `{"path":"C:/do-not-write"}`, token)
	require.Equal(t, http.StatusBadRequest, res.Code)
}
