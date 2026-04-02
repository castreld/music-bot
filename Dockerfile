FROM node:22-slim

# Install ffmpeg, curl and SSL certificates
RUN apt-get update && \
    apt-get install -y ffmpeg curl ca-certificates --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Download yt-dlp standalone binary (no Python required)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
    -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "src/index.js"]
