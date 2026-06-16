# Backend Referidos — Express + Sequelize
FROM node:22-alpine

WORKDIR /app

# Instalar solo dependencias de producción (cache de capa)
COPY package*.json ./
RUN npm ci --omit=dev

# Código de la aplicación
COPY . .

# El bootstrap escribe adjuntos de fallback en uploads/ (normalmente se usa S3)
RUN mkdir -p uploads

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["node", "src/server.js"]
