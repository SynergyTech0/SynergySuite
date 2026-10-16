# SynergyMeet moat worker: webhook -> ffmpeg -> faster-whisper -> LLM -> Drive/Boards.
# Bundles ffmpeg + faster-whisper so it doesn't depend on anything on the host (the host may have no
# ffmpeg / GPU / whisper). CPU int8 whisper; fine for occasional post-meeting jobs.
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Pre-cache the whisper model at build time so the first meeting isn't slow / offline-fragile.
ENV MOAT_WHISPER=base.en
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('base.en', device='cpu', compute_type='int8')"

COPY moat.py .

EXPOSE 9080
CMD ["uvicorn", "moat:app", "--host", "0.0.0.0", "--port", "9080"]
