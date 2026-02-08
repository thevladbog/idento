package main

import (
	"idento/backend/internal/handler"
	"idento/backend/internal/store"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
)

const backendOpenAPISpec = `openapi: 3.0.3
info:
  title: Idento Backend API
  description: |
    REST API для системы регистрации и чекина участников мероприятий Idento.
    
    ## Основные возможности:
    - Управление мероприятиями (Events)
    - Управление участниками (Attendees)
    - Чекин участников с отслеживанием
    - Управление пользователями и ролями
    - Массовый импорт/экспорт данных (CSV)
    - Генерация QR-кодов для участников
    - Настройка шаблонов бейджей
    - Блокировка участников с причинами
  version: 1.0.0
  contact:
    name: Idento Support
    email: support@idento.app
  license:
    name: MIT
servers:
  - url: http://localhost:8008
    description: Local development
  - url: https://api.idento.app
    description: Production
tags:
  - name: Auth
    description: Аутентификация и авторизация
  - name: Events
    description: Управление мероприятиями
  - name: Attendees
    description: Управление участниками
  - name: Users
    description: Управление пользователями
  - name: Staff
    description: Персонал мероприятий
  - name: Import/Export
    description: Импорт и экспорт данных
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: JWT token (формат - Bearer {token})
  schemas:
    User:
      type: object
      properties:
        id:
          type: string
          format: uuid
        tenant_id:
          type: string
          format: uuid
        email:
          type: string
          format: email
        role:
          type: string
          enum: [admin, manager, staff]
        created_at:
          type: string
          format: date-time
    Event:
      type: object
      properties:
        id:
          type: string
          format: uuid
        name:
          type: string
        description:
          type: string
        start_date:
          type: string
          format: date-time
        end_date:
          type: string
          format: date-time
        location:
          type: string
        field_schema:
          type: array
          items:
            type: string
        custom_fields:
          type: object
    Attendee:
      type: object
      properties:
        id:
          type: string
          format: uuid
        event_id:
          type: string
          format: uuid
        first_name:
          type: string
        last_name:
          type: string
        email:
          type: string
        company:
          type: string
        position:
          type: string
        code:
          type: string
        checkin_status:
          type: boolean
        checked_in_at:
          type: string
          format: date-time
        checked_in_by:
          type: string
          format: uuid
        checked_in_by_email:
          type: string
        blocked:
          type: boolean
        block_reason:
          type: string
        custom_fields:
          type: object
paths:
  /api/auth/login:
    post:
      tags: [Auth]
      summary: Вход в систему
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                email:
                  type: string
                password:
                  type: string
      responses:
        '200':
          description: Успешный вход
  /api/auth/register:
    post:
      tags: [Auth]
      summary: Регистрация
      security: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                email:
                  type: string
                password:
                  type: string
      responses:
        '201':
          description: Пользователь создан
  /api/events:
    get:
      tags: [Events]
      summary: Список мероприятий
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Event'
    post:
      tags: [Events]
      summary: Создать мероприятие
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                start_date:
                  type: string
                  format: date-time
      responses:
        '201':
          description: Создано
  /api/events/{id}:
    get:
      tags: [Events]
      summary: Получить мероприятие
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
            format: uuid
      responses:
        '200':
          description: OK
    put:
      tags: [Events]
      summary: Обновить мероприятие
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Event'
      responses:
        '200':
          description: Обновлено
  /api/events/{id}/attendees:
    get:
      tags: [Attendees]
      summary: Список участников
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: '#/components/schemas/Attendee'
    post:
      tags: [Attendees]
      summary: Добавить участника
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: Создан
  /api/events/{id}/attendees/bulk:
    post:
      tags: [Import/Export]
      summary: Массовый импорт участников
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                attendees:
                  type: array
                  items:
                    type: object
      responses:
        '200':
          description: Импорт завершен
  /api/attendees/{id}:
    put:
      tags: [Attendees]
      summary: Обновить участника
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Attendee'
      responses:
        '200':
          description: Обновлено
    delete:
      tags: [Attendees]
      summary: Удалить участника
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '204':
          description: Удалено
  /api/attendees/{id}/block:
    post:
      tags: [Attendees]
      summary: Заблокировать участника
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                reason:
                  type: string
      responses:
        '200':
          description: Заблокирован
  /api/attendees/{id}/unblock:
    post:
      tags: [Attendees]
      summary: Разблокировать участника
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Разблокирован
  /api/users:
    get:
      tags: [Users]
      summary: Список пользователей
      responses:
        '200':
          description: OK
    post:
      tags: [Users]
      summary: Создать пользователя
      requestBody:
        content:
          application/json:
            schema:
              type: object
      responses:
        '201':
          description: Создан
security:
  - BearerAuth: []
`

func main() {
	// Load environment variables
	if err := godotenv.Load("../.env"); err != nil {
		log.Println("No .env file found, relying on environment variables")
	}

	// Database connection string
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
		if appEnv == "" {
			appEnv = strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV")))
		}
		isDev := appEnv == "development" || appEnv == "local" || appEnv == "dev"
		if !isDev {
			log.Fatal("DATABASE_URL is required outside development/local environments")
		}
		log.Println("Warning: DATABASE_URL not set; using local development default")
		dbURL = "postgres://idento:idento_password@localhost:5438/idento_db?sslmode=disable"
	}

	// Initialize Store
	pgStore, err := store.NewPGStore(dbURL)
	if err != nil {
		log.Fatalf("Unable to connect to database: %v\n", err)
	}
	defer pgStore.Close()

	// Run migrations on startup (already-applied migrations are skipped and logged)
	if err := pgStore.RunMigrations(); err != nil {
		log.Fatalf("Migrations failed: %v", err)
	}

	// Initialize Handler
	h := handler.New(pgStore)

	// Initialize Echo
	e := echo.New()

	// Middleware
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{"*"}, // Configure properly for production
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	// Public utility routes (no auth) - BEFORE RegisterRoutes
	e.POST("/api/util/printers/generate-qr", h.GeneratePrinterQR)

	// Register Routes
	h.RegisterRoutes(e)

	// Health Check
	e.GET("/health", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
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
	port := os.Getenv("PORT")
	if port == "" {
		port = "8008"
	}
	e.Logger.Fatal(e.Start(":" + port))
}
