// Package migrations embeds the SQL migration files into the binary so the
// backend is self-contained (no migrations/ directory needed at runtime).
package migrations

import "embed"

// Files contains every up-migration; seed.sql and *.down.sql are intentionally
// excluded — RunMigrations only ever applies up-migrations.
//
//go:embed *.up.sql
var Files embed.FS
