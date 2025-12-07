# 1. Usamos Node 20 (Requisito de Next.js 14/15)
FROM node:20-alpine

# 2. Instalamos las herramientas necesarias (Python, FFmpeg y Curl)
# Nota: En Alpine 20 a veces python3 se llama simplemente python, pero python3 suele funcionar.
RUN apk add --no-cache python3 ffmpeg curl

# 3. Preparamos la carpeta de trabajo
WORKDIR /app

# 4. Copiamos los archivos de dependencias
COPY package.json pnpm-lock.yaml* ./

# 5. Instalamos pnpm y las dependencias del proyecto
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# 6. Copiamos todo el código fuente
COPY . .

# 7. TRUCO DE MAGIA: Descargamos yt-dlp versión LINUX
RUN mkdir -p bin
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
RUN chmod +x bin/yt-dlp

# 8. Construimos la aplicación de Next.js
RUN pnpm build

# 9. Exponemos el puerto y arrancamos
EXPOSE 3000
CMD ["pnpm", "start"]