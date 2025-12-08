# Dockerfile (Debian-slim) para Next.js 16 + yt-dlp
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

# Asegurar que /usr/bin/python apunte a python3 (algunas imágenes lo requieren)
RUN if [ ! -x /usr/bin/python ] && [ -x /usr/bin/python3 ]; then ln -s /usr/bin/python3 /usr/bin/python; fi

# Instalar yt-dlp globalmente mediante pip (stable). --upgrade pip por si acaso
RUN pip3 install --no-cache-dir --upgrade pip \
  && pip3 install --no-cache-dir yt-dlp

# Copiar package files e instalar dependencias con pnpm (si usas pnpm)
COPY package.json pnpm-lock.yaml* ./

RUN npm install -g pnpm \
  && pnpm install --frozen-lockfile --prod

# Copiar el resto del proyecto
COPY . .

# Build (ajusta según tu script)
RUN pnpm build

# Puerto y comando
EXPOSE 3000

# Usar el PATH con /usr/local/bin ya añadido; ejecutar next start
CMD ["pnpm", "start"]
