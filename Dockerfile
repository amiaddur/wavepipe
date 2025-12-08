# Dockerfile (Debian-slim) para Next.js + yt-dlp
FROM node:20-slim

# Variables de entorno
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PATH=/usr/local/bin:$PATH
WORKDIR /app

# Actualizar e instalar dependencias del sistema: python3, pip, ffmpeg, utilidades
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
      python3 \
      python3-pip \
      ffmpeg \
      ca-certificates \
      curl \
      build-essential \
  && rm -rf /var/lib/apt/lists/*

# Asegurar que /usr/bin/python apunte a python3
RUN if [ ! -x /usr/bin/python ] && [ -x /usr/bin/python3 ]; then ln -s /usr/bin/python3 /usr/bin/python; fi

# --- CORRECCIÓN AQUÍ ---
# Añadimos --break-system-packages para saltarnos la restricción de Debian 12
RUN pip3 install --no-cache-dir --upgrade pip --break-system-packages \
  && pip3 install --no-cache-dir yt-dlp --break-system-packages

# Copiar package files e instalar dependencias con pnpm
COPY package.json pnpm-lock.yaml* ./

RUN npm install -g pnpm \
  && pnpm install --frozen-lockfile --prod

# Copiar el resto del proyecto
COPY . .

# Build
RUN pnpm build

# Puerto y comando
EXPOSE 3000
CMD ["pnpm", "start"]