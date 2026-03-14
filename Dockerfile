# ===========================
# 渇水モニター — 本番用 Dockerfile
# Node.js + Python 同居構成
# ===========================

FROM node:20-slim

# Python 3 と pip のインストール
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python 依存ライブラリのインストール（仮想環境使用）
COPY requirements.txt ./
RUN python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --no-cache-dir -r requirements.txt
ENV PATH="/opt/venv/bin:$PATH"
ENV PYTHON_CMD="python3"

# Node.js 依存ライブラリのインストール (本番用のみ)
COPY package.json package-lock.json ./
RUN npm ci --production

# アプリケーションコードのコピー
COPY . .

# フロントエンドのビルド (devDependenciesが必要なので一時的にインストール)
RUN npm install --include=dev && \
    npm run build && \
    npm prune --production

# ポート公開
EXPOSE 3001

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# 起動コマンド (メモリ制限を追加)
CMD ["node", "--max-old-space-size=256", "server/index.js"]
