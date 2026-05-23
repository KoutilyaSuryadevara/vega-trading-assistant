# VEGA Commands Reference

All commands can be triggered by natural language in the chat interface. VEGA detects intent and presents a confirmation dialog (in `approval_required` mode) before execution.

---

## Query Commands (Read-Only — available in all modes)

### Get Watchlist
- **Trigger phrases:** "What stocks are we watching?", "Show me the watchlist", "What's on the watchlist?"
- **Command:** `get_watchlist`
- **Risk:** Low
- **Returns:** Array of ticker symbols

### Get Predictions
- **Trigger phrases:** "What are today's signals?", "Show me buy/sell predictions", "What are the strongest opportunities?"
- **Command:** `get_predictions`
- **Risk:** Low
- **Returns:** Array of predictions with signal, confidence, price, and reasoning

### Get Recent Orders
- **Trigger phrases:** "What orders were placed today?", "Show me recent trades", "What did we buy/sell?"
- **Command:** `get_orders`
- **Risk:** Low
- **Returns:** Recent order history

### Get Open Orders
- **Trigger phrases:** "What orders are open in Alpaca?", "Any pending orders?", "Show open positions"
- **Command:** `get_open_orders`
- **Risk:** Low
- **Returns:** Currently open orders in Alpaca

### Get Trading Status
- **Trigger phrases:** "Is auto-trading paused?", "What's the current trading status?", "Is the bot active?"
- **Command:** `get_status`
- **Risk:** Low
- **Returns:** isPaused, isAutoTradingEnabled, isOptionsEnabled, positions, P&L

### Show Alpaca Status
- **Trigger phrases:** "Show Alpaca status", "What's our Alpaca account look like?", "Check Alpaca"
- **Command:** `show_alpaca_status`
- **Risk:** Low
- **Returns:** Account status, buying power, portfolio value, day trade count

### Show Training Progress
- **Trigger phrases:** "What's the ML training status?", "How's training going?", "Show training progress"
- **Command:** `show_training_progress`
- **Risk:** Low
- **Returns:** isRunning, progress %, current epoch, loss, accuracy

---

## Action Commands (Require `approval_required` or `autonomous` mode)

### Pause Trading
- **Trigger phrases:** "Pause trading", "Stop auto-trading", "Suspend trading"
- **Command:** `pause_trading`
- **Risk:** High
- **Requires approval:** Yes
- **Effect:** Pauses all automated trade execution on the trading bot
- **Example response:** "Trading has been paused. All active strategies are suspended. Resume when ready."

### Resume Trading
- **Trigger phrases:** "Resume trading", "Unpause trading", "Restart auto-trading"
- **Command:** `resume_trading`
- **Risk:** High
- **Requires approval:** Yes
- **Effect:** Resumes automated trade execution
- **Example response:** "Trading has been resumed. Active strategies are now executing."

### Add Symbol to Watchlist
- **Trigger phrases:** "Add AAPL to the watchlist", "Watch NVDA", "Start tracking MSFT"
- **Command:** `add_symbol`
- **Params:** `{ symbol: "AAPL" }`
- **Risk:** Low
- **Requires approval:** Yes
- **Effect:** Adds ticker to the trading bot's watchlist for prediction generation

### Remove Symbol from Watchlist
- **Trigger phrases:** "Remove TSLA from the watchlist", "Stop watching GME", "Unwatch AMZN"
- **Command:** `remove_symbol`
- **Params:** `{ symbol: "TSLA" }`
- **Risk:** Low
- **Requires approval:** Yes
- **Effect:** Removes ticker from the watchlist

### Refresh Predictions
- **Trigger phrases:** "Refresh predictions", "Update signals", "Re-run the model"
- **Command:** `refresh_predictions`
- **Risk:** Low
- **Requires approval:** Yes
- **Effect:** Triggers a fresh prediction run on the current watchlist

### Start Training
- **Trigger phrases:** "Start model training", "Train the ML model", "Begin training"
- **Command:** `start_training`
- **Risk:** Medium
- **Requires approval:** Yes
- **Effect:** Initiates a new ML training run. May consume significant compute resources.

### Stop Training
- **Trigger phrases:** "Stop training", "Cancel model training", "Abort training"
- **Command:** `stop_training`
- **Risk:** Medium
- **Requires approval:** Yes
- **Effect:** Stops the current training run. Progress up to current epoch is saved.

---

## Emergency Command (Always available in any mode)

### Emergency Stop
- **Trigger phrases:** "Emergency stop", "Halt all trading immediately", "STOP EVERYTHING"
- **Command:** `emergency_stop`
- **Risk:** Critical
- **Requires approval:** Yes (even in autonomous mode)
- **Effect:** Immediately halts ALL trading activity. Cancels pending orders. Pauses all strategies.
- **Cannot be undone automatically** — requires explicit resume command after investigation

> ⚠ Emergency stop bypasses mode restrictions. It is always available, even in readonly mode.

---

## Command Execution Flow

```
User says: "Pause trading"
         │
         ▼
VEGA detects intent: pause_trading (HIGH risk)
         │
         ▼
Mode check:
  readonly        → "Commands disabled in readonly mode"
  approval_required → Shows approval modal
  autonomous      → Shows approval modal (ENABLE_TRADE_COMMANDS must be true)
         │
         ▼
User clicks "Approve"
         │
         ▼
POST /api/trading/pause → Trading bot
         │
         ▼
Audit log entry written
         │
         ▼
VEGA: "Trading has been paused successfully."
```
