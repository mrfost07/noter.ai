package api

import (
	"context"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/usememos/memos/internal/webhook"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// DispatchMemoCreatedWebhook dispatches a webhook when a memo is created.
func (s *APIService) DispatchMemoCreatedWebhook(ctx context.Context, memo *apipb.Memo) error {
	return s.dispatchMemoRelatedWebhook(ctx, memo, "memos.memo.created")
}

// DispatchMemoUpdatedWebhook dispatches webhook when memo is updated.
func (s *APIService) DispatchMemoUpdatedWebhook(ctx context.Context, memo *apipb.Memo) error {
	return s.dispatchMemoRelatedWebhook(ctx, memo, "memos.memo.updated")
}

// DispatchMemoDeletedWebhook dispatches webhook when memo is deleted.
func (s *APIService) DispatchMemoDeletedWebhook(ctx context.Context, memo *apipb.Memo) error {
	return s.dispatchMemoRelatedWebhook(ctx, memo, "memos.memo.deleted")
}

func (s *APIService) dispatchMemoRelatedWebhook(ctx context.Context, memo *apipb.Memo, activityType string) error {
	creator, err := ResolveUserByName(ctx, s.Store, memo.Creator)
	if err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid note creator")
	}
	if creator == nil {
		return status.Errorf(codes.NotFound, "note creator not found")
	}
	creatorID := creator.ID
	webhooks, err := s.Store.GetUserWebhooks(ctx, creatorID)
	if err != nil {
		return err
	}
	for _, hook := range webhooks {
		webhook.PostAsync(newMemoWebhookRequest(hook, activityType, memo))
	}
	return nil
}

// memoWebhookPayload is the JSON body delivered to user webhooks for memo
// activity. Field names are part of the webhook contract.
type memoWebhookPayload struct {
	// URL is the destination the payload was sent to.
	URL string `json:"url"`
	// ActivityType names the event, for example "memos.memo.created".
	ActivityType string `json:"activityType"`
	// Creator is the resource name of the memo creator. Format: users/{user}
	Creator string `json:"creator"`
	// Memo is the memo that triggered the event.
	Memo *apipb.Memo `json:"memo"`
}

func newMemoWebhookRequest(hook *storepb.WebhooksUserSetting_Webhook, activityType string, memo *apipb.Memo) *webhook.Request {
	return &webhook.Request{
		URL:           hook.Url,
		Label:         activityType,
		SigningSecret: hook.SigningSecret,
		Payload: &memoWebhookPayload{
			URL:          hook.Url,
			ActivityType: activityType,
			Creator:      memo.Creator,
			Memo:         memo,
		},
	}
}

func (s *APIService) getMemoContentSnippet(content string) (string, error) {
	// Use goldmark service for snippet generation
	snippet, err := s.MarkdownService.GenerateSnippet([]byte(content), 64)
	if err != nil {
		return "", errors.Wrap(err, "failed to generate snippet")
	}
	return snippet, nil
}

// parseMemoOrderBy parses the order_by field and sets the appropriate ordering in memoFind.
// Follows AIP-132: supports comma-separated list of fields with optional "desc" suffix.
// Example: "pinned desc, create_time desc" or "update_time asc".
