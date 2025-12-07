# 1. Usamos una base ligera de Node.js
FROM node:18-alpine

# 2. Instalamos las herramientas necesarias (Python, FFmpeg y Curl)
# Esto es lo que hace que tu app funcione en la nube
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
# Porque el .exe que tienes no sirve aquí.
RUN mkdir -p bin
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o bin/yt-dlp
RUN chmod +x bin/yt-dlp

# 8. Construimos la aplicación de Next.js
RUN pnpm build

# 9. Exponemos el puerto y arrancamos
EXPOSE 3000
CMD ["pnpm", "start"]