package api

import (
	"context"
	stderrors "errors"
	"fmt"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/timestamppb"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

var (
	errMemoCreatorNotFound = stderrors.New("note creator not found")
)

func (s *APIService) convertMemoFromStore(ctx context.Context, memo *store.Memo, attachments []*store.Attachment, relations []*apipb.MemoRelation) (*apipb.Memo, error) {
	creatorMap, err := s.listUsersByID(ctx, []int32{memo.CreatorID})
	if err != nil {
		return nil, errors.Wrap(err, "failed to list note creators")
	}
	return s.convertMemoFromStoreWithCreators(ctx, memo, attachments, relations, creatorMap)
}

func (s *APIService) convertMemoFromStoreWithCreators(_ context.Context, memo *store.Memo, attachments []*store.Attachment, relations []*apipb.MemoRelation, creatorMap map[int32]*store.User) (*apipb.Memo, error) {
	name := buildMemoName(memo.UID)
	creator := creatorMap[memo.CreatorID]
	if creator == nil {
		return nil, errMemoCreatorNotFound
	}
	memoMessage := &apipb.Memo{
		Name:       name,
		State:      convertStateFromStore(memo.RowStatus),
		Creator:    BuildUserName(creator.Username),
		CreateTime: timestamppb.New(time.Unix(memo.CreatedTs, 0)),
		UpdateTime: timestamppb.New(time.Unix(memo.UpdatedTs, 0)),
		Content:    memo.Content,
		Pinned:     memo.Pinned,
	}
	if memo.Payload != nil {
		memoMessage.Tags = memo.Payload.Tags
		memoMessage.Property = convertMemoPropertyFromStore(memo.Payload.Property)
		memoMessage.Location = convertLocationFromStore(memo.Payload.Location)
	}

	// Parent identity is part of a readable comment's context. It grants no
	// access to the parent; clients resolve it independently and handle denial.
	if memo.ParentUID != nil {
		parentName := buildMemoName(*memo.ParentUID)
		memoMessage.Parent = &parentName
	}

	if relations != nil {
		memoMessage.Relations = relations
	} else {
		memoMessage.Relations = []*apipb.MemoRelation{}
	}

	memoMessage.Attachments = []*apipb.Attachment{}
	for _, attachment := range attachments {
		attachmentResponse := convertAttachmentFromStore(attachment)
		memoMessage.Attachments = append(memoMessage.Attachments, attachmentResponse)
	}

	snippet, err := s.getMemoContentSnippet(memo.Content)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get note content snippet")
	}
	memoMessage.Snippet = snippet

	return memoMessage, nil
}

