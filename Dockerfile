FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer-cached separately from code)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Ensure the games directory exists (ephemeral on Cloud Run — acceptable for 15-min game lifetime)
RUN mkdir -p games

# Cloud Run injects PORT at runtime (default 8080).
# Shell-form CMD is required so $PORT is expanded by the shell at container start.
ENV PORT=8080
EXPOSE $PORT

CMD gunicorn --worker-class eventlet -w 1 --bind "0.0.0.0:${PORT}" --timeout 300 app:app
