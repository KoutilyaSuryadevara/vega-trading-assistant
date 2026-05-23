# VEGA Safety Documentation

## Operating Modes

VEGA has three operating modes that control what actions it can take. The mode can be changed in the UI header or via the `AI_ASSISTANT_MODE` environment variable.

### `readonly` (Default)

VEGA can only answer questions and provide analysis. No commands are executed. This is the safest mode and should be used when:
- You're monitoring during volatile market conditions
- You're sharing access with others who shouldn't execute commands
- You want to use VEGA purely as an intelligence layer

**What works:** All read queries (watchlist, predictions, orders, status)
**What doesn't:** Any command that modifies trading state

### `approval_required`

VEGA can suggest commands and the user must explicitly approve each one before execution. A modal dialog appears with:
- The action description
- Risk level badge (low/medium/high/critical)
- Warning for high/critical risk actions
- Approve and Reject buttons

Use this mode during normal operations when you want VEGA to be able to act but with human oversight.

### `autonomous`

Commands execute after confirmation (still shown in the approval modal). Requires `ENABLE_TRADE_COMMANDS=true` in the environment. Use for automated/unattended scenarios only when you fully trust the system.

---

## Default Mode Rationale

**readonly is the default** because:

1. Most users interact with VEGA to monitor and understand, not to execute
2. The consequences of an accidental trade command (especially on a live account) can be severe
3. Switching modes is a deliberate, visible action — you can't accidentally enter approval_required
4. This follows the principle of least privilege

---

## Audit Trail

Every interaction with VEGA is recorded in a SQLite database (`./data/audit.db`):

| Column | Description |
|--------|-------------|
| `id` | UUID for each entry |
| `session_id` | Browser session identifier |
| `timestamp` | ISO 8601 timestamp |
| `event_type` | `chat`, `command`, `approval`, `rejection`, `emergency_stop` |
| `input` | User's message or command |
| `output` | VEGA's response or command result |
| `command_type` | Which command was executed (if any) |
| `approved` | Whether the user approved the action |
| `mode` | Mode at time of execution |
| `ip_address` | Client IP address |

In production (App Runner), the audit DB is in `/tmp/audit.db` — it resets on container restart. For persistent audit logs, configure a volume or export to CloudWatch Logs.

---

## Emergency Stop

The emergency stop is the highest-priority safety mechanism:

- **Always available** regardless of mode (even in readonly)
- **Bypasses mode check** — the only command that does this
- **Always requires approval** — even in autonomous mode
- **What it does:**
  1. Pauses all automated trading immediately
  2. Sends `POST /api/trading/emergency-stop` to the trading bot
  3. The trading bot should cancel pending orders and suspend all strategies
  4. Logs as `emergency_stop` event type in audit trail

**To recover after emergency stop:**
1. Investigate what triggered it
2. Confirm the situation is safe
3. Use the `resume_trading` command (requires approval_required mode)

---

## What VEGA Can and Cannot See

### Can see:
- Watchlist (ticker symbols only)
- Predictions (symbol, signal, confidence, price, reasoning summary)
- Recent orders (order details, prices, status)
- Trading status (paused/active, P&L, position count)
- Alpaca account (status, buying power, portfolio value, day trade count)
- ML training status (is running, progress, epoch, loss, accuracy)

### Cannot see:
- Alpaca API key or secret
- Database connection strings
- Any stored broker credentials
- JWT secrets or encryption keys
- User passwords
- Internal system architecture details

---

## Broker Key Security

Alpaca API keys and all broker credentials are stored **exclusively** in AWS SSM Parameter Store under the trading bot's SSM paths (`/tradingbot/prod/alpaca_api_key`, etc.).

VEGA has **no access** to these SSM paths. The IAM role for VEGA's App Runner instance only permits reading `/vega/prod/*` and the shared Anthropic API key. This is enforced at the AWS IAM policy level.

VEGA's backend logs are configured to redact any field named `apiKey`, `api_key`, `token`, `secret`, `password`, or `broker_credentials`. Winston's logger redacts these before writing to CloudWatch.

**API responses never include broker credential values.** The Alpaca status endpoint returns only: connection status, account status, buying power, portfolio value, and day trade count.

---

## Permanently Blocked Operations

These operations cannot be performed through VEGA under any circumstances:

- Changing broker API keys or credentials
- Accessing or displaying stored secrets
- Modifying IAM permissions or SSM parameters
- Accessing the trading bot's database directly
- Executing arbitrary code on the trading bot server
- Bypassing the approval workflow via API manipulation

These restrictions are enforced in the backend code, not just the UI.

---

## Escalating from Readonly

To switch from readonly to approval_required:

1. Click the mode selector in the VEGA header
2. Select "approval-required"
3. Mode change takes effect immediately
4. All subsequent commands will show an approval modal

**There is no way to switch modes via chat.** This is intentional — mode changes must be explicit UI actions, not something that can be triggered by a crafted message.

---

## Rate Limits

To prevent accidental or malicious flooding:

- `/api/ai/chat` — 100 requests per 15 minutes per IP
- `/api/ai/command` — 30 requests per 15 minutes per IP
- `/api/ai/context` — 60 requests per minute per IP

These limits apply per IP address and reset on a rolling window.
