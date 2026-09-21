FROM node:20-slim

# Install system utilities, Python3, and FFmpeg required for stream merging
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install the latest stable release of yt-dlp binary
RUN curl -L https://github.com -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install

# Copy all server scripts into the container workspace
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
