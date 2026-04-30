# 1. Use Node.js for the main runtime
FROM node:22-bullseye-slim

# 2. Set up the App
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --legacy-peer-deps
COPY . .
RUN npm run build

EXPOSE 3001
CMD ["node", "server/index.js"]
