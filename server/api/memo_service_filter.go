package api

import (
	"github.com/usememos/memos/filter"
)

// filterDialect maps the configured database driver onto the filter engine dialect.
func (s *APIService) filterDialect() filter.DialectName {
	switch s.Profile.Driver {
	case "mysql":
		return filter.DialectMySQL
	case "postgres":
		return filter.DialectPostgres
	default:
		return filter.DialectSQLite
	}
}
