# ═══════════════════════════════════════════════════════════════════
# TalentIQ - Single Dockerfile for Northflank deployment
# Stage 1: Build React frontend
# Stage 2: Python backend + serve built frontend via FastAPI static
# ═══════════════════════════════════════════════════════════════════

# ── Stage 1: Build frontend ──────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install --no-fund --no-audit

COPY frontend/ ./
RUN npm run build
# Output: /app/frontend/dist


# ── Stage 2: Production image ────────────────────────────────────
FROM python:3.11-slim

# System deps for Playwright + PDF libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl wget gnupg ca-certificates \
    libglib2.0-0 libnss3 libnspr4 libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 \
    libpangocairo-1.0-0 libpango-1.0-0 libcairo2 \
    libatspi2.0-0 libx11-6 libxcb1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./
# ── CPU-only torch, installed BEFORE requirements.txt ──────────────
# sentence-transformers (in requirements.txt, for utils/embeddings.py's
# local semantic-matching model) depends on torch. Without this step,
# pip installs torch's DEFAULT PyPI wheel, which bundles full CUDA/GPU
# support — confirmed while building this feature: that wheel is over
# 1.2GB, vs. ~200-300MB for the official CPU-only build, for a feature
# explicitly designed to run on CPU with no GPU involved at all. Installing
# the CPU wheel FIRST satisfies sentence-transformers' torch dependency
# before `pip install -r requirements.txt` runs, so pip does not pull in
# the much larger GPU build afterward.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

# Pre-download the local CPU embedding model (utils/embeddings.py,
# all-MiniLM-L6-v2 — used for semantic skill matching + taxonomy search)
# at BUILD time rather than on first use at runtime. Without this, the
# first real request that needs it would try to fetch the model weights
# from huggingface.co on the fly — which may be slow, or fail entirely if
# the runtime environment's egress is more restricted than the build
# environment's. `|| true` means a failed/offline download here doesn't
# break the image build; the app still runs fine without it, just with
# that one feature falling back to its TF-IDF tier (see
# utils/semantic_match.py) until the model becomes available.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')" || true

# Install Playwright browsers
RUN playwright install chromium --with-deps || true

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend into backend/static so FastAPI can serve it
COPY --from=frontend-build /app/frontend/dist ./backend/static/

# Copy data directory (LinkedIn session, location.json)
COPY backend/data/ ./backend/data/

# Update main.py to serve frontend static files
WORKDIR /app/backend

# Environment defaults (override in Northflank)
ENV PORT=8000 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
