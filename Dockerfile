# =============================================================================
# Oculo — Headless Docker Image
# Self-hosted AI browser service (Browserbase alternative)
#
# Build:  docker build -t oculo .
# Run:    docker run -p 19516:19516 oculo
# =============================================================================

# ---------------------------------------------------------------------------
# Stage 1: Build
# ---------------------------------------------------------------------------
FROM node:20-bookworm AS builder

WORKDIR /app

# Copy package files first for better layer caching
COPY package.json package-lock.json ./

# Install ALL dependencies (need devDeps for build)
RUN npm ci

# Copy source
COPY . .

# Build the Electron app (electron-vite build → out/)
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Runtime
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

# Electron system dependencies (Debian 12 / Bookworm)
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Virtual display
    xvfb \
    # D-Bus (required for Electron IPC)
    dbus dbus-x11 \
    # GTK / windowing
    libgtk-3-0 \
    libgbm1 \
    libdrm2 \
    # Accessibility
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    # Security / crypto
    libnss3 \
    libnspr4 \
    # Audio (Electron requires it even headless)
    libasound2 \
    # Fonts
    fonts-liberation \
    fonts-noto-cjk \
    # X11
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxkbcommon0 \
    libpango-1.0-0 \
    libcairo2 \
    libcups2 \
    # Misc
    libxshmfence1 \
    libxext6 \
    libxss1 \
    # Health check
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -r oculo && useradd -r -g oculo -m -s /bin/bash oculo

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output from builder stage
COPY --from=builder /app/out ./out

# Copy runtime files
COPY bin/ ./bin/
COPY resources/ ./resources/

# Electron needs a writable home directory
RUN mkdir -p /home/oculo/.config/oculo && \
    chown -R oculo:oculo /app /home/oculo

# Switch to non-root user
USER oculo

# Environment
ENV OCULO_HEADLESS=1 \
    DISPLAY=:99 \
    ELECTRON_DISABLE_GPU=1 \
    DBUS_SESSION_BUS_ADDRESS=autolaunch: \
    NODE_ENV=production

# MCP server port
EXPOSE 19516

# Health check — hit the MCP server's /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:19516/health || exit 1

# Launch with xvfb (virtual framebuffer) — Electron needs a display even headless
# Screen: 1920x1080, 24-bit color depth
# --no-sandbox is required when running in containers (user namespaces unavailable)
ENTRYPOINT ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24"]
CMD ["node", "bin/oculo-headless.mjs", "--no-sandbox"]
