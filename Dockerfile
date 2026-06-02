FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p games

# Exec-form CMD — no shell, so no variable-expansion issues.
# gunicorn.conf.py reads $PORT directly from the environment in Python.
EXPOSE 8080
CMD ["gunicorn", "--config", "gunicorn.conf.py", "app:app"]
