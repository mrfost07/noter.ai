package api

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/store"
)

func TestMemoCreateSharedPreparationPreservesFields(t *testing.T) {
	ctx := context.Background()
	service := newIntegrationService(t)
	user := createSpaceTestUser(ctx, t, service, "memo-create-fields", store.RoleUser)
	userCtx := userCtx(ctx, user.ID)

	referenceTarget, err := service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		MemoId: "create-fields-reference",
		Memo:   &apipb.Memo{Content: "reference target"},
	})
	require.NoError(t, err)

	createAttachment := func(id string) *apipb.Attachment {
		t.Helper()
		attachment, err := service.CreateAttachment(userCtx, &apipb.CreateAttachmentRequest{
			AttachmentId: id,
			Attachment: &apipb.Attachment{
				Filename: id + ".png",
				Type:     "image/png",
				Content:  []byte("test image"),
			},
		})
		require.NoError(t, err)
		return attachment
	}
	createReference := func() *apipb.MemoRelation {
		return &apipb.MemoRelation{
			RelatedMemo: &apipb.MemoRelation_MemoRef{Name: referenceTarget.Name},
			Type:        apipb.MemoRelation_REFERENCE,
		}
	}

	topAttachment := createAttachment("create-fields-top-image")
	topAttachmentUID := strings.TrimPrefix(topAttachment.Name, "attachments/")
	topCreateTime := time.Date(2022, time.March, 4, 5, 6, 7, 0, time.UTC)
	topUpdateTime := topCreateTime.Add(2 * time.Hour)
	topLocation := &apipb.Location{Placeholder: "top location", Latitude: 1.25, Longitude: 2.5}
	topMemo, err := service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		MemoId: "create-fields-top",
		Memo: &apipb.Memo{
			Content:     fmt.Sprintf("![top](/file/attachments/%s)", topAttachmentUID),
			CreateTime:  timestamppb.New(topCreateTime),
			UpdateTime:  timestamppb.New(topUpdateTime),
			Attachments: []*apipb.Attachment{{Name: topAttachment.Name}},
			Relations:   []*apipb.MemoRelation{createReference()},
			Location:    topLocation,
		},
	})
	require.NoError(t, err)
	require.Equal(t, topCreateTime.Unix(), topMemo.CreateTime.AsTime().Unix())
	require.Equal(t, topUpdateTime.Unix(), topMemo.UpdateTime.AsTime().Unix())
	require.Equal(t, topLocation.Placeholder, topMemo.Location.Placeholder)
	require.Equal(t, topLocation.Latitude, topMemo.Location.Latitude)
	require.Equal(t, topLocation.Longitude, topMemo.Location.Longitude)
	require.Len(t, topMemo.Attachments, 1)
	require.Equal(t, topAttachment.Name, topMemo.Attachments[0].Name)
	requireMemoCreateRelation(t, topMemo, apipb.MemoRelation_REFERENCE, referenceTarget.Name)
}

func TestMemoCreateDuplicateIDsUseAlreadyExists(t *testing.T) {
	ctx := context.Background()
	service := newIntegrationService(t)
	user := createSpaceTestUser(ctx, t, service, "memo-create-duplicates", store.RoleUser)
	userCtx := userCtx(ctx, user.ID)

	_, err := service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		MemoId: "duplicate-parent",
		Memo:   &apipb.Memo{Content: "parent"},
	})
	require.NoError(t, err)
	_, err = service.CreateMemo(userCtx, &apipb.CreateMemoRequest{
		MemoId: "duplicate-parent",
		Memo:   &apipb.Memo{Content: "duplicate"},
	})
	require.Equal(t, codes.AlreadyExists, status.Code(err))
}

func requireMemoCreateRelation(t *testing.T, memo *apipb.Memo, relationType apipb.MemoRelation_Type, relatedMemoName string) {
	t.Helper()
	for _, relation := range memo.Relations {
		if relation.Type == relationType && relation.GetRelatedMemo().GetName() == relatedMemoName {
			require.Equal(t, memo.Name, relation.GetMemo().GetName())
			return
		}
	}
	require.Failf(t, "memo relation not found", "missing %s relation from %s to %s", relationType, memo.Name, relatedMemoName)
}
