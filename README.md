# Poker De Game

Texas Hold'em poker for up to 6 friends, playable in any browser. No accounts needed.

## Features

- Texas Hold'em for 2–6 players
- Create a game and share a 6-character room code
- Private hole cards — only you see your own cards
- Real-time gameplay via WebSockets
- In-game text chat
- 1,000 starting coins per player (reset on new session)
- Game rooms auto-expire after 15 minutes of inactivity

## Run locally

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000` in two or more browser tabs (use incognito for extra tabs so each gets a separate session).

## Deploy to Azure App Service

```bash
# 1. Log in
az login

# 2. Deploy (creates resource group, plan, and web app)
az webapp up \
  --name poker-de-game-<unique-suffix> \
  --runtime "PYTHON:3.11" \
  --sku B1 \
  --os-type Linux \
  --location eastus

# 3. Set startup command
az webapp config set \
  --name poker-de-game-<unique-suffix> \
  --resource-group <resource-group> \
  --startup-file "gunicorn --worker-class eventlet -w 1 --bind=0.0.0.0:8000 --timeout 600 app:app"

# 4. Enable WebSockets (required for Socket.IO)
az webapp config set \
  --name poker-de-game-<unique-suffix> \
  --resource-group <resource-group> \
  --web-sockets-enabled true

# 5. App settings
az webapp config appsettings set \
  --name poker-de-game-<unique-suffix> \
  --resource-group <resource-group> \
  --settings \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true \
    WEBSITES_PORT=8000 \
    SECRET_KEY="<generate-a-random-string>"
```

**Important:** Keep `-w 1` (single gunicorn worker). Game state lives in-process; multiple workers would split state across them.

Subsequent deploys: `az webapp up` from the repo root.

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11 + Flask + Flask-SocketIO (eventlet) |
| Frontend | Vanilla HTML/CSS/JS |
| Real-time | Socket.IO WebSockets |
| Storage | JSON files per room in `/games/` |
| Deployment | Azure App Service B1 |
