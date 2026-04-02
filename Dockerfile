FROM node:22-slim

# Install ffmpeg, python3, pip and SSL certificates
RUN apt-get update && \
    apt-get install -y ffmpeg python3 python3-pip ca-certificates --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Install yt-dlp via pip — includes Python jsinterp for YouTube signature solving
RUN pip3 install yt-dlp --break-system-packages

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "src/index.js"]
