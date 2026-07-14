package handler

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// RegisterMetaRoutes mounts the public health and instance-metadata routes.
// They live in main.go historically; extracted so they are unit-testable and
// contract-testable like every other handler.
func RegisterMetaRoutes(e *echo.Echo, mode, version string) {
	e.GET("/health", Health)
	e.GET("/api/instance", Instance(mode, version))
}

// Health reports process liveness.
func Health(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]string{"status": "ok"})
}

// Instance returns deployment metadata the frontends read before login.
func Instance(mode, version string) echo.HandlerFunc {
	return func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]interface{}{
			"mode":    mode,
			"version": version,
			"license": nil,
		})
	}
}
