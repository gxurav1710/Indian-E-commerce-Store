# Installation & Host Environment Setup Guide

## 1. Operating Environment
YOUPI PG is distributed as source code and is engineered to run directly as native host processes on standard Linux (Ubuntu, Debian, RHEL, CentOS) and Windows 10/11 environments.

**Zero Docker Requirement:** Docker, Docker Compose, and container engines are completely out of scope and not required.

### Prerequisites
- **Node.js:** v20.0.0 or higher (v24 LTS recommended)
- **Database:** PostgreSQL v14+ (or built-in zero-dependency SQLite for local dev/testing)
- **Java/JDK (Optional, for Android build):** OpenJDK 17+

---

## 2. Linux (Ubuntu / Debian) Setup

```bash
# 1. Update system packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git postgresql postgresql-contrib

# 3. Setup PostgreSQL database
sudo -u postgres psql -c "CREATE USER youpi WITH PASSWORD 'SecurePassword123!';"
sudo -u postgres psql -c "CREATE DATABASE youpi_pg OWNER youpi;"

# 4. Clone and enter repository
git clone <your-repository-url> youpi-pg
cd youpi-pg

# 5. Configure environment
cp .env.example .env
nano .env # Set DATABASE_URL=postgresql://youpi:SecurePassword123!@localhost:5432/youpi_pg

# 6. Run database migrations
node packages/db/src/migrate.js

# 7. Start Control Center
node apps/control-center/src/index.js
```

---

## 3. Windows Setup

```powershell
# 1. Verify Node.js
node -v # Ensure >= v20.0.0

# 2. Configure .env
Copy-Item .env.example .env
# Edit .env using Notepad or VS Code

# 3. Run database migrations
node packages/db/src/migrate.js

# 4. Start local services via Control Center
node apps/control-center/src/index.js
```

Navigate to `http://localhost:8090` to access the Control Center and verify running services.
