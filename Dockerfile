FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p games

# run.py uses socketio.run() with eventlet's own WSGI server.
# This avoids the gunicorn-forks-eventlet-worker double-patch issue
# that caused the "container not listening on port 8080" error on Cloud Run.
# PORT is read from the environment (Cloud Run injects PORT=8080).
EXPOSE 8080
CMD ["python", "run.py"]
