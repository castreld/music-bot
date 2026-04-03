FROM node:22-slim

# ffmpeg: PCM transcode; yt-dlp: YouTube on VPS IPs (play-dl often fails with Invalid URL)
RUN apt-get update && \
    apt-get install -y ffmpeg ca-certificates python3 curl --no-install-recommends && \
    curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "src/index.js"]
