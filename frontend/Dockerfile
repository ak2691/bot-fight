FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["node", "scripts/serve-static.mjs", "--host", "0.0.0.0", "--port", "5173"]
