# College Event Registration Management System (CERMS)

A production-ready, full-stack **Node.js (TypeScript) + Supabase PostgreSQL + Google Gemini AI + Progressive Web App (PWA)** for managing college events, student enrollment, duplicate-prevention registrations, universal search, verifiable administrative reports, and institutional analytics.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│                   Client Tier                          │
│  - Responsive Desktop & Mobile Single-Page App (SPA)   │
│  - PWA: Service Worker (sw.js) & Manifest              │
│  - Supabase Realtime Client & Live SSE Fallback        │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / WebSocket / SSE
┌──────────────────────────▼─────────────────────────────┐
│                 Application Server                     │
│  - Express 5 REST API & Static Asset Hosting           │
│  - PBKDF2 HMAC-SHA256 Authentication & Sessions        │
│  - Realtime Event Bus & Server-Sent Events (SSE)       │
│  - Google Gemini AI Management Analysis Service        │
└──────────────┬──────────────────────────┬──────────────┘
               │ PostgreSQL Wire          │ Gemini API
┌──────────────▼─────────────┐ ┌──────────▼──────────────┐
│    Supabase PostgreSQL    │ │     Google Gemini AI     │
│  - Events, Students, Regs  │ │  - Executive Summaries   │
│  - Realtime Publications   │ │  - Capacity Risk Engine  │
└────────────────────────────┘ └─────────────────────────┘
```

---

## Tech Stack

- **Runtime & Language**: Node.js 20+ / 22+ (TypeScript, compiled via esbuild)
- **Application Server**: Express 5 with CORS, security headers (`nosniff`, `strict-origin`), and graceful shutdown
- **Database**: Supabase PostgreSQL (with automatic schema bootstrap and local in-memory development fallback)
- **Live Sync**: Supabase Realtime WebSocket channel with automatic fallback to built-in Server-Sent Events (SSE)
- **Artificial Intelligence**: Google Gemini 3.8 / 3.1 Flash (`@google/genai`) for real-time institutional event analytics
- **Frontend & PWA**: Semantic HTML5, Vanilla JavaScript, Responsive CSS3 design system, Web App Manifest, and Service Worker offline caching strategy

---

## Production Readiness Features

- **PWA Ready**: Installable on Android, iOS, Windows, macOS, and Linux with standalone display mode and custom icons.
- **Offline Resilient**: Service worker caches core application shell and read-only API requests; status indicator alerts user when offline.
- **Dynamic Port Binding**: Honors `process.env.PORT` with fallback to port 3000 for standard container environments (Cloud Run, Render, Railway).
- **Graceful Shutdown**: Intercepts `SIGTERM` and `SIGINT` to safely disconnect active SSE clients and database channels during rolling zero-downtime deploys.
- **Containerized**: Includes multi-stage production `Dockerfile` with non-root user execution, Alpine base, and automated health checks.
- **Zero Exposed Secrets**: Clean separation between server environment variables and client frontend assets.

---

## Environment Variables

Copy `.env.example` to `.env` in production:

```bash
cp .env.example .env
```

| Variable | Required | Description |
|---|---|---|
| `PORT` | Optional | Application listening port (default: `3000`) |
| `NODE_ENV` | Optional | Server environment (`production` or `development`) |
| `SUPABASE_URL` | Recommended | Remote Supabase project URL (e.g. `https://xyz.supabase.co`) |
| `SUPABASE_ANON_KEY` | Recommended | Supabase public/publishable API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Supabase service-role key for backend operations |
| `GEMINI_API_KEY` | Optional | Google Gemini API key for `/api/ai/analyze` assistant |

*Note: If `SUPABASE_URL` is omitted, the application operates in resilient local in-memory fallback mode.*

---

## Local Development & Build

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode (with Live Reload)
```bash
npm run dev
```
The server will start at `http://localhost:3000`.

### 3. Production Build
```bash
npm run build
```
This produces an optimized, standalone CommonJS bundle at `dist/server.cjs`.

### 4. Production Start
```bash
npm start
```

### 5. Run Verification Test Suite
```bash
bun ./tests/test_e2e_ai.ts
```

---

## Production Deployment Guides

### Option 1: Docker / Container Platforms (Recommended)

Build and run using Docker:

```bash
# Build production image
docker build -t college-event-portal:latest .

# Run container with environment configuration
docker run -d \
  --name college-event-portal \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  college-event-portal:latest
```

Using Docker Compose:

```bash
docker compose up -d
```

### Option 2: Google Cloud Run

1. Connect your GitHub repository to Cloud Build or push container image:
   ```bash
   gcloud run deploy college-event-portal \
     --source . \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --set-env-vars SUPABASE_URL="https://your-id.supabase.co",SUPABASE_ANON_KEY="your-anon-key",GEMINI_API_KEY="your-gemini-key"
   ```
2. Cloud Run automatically assigns HTTPS and injects `PORT=8080`.

### Option 3: Render / Railway / PaaS

1. Create a new **Web Service** and connect repository `https://github.com/Deveesh-07/p.git`.
2. Configure settings:
   - **Environment**: Node
   - **Build Command**: `npm ci && npm run build`
   - **Start Command**: `npm start`
3. In the **Environment Variables** tab, define:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`
4. Deploy service.

---

## Default Credentials

The system seeds an initial administrative account for authorized access:

- **Username**: `admin`
- **Password**: `admin123`

*Administrators can update or add credentials directly via database records.*

---

## License

MIT License. Designed and maintained for institutional college event management.
