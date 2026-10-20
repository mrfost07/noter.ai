package test

import (
	"github.com/usememos/memos/store"
)

func uids(memos []*store.Memo) []string {
	out := make([]string, 0, len(memos))
	for _, m := range memos {
		out = append(out, m.UID)
	}
	return out
}
