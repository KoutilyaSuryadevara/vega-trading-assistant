# ⬡ VEGA

```
    ▲
   ▲ ▲
  ▲   ▲
 ▲▲▲▲▲▲▲
   VEGA
```

**Voice-Enabled Guidance Agent** — AI-powered command center for intelligent trading oversight.

VEGA is a standalone AI assistant that connects to your trading bot and gives you a natural-language interface to monitor, analyze, and control your trading operations. Ask questions in plain English, get data-driven answers, and optionally execute commands with built-in approval flows and a full audit trail.

---

## Features

- **AI Chat Interface** — Ask anything about your portfolio in natural language
- **Voice Input** — Browser-native Web Speech API (no external service)
- **Trading Dashboard** — Real-time status cards for trading, Alpaca, and ML training
- **Predictions Panel** — Top buy/sell/hold signals with confidence scores
- **Command Execution** — Pause trading, add symbols, trigger training, and more
- **Safety Modes** — `readonly` (default), `approval_required`, `autonomous`
- **Audit Trail** — Every interaction and command logged to SQLite
- **Emergency Stop** — Always available regardless of mode

---

## Quick Start

```bash
git clone https://github.com/YOUR_ORG/vega-trading-assistant.git
cd vega-trading-assistant
cp .env.example .env
# Edit .env — fill in ANTHROPIC_API_KEY and TRADING_API_BASE_URL
docker-compose up --build
```

Open **http://localhost** in your browser.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      User Browser                        │
│              (React SPA — Port 80 via nginx)             │
└────────────────────────┬────────────────────────────────┘
                         │ /api/*
         ┌───────────────▼───────────────┐
         │   VEGA Backend (Node/Express) │
         │         Port 3001             │
         │  ┌──────────┐ ┌───────────┐  │
         │  │ Anthropic │ │ Audit DB  │  │
         │  │ Claude AI │ │ (SQLite)  │  │
         │  └──────────┘ └───────────┘  │
         └───────────────┬───────────────┘
                         │ REST API
         ┌───────────────▼───────────────┐
         │    Trading Bot API (EC2)       │
         │  /api/status  /api/watchlist  │
         │  /api/predictions  /api/orders │
         └───────────────────────────────┘
```

**Production (AWS):**
- Frontend → S3 + CloudFront (free tier friendly)
- Backend → AWS App Runner (serverless containers, ~$1-5/month)
- Secrets → AWS SSM Parameter Store

---

## API Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/health` | GET | Service health + dependency status |
| `/api/ai/context` | GET | Full trading context (cached 30s) |
| `/api/ai/chat` | POST | Send message, receive AI response |
| `/api/ai/command` | POST | Execute trading command |

See [`shared/openapi.yaml`](shared/openapi.yaml) for full schema.

---

## Commands Reference

| Command | Trigger phrases | Risk |
|---------|----------------|------|
| `pause_trading` | "pause trading", "stop trading" | High |
| `resume_trading` | "resume trading", "unpause" | High |
| `emergency_stop` | "emergency stop", "halt all trading" | Critical |
| `add_symbol` | "add AAPL to watchlist" | Low |
| `remove_symbol` | "remove TSLA from watchlist" | Low |
| `refresh_predictions` | "refresh predictions", "update signals" | Low |
| `start_training` | "start training" | Medium |
| `stop_training` | "stop training" | Medium |
| `show_alpaca_status` | "show Alpaca status" | Low |
| `show_training_progress` | "show training progress" | Low |

---

## Safety Modes

| Mode | Description | Commands |
|------|-------------|----------|
| `readonly` | Read-only. VEGA answers questions only. | ✗ None |
| `approval_required` | Commands suggested, user must approve each. | ✓ With approval |
| `autonomous` | Commands execute directly (requires `ENABLE_TRADE_COMMANDS=true`). | ✓ Direct |

**Default is `readonly`**. Emergency stop is always available regardless of mode.

---

## Local Development

### Backend
```bash
cd backend
npm install
cp ../.env.example ../.env
# Edit .env with your keys
npm run dev
# → http://localhost:3001
```

### Frontend
```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173 (proxies /api to :3001)
```

### Docker Compose
```bash
cp .env.example .env  # fill in values
docker-compose up --build
# → http://localhost
```

---

## Deployment

See [docs/setup.md](docs/setup.md) for full deployment instructions including:
- AWS App Runner + S3/CloudFront deployment
- GitHub Actions CI/CD setup
- Required GitHub Secrets
- SSM Parameter Store configuration

Infrastructure is managed in the [tradingbot-infra](../tradingbot-infra) repository under `interactive-ai-agent/`.

---

## Security

- API keys are never returned in API responses
- Alpaca credentials are never logged or exposed
- All command executions are audited
- Trade-affecting commands require explicit approval
- Emergency stop bypasses all mode restrictions
- Secrets managed via AWS SSM Parameter Store in production

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite |
| Backend | Node.js, Express, TypeScript |
| AI | Anthropic Claude (claude-sonnet-4-6) |
| Audit | SQLite via better-sqlite3 |
| Voice | Web Speech API (browser-native) |
| Infra | AWS App Runner + S3 + CloudFront |
| IaC | Terraform (in tradingbot-infra) |
| CI/CD | GitHub Actions |
