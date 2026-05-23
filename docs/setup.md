# VEGA Setup Guide

## Prerequisites

- Node.js 20+
- Docker + Docker Compose
- Anthropic API key (`sk-ant-...`)
- Your trading bot running and accessible
- AWS CLI configured (for production deployment)
- Terraform 1.6+ (for infrastructure)
- GitHub CLI `gh` (optional, for repo setup)

---

## Local Development

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_ORG/vega-trading-assistant.git
cd vega-trading-assistant
cp .env.example .env
```

Edit `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
TRADING_API_BASE_URL=http://localhost:8000   # your trading bot URL
TRADING_API_TOKEN=your-trading-api-token
AI_ASSISTANT_MODE=readonly
ENABLE_TRADE_COMMANDS=false
```

### 2. Run backend

```bash
cd backend
npm install
npm run dev
# API available at http://localhost:3001
# Health check: curl http://localhost:3001/api/ai/health
```

### 3. Run frontend

```bash
cd frontend
npm install
npm run dev
# UI available at http://localhost:5173
```

### 4. Or use Docker Compose

```bash
# From repo root
docker-compose up --build
# UI at http://localhost
# API at http://localhost:3001
```

---

## Production Deployment on AWS

### Step 1: Deploy infrastructure

The infrastructure is in the `tradingbot-infra` repo under `interactive-ai-agent/`.

```bash
cd ../tradingbot-infra/interactive-ai-agent

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Set trading_api_base_url to your EC2's public IP or domain

terraform init
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
```

Save the outputs:
```bash
terraform output -json
```

### Step 2: Update SSM secrets with real values

```bash
# Set Anthropic API key (if not already set by the trading bot infra)
aws ssm put-parameter \
  --name "/tradingbot/prod/anthropic_api_key" \
  --type SecureString \
  --value "sk-ant-your-actual-key" \
  --overwrite

# Set trading API token (the token VEGA uses to call your trading bot)
aws ssm put-parameter \
  --name "/vega/prod/trading_api_token" \
  --type SecureString \
  --value "your-trading-bot-api-token" \
  --overwrite

# Set JWT secret
aws ssm put-parameter \
  --name "/vega/prod/jwt_secret" \
  --type SecureString \
  --value "$(openssl rand -base64 32)" \
  --overwrite
```

### Step 3: Push first Docker image to ECR

```bash
# Get ECR URI from Terraform output
ECR_URI=$(cd ../tradingbot-infra/interactive-ai-agent && terraform output -raw vega_ecr_repository_url)
AWS_REGION=us-east-1

# Authenticate
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_URI

# Build and push
cd vega-trading-assistant/backend
docker build -t $ECR_URI:latest .
docker push $ECR_URI:latest
```

### Step 4: Configure GitHub Secrets

In your GitHub repository → Settings → Secrets → Actions, add:

| Secret | Value (from `terraform output`) |
|--------|--------------------------------|
| `AWS_DEPLOY_ROLE_VEGA` | `github_deploy_role_arn` output |
| `VEGA_ECR_URI` | `vega_ecr_repository_url` output |
| `VEGA_APP_RUNNER_ARN` | `vega_app_runner_arn` output |
| `VEGA_FRONTEND_BUCKET` | `vega_frontend_bucket` output |
| `VEGA_CLOUDFRONT_ID` | `vega_cloudfront_distribution_id` output |
| `VEGA_API_URL` | `vega_frontend_url` output |

### Step 5: Deploy frontend

```bash
cd vega-trading-assistant/frontend
npm install
VITE_API_URL=$(cd ../tradingbot-infra/interactive-ai-agent && terraform output -raw vega_frontend_url) npm run build

# Upload to S3
BUCKET=$(cd ../tradingbot-infra/interactive-ai-agent && terraform output -raw vega_frontend_bucket)
aws s3 sync dist/ s3://$BUCKET/ --delete

# Invalidate CloudFront cache
CF_ID=$(cd ../tradingbot-infra/interactive-ai-agent && terraform output -raw vega_cloudfront_distribution_id)
aws cloudfront create-invalidation --distribution-id $CF_ID --paths "/*"
```

### Step 6: Verify deployment

```bash
BACKEND_URL=$(cd ../tradingbot-infra/interactive-ai-agent && terraform output -raw vega_backend_url)
FRONTEND_URL=$(cd ../tradingbot-infra/interactive-ai-agent && terraform output -raw vega_frontend_url)

curl $BACKEND_URL/api/ai/health
# Should return {"status":"healthy",...}

echo "Frontend: $FRONTEND_URL"
```

---

## CI/CD (Automatic after setup)

Once GitHub Secrets are configured, every push to `main` automatically:
1. Runs lint + typecheck
2. Builds backend TypeScript
3. Builds frontend
4. Builds Docker images
5. Pushes backend image to ECR
6. Updates App Runner service
7. Deploys frontend to S3 + invalidates CloudFront

---

## Connecting to Your Trading Bot

VEGA calls these endpoints on your trading bot:

| VEGA needs | Trading bot endpoint |
|-----------|---------------------|
| Watchlist | `GET /api/watchlist` |
| Predictions | `GET /api/predictions` |
| Recent orders | `GET /api/orders?recent=true` |
| Open orders | `GET /api/orders/open` |
| Trading status | `GET /api/status` |
| Alpaca status | `GET /api/alpaca/status` |
| Training status | `GET /api/training/status` |
| Pause trading | `POST /api/trading/pause` |
| Resume trading | `POST /api/trading/resume` |
| Emergency stop | `POST /api/trading/emergency-stop` |
| Add symbol | `POST /api/watchlist/add` |
| Remove symbol | `POST /api/watchlist/remove` |
| Refresh predictions | `POST /api/predictions/refresh` |
| Start training | `POST /api/training/start` |
| Stop training | `POST /api/training/stop` |

If your trading bot uses different paths, update `backend/src/services/trading.ts`.

In development, VEGA falls back to mock data if the trading bot is unreachable.