// batchConvertMemoRelations batch-loads relations for a list of memos and returns
// a map from memo ID to its converted relations. This avoids N+1 queries when listing memos.
func (s *APIService) batchConvertMemoRelations(ctx context.Context, memos []*store.Memo, includeSnippets bool) (map[int32][]*apipb.MemoRelation, error) {
	if len(memos) == 0 {
		return map[int32][]*apipb.MemoRelation{}, nil
	}

	accessScope, _, err := s.resolveMemoAccessScope(ctx)
	if err != nil {
		return nil, err
	}

	memoIDs := make([]int32, len(memos))
	memoIDSet := make(map[int32]bool, len(memos))
	for i, m := range memos {
		memoIDs[i] = m.ID
		memoIDSet[m.ID] = true
	}

	outgoingRelations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
		SourceMemoIDList: memoIDs,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to batch list outgoing note relations")
	}
	incomingRelations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{
		RelatedMemoIDList: memoIDs,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to batch list incoming note relations")
	}
	allRelations := mergeMemoRelations(outgoingRelations, incomingRelations)

	// Collect all memo IDs referenced in relations that we need to resolve.
	neededIDs := make(map[int32]bool)
	for _, r := range allRelations {
		neededIDs[r.MemoID] = true
		neededIDs[r.RelatedMemoID] = true
	}

	// Build ID→UID map from the memos we already have.
	memoIDToUID := make(map[int32]string, len(memos))
	memoIDToSnippet := make(map[int32]string, len(memos))
	for _, m := range memos {
		memoIDToUID[m.ID] = m.UID
		if includeSnippets {
			snippet, err := s.getMemoContentSnippet(m.Content)
			if err != nil {
				return nil, errors.Wrap(err, "failed to get note content snippet")
			}
			memoIDToSnippet[m.ID] = snippet
		}
		delete(neededIDs, m.ID)
	}

	// Batch fetch any additional memos referenced by relations that we don't already have.
	if len(neededIDs) > 0 {
		extraIDs := make([]int32, 0, len(neededIDs))
		for id := range neededIDs {
			extraIDs = append(extraIDs, id)
		}
		extraFind := &store.FindMemo{IDList: extraIDs, ExcludeContent: !includeSnippets, Access: accessScope}
		extraMemos, err := s.Store.ListMemos(ctx, extraFind)
		if err != nil {
			return nil, errors.Wrap(err, "failed to batch fetch related notes")
		}
		for _, m := range extraMemos {
			memoIDToUID[m.ID] = m.UID
			if includeSnippets {
				snippet, err := s.getMemoContentSnippet(m.Content)
				if err != nil {
					return nil, errors.Wrap(err, "failed to get related note content snippet")
				}
				memoIDToSnippet[m.ID] = snippet
			}
		}
	}

	// Build the result map: memo ID → its relations (both directions).
	result := make(map[int32][]*apipb.MemoRelation, len(memos))
	for _, r := range allRelations {
		memoUID, ok1 := memoIDToUID[r.MemoID]
		relatedUID, ok2 := memoIDToUID[r.RelatedMemoID]
		if !ok1 || !ok2 {
			continue
		}

		relation := &apipb.MemoRelation{
			Memo: &apipb.MemoRelation_MemoRef{
				Name:    fmt.Sprintf("%s%s", MemoNamePrefix, memoUID),
				Snippet: memoIDToSnippet[r.MemoID],
			},
			RelatedMemo: &apipb.MemoRelation_MemoRef{
				Name:    fmt.Sprintf("%s%s", MemoNamePrefix, relatedUID),
				Snippet: memoIDToSnippet[r.RelatedMemoID],
			},
			Type: convertMemoRelationTypeFromStore(r.Type),
		}

		// Add to the memo that owns this relation (both directions).
		if memoIDSet[r.MemoID] {
			result[r.MemoID] = append(result[r.MemoID], relation)
		}
		if memoIDSet[r.RelatedMemoID] {
			result[r.RelatedMemoID] = append(result[r.RelatedMemoID], relation)
		}
	}

	return result, nil
}

// loadMemoRelations loads relations for a single memo and converts them to API format.
func (s *APIService) loadMemoRelations(ctx context.Context, memo *store.Memo) ([]*apipb.MemoRelation, error) {
	relationMap, err := s.batchConvertMemoRelations(ctx, []*store.Memo{memo}, true)
	if err != nil {
		return nil, err
	}
	return relationMap[memo.ID], nil
}

func mergeMemoRelations(groups ...[]*store.MemoRelation) []*store.MemoRelation {
	seen := make(map[string]struct{})
	merged := make([]*store.MemoRelation, 0)
	for _, relations := range groups {
		for _, relation := range relations {
			key := fmt.Sprintf("%d:%d:%s", relation.MemoID, relation.RelatedMemoID, relation.Type)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			merged = append(merged, relation)
		}
	}
	return merged
}

func convertMemoPropertyFromStore(property *storepb.MemoPayload_Property) *apipb.Memo_Property {
	if property == nil {
		return nil
	}
	return &apipb.Memo_Property{
		HasLink:            property.HasLink,
		HasTaskList:        property.HasTaskList,
		HasCode:            property.HasCode,
		HasIncompleteTasks: property.HasIncompleteTasks,
		Title:              property.Title,
	}
}

func convertLocationFromStore(location *storepb.MemoPayload_Location) *apipb.Location {
	if location == nil {
		return nil
	}
	return &apipb.Location{
		Placeholder: location.Placeholder,
		Latitude:    location.Latitude,
		Longitude:   location.Longitude,
	}
}

func convertLocationToStore(location *apipb.Location) *storepb.MemoPayload_Location {
	if location == nil {
		return nil
	}
	return &storepb.MemoPayload_Location{
		Placeholder: location.Placeholder,
		Latitude:    location.Latitude,
		Longitude:   location.Longitude,
	}
}
