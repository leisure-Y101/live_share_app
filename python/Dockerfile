FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src

ENV HOST=0.0.0.0
ENV PORT=8787
ENV STORAGE_DRIVER=memory

EXPOSE 8787

CMD ["npm", "start"]
