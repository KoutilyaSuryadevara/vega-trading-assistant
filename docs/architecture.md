# VEGA Architecture

## Overview

VEGA (Voice-Enabled Guidance Agent) is a **standalone service** that wraps your trading bot's REST API with an AI-powered natural language interface. It is deliberately decoupled from the trading bot — it communicates only via approved REST API endpoints and never accesses the database directly.

## Component Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         AWS (Production)                          │
│                                                                  │
│  ┌──────────────┐    HTTPS     ┌──────────────────────────────┐  │
│  │  CloudFront  │◄────────────►│   S3 Bucket                  │  │
│  │  Distribution│              │   (React SPA static files)   │  │
│  │              │              └──────────────────────────────┘  │
│  │  /api/* ────►│──────────────►┌─────────────────────────────┐  │
│  └──────────────┘              │   AWS App Runner              │  │
│                                │   VEGA Backend (Node.js)      │  │
│                                │   Port 3001                   │  │
│                                │                               │  │
│                                │  ┌───────────┐ ┌──────────┐  │  │
│                                │  │ Anthropic │ │ SQLite   │  │  │
│                                │  │ API       │ │ Audit DB │  │  │
│                                │  └───────────┘ └──────────┘  │  │
│                                └────────────┬────────────────┘  │
│                                             │ REST API           │
│                                ┌────────────▼────────────────┐  │
│                                │  Trading Bot EC2 (t3.micro)  │  │
│                                │  Docker Compose              │  │
│                                │  /api/status /api/watchlist  │  │
│                                │  /api/predictions /api/orders│  │
│                                └─────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │   AWS SSM Parameter Store                                 │   │
│  │   /vega/prod/trading_api_token (SecureString)            │   │
│  │   /vega/prod/jwt_secret (SecureString)                   │   │
│  │   /tradingbot/prod/anthropic_api_key (SecureString)      │   │
│  └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

## Data Flow: Chat Message

```
1. User types or speaks a message in the browser
2. React frontend sends POST /api/ai/chat → CloudFront → App Runner
3. Backend checks context cache (30s TTL), fetches from trading bot if stale
4. Backend calls Anthropic Claude API with system prompt + trading context
5. Claude generates response; backend detects any command intent
6. Response returned to frontend (message + suggestions + optional pendingAction)
7. Audit log entry written to SQLite
8. Frontend displays response; if pendingAction, shows approval modal
```

## Data Flow: Command Execution

```
1. User approves a pending action in the frontend
2. Frontend sends POST /api/ai/command { command, params, approved: true }
3. Backend checks mode: readonly → reject, approval_required → verify approved=true
4. Backend checks ENABLE_TRADE_COMMANDS for write commands
5. Backend calls trading bot REST API (e.g., POST /api/trading/pause)
6. Trading bot executes the action
7. Result returned to backend, audit logged, response sent to frontend
8. Frontend shows success/failure, adds to command history
```

## AWS Services

| Service | Purpose | Est. Cost |
|---------|---------|-----------|
| **App Runner** | Serverless container for backend | ~$1-5/month |
| **S3** | Static frontend hosting | ~$0.01/month |
| **CloudFront** | CDN + API proxy + HTTPS | ~$0 (free tier) |
| **ECR** | Docker image registry | ~$0 (500MB free) |
| **SSM** | Secrets management | ~$0 (10K req free) |
| **CloudWatch** | Logs | ~$0.50/GB |

## Why App Runner?

App Runner was chosen because:
1. **Zero infra management** — no EC2, no ECS task definitions, no ALB
2. **Auto-HTTPS** — certificates managed automatically
3. **Scale to near-zero** — pauses when idle, charged only for active requests
4. **ECR integration** — pulls directly from your private ECR repository
5. **IAM instance roles** — secure SSM access without storing credentials

## Security Boundaries

```
Browser ──[HTTPS]──► CloudFront ──[HTTPS]──► App Runner
                                                  │
                                    [Bearer token]│
                                                  ▼
                                           Trading Bot API
                                     (token stored in SSM,
                                      never in code/env files)
```

- VEGA backend never has direct database access
- Broker API keys (Alpaca) are stored only in the trading bot's SSM parameters
- VEGA only receives data that the trading bot explicitly exposes
- All command executions are audited with timestamp, mode, and approval status

## Local Development Architecture

```
Browser :5173 ──[Vite proxy]──► Backend :3001 ──► Trading Bot :8000
                                     │
                                     ▼
                              Anthropic API
                                     │
                              SQLite ./data/audit.db
```
