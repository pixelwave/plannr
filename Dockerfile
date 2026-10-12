FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/theme/package.json packages/theme/package.json
RUN npm ci -w @plannr/web -w @plannr/mobile
COPY apps/web apps/web
COPY apps/mobile apps/mobile
COPY packages/theme packages/theme
RUN npm run build -w @plannr/web
RUN npm run build -w @plannr/mobile

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /src/apps/web/dist /app/public
COPY --from=build /src/apps/mobile/dist /app/public/mobile
COPY server /app/server
ENV PLANNR_DATA=/data
ENV PLANNR_STATIC=/app/public
ENV PORT=8080
VOLUME /data
EXPOSE 8080
CMD ["node", "server/index.mjs"]
