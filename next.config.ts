import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'i.ytimg.com',
      },
      {
        protocol: 'https',
        hostname: 'yt3.ggpht.com', // A veces las miniaturas de canales vienen de aquí
      },
    ],
  },
  // ESTA ES LA MAGIA QUE SOLUCIONA EL ERROR:
  serverExternalPackages: ['ytpl', '@distube/ytdl-core', 'fluent-ffmpeg'],
};

export default nextConfig;

