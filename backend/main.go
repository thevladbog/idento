package main

import (
	"context"
	_ "embed"
	"idento/backend/internal/bootstrap"
	"idento/backend/internal/config"
	"idento/backend/internal/handler"
	"idento/backend/internal/retention"
	"idento/backend/internal/store"
	"log"
	"net/http"
	"time"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

// version is the build version, injected at build time via
// -ldflags "-X main.version=v1.2.3". "dev" for local builds.
var version = "dev"

// backendOpenAPISpec embeds the real, contract-tested backend/openapi.yaml
// so that the /openapi.yaml and /docs routes always serve the truthful spec
// (see backend/internal/handler/openapi_contract_test.go for the contract
// tests that keep openapi.yaml honest).
//
//go:embed openapi.yaml
var backendOpenAPISpec string

func main() {
	// Try .env in cwd first (Docker/packaged runs), then repo root (make dev runs from backend/).
	if err := godotenv.Load(".env"); err != nil {
		if err := godotenv.Load("../.env"); err != nil {
			log.Println("No .env file found, relying on environment variables")
		}
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	// Initialize Store
	pgStore, err := store.NewPGStore(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
	defer pgStore.Close()

	// Run migrations on startup (already-applied migrations are skipped and logged)
	if err := pgStore.RunMigrations(); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}

	if err := pgStore.EnsureSeedData(context.Background(), cfg.DeploymentMode); err != nil {
		log.Fatalf("Seed data failed: %v", err)
	}

	if cfg.DeploymentMode == config.ModeOnPrem {
		if err := bootstrap.OnPremAdmin(context.Background(), pgStore, cfg); err != nil {
			log.Fatalf("Bootstrap failed: %v", err)
		}
	}

	// Initialize Handler
	h := handler.New(pgStore)

	// Tenant retention purge (P1.4 soft-delete): first pass a minute after
	// boot, then daily. Logs and no-ops when retention is 0.
	retention.Start(pgStore, cfg.TenantRetentionDays, time.Minute, 24*time.Hour)

	// Initialize Echo
	e := echo.New()

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: cfg.CORSAllowedOrigins,
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	// Public utility routes (no auth) - BEFORE RegisterRoutes
	e.POST("/api/util/printers/generate-qr", h.GeneratePrinterQR)

	// Register Routes
	h.RegisterRoutes(e, cfg.DeploymentMode)

	// Meta routes (health check, instance metadata)
	handler.RegisterMetaRoutes(e, cfg.DeploymentMode, version)

	// Version / instance metadata (public: web reads the mode before login).
	e.GET("/api/version", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"version": version})
	})

	// OpenAPI spec endpoint
	e.GET("/openapi.yaml", func(c echo.Context) error {
		return c.Blob(http.StatusOK, "text/yaml", []byte(backendOpenAPISpec))
	})

	// Printer QR Generator UI
	e.GET("/printer-qr", func(c echo.Context) error {
		return c.File("templates/printer_qr_generator.html")
	})

	// Scalar UI (modern API documentation)
	e.GET("/docs", func(c echo.Context) error {
		return c.HTML(http.StatusOK, `
<!DOCTYPE html>
<html>
<head>
    <title>Idento API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
    <script id="api-reference" data-url="/openapi.yaml"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>
		`)
	})

	// Start server
	e.Logger.Fatal(e.Start(":" + cfg.Port))
}
