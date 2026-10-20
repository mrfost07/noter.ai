package test

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/store"
)

func TestTestingStoreCleanupClosesConnectionsBeforeTempDir(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		existingDSN   bool
		explicitClose bool
	}{
		{name: "fresh"},
		{name: "fresh explicitly closed", explicitClose: true},
		{name: "existing DSN", existingDSN: true},
		{name: "existing DSN explicitly closed", existingDSN: true, explicitClose: true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := context.Background()
			var connection *sql.DB
			var databaseDirectory string
			// Also release the handle if the regression fails before fixture cleanup.
			t.Cleanup(func() {
				if connection != nil {
					if err := connection.Close(); err != nil {
						t.Errorf("close regression connection: %v", err)
					}
				}
			})
			passed := t.Run("fixture lifetime", func(t *testing.T) {
				var fixture *store.Store
				if scenario.existingDSN {
					profile := getTestingProfileForDriver(t, getDriverFromEnv())
					fixture = NewTestingStoreWithDSN(ctx, t, profile.Driver, profile.DSN)
					require.NoError(t, fixture.Migrate(ctx))
				} else {
					fixture = NewTestingStore(ctx, t)
				}
				connection = fixture.GetDriver().GetDB()
				require.NoError(t, connection.PingContext(ctx))
				if getDriverFromEnv() == "sqlite" {
					var sequence int
					var schema, filename string
					require.NoError(t, connection.QueryRowContext(ctx, "PRAGMA database_list").Scan(&sequence, &schema, &filename))
					databaseDirectory = filepath.Dir(filename)
				}
				if scenario.explicitClose {
					require.NoError(t, fixture.Close())
				}
				// Intentionally no defer Close: the helper owns the remaining lifetime.
			})
			require.True(t, passed, "fixture cleanup must succeed before the child returns")
			require.NotNil(t, connection)
			require.ErrorContains(t, connection.PingContext(ctx), "database is closed")
			if databaseDirectory != "" {
				_, err := os.Stat(databaseDirectory)
				require.True(t, os.IsNotExist(err), "the temporary SQLite directory should already be removed: %v", err)
			}
		})
	}
}
