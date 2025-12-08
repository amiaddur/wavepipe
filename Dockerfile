# 1. Usamos una base Debian (slim) que es más compatible que Alpine
FROM node:20-slim

# 2. Actualizamos e instalamos Python3, PIP y FFmpeg
# Al usar Debian, esto es mucho más robusto
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 3. INSTALACIÓN DE YT-DLP VIA PIP
# En lugar de descargar un archivo, dejamos que Python lo instale y configure
# La bandera --break-system-packages es necesaria en versiones nuevas de Python
RUN pip3 install yt-dlp --break-system-packages

# 4. Configuración estándar de Node
WORKDIR /app

COPY package.json pnpm-lock.yaml* ./

RUN npm install -g pnpm && pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

EXPOSE 3000
CMD ["pnpm", "start"]