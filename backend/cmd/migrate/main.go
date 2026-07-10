// Command migrate applies pending database migrations and exits.
// Uses the same embedded migrations and version tracking as the server.
package main

import (
	"log"
	"os"

	"idento/backend/internal/store"

	"github.com/joho/godotenv"
)

func main() {
	// cwd differs by invocation: backend/ (go run ./cmd/migrate) or cmd/migrate/ — try each level.
	loaded := false
	for _, p := range []string{".env", "../.env", "../../.env"} {
		if godotenv.Load(p) == nil {
			loaded = true
			break
		}
	}
	if !loaded {
		log.Println("No .env file found, relying on environment variables")
	}
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatal("DATABASE_URL is not set")
	}
	pgStore, err := store.NewPGStore(dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v", err)
	}
	defer pgStore.Close()
	if err := pgStore.RunMigrations(); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}
}
