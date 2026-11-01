FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
COPY public ./public
COPY scripts ./scripts

USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
