# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:24-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output lands at ../backend/static (relative to frontend/) = /app/backend/static


# ── Stage 2: Python runtime ────────────────────────────────────────────────────
FROM python:3.11-slim

# System tools used by the app:
#   openocd  – flash/debug firmware
#   nmap     – network scanner (network_tools.py falls back to ping/arp without it)
#   iputils-ping, net-tools – fallback ping sweep + arp
RUN apt-get update && apt-get install -y --no-install-recommends \
        openocd \
        nmap \
        iputils-ping \
        net-tools \
        iproute2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY backend/ backend/
COPY version.json .

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/backend/static/ backend/static/

# Config directory – mount a host volume here to persist remotes & scripts
COPY config/ config/

EXPOSE 8000

CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
