# Single deployable: API + built web app served from the same origin.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps
COPY devices devices
# Demo servers only: show the seeded demo logins on the sign-in page.
ARG VITE_SHOW_DEMO_LOGINS=false
ENV VITE_SHOW_DEMO_LOGINS=$VITE_SHOW_DEMO_LOGINS
RUN pnpm --filter @dobi/web build && pnpm --filter @dobi/api build

FROM node:22-slim
RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod --filter @dobi/api
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
WORKDIR /app/apps/api
# Photos live on a volume at /data/uploads; run as the unprivileged "node" user.
RUN mkdir -p /data/uploads && chown -R node:node /data
ENV WEB_DIST=/app/apps/web/dist PORT=3000 UPLOAD_DIR=/data/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
