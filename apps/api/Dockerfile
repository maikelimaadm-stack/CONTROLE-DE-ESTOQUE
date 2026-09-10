# API (Fastify) — imagem para Railway. Build a partir da raiz do monorepo:
#   docker build -f apps/api/Dockerfile -t agro-api .
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY supabase ./supabase
RUN pnpm install --frozen-lockfile --filter @agro/api... 
RUN pnpm --filter @agro/shared build && pnpm --filter @agro/domain build && pnpm --filter @agro/db build && pnpm --filter @agro/api build
RUN pnpm --filter @agro/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production MIGRATIONS_DIR=/app/supabase/migrations
COPY --from=build /out ./
COPY --from=build /app/supabase/migrations ./supabase/migrations
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3333}/health || exit 1
CMD ["node", "dist/main.js"]
