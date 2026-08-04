FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json index.js ./
RUN npm ci --omit=dev --no-audit --no-fund
USER node
CMD ["node", "index.js"]
