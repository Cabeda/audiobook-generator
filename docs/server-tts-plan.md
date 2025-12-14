# Server-Side TTS Plan

## Goals

- Add FastAPI backend for server-side TTS, supporting both self-hosted models (Kokoro/Piper) and external APIs (start with Chatterbox, then optionally OpenAI/ElevenLabs).
- Introduce authentication (JWT with refresh) to gate models that have third-party costs or require server resources.
- Keep existing client-side TTS as an option; add UI toggle and model list with capabilities and cost hints (informational only, no billing yet).

## Milestones & Issues

### 1) Backend Scaffold (FastAPI)

- Create `backend/` with `main.py`, `api/`, `services/`, `auth/`, `models/`, `config/`.
- Add health check, CORS, logging, settings (env-driven), dependency wiring.

### 2) Authentication & Security

- JWT auth (access + refresh), password hashing.
- Endpoints: `POST /api/auth/login`, `POST /api/auth/register` (if needed), `POST /api/auth/refresh`, `GET /api/auth/me`.
- Middleware: auth enforcement, rate limiting on auth routes.
- Configurable user store (in-memory/SQLite for start).

### 3) TTS API Surface

- Endpoints:
  - `POST /api/tts/generate` → returns audio; accepts `model_id` (`server:koko`, `server:piper`, `external:chatterbox`, `external:openai`, `external:elevenlabs`, etc.), text, voice, speed, pitch, format.
  - `POST /api/tts/generate-segments` → optional; returns segments + timings.
  - `GET /api/tts/models` → list models with capabilities (format, max chars, cost hint, provider, locale).
  - `GET /api/tts/voices` → list voices per model.
- Progress: SSE endpoint (`/api/tts/generate/stream`) emitting `progress` / `chunk-progress` / `complete` / `error`; fallback polling.

### 4) TTS Providers (Backend Services)

- Local hosting: `services/tts_local.py`
  - Load Kokoro/Piper server-side; model registry; on-demand load with caching; device selection (CPU/GPU).
  - Text chunking, concatenation, optional format encoding.
- External APIs: `services/tts_external.py`
  - Adapters for Chatterbox (first target), then OpenAI/ElevenLabs; retry/backoff; map provider errors; capability metadata per call.
- Registry maps `model_id -> provider -> handler` with capability metadata.

### 5) Frontend Auth & Client

- New `authStore` (persisted) for tokens + refresh flow.
- UI for login/logout; handle 401/403 and token refresh.
- HTTP client attaches `Authorization` header; SSE client handles token expiration gracefully.

### 6) Frontend TTS Engine: Server

- Add `server` engine type to `ttsModels.ts` and `serverTtsClient.ts` that calls FastAPI.
- Mirror worker-style callbacks: progress, chunk-progress, complete, error.
- SSE for progress; polling fallback.

### 7) UI Integration

- Update generation panel/controls to offer engine selection: Local (existing), Server-hosted, External API.
- Show model list with capability/cost badges sourced from `/api/tts/models`.

### 8) Testing

- Backend: unit tests for auth and provider adapters; integration tests for `/api/tts/generate` with short text; mock external APIs.
- Frontend: update e2e to cover server TTS flow with auth; keep local TTS tests.

### 9) Deployment & Ops

- Env vars for API keys, model paths, device preference, rate limits.
- Serverless notes: prefer external models or small on-demand loads; ensure SSE-compatible hosting; handle timeouts.
- Server notes: preload models on GPU if available; background warmup.

## Open Decisions

1. Path first?
   - A: External API first (Chatterbox) for fast delivery.
   - B: Self-host first (Kokoro/Piper) for more control and offline capability.
2. Next external provider after Chatterbox (OpenAI vs ElevenLabs) if needed.

## Recommended Implementation Order

1. Backend scaffold + auth
2. External API adapter (Chatterbox) + `/api/tts/generate` + SSE
3. Frontend auth store + server engine + UI toggle
4. Local model hosting (Kokoro/Piper) with registry
5. Add more external providers (OpenAI/ElevenLabs) as needed

## Acceptance Checks

- Can log in, select server/external model, generate audio, see progress, and receive file.
- Model list shows provider, format, locale, and cost hints (informational only).
- External provider errors surface clearly; retries applied where safe.
- Local and external flows coexist; local remains functional offline.
