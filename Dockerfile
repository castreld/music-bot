FROM node:22-slim

# Install ffmpeg and SSL certificates
RUN apt-get update && \
    apt-get install -y ffmpeg ca-certificates --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["node", "src/index.js"]
