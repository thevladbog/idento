<div align="center">
  <img src="web/public/idento-en-full.svg" alt="Idento Logo" width="200"/>
  
  # Idento - Event Check-in System
  
  ### Complete event registration and check-in system with badge printing
  
  [![CI](https://img.shields.io/github/actions/workflow/status/thevladbog/idento/ci.yml?branch=main&label=CI&logo=github)](https://github.com/thevladbog/idento/actions/workflows/ci.yml)
  [![GitHub Stars](https://img.shields.io/github/stars/thevladbog/idento?style=social)](https://github.com/thevladbog/idento/stargazers)
  [![GitHub Issues](https://img.shields.io/github/issues/thevladbog/idento)](https://github.com/thevladbog/idento/issues)
  [![GitHub Pull Requests](https://img.shields.io/github/issues-pr/thevladbog/idento)](https://github.com/thevladbog/idento/pulls)
  [![License](https://img.shields.io/badge/license-Proprietary-red)](LICENSE)
  
  [![Made with Go](https://img.shields.io/badge/Go-1.25+-00ADD8?logo=go&logoColor=white)](https://golang.org)
  [![Made with React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://reactjs.org)
  [![Made with Kotlin](https://img.shields.io/badge/Kotlin-2.1-7F52FF?logo=kotlin&logoColor=white)](https://kotlinlang.org)
  [![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
  
  [![Windows](https://img.shields.io/badge/Windows-0078D6?logo=windows&logoColor=white)](DEVELOPMENT.md#windows-setup)
  [![macOS](https://img.shields.io/badge/macOS-000000?logo=apple&logoColor=white)](DEVELOPMENT.md#macos-setup)
  [![Linux](https://img.shields.io/badge/Linux-FCC624?logo=linux&logoColor=black)](DEVELOPMENT.md#linux-setup)
  
  [English](README.md) • [Русский](README.ru.md)
</div>

---

## ✨ Features

- 🎪 **Event Management** - Create and configure events
- 📊 **Flexible CSV Import** - Any fields, automatic structure detection
- 🎟️ **Code Generation** - Automatic unique ticket codes
- 🏷️ **Visual Badge Editor** - Constructor with dynamic fields
- ✅ **Quick Check-in** - QR/Barcodes, search, offline mode
- 🖨️ **Printing** - USB, Bluetooth, Ethernet printers
- 👥 **Staff Management** - Roles, QR login for staff
- 🌍 **Multilingual** - EN/RU
- 🌓 **Dark Theme** - Italian green accent

## 🚀 Quick Start

Idento supports development on **Windows**, **macOS**, and **Linux**.

### Windows

**Requirements:** Docker Desktop, Go 1.25+, Node 20+, Git

```powershell
# Clone the repository
git clone https://github.com/thevladbog/idento.git
cd idento

# Start EVERYTHING with one command!
.\scripts\start-all.ps1

# Or via Batch
.\scripts\start-all.bat

# With Make (if installed)
make dev
```

### macOS / Linux

**Requirements:** Docker, Go 1.25+, Node 20+

```bash
# Clone the repository
git clone https://github.com/thevladbog/idento.git
cd idento

# Start EVERYTHING with one command!
bash scripts/start-all.sh

# Or via Make
make dev
```

### What happens on startup?

The command automatically:
- ✅ Starts Docker (PostgreSQL, Redis, PgAdmin)
- ✅ Applies DB migrations
- ✅ Loads test data
- ✅ Starts Backend (Go)
- ✅ Starts Web Frontend (React)
- ✅ Starts Printing Agent (Go)

### System Access

🌐 **Web Admin**: http://localhost:5173  
🔑 **Login**: `admin@test.com` / `password`

🔧 **Backend API**: http://localhost:8008  
🖨️ **Printing Agent**: http://localhost:3000  
🗄️ **PgAdmin**: http://localhost:50050 (`admin@idento.com` / `admin`)

Tip: set `IDENTO_SKIP_PASSWORD_RESET=1` to skip resetting test passwords during `make dev`.

### Stopping

```bash
# Windows PowerShell
.\scripts\stop-all.ps1

# macOS / Linux
bash scripts/stop-all.sh

# Or via Make (all platforms)
make docker-down

# Note: stop-all preserves containers/volumes; docker-down removes them.
```

## 📖 How to Use

### 1️⃣ Import Attendees

1. Open an event
2. Click **"Import CSV"**
3. Upload CSV with **any columns**! (example: `examples/sample-attendees.csv`)
4. System automatically detects all fields
5. Review preview and click **"Import"**

### 2️⃣ Generate Codes

If CSV didn't have a "code" column:
- Click **"Generate Ticket Codes"**
- Done! Unique codes created

### 3️⃣ Create Badge Template

1. Click **"Edit Template"**
2. Add text fields and QR code
3. For each field, select **Data Source** from dropdown
   - ALL fields from your CSV are available!
4. Configure design and save

### 4️⃣ Check-in

**Web**: `/checkin` - search, scan, one button  
**Mobile**: Offline mode, built-in scanner, sync

## 🏗️ Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Web Admin     │     │  Mobile Check-in │     │  Desktop Agent  │
│  (React + TS)   │────▶│    (Kotlin)      │────▶│  (Go + Serial)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                        │
         │                       │                        │
         └───────────────────────┴────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │   Backend (Go + Echo)    │
                    │  ┌─────────────────────┐ │
                    │  │   PostgreSQL        │ │
                    │  │   Redis Cache       │ │
                    │  └─────────────────────┘ │
                    └─────────────────────────┘
```

## 📦 Project Structure

```
idento/
├── backend/          # Go API (Echo, PostgreSQL, Redis)
├── web/             # React Admin (Vite, TailwindCSS, shadcn/ui)
├── mobile/          # Kotlin Android App (offline-first)
├── agent/           # Printing Agent (Go, serial ports)
├── docs/            # Documentation (guides, migrations, status)
├── scripts/         # Utilities (start-all.sh, stop-all.sh, seed.sh)
├── examples/        # Sample CSV files for import
└── docker-compose.yml
```

## 🛠️ Tech Stack

| Component | Technologies |
|-----------|-------------|
| **Backend** | Go 1.25, Echo, PostgreSQL, Redis, JWT |
| **Web** | React 18, TypeScript, Vite, TailwindCSS v4, shadcn/ui, React Konva |
| **Mobile** | Kotlin, Jetpack Compose, Room Database (SQLite) |
| **Agent** | Go, Serial port (`go.bug.st/serial`) |
| **DevOps** | Docker, Docker Compose, GitHub Actions |

## 📚 Documentation

- **Developer Guide**: [DEVELOPMENT.md](./DEVELOPMENT.md) — detailed instructions for development on Windows, macOS, and Linux
- **Project Documentation**: [docs/](./docs/) — setup guides, testing, migrations, and implementation status
- **CI/CD**: [.github/CI.md](./.github/CI.md) — pipeline and checks information
- **API Docs**: http://localhost:8008/docs (after startup)

## 🎨 Features

### CSV Import with Dynamic Fields
```csv
first_name,last_name,email,company,custom_field_1,custom_field_2
John,Doe,john@example.com,Acme,Value1,Value2
```
✅ Any columns - system adapts!

### Badge Editor
- Drag & Drop elements
- Field selection from dropdown
- QR codes
- Size, font, color customization

### Offline Mode (Mobile)
- SQLite database
- Works without internet
- Auto-sync

### User Management
- Roles: Admin, Manager, Staff
- QR tokens for quick staff login
- Event assignment

## 🧪 Development

### Cross-platform Make Commands

```bash
# Show all commands
make help

# Check dependencies
make check-deps

# Lint
make lint

# Tests
make test
make test-coverage

# Build
make build-backend    # Creates build/idento-backend(.exe)
make build-agent      # Creates build/idento-agent(.exe)
make build-all

# Docker
make docker-up
make docker-down

# Clean
make clean
```

### Platform-Specific Scripts

**Windows:**
```powershell
.\scripts\start-all.ps1    # Start all services
.\scripts\stop-all.ps1     # Stop
.\scripts\lint-backend.ps1 # Lint Go code
.\scripts\seed.ps1         # Migrations and seed
```

**macOS/Linux:**
```bash
bash scripts/start-all.sh    # Start all services
bash scripts/stop-all.sh     # Stop
bash scripts/lint-backend.sh # Lint Go code
bash scripts/seed.sh         # Migrations and seed
```

### Detailed Information

See [DEVELOPMENT.md](./DEVELOPMENT.md) for:
- Dependency installation for each platform
- OS-specific troubleshooting
- Development tips
- Commands for each platform

## 📝 Usage Examples

**Upload CSV**:
```bash
curl -X POST http://localhost:8008/api/events/{event_id}/attendees/bulk \
  -H "Authorization: Bearer {token}" \
  -F "file=@examples/sample-attendees.csv"
```

**Generate Codes**:
```bash
curl -X POST http://localhost:8008/api/events/{event_id}/attendees/generate-codes \
  -H "Authorization: Bearer {token}"
```

**Export CSV**:
```bash
curl -X GET http://localhost:8008/api/events/{event_id}/attendees/export \
  -H "Authorization: Bearer {token}" \
  --output attendees.csv
```

## 🤝 Contributing

This project uses a proprietary license. To obtain permission for use or contributions, please contact the repository owner.

If you have suggestions or found a bug:
1. Create an [Issue](https://github.com/thevladbog/idento/issues/new/choose)
2. Describe the problem or suggestion in detail
3. Attach screenshots or logs if necessary

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed contribution guidelines.

## 📄 License

Proprietary — All Rights Reserved. Use without written permission from the copyright holder is prohibited. Details in [LICENSE](LICENSE).

---

<div align="center">
  
  **Made with ❤️ using Go, React, and Kotlin**
  
  [⭐ Star on GitHub](https://github.com/thevladbog/idento) • [📝 Report Bug](https://github.com/thevladbog/idento/issues/new/choose) • [💡 Suggest Feature](https://github.com/thevladbog/idento/issues/new/choose)
  
</div>
