# Comprehensive Docker Guide for GuardScan

This comprehensive guide covers running GuardScan CLI in Docker across all major operating systems: Linux, macOS, and Windows.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation by OS](#installation-by-os)
4. [Quick Start](#quick-start)
5. [Docker Image Variants](#docker-image-variants)
6. [Usage Examples](#usage-examples)
7. [Environment Variables](#environment-variables)
8. [Volume Mounting Strategies](#volume-mounting-strategies)
9. [Docker Compose Examples](#docker-compose-examples)
10. [CI/CD Integration](#cicd-integration)
11. [Troubleshooting](#troubleshooting)
12. [Security Considerations](#security-considerations)
13. [Performance Optimization](#performance-optimization)
14. [Advanced Scenarios](#advanced-scenarios)

---

## Overview

### Why Use GuardScan in Docker?

- **Consistent Environment**: Same behavior across different operating systems
- **Isolation**: No conflicts with local Node.js installations
- **CI/CD Ready**: Easy integration into automated pipelines
- **Reproducibility**: Same results every time
- **Security**: Isolated execution environment
- **Portability**: Run anywhere Docker runs

### What This Guide Covers

- Installation on Linux, macOS, and Windows
- Docker image selection and optimization
- OS-specific usage patterns
- Volume mounting strategies
- CI/CD pipeline integration
- Troubleshooting common issues
- Security best practices

---

## Prerequisites

### General Requirements

- Docker Engine 20.10+ or Docker Desktop 4.0+
- Node.js 18+ (in container)
- 2GB+ RAM available for Docker
- Internet connection (for npm install and AI features)

### OS-Specific Prerequisites

#### Linux

- Docker Engine or Docker Desktop
- User in `docker` group (for Docker Engine)
- sudo access (for installation)

#### macOS

- Docker Desktop for Mac
- macOS 10.15+ (Catalina or later)
- For Apple Silicon (M1/M2): Docker Desktop with Rosetta 2 support

#### Windows

- Docker Desktop for Windows
- Windows 10/11 (64-bit) or Windows Server 2019+
- WSL2 enabled (recommended)
- Virtualization enabled in BIOS

---

## Installation by OS

### Linux

#### Docker Engine Installation

**Ubuntu/Debian:**

```bash
# Remove old versions
sudo apt-get remove docker docker-engine docker.io containerd runc

# Update package index
sudo apt-get update

# Install prerequisites
sudo apt-get install \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add user to docker group (optional, for non-sudo usage)
sudo usermod -aG docker $USER
# Log out and back in for group changes to take effect
```

**CentOS/RHEL/Fedora:**

```bash
# Install prerequisites
sudo yum install -y yum-utils

# Add Docker repository
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# Install Docker Engine
sudo yum install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER
```

**Arch Linux:**

```bash
# Install Docker
sudo pacman -S docker docker-compose

# Start Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Add user to docker group
sudo usermod -aG docker $USER
```

#### Docker Compose Installation

Docker Compose is included with Docker Desktop and Docker Engine 20.10+. For standalone installation:

```bash
# Download latest version
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

# Make executable
sudo chmod +x /usr/local/bin/docker-compose

# Verify installation
docker-compose --version
```

#### Verification

```bash
# Check Docker version
docker --version

# Test Docker installation
docker run hello-world

# Check Docker Compose
docker-compose --version
```

### macOS

#### Docker Desktop Installation

**Using Homebrew (Recommended):**

```bash
# Install Docker Desktop
brew install --cask docker

# Start Docker Desktop
open /Applications/Docker.app
```

**Manual Installation:**

1. Download Docker Desktop from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Open the `.dmg` file
3. Drag Docker to Applications folder
4. Launch Docker Desktop from Applications
5. Complete the setup wizard

#### Apple Silicon (M1/M2) Considerations

- Docker Desktop for Apple Silicon includes native ARM support
- Most images work without issues
- For x86 images, Docker Desktop automatically uses Rosetta 2
- Performance may be slightly slower for x86 containers

#### Resource Allocation

Configure resources in Docker Desktop:

1. Open Docker Desktop
2. Go to Settings → Resources
3. Recommended settings:
   - **CPUs**: 2-4 cores
   - **Memory**: 4-8 GB
   - **Swap**: 1 GB
   - **Disk image size**: 60+ GB

#### File Sharing Configuration

1. Open Docker Desktop → Settings → Resources → File Sharing
2. Add directories you want to mount:
   - `/Users` (default, includes your home directory)
   - `/Volumes` (for external drives)
   - Custom project directories

#### Verification

```bash
# Check Docker version
docker --version

# Test Docker installation
docker run hello-world

# Check architecture (Apple Silicon)
docker info | grep Architecture
```

### Windows

#### Docker Desktop Installation

**Using Chocolatey:**

```powershell
# Install Chocolatey if not installed
Set-ExecutionPolicy Bypass -Scope Process -Force
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Docker Desktop
choco install docker-desktop -y
```

**Manual Installation:**

1. Download Docker Desktop from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Run the installer
3. Enable WSL2 when prompted (recommended)
4. Restart computer if required
5. Launch Docker Desktop

#### WSL2 Setup

WSL2 is recommended for better performance:

```powershell
# Enable WSL2 (run as Administrator)
wsl --install

# Set WSL2 as default version
wsl --set-default-version 2

# Verify WSL2 installation
wsl --list --verbose
```

#### Windows Container Mode

Docker Desktop supports both Linux and Windows containers:

```powershell
# Switch to Linux containers (default, recommended)
# Right-click Docker Desktop tray icon → Switch to Linux containers

# Or use command line
& "C:\Program Files\Docker\Docker\DockerCli.exe" -SwitchLinuxEngine
```

#### Path Format Considerations

Windows uses backslashes (`\`) but Docker containers use forward slashes (`/`):

```powershell
# PowerShell - Use forward slashes or escape backslashes
docker run -v C:/Users/username/project:/workspace node:lts-alpine

# CMD - Use forward slashes
docker run -v C:/Users/username/project:/workspace node:lts-alpine

# WSL2 - Use Linux paths
docker run -v /mnt/c/Users/username/project:/workspace node:lts-alpine
```

#### Verification

```powershell
# Check Docker version
docker --version

# Test Docker installation
docker run hello-world

# Check WSL2 integration
docker info | Select-String "Operating System"
```

---

## Quick Start

### Basic Usage

**Linux/macOS:**

```bash
# Run GuardScan in a container
docker run --rm -v $(pwd):/workspace -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan init &&
    guardscan security
  "
```

**Windows (PowerShell):**

```powershell
# Run GuardScan in a container
docker run --rm -v ${PWD}:/workspace -w /workspace `
  -e GUARDSCAN_HOME=/tmp/guardscan `
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan init &&
    guardscan security
  "
```

**Windows (CMD):**

```cmd
docker run --rm -v %CD%:/workspace -w /workspace -e GUARDSCAN_HOME=/tmp/guardscan node:lts-alpine sh -c "apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan init && guardscan security"
```

---

## Docker Image Variants

### Base Image Comparison

| Image | Size | Compatibility | Use Case |
|-------|------|---------------|----------|
| `node:lts-alpine` | ~50MB | High (musl libc) | **Recommended** - Production, CI/CD |
| `node:lts-slim` | ~200MB | Very High (glibc) | Development, compatibility issues |
| `node:lts` | ~900MB | Very High | Full Debian environment |

### Recommended: `node:lts-alpine`

**Advantages:**

- Smallest image size
- Fast downloads and startup
- Lower memory footprint
- Suitable for most use cases

**Considerations:**

- Requires additional packages for some native modules
- Uses musl libc instead of glibc

### Alternative: `node:lts-slim`

Use when:

- Alpine has compatibility issues
- Need glibc compatibility
- Working with packages that don't support musl

### Alternative: `node:lts`

Use when:

- Need full Debian environment
- Maximum compatibility required
- Size is not a concern

### Alpine Linux Detailed Guide

**Quick Start:**

```bash
# Install dependencies first
apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
  libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

# Install GuardScan
npm install -g guardscan

# Initialize
guardscan init
```

**Common Issues & Solutions:**

#### Issue #1: "Configuration not found" Error

**Symptoms:**

```
Configuration not found. Run "guardscan init" first.
```

**Cause:** Alpine Linux containers may have issues with home directory detection.

**Solutions:**

1. **Set GUARDSCAN_HOME environment variable:**

   ```bash
   export GUARDSCAN_HOME=/tmp/guardscan
   guardscan init
   ```

2. **Ensure HOME is set:**

   ```bash
   export HOME=/root  # or appropriate directory
   guardscan init
   ```

3. **Enable debug mode to see what's happening:**

   ```bash
   export GUARDSCAN_DEBUG=true
   guardscan init
   ```

#### Issue #2: Permission Denied Errors

**Cause:** Container may have restricted write permissions.

**Solution:** Use `/tmp` or a writeable volume:

```bash
export GUARDSCAN_HOME=/tmp/guardscan
# or mount a volume
docker run -v /path/on/host:/guardscan node:lts-alpine
export GUARDSCAN_HOME=/guardscan
```

#### Issue #3: Missing Dependencies

**Cause:** Alpine uses `musl` instead of `glibc` and needs additional build tools.

**Solution:** Install all required dependencies:

```bash
apk add --no-cache \
  python3 \
  make \
  g++ \
  pkgconfig \
  cairo-dev \
  pango-dev \
  libjpeg-turbo-dev \
  giflib-dev \
  pixman-dev \
  freetype-dev \
  build-base \
  git
```

**Docker Examples:**

#### Example 1: Basic Alpine Container

```dockerfile
FROM node:lts-alpine

# Install dependencies
RUN apk add --no-cache \
    python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

# Install GuardScan
RUN npm install -g guardscan

# Set up config location
ENV GUARDSCAN_HOME=/app/.guardscan

# Your code
WORKDIR /app
COPY . .

# Run GuardScan
RUN guardscan init
```

#### Example 2: Read-Only Root Filesystem

For enhanced security with read-only root:

```bash
docker run --read-only --tmpfs /tmp \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine \
  sh -c "npm install -g guardscan && guardscan init"
```

**Testing Your Setup:**

Run the test script to verify GuardScan works in your environment:

```bash
cd cli
./test-alpine.sh
```

This will test:

- ✅ Clean Alpine environment
- ✅ Missing HOME variable
- ✅ Custom GUARDSCAN_HOME
- ✅ Read-only filesystems
- ✅ Version check behavior
- ✅ Multiple commands in sequence

### Custom Dockerfile Examples

#### Minimal Alpine Dockerfile

```dockerfile
FROM node:lts-alpine

# Install only essential dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Install GuardScan
RUN npm install -g guardscan

# Set environment
ENV GUARDSCAN_HOME=/app/.guardscan

WORKDIR /app
```

#### Production-Ready Multi-Stage Build

```dockerfile
# Build stage
FROM node:lts-alpine AS builder

RUN apk add --no-cache \
    python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

RUN npm install -g guardscan

# Runtime stage
FROM node:lts-alpine

# Copy only runtime dependencies
RUN apk add --no-cache \
    python3 \
    git

# Copy GuardScan from builder
COPY --from=builder /usr/local/lib/node_modules/guardscan /usr/local/lib/node_modules/guardscan
COPY --from=builder /usr/local/bin/guardscan /usr/local/bin/guardscan

ENV GUARDSCAN_HOME=/app/.guardscan
WORKDIR /app
```

#### Development Dockerfile with Hot-Reload

```dockerfile
FROM node:lts-alpine

RUN apk add --no-cache \
    python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git

RUN npm install -g guardscan

ENV GUARDSCAN_HOME=/app/.guardscan
ENV GUARDSCAN_DEBUG=true

WORKDIR /app

# Mount source code as volume in docker-compose
```

---

## Usage Examples

### Linux

#### Basic Docker Run

```bash
# Simple security scan
docker run --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan security
  "
```

#### With Persistent Configuration

```bash
# Create named volume for config
docker volume create guardscan-config

# Use the volume
docker run --rm \
  -v $(pwd):/workspace \
  -v guardscan-config:/root/.guardscan \
  -w /workspace \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan security
  "
```

#### Systemd Service

Create `/etc/systemd/system/guardscan.service`:

```ini
[Unit]
Description=GuardScan Security Scanner
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/docker run --rm \
  -v /path/to/project:/workspace \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c "apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan security"
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

Enable and run:

```bash
sudo systemctl enable guardscan.service
sudo systemctl start guardscan.service
```

#### Cron Job

Add to crontab (`crontab -e`):

```bash
# Run security scan daily at 2 AM
0 2 * * * docker run --rm -v /path/to/project:/workspace -w /workspace -e GUARDSCAN_HOME=/tmp/guardscan node:lts-alpine sh -c "apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan security" >> /var/log/guardscan.log 2>&1
```

### macOS

#### Basic Docker Run

```bash
# Simple security scan
docker run --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan security
  "
```

#### With Home Directory Mount

```bash
# Mount macOS home directory
docker run --rm \
  -v $(pwd):/workspace \
  -v $HOME/.guardscan:/root/.guardscan \
  -w /workspace \
  -e GUARDSCAN_HOME=/root/.guardscan \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan security
  "
```

#### Homebrew Integration

Create a wrapper script `~/bin/guardscan-docker`:

```bash
#!/bin/bash
docker run --rm \
  -v $(pwd):/workspace \
  -v $HOME/.guardscan:/root/.guardscan \
  -w /workspace \
  -e GUARDSCAN_HOME=/root/.guardscan \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git > /dev/null 2>&1 &&
    npm install -g guardscan > /dev/null 2>&1 &&
    guardscan $@
  "
```

Make executable:

```bash
chmod +x ~/bin/guardscan-docker
```

### Windows

#### PowerShell Script

Create `guardscan-docker.ps1`:

```powershell
param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [string[]]$CommandArgs
)

$workspace = (Get-Location).Path
$workspaceLinux = $workspace -replace '\\', '/' -replace 'C:', '/mnt/c'

docker run --rm `
  -v "${workspace}:/workspace" `
  -w /workspace `
  -e GUARDSCAN_HOME=/tmp/guardscan `
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan $($CommandArgs -join ' ')
  "
```

Usage:

```powershell
.\guardscan-docker.ps1 security
.\guardscan-docker.ps1 scan --skip-tests
```

#### CMD Batch File

Create `guardscan-docker.bat`:

```batch
@echo off
setlocal

set WORKSPACE=%~dp0
set WORKSPACE=%WORKSPACE:~0,-1%

docker run --rm ^
  -v "%WORKSPACE%:/workspace" ^
  -w /workspace ^
  -e GUARDSCAN_HOME=/tmp/guardscan ^
  node:lts-alpine sh -c "apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan %*"

endlocal
```

Usage:

```cmd
guardscan-docker.bat security
guardscan-docker.bat scan --skip-tests
```

#### WSL2 Integration

From WSL2 terminal:

```bash
# Navigate to Windows project (mounted at /mnt/c)
cd /mnt/c/Users/username/project

# Run GuardScan
docker run --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine sh -c "
    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
    npm install -g guardscan &&
    guardscan security
  "
```

---

## Environment Variables

### Core Environment Variables

#### `GUARDSCAN_HOME`

Override the default home directory location.

```bash
export GUARDSCAN_HOME=/custom/path
```

**Default behavior:**

- Tries `$GUARDSCAN_HOME` first
- Falls back to `$HOME`
- Falls back to `$USERPROFILE` (Windows)
- Falls back to `os.homedir()`
- Last resort: `/tmp`

**Usage in Docker:**

```bash
docker run -e GUARDSCAN_HOME=/tmp/guardscan node:lts-alpine
```

#### `GUARDSCAN_DEBUG`

Enable verbose debug logging to troubleshoot issues.

```bash
export GUARDSCAN_DEBUG=true
guardscan init  # Will show detailed logging
```

**Usage in Docker:**

```bash
docker run -e GUARDSCAN_DEBUG=true node:lts-alpine guardscan init
```

#### `GUARDSCAN_API_URL`

Override the default backend API URL (for self-hosting or testing).

```bash
export GUARDSCAN_API_URL=https://custom-api.example.com
```

#### `GUARDSCAN_NO_TELEMETRY`

Disable telemetry for the current command execution (set via `--no-telemetry` flag).

**Note:** This is handled via the `--no-telemetry` CLI flag, not an environment variable.

### OS-Specific Environment Variables

#### Linux

- `HOME` - User home directory
- `USER` - Current username
- `XDG_CONFIG_HOME` - Config directory (if set, GuardScan uses `$HOME/.guardscan`)

#### macOS

- `HOME` - User home directory (typically `/Users/username`)
- `USER` - Current username

#### Windows

- `USERPROFILE` - User profile directory (typically `C:\Users\username`)
- `APPDATA` - Application data directory
- `LOCALAPPDATA` - Local application data directory

---

## Volume Mounting Strategies

### Configuration Persistence

#### Named Volumes (Recommended for Production)

```bash
# Create named volume
docker volume create guardscan-config

# Use the volume
docker run --rm \
  -v guardscan-config:/root/.guardscan \
  -v $(pwd):/workspace \
  -w /workspace \
  node:lts-alpine guardscan security
```

**Advantages:**

- Persistent across container restarts
- Managed by Docker
- Can be backed up easily

#### Bind Mounts (Recommended for Development)

**Linux/macOS:**

```bash
docker run --rm \
  -v $HOME/.guardscan:/root/.guardscan \
  -v $(pwd):/workspace \
  -w /workspace \
  node:lts-alpine guardscan security
```

**Windows (PowerShell):**

```powershell
docker run --rm `
  -v "$env:USERPROFILE\.guardscan:/root/.guardscan" `
  -v "${PWD}:/workspace" `
  -w /workspace `
  node:lts-alpine guardscan security
```

**Advantages:**

- Direct access to config files
- Easy to edit configuration
- Shares config with host system

#### Temporary Volumes (Ephemeral)

```bash
docker run --rm \
  -v guardscan-temp:/tmp/guardscan \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  -v $(pwd):/workspace \
  -w /workspace \
  node:lts-alpine guardscan security
```

**Use case:** One-time scans, CI/CD pipelines

### Code Repository Mounting

#### Read-Only Mounts (Recommended for Scanning)

```bash
docker run --rm \
  -v $(pwd):/workspace:ro \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine guardscan security
```

**Advantages:**

- Prevents accidental modifications
- Better security
- Suitable for production scans

#### Read-Write Mounts (For Development)

```bash
docker run --rm \
  -v $(pwd):/workspace \
  -w /workspace \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine guardscan security
```

**Use case:** When GuardScan needs to write reports or generate files

### Excluding Files

Create `.dockerignore` in your project root:

```
node_modules
dist
build
.git
.env
*.log
.DS_Store
Thumbs.db
```

This reduces the amount of data copied into the container.

---

## Docker Compose Examples

### Basic Compose File

```yaml
version: '3.8'

services:
  guardscan:
    image: node:lts-alpine
    environment:
      - GUARDSCAN_HOME=/workspace/.guardscan
      - GUARDSCAN_DEBUG=false
    volumes:
      - ./:/workspace
    working_dir: /workspace
    command: sh -c "
      apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
      npm install -g guardscan &&
      guardscan scan
    "
```

Usage:

```bash
docker-compose up
```

### Multi-Service Compose

```yaml
version: '3.8'

services:
  guardscan:
    image: node:lts-alpine
    environment:
      - GUARDSCAN_HOME=/workspace/.guardscan
    volumes:
      - ./:/workspace
      - guardscan-config:/root/.guardscan
    working_dir: /workspace
    command: sh -c "
      apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
      npm install -g guardscan &&
      guardscan security
    "
    depends_on:
      - postgres

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=guardscan
      - POSTGRES_USER=guardscan
      - POSTGRES_PASSWORD=secret
    volumes:
      - postgres-data:/var/lib/postgresql/data

volumes:
  guardscan-config:
  postgres-data:
```

### Development Compose

```yaml
version: '3.8'

services:
  guardscan:
    build:
      context: .
      dockerfile: Dockerfile.dev
    environment:
      - GUARDSCAN_HOME=/app/.guardscan
      - GUARDSCAN_DEBUG=true
    volumes:
      - ./:/app
      - /app/node_modules
      - guardscan-cache:/app/.guardscan/cache
    working_dir: /app
    command: guardscan security --watch
    ports:
      - "3000:3000"  # If running a dev server

volumes:
  guardscan-cache:
```

---

## CI/CD Integration

### GitHub Actions

#### Linux Runner

```yaml
name: GuardScan Security Check
on: [push, pull_request]

jobs:
  security-scan:
    runs-on: ubuntu-latest
    container:
      image: node:lts-alpine
    steps:
      - uses: actions/checkout@v3
      
      - name: Install dependencies
        run: |
          apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev \
            libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
      
      - name: Install GuardScan
        run: npm install -g guardscan
      
      - name: Run security scan
        env:
          GUARDSCAN_HOME: ${{ github.workspace }}/.guardscan
        run: guardscan security
      
      - name: Upload report
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: guardscan-report
          path: guardscan-report.md
```

#### macOS Runner

```yaml
name: GuardScan macOS Check
on: [push, pull_request]

jobs:
  security-scan:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install dependencies
        run: |
          brew install node
          npm install -g guardscan
      
      - name: Run security scan
        env:
          GUARDSCAN_HOME: ${{ github.workspace }}/.guardscan
        run: guardscan security
```

#### Windows Runner

```yaml
name: GuardScan Windows Check
on: [push, pull_request]

jobs:
  security-scan:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install GuardScan
        run: npm install -g guardscan
      
      - name: Run security scan
        env:
          GUARDSCAN_HOME: ${{ github.workspace }}\.guardscan
        run: guardscan security
```

#### Matrix Strategy (Multiple OS)

```yaml
name: GuardScan Multi-OS
on: [push, pull_request]

jobs:
  security-scan:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install GuardScan
        run: npm install -g guardscan
      
      - name: Run security scan
        env:
          GUARDSCAN_HOME: ${{ github.workspace }}/.guardscan
        run: guardscan security
```

### GitLab CI

```yaml
stages:
  - security

guardscan:
  stage: security
  image: node:lts-alpine
  before_script:
    - apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
    - npm install -g guardscan
  script:
    - export GUARDSCAN_HOME=$CI_PROJECT_DIR/.guardscan
    - guardscan security
  artifacts:
    paths:
      - guardscan-report.md
    expire_in: 1 week
```

### Jenkins

#### Linux Agent

```groovy
pipeline {
    agent {
        docker {
            image 'node:lts-alpine'
            args '-e GUARDSCAN_HOME=/workspace/.guardscan'
        }
    }
    stages {
        stage('Security Scan') {
            steps {
                sh '''
                    apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
                    libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
                    npm install -g guardscan
                    guardscan security
                '''
            }
        }
    }
    post {
        always {
            archiveArtifacts artifacts: 'guardscan-report.md', fingerprint: true
        }
    }
}
```

#### Windows Agent

```groovy
pipeline {
    agent {
        label 'windows'
    }
    stages {
        stage('Security Scan') {
            steps {
                bat '''
                    npm install -g guardscan
                    set GUARDSCAN_HOME=%WORKSPACE%\.guardscan
                    guardscan security
                '''
            }
        }
    }
}
```

### Azure DevOps

```yaml
trigger:
  branches:
    include:
      - main
      - develop

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: Docker@2
    displayName: 'Run GuardScan'
    inputs:
      containerRegistry: ''
      repository: 'node'
      command: 'run'
      arguments: '--rm -v $(System.DefaultWorkingDirectory):/workspace -w /workspace -e GUARDSCAN_HOME=/workspace/.guardscan node:lts-alpine sh -c "apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan security"'
```

### CircleCI

```yaml
version: 2.1

jobs:
  security-scan:
    docker:
      - image: node:lts-alpine
    steps:
      - checkout
      - run:
          name: Install dependencies
          command: |
            apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
            libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git
      - run:
          name: Install GuardScan
          command: npm install -g guardscan
      - run:
          name: Run security scan
          environment:
            GUARDSCAN_HOME: /tmp/guardscan
          command: guardscan security
      - store_artifacts:
          path: guardscan-report.md
```

---

## Troubleshooting

### Linux

#### Permission Denied Errors

**Problem:** `permission denied` when accessing files or directories.

**Solutions:**

1. **Check file permissions:**

   ```bash
   ls -la /path/to/file
   chmod 755 /path/to/directory
   ```

2. **Run with correct user:**

   ```bash
   docker run --user $(id -u):$(id -g) ...
   ```

3. **Fix ownership:**

   ```bash
   sudo chown -R $USER:$USER /path/to/directory
   ```

#### SELinux Issues

**Problem:** SELinux blocking Docker access.

**Solutions:**

1. **Set SELinux context:**

   ```bash
   chcon -Rt svirt_sandbox_file_t /path/to/directory
   ```

2. **Disable SELinux for Docker (not recommended for production):**

   ```bash
   setsebool -P container_manage_cgroup on
   ```

#### AppArmor Configuration

**Problem:** AppArmor blocking container operations.

**Solution:** Create custom AppArmor profile or adjust Docker's AppArmor profile.

#### Network Connectivity

**Problem:** Container cannot reach internet.

**Solutions:**

1. **Check Docker network:**

   ```bash
   docker network ls
   docker network inspect bridge
   ```

2. **Use host network (Linux only):**

   ```bash
   docker run --network host ...
   ```

3. **Check DNS:**

   ```bash
   docker run --rm node:lts-alpine nslookup google.com
   ```

### macOS

#### Docker Desktop Not Starting

**Problem:** Docker Desktop fails to start.

**Solutions:**

1. **Restart Docker Desktop:**

   ```bash
   killall Docker && open /Applications/Docker.app
   ```

2. **Reset Docker Desktop:**
   - Docker Desktop → Troubleshoot → Reset to factory defaults

3. **Check system requirements:**
   - macOS 10.15+ required
   - Virtualization must be enabled

#### Resource Allocation Issues

**Problem:** Container runs out of memory or CPU.

**Solutions:**

1. **Increase resources in Docker Desktop:**
   - Settings → Resources → Advanced
   - Increase Memory to 8GB+
   - Increase CPUs to 4+

2. **Check current usage:**

   ```bash
   docker stats
   ```

#### File Sharing Permissions

**Problem:** Cannot access mounted directories.

**Solutions:**

1. **Add directory in Docker Desktop:**
   - Settings → Resources → File Sharing
   - Add `/Users/username/project`

2. **Check directory permissions:**

   ```bash
   ls -la /Users/username/project
   chmod 755 /Users/username/project
   ```

#### Path Resolution Issues

**Problem:** Paths not resolving correctly.

**Solutions:**

1. **Use absolute paths:**

   ```bash
   docker run -v /Users/username/project:/workspace ...
   ```

2. **Check path format:**
   - Use forward slashes: `/Users/username/project`
   - Not backslashes: `\Users\username\project`

#### Apple Silicon Compatibility

**Problem:** x86 images not working on Apple Silicon.

**Solutions:**

1. **Use ARM images when available:**

   ```bash
   docker pull node:lts-alpine  # Automatically pulls ARM version
   ```

2. **Enable Rosetta 2 (automatic in Docker Desktop):**
   - Docker Desktop handles x86 emulation automatically

### Windows

#### WSL2 Not Starting

**Problem:** WSL2 fails to start or initialize.

**Solutions:**

1. **Enable WSL2:**

   ```powershell
   # Run as Administrator
   wsl --install
   wsl --set-default-version 2
   ```

2. **Update WSL2:**

   ```powershell
   wsl --update
   ```

3. **Check WSL2 status:**

   ```powershell
   wsl --status
   ```

#### Path Format Issues

**Problem:** Windows paths not working in Docker.

**Solutions:**

1. **Use forward slashes:**

   ```powershell
   docker run -v C:/Users/username/project:/workspace ...
   ```

2. **Use WSL2 paths:**

   ```bash
   # From WSL2
   docker run -v /mnt/c/Users/username/project:/workspace ...
   ```

3. **Convert paths in PowerShell:**

   ```powershell
   $path = (Get-Location).Path -replace '\\', '/'
   docker run -v "${path}:/workspace" ...
   ```

#### Volume Mounting Failures

**Problem:** Volumes fail to mount.

**Solutions:**

1. **Enable file sharing in Docker Desktop:**
   - Settings → Resources → File Sharing
   - Add `C:\Users` or specific project directory

2. **Use WSL2 backend:**
   - Docker Desktop → Settings → General
   - Enable "Use the WSL 2 based engine"

3. **Check path format:**

   ```powershell
   # Correct
   docker run -v C:/Users/username/project:/workspace ...
   
   # Incorrect
   docker run -v C:\Users\username\project:/workspace ...
   ```

#### Permission Issues

**Problem:** Permission denied errors.

**Solutions:**

1. **Run PowerShell as Administrator:**
   - Right-click PowerShell → Run as Administrator

2. **Check file permissions:**

   ```powershell
   icacls C:\Users\username\project
   ```

3. **Grant permissions:**

   ```powershell
   icacls C:\Users\username\project /grant Users:F
   ```

#### Line Ending Problems (CRLF vs LF)

**Problem:** Scripts fail due to line ending differences.

**Solutions:**

1. **Configure Git to use LF:**

   ```bash
   git config --global core.autocrlf false
   ```

2. **Convert files:**

   ```powershell
   # Convert CRLF to LF
   (Get-Content file.sh -Raw) -replace "`r`n", "`n" | Set-Content file.sh -NoNewline
   ```

3. **Use WSL2 for script execution:**

   ```bash
   # From WSL2
   ./script.sh
   ```

### Alpine Linux Specific

#### Missing Dependencies

**Problem:** Native modules fail to build.

**Solution:** Install all required build dependencies:

```bash
apk add --no-cache \
  python3 \
  make \
  g++ \
  pkgconfig \
  cairo-dev \
  pango-dev \
  libjpeg-turbo-dev \
  giflib-dev \
  pixman-dev \
  freetype-dev \
  build-base \
  git
```

#### Configuration Not Found

**Problem:** GuardScan cannot find configuration.

**Solutions:**

1. **Set GUARDSCAN_HOME:**

   ```bash
   export GUARDSCAN_HOME=/tmp/guardscan
   guardscan init
   ```

2. **Enable debug mode:**

   ```bash
   export GUARDSCAN_DEBUG=true
   guardscan init
   ```

3. **Check directory permissions:**

   ```bash
   mkdir -p /tmp/guardscan
   chmod 755 /tmp/guardscan
   ```

### General Troubleshooting

#### Container Exits Immediately

**Problem:** Container starts and exits right away.

**Solutions:**

1. **Check logs:**

   ```bash
   docker logs <container-id>
   ```

2. **Run interactively:**

   ```bash
   docker run -it node:lts-alpine sh
   ```

3. **Check command syntax:**

   ```bash
   docker run --rm node:lts-alpine echo "test"
   ```

#### Slow Performance

**Problem:** Container operations are slow.

**Solutions:**

1. **Increase resources:**
   - Docker Desktop → Settings → Resources
   - Increase CPU and Memory allocation

2. **Use volume caching:**

   ```bash
   docker volume create guardscan-cache
   docker run -v guardscan-cache:/root/.guardscan/cache ...
   ```

3. **Optimize Dockerfile:**
   - Use multi-stage builds
   - Cache npm packages
   - Minimize layers

#### Network Issues

**Problem:** Cannot reach external services.

**Solutions:**

1. **Check DNS:**

   ```bash
   docker run --rm node:lts-alpine nslookup google.com
   ```

2. **Test connectivity:**

   ```bash
   docker run --rm node:lts-alpine ping -c 3 8.8.8.8
   ```

3. **Use host network (Linux only):**

   ```bash
   docker run --network host ...
   ```

---

## Security Considerations

### Container Security

#### Running as Non-Root User

```dockerfile
FROM node:lts-alpine

# Create non-root user
RUN addgroup -g 1000 guardscan && \
    adduser -D -u 1000 -G guardscan guardscan

# Switch to non-root user
USER guardscan

WORKDIR /app
```

#### Read-Only Root Filesystem

```bash
docker run --read-only --tmpfs /tmp \
  -e GUARDSCAN_HOME=/tmp/guardscan \
  node:lts-alpine guardscan security
```

#### Resource Limits

```bash
docker run --memory="512m" --cpus="1.0" \
  node:lts-alpine guardscan security
```

#### Network Isolation

```bash
# Disable network access
docker run --network none node:lts-alpine guardscan security

# Use custom network
docker network create guardscan-net
docker run --network guardscan-net node:lts-alpine guardscan security
```

### Secrets Management

#### Environment Variables (Not Recommended for Secrets)

```bash
# ❌ Don't do this for secrets
docker run -e API_KEY=secret123 node:lts-alpine
```

#### Docker Secrets (Docker Swarm)

```yaml
version: '3.8'
services:
  guardscan:
    image: node:lts-alpine
    secrets:
      - api_key
    environment:
      - API_KEY_FILE=/run/secrets/api_key

secrets:
  api_key:
    external: true
```

#### Bind Mount Secrets (Development Only)

```bash
# Mount secret file
docker run -v ./secrets:/secrets:ro node:lts-alpine
```

### Best Practices

1. **Use minimal base images** - Reduces attack surface
2. **Regular updates** - Keep base images and dependencies updated
3. **Scan for vulnerabilities** - Use `docker scan` or Trivy
4. **Least privilege** - Run as non-root, minimal permissions
5. **No secrets in images** - Use secrets management
6. **Read-only filesystems** - When possible
7. **Resource limits** - Prevent resource exhaustion

---

## Performance Optimization

### Resource Allocation

#### CPU Limits

```bash
# Limit to 2 CPUs
docker run --cpus="2.0" node:lts-alpine guardscan security

# Limit CPU shares (relative)
docker run --cpu-shares=512 node:lts-alpine guardscan security
```

#### Memory Limits

```bash
# Limit to 1GB
docker run --memory="1g" node:lts-alpine guardscan security

# With swap
docker run --memory="1g" --memory-swap="2g" node:lts-alpine guardscan security
```

#### I/O Optimization

```bash
# Limit I/O operations
docker run --device-read-bps /dev/sda:1mb \
  --device-write-bps /dev/sda:1mb \
  node:lts-alpine guardscan security
```

### Caching Strategies

#### Build Cache

```dockerfile
# Order matters - put frequently changing layers last
FROM node:lts-alpine

# Install dependencies first (cached if unchanged)
RUN apk add --no-cache python3 make g++ git

# Install GuardScan (cached if version unchanged)
RUN npm install -g guardscan

# Copy code last (changes frequently)
COPY . /app
```

#### Volume Caching

```bash
# Create cache volume
docker volume create guardscan-npm-cache

# Use cache volume
docker run -v guardscan-npm-cache:/root/.npm \
  node:lts-alpine guardscan security
```

#### Layer Caching

```dockerfile
# Multi-stage build with layer caching
FROM node:lts-alpine AS deps
RUN apk add --no-cache python3 make g++ git
RUN npm install -g guardscan

FROM deps AS runtime
WORKDIR /app
COPY . .
```

---

## Advanced Scenarios

### Kubernetes Deployment

#### Basic Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: guardscan
spec:
  replicas: 1
  selector:
    matchLabels:
      app: guardscan
  template:
    metadata:
      labels:
        app: guardscan
    spec:
      containers:
      - name: guardscan
        image: node:lts-alpine
        command: ["sh", "-c"]
        args:
          - |
            apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
            libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
            npm install -g guardscan &&
            guardscan security
        env:
        - name: GUARDSCAN_HOME
          value: "/tmp/guardscan"
        volumeMounts:
        - name: workspace
          mountPath: /workspace
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
      volumes:
      - name: workspace
        emptyDir: {}
```

#### ConfigMap for Configuration

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: guardscan-config
data:
  GUARDSCAN_HOME: "/tmp/guardscan"
  GUARDSCAN_DEBUG: "false"
```

#### Secret for API Keys

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: guardscan-secrets
type: Opaque
stringData:
  api-key: "your-api-key-here"
```

### Docker Swarm

#### Stack File

```yaml
version: '3.8'

services:
  guardscan:
    image: node:lts-alpine
    environment:
      - GUARDSCAN_HOME=/tmp/guardscan
    volumes:
      - workspace:/workspace
    command: sh -c "
      apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev
      libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git &&
      npm install -g guardscan &&
      guardscan security
    "
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M

volumes:
  workspace:
```

Deploy:

```bash
docker stack deploy -c docker-compose.yml guardscan
```

### Cloud Container Services

#### AWS ECS

```json
{
  "family": "guardscan",
  "containerDefinitions": [
    {
      "name": "guardscan",
      "image": "node:lts-alpine",
      "environment": [
        {
          "name": "GUARDSCAN_HOME",
          "value": "/tmp/guardscan"
        }
      ],
      "command": [
        "sh", "-c",
        "apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan security"
      ],
      "memory": 1024,
      "cpu": 1024
    }
  ]
}
```

#### Azure Container Instances

```yaml
apiVersion: 2018-10-01
location: eastus
name: guardscan
properties:
  containers:
  - name: guardscan
    properties:
      image: node:lts-alpine
      environmentVariables:
      - name: GUARDSCAN_HOME
        value: /tmp/guardscan
      command:
      - sh
      - -c
      - apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan security
      resources:
        requests:
          cpu: 1
          memoryInGb: 1
  osType: Linux
  restartPolicy: Never
```

#### Google Cloud Run

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: guardscan
spec:
  template:
    spec:
      containers:
      - image: node:lts-alpine
        env:
        - name: GUARDSCAN_HOME
          value: /tmp/guardscan
        command:
        - sh
        - -c
        - apk add --no-cache python3 make g++ pkgconfig cairo-dev pango-dev libjpeg-turbo-dev giflib-dev pixman-dev freetype-dev build-base git && npm install -g guardscan && guardscan security
        resources:
          limits:
            cpu: "1"
            memory: 1Gi
```

---

## Additional Resources

- [Main README](../README.md)
- [Getting Started Guide](GETTING_STARTED.md)
- [Alpine Linux Quick Reference](../DOCKER_ALPINE_GUIDE.md)
- [Issue #25 - Alpine Linux Fix](https://github.com/ntanwir10/GuardScan/issues/25)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)

---

## Getting Help

If you're still experiencing issues:

1. **Enable debug mode:**

   ```bash
   GUARDSCAN_DEBUG=true guardscan init 2>&1 | tee debug.log
   ```

2. **Check home directory:**

   ```bash
   node -e "console.log(require('os').homedir())"
   ```

3. **Verify write permissions:**

   ```bash
   mkdir -p ~/.guardscan && echo "test" > ~/.guardscan/test.txt
   ```

4. **Open an issue:** [GitHub Issues](https://github.com/ntanwir10/GuardScan/issues)
   - Include the debug log
   - Mention your OS and Docker version
   - Include your Dockerfile or docker-compose.yml if relevant
   - Describe the exact error message

---

**Last Updated:** 2025-01-27
