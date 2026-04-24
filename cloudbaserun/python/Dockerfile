FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src

ENV HOST=0.0.0.0
ENV PORT=80
ENV STORAGE_DRIVER=memory

EXPOSE 80

CMD ["npm", "start"]

