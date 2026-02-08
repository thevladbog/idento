package main

import (
	"context"
	"fmt"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	if len(os.Args) < 3 {
		log.Fatalf("Usage: reset_password <email> <password>")
	}

	email := os.Args[1]
	password := os.Args[2]

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatalf("DATABASE_URL is not set")
	}

	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		log.Fatalf("Connect DB: %v", err)
	}
	defer pool.Close()

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("Hash password: %v", err)
	}

	cmd := `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE email = $2`
	result, err := pool.Exec(context.Background(), cmd, string(hash), email)
	if err != nil {
		log.Fatalf("Update user: %v", err)
	}

	if result.RowsAffected() == 0 {
		log.Fatalf("No user found for email %q", email)
	}

	fmt.Println("Password updated")
}
