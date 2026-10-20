package llm

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

type modelFixtureTransport struct{}

func (modelFixtureTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"models":{"unknown":{"displayName":"Unknown quota"},"empty":{"displayName":"Exhausted quota","quotaInfo":{"remainingFraction":0}},"half":{"displayName":"Half quota","quotaInfo":{"remainingFraction":0.5}}}}`))}, nil
}

func TestModelListPreservesZeroAndUnknownQuota(t *testing.T) {
	models, err := FetchAntigravityModels(context.Background(), &http.Client{Transport: modelFixtureTransport{}}, "fake-token", "fake-project")
	require.NoError(t, err)
	quota := map[string]float64{}
	for _, model := range models {
		quota[model.ID] = model.RemainingQuota
	}
	require.Equal(t, -1.0, quota["unknown"])
	require.Equal(t, 0.0, quota["empty"])
	require.Equal(t, 0.5, quota["half"])
	require.Len(t, models, 3)
}
