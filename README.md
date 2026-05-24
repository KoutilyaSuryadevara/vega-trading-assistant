# ⬡ VEGA — Voice-Enabled Guidance Agent

<div align="center">

[![CI](https://github.com/KoutilyaSuryadevara/vega-trading-assistant/actions/workflows/ci.yml/badge.svg)](https://github.com/KoutilyaSuryadevara/vega-trading-assistant/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Claude AI](https://img.shields.io/badge/Claude-Sonnet--4.6-191919?logo=anthropic&logoColor=white)](https://www.anthropic.com/)
[![AWS](https://img.shields.io/badge/AWS-App_Runner_+_S3-FF9900?logo=amazonaws&logoColor=white)](https://aws.amazon.com/)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)

**AI-powered command center for intelligent trading oversight.**

*Ask questions in plain English. Monitor, analyze, and control your trading platform with voice and natural language.*

</div>

---

## 🎯 What is VEGA?

VEGA is a standalone AI assistant that connects to your trading bot and gives you a natural-language interface to monitor, analyze, and control your trading operations. Ask questions in plain English, get data-driven answers, and optionally execute commands with built-in approval flows and a full audit trail.

**VEGA is the control plane for your trading infrastructure** — not a trading bot itself, but the intelligent layer that sits on top of one.

---

## ✨ Features

| Feature | Description |
|---|---|
| 🤖 **AI Chat Interface** | Ask anything about your portfolio in natural language using Claude Sonnet |
| 🎙️ **Voice Input** | Browser-native Web Speech API (no external service required) |
| 📊 **Trading Dashboard** | Real-time status cards for trading engine, Alpaca broker, and ML training |
| 🎯 **Predictions Panel** | Top buy/sell/hold signals with confidence scores and reasoning |
| ⚡ **Command Execution** | Pause trading, add symbols, trigger training, and more via natural language |
| 🛡️ **Safety Modes** | `readonly` (default) → `approval_required` → `autonomous` |
| 📋 **Audit Trail** | Every interaction and command logged to SQLite with full context |
| 🚨 **Emergency Stop** | Always available regardless of safety mode |

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        User Browser                           │
│             React SPA (TypeScript + Vite)                     │
│          Voice Input │ Chat UI │ Dashboard │ Signals           │
└──────────────────────┬───────────────────────────────────────┘
                       │  HTTP/REST  (/api/*)
         ┌─────────────▼──────────────┐
         │   VEGA Backend (Node/Express)│
         │         Port 3001            │
         │                              │
         │  ┌────────────────────────┐  │
         │  │  Anthropic Claude AI   │  │
         │  │  (claude-sonnet-4-6)   │  │
         │  └────────────────────────┘  │
         │                              │
         │  ┌────────────────────────┐  │
         │  │    Audit DB (SQLite)   │  │
         │  │  All commands logged   │  │
         │  └────────────────────────┘  │
         └──────────────┬───────────────┘
                        │  REST API calls
         ┌──────────────▼───────────────┐
         │      Trading Bot API (EC2)    │
         │  /api/status  /api/watchlist  │
         │  /api/predictions  /api/orders│
         └───────────────────────────────┘
```

### Production Deployment (AWS)

```
Browser → CloudFront CDN → S3 (React SPA)
                              ↓
              VEGA Backend → AWS App Runner (serverless containers)
                              ↓
              Secrets → AWS SSM Parameter Store
```

**Infrastructure managed in [tradingbot-infra](https://github.com/KoutilyaSuryadevara/tradingbot-infra) under `interactive-ai-agent/`.**

---

## 🚀 Quick Start

### Docker Compose (Recommended)

```bash
git clone https://github.com/KoutilyaSuryadevara/vega-trading-assistant.git
cd vega-trading-assistant

# Configure environment
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY and TRADING_API_BASE_URL

# Start all services
docker-compose up --build
```

Open **http://localhost** in your browser.

### Local Development

```bash
# Backend
cd backend
npm install
cp ../.env.example ../.env  # fill in values
npm run dev
# → http://localhost:3001

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
# → http://localhost:5173 (proxies /api → :3001)
```

---

## 🔐 Safety & Security

VEGA has a tiered safety model to prevent accidental trade execution:

| Mode | Description | Commands |
|---|---|---|
| `readonly` | Default. VEGA answers questions only — no execution. | ✗ None |
| `approval_required` | Commands are suggested; user must confirm each one. | ✓ With approval |
| `autonomous` | Commands execute directly (requires `ENABLE_TRADE_COMMANDS=true`). | ✓ Direct |

**Emergency stop is always available regardless of mode.**

Additional security measures:
- API keys are never returned in API responses
- Alpaca credentials are never logged or exposed
- All command executions are persisted in the audit log
- Secrets managed via AWS SSM Parameter Store in production
- IMDSv2 enforcement on EC2 (blocks SSRF credential theft)

---

## 📡 API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/ai/health` | GET | Service health + dependency status |
| `/api/ai/context` | GET | Full trading context (cached 30s) |
| `/api/ai/chat` | POST | Send message, receive AI response |
| `/api/ai/command` | POST | Execute a trading command |

See `shared/openapi.yaml` for the full schema.

---

## ⚙️ Commands Reference

| Command | Trigger Phrases | Risk Level |
|---|---|---|
| `pause_trading` | "pause trading", "stop trading" | 🟠 High |
| `resume_trading` | "resume trading", "unpause" | 🟠 High |
| `emergency_stop` | "emergency stop", "halt all trading" | 🔴 Critical |
| `add_symbol` | "add AAPL to watchlist" | 🟢 Low |
| `remove_symbol` | "remove TSLA from watchlist" | 🟢 Low |
| `refresh_predictions` | "refresh predictions", "update signals" | 🟢 Low |
| `start_training` | "start training" | 🟡 Medium |
| `stop_training` | "stop training" | 🟡 Medium |
| `show_alpaca_status` | "show Alpaca status" | 🟢 Low |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, Web Speech API |
| **Backend** | Node.js, Express, TypeScript |
| **AI Engine** | Anthropic Claude (claude-sonnet-4-6) |
| **Audit Store** | SQLite via better-sqlite3 |
| **Voice** | Browser-native Web Speech API |
| **Infrastructure** | AWS App Runner + S3 + CloudFront |
| **IaC** | Terraform (in tradingbot-infra) |
| **CI/CD** | GitHub Actions with OIDC auth |

---

## 📦 Deployment

See [docs/setup.md](./docs/setup.md) for full deployment instructions including:

- AWS App Runner + S3/CloudFront setup
- GitHub Actions CI/CD configuration
- Required GitHub Secrets
- SSM Parameter Store configuration

---

## 📄 License

MIT — see [LICENSE](./LICENSE) for details.

---

<div align="center">

*Part of the [AlphaBot](https://github.com/KoutilyaSuryadevara/tradingbot-infra) ecosystem — a fully automated trading platform built with production-grade AWS infrastructure.*

**[Docs](./docs/setup.md) · [API Schema](./shared/openapi.yaml) · [Infrastructure](https://github.com/KoutilyaSuryadevara/tradingbot-infra)**

</div>
