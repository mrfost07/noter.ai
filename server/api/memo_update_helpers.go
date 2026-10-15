package api

import (
	"context"
	"log/slog"

	"github.com/pkg/errors"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

func (s *APIService) buildUpdatedMemoState(ctx context.Context, memoID int32) (*store.Memo, *store.Memo, *apipb.Memo, error) {
	memo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &memoID})
	if err != nil {
		return nil, nil, nil, errors.Wrap(err, "failed to get note")
	}
	if memo == nil {
		return nil, nil, nil, errors.New("note not found")
	}

	attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{
		MemoID: &memo.ID,
	})
	if err != nil {
		return nil, nil, nil, errors.Wrap(err, "failed to list attachments")
	}
	relations, err := s.loadMemoRelations(ctx, memo)
	if err != nil {
		return nil, nil, nil, errors.Wrap(err, "failed to load note relations")
	}
	memoMessage, err := s.convertMemoFromStore(ctx, memo, attachments, relations)
	if err != nil {
		return nil, nil, nil, errors.Wrap(err, "failed to convert note")
	}

	var commentContext *store.Memo
	if memo.ParentUID != nil {
		commentContext, err = s.Store.GetMemo(ctx, &store.FindMemo{UID: memo.ParentUID})
		if err != nil {
			return nil, nil, nil, errors.Wrap(err, "failed to get comment context")
		}
	}

	return memo, commentContext, memoMessage, nil
}

func (s *APIService) dispatchMemoUpdatedSideEffects(
	ctx context.Context,
	memoMessage *apipb.Memo,
) {
	if err := s.DispatchMemoUpdatedWebhook(ctx, memoMessage); err != nil {
		slog.Warn("Failed to dispatch memo updated webhook", slog.Any("err", err))
	}

	s.SSEHub.publishMemoChanged()
}
