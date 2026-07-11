package store

import (
	"context"
	"errors"
	"testing"

	pgxmock "github.com/pashagolub/pgxmock/v4"
)

func TestHasAnyUsersReturnsFalseOnEmptyTable(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users\)`).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(false))

	s := &PGStore{db: mock}
	got, err := s.HasAnyUsers(context.Background())
	if err != nil {
		t.Fatalf("HasAnyUsers: %v", err)
	}
	if got != false {
		t.Errorf("HasAnyUsers = %v, want false", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestHasAnyUsersReturnsTrueWhenAUserExists(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users\)`).
		WillReturnRows(pgxmock.NewRows([]string{"exists"}).AddRow(true))

	s := &PGStore{db: mock}
	got, err := s.HasAnyUsers(context.Background())
	if err != nil {
		t.Fatalf("HasAnyUsers: %v", err)
	}
	if got != true {
		t.Errorf("HasAnyUsers = %v, want true", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}

func TestHasAnyUsersPropagatesQueryError(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()

	wantErr := errors.New("connection reset")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users\)`).
		WillReturnError(wantErr)

	s := &PGStore{db: mock}
	_, err = s.HasAnyUsers(context.Background())
	if err == nil {
		t.Fatal("HasAnyUsers() error = nil, want non-nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations: %v", err)
	}
}
