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

	// Get email from args or use default
	email := "demo@idento.app"
	if len(os.Args) > 1 {
		email = os.Args[1]
	}

	// Update user to be super admin
	result, err := pool.Exec(context.Background(),
		`UPDATE users SET is_super_admin = TRUE WHERE email = $1`, email)
	if err != nil {
		log.Fatalf("Error: %v", err)
	}

	rowsAffected := result.RowsAffected()
	if rowsAffected == 0 {
		log.Printf("❌ User with email '%s' not found", email)
	} else {
		log.Printf("✅ User '%s' is now a super admin!", email)
	}
}
