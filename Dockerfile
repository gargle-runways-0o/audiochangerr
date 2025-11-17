FROM node:alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 4444
VOLUME ["/config", "/logs"]
CMD ["node", "main.js"]