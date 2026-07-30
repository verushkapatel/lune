FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# music21 needs a writable home for its configuration on first import.
ENV HOME=/tmp

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY frontend ./frontend
COPY samples ./samples

# Accounts and conversations live here. Mount a persistent disk at this path,
# otherwise every redeploy wipes every account.
ENV LUNE_DATA_DIR=/data
RUN mkdir -p /data

# Sessions are cookie-based and the database is SQLite, so run a single worker.
ENV PORT=8000
EXPOSE 8000

CMD ["sh", "-c", "uvicorn backend.main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
