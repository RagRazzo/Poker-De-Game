# Poker De Game

Texas Hold'em poker for up to 6 friends, playable in any browser. No accounts needed.

## Features

- Texas Hold'em for 2–6 players
- Create a game and share a 6-character room code
- Private hole cards — only you see your own cards
- Real-time gameplay via WebSockets (Socket.IO)
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

Open `http://localhost:5000` in two or more browser windows (use incognito tabs so each gets a separate session).

## Deploy to GCP Cloud Run

### Option A — Cloud Build trigger (recommended if already connected to GitHub)

1. **Create an Artifact Registry repository** (one-time):
   ```bash
   gcloud artifacts repositories create poker-de-game \
     --repository-format=docker \
     --location=us-central1
   ```

2. **Create a Cloud Build trigger** pointing to your GitHub repo:
   - Branch filter: `main`
   - Config file: `cloudbuild.yaml`
   - Set these substitution variables in the trigger:

   | Variable | Example value |
   |---|---|
   | `_REGION` | `us-central1` |
   | `_SERVICE` | `poker-de-game` |
   | `_AR_REPO` | `poker-de-game` |
   | `_SECRET_KEY` | *(generate a random string)* |

3. Push to `main` — Cloud Build handles the rest automatically.

### Option B — GitHub Actions

Add these **GitHub Secrets** to your repository (`Settings → Secrets → Actions`):

| Secret | Description |
|---|---|
| `GCP_PROJECT_ID` | Your GCP project ID |
| `WIF_PROVIDER` | Workload Identity Federation provider resource name |
| `WIF_SERVICE_ACCOUNT` | Service account email for deployment |
| `SECRET_KEY` | Random secret string for Flask sessions |

Then push to `main` — the workflow at `.github/workflows/deploy-cloud-run.yml` runs automatically.

### Option C — Manual one-shot deploy

```bash
IMAGE="us-central1-docker.pkg.dev/YOUR_PROJECT/poker-de-game/poker-de-game"

docker build -t "${IMAGE}:latest" .
docker push "${IMAGE}:latest"

gcloud run deploy poker-de-game \
  --image="${IMAGE}:latest" \
  --region=us-central1 \
  --allow-unauthenticated \
  --port=8080 \
  --timeout=3600 \
  --min-instances=1 \
  --max-instances=1 \
  --session-affinity \
  --set-env-vars="SECRET_KEY=your-random-secret"
```

### Important Cloud Run settings

| Setting | Value | Why |
|---|---|---|
| `--max-instances=1` | **Required** | Game state lives in memory; multiple instances split players into separate states |
| `--min-instances=1` | Required | Prevents cold starts that clear in-memory game state |
| `--session-affinity` | Required | Routes WebSocket connections to the same instance |
| `--timeout=3600` | Recommended | Allows WebSocket sessions up to 1 hour |
| `games/*.json` | Ephemeral | Files live in container filesystem — acceptable since games expire after 15 min |

## Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11 + Flask + Flask-SocketIO (eventlet) |
| Frontend | Vanilla HTML/CSS/JS |
| Real-time | Socket.IO WebSockets |
| Storage | JSON files per room in `/games/` (ephemeral) |
| Container | Docker |
| Deployment | GCP Cloud Run |
