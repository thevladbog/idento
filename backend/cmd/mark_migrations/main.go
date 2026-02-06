package main

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load("../../.env")
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://idento:idento_password@localhost:5432/idento_db"
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	// Mark migrations as applied (for DBs migrated with old numbering or partial runs).
	// All versions use 6-digit zero-padded format: 000001, 000002, ...
	versions := []string{"000002", "000003", "000004", "000005", "000006", "000007", "000008", "000009", "000010"}
	for _, v := range versions {
		_, err := pool.Exec(context.Background(), "INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING", v)
		if err != nil {
			log.Printf("Error marking %s: %v", v, err)
		} else {
			log.Printf("✅ Marked %s as applied", v)
		}
	}
	log.Println("🎉 Done!")
}
