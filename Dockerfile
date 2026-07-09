# ============================================
# Ment-Query-Board — Next.js 15 (App Router) / React 19 / npm
# 使用 Next.js standalone 輸出，產生最小化的生產映像
# ============================================

# BASE_IMAGE 可由 CI 覆寫，指向預先建置好的相依快取映像，
# 省去每次重新安裝相依套件的時間；預設使用下方的 base 階段。
ARG BASE_IMAGE=base

# --- Base Stage：依 lockfile 安裝相依套件（可快取層）---
FROM node:20-alpine AS base
WORKDIR /app

# 某些原生相依套件在 Alpine 上需要 libc6-compat；curl/jq 供抓取設定使用
RUN apk add --no-cache libc6-compat curl jq

# 只複製依賴檔案以利用 Docker 層快取最小化重建時間
COPY package.json package-lock.json ./
RUN npm ci


# --- Build Stage：構建 Next.js 應用程式（繼承相依快取層）---
FROM ${BASE_IMAGE} AS build
ARG ENV_TAG=dev
ARG APP_ID=Ment-Query-Board
ARG BRANCH_NAME
WORKDIR /app

# 複製原始碼（node_modules 已存在於 base 階段的 /app）
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

# 獲取環境變數配置（來自 Apollo Config Server）
RUN curl -L https://apollo.ment-tech.com/cd-scripts/15-fetch-apollo-config.sh \
    -o ./15-fetch-apollo-config.sh && \
    chmod +x ./15-fetch-apollo-config.sh && \
    sh ./15-fetch-apollo-config.sh && \
    cat .env

# 構建應用程式（產生 .next/standalone）
RUN npm run build

# ============================================
# Runtime Stage - 最小化生產映像大小
# ============================================
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# HEALTHCHECK 所需
RUN apk add --no-cache wget

# 以非 root 使用者執行
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# 複製 standalone 伺服器輸出與必要的靜態資源
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
#COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs

# 暴露應用程式連接埠（Next.js 預設 3000）
EXPOSE 3000

# 健康檢查
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

# 啟動應用程式（standalone 於專案根目錄產生 server.js）
CMD ["node", "server.js"]
