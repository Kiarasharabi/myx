FROM node:20-bullseye-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates unzip curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# دانلود آخرین نسخه‌ی Xray-core
RUN curl -fL -o /tmp/xray.zip \
      https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip \
    && mkdir -p /app/bin \
    && unzip -o /tmp/xray.zip -d /app/bin \
    && chmod +x /app/bin/xray \
    && rm /tmp/xray.zip

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

ENV XRAY_BIN=/app/bin/xray
ENV DATA_DIR=/app/data

CMD ["node", "server.js"]
