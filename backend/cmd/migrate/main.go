package main

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

func main() {
	// Load environment variables (optional; ignore if .env missing)
	if err := godotenv.Load("../../.env"); err != nil {
		log.Print("No .env file or load error (using defaults): ", err)
	}

	// Database connection string
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://idento:idento_password@localhost:5432/idento_db"
	}

	// Connect to database
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
	defer pool.Close()

	// Create schema_migrations table
	_, err = pool.Exec(context.Background(), `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version VARCHAR(255) PRIMARY KEY,
			applied_at TIMESTAMP DEFAULT NOW()
		)
	`)
	if err != nil {
		log.Fatalf("Failed to create schema_migrations table: %v", err)
	}

	// Find migrations directory
	migrationsDir := "../../migrations"
	if _, err := os.Stat(migrationsDir); os.IsNotExist(err) {
		migrationsDir = "../migrations"
	}

	// Read all migration files
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		log.Fatalf("Failed to read migrations directory: %v", err)
	}

	// Filter and sort .up.sql files
	var migrationFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && filepath.Ext(entry.Name()) == ".sql" &&
			entry.Name() != "seed.sql" &&
			strings.HasSuffix(entry.Name(), ".up.sql") {
			migrationFiles = append(migrationFiles, entry.Name())
		}
	}
	sort.Strings(migrationFiles)

	log.Printf("Found %d migrations", len(migrationFiles))

	absDir, err := filepath.Abs(migrationsDir)
	if err != nil {
		log.Fatalf("Migrations dir: %v", err)
	}
	root, err := os.OpenRoot(absDir)
	if err != nil {
		log.Fatalf("OpenRoot migrations: %v", err)
	}
	defer root.Close()

	// Apply migrations in order
	for _, filename := range migrationFiles {
		// Extract version from filename
		version := strings.Split(filename, "_")[0]

		// Check if already applied
		var exists bool
		err := pool.QueryRow(context.Background(),
			`SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists)
		if err != nil {
			log.Fatalf("Failed to check migration status: %v", err)
		}

		if exists {
			log.Printf("⏭️  Skipping %s (already applied)", filename)
			continue
		}

		// Read and execute migration (os.Root scopes access to migrations dir)
		content, err := root.ReadFile(filename)
		if err != nil {
			log.Fatalf("Failed to read migration %s: %v", filename, err)
		}

		log.Printf("⚙️  Applying %s...", filename)
		_, err = pool.Exec(context.Background(), string(content))
		if err != nil {
			log.Fatalf("Failed to execute migration %s: %v", filename, err)
		}

		// Record migration
		_, err = pool.Exec(context.Background(),
			`INSERT INTO schema_migrations (version) VALUES ($1)`, version)
		if err != nil {
			log.Fatalf("Failed to record migration %s: %v", version, err)
		}

		log.Printf("✅ Applied migration: %s", filename)
	}

	log.Printf("🎉 All migrations applied successfully!")
}
