FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package*.json apps/api/
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run prisma:generate --workspace @rms/api
RUN npm run build --workspace @rms/api

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY package*.json ./
COPY apps/api/package*.json apps/api/
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
