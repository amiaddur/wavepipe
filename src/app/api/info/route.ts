import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

// --- DEFINICIÓN DE TIPOS ---
type VideoInfo = {
  type: 'video';
  title: string;
  author: string;
  thumbnail: string;
  duration: string;
};

type PlaylistInfo = {
  type: 'playlist';
  title: string;
  author: string;
  thumbnail: string;
  totalVideos: number;
  tracks: { id: string; title: string; duration: string }[];
};

interface RawTrack {
  id: string;
  title: string;
  duration: number;
}

const formatDuration = (seconds: number): string => {
  if (!seconds) return "00:00";
  const date = new Date(seconds * 1000);
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  if (hh) {
    return `${hh}:${mm.toString().padStart(2, '0')}:${ss}`;
  }
  return `${mm}:${ss}`;
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Falta la URL' }, { status: 400 });
  }

  try {
    const isWindows = process.platform === 'win32';
    const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
    const ytDlpPath = path.join(process.cwd(), 'bin', binaryName);

    console.log(`[API Info] Motor: ${ytDlpPath} | URL: ${url}`);

    const args = [
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
      '--no-call-home',
      '--no-check-certificate', // Ayuda en entornos Docker con SSL estricto
      '--prefer-free-formats',
      '--no-cache-dir',         // <--- CLAVE 1: Evita errores de escritura en disco
      // <--- CLAVE 2: Simulamos ser un navegador real para evitar bloqueos
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      url
    ];

    if (url.includes('list=')) {
        args.push('--yes-playlist');
    }

    const child = spawn(ytDlpPath, args);

    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];

    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => errorChunks.push(Buffer.from(chunk)));

    await new Promise((resolve, reject) => {
      child.on('close', (code) => {
        // En Linux, a veces el código no es 0 pero devuelve datos válidos
        if (chunks.length > 0) resolve(true);
        else {
           const errorMsg = Buffer.concat(errorChunks).toString('utf-8');
           reject(new Error(`yt-dlp error code ${code}: ${errorMsg}`));
        }
      });
      child.on('error', (err) => reject(err));
    });

    const fullOutput = Buffer.concat(chunks).toString('utf-8');
    
    // --- LOG CRÍTICO PARA DEBUG ---
    // Si falla, mira esto en los logs de Render para ver qué devolvió exactamente
    if (fullOutput.length < 50) {
        console.log("Salida sospechosamente corta:", fullOutput);
    }

    let details;
    try {
        if (!fullOutput) throw new Error("Salida vacía de yt-dlp");
        details = JSON.parse(fullOutput);
    } catch {
        console.error("Error parseando JSON. Output recibido:", fullOutput.substring(0, 500));
        throw new Error("La respuesta de YouTube no fue un JSON válido.");
    }

    if (!details) {
        throw new Error("No se recibieron detalles del vídeo (Objeto nulo).");
    }

    // --- RESPUESTA ---

    if (details._type === 'playlist' || (details.entries && details.entries.length > 0)) {
      
      const playlistData: PlaylistInfo = {
        type: 'playlist',
        title: details.title || "Playlist",
        author: details.uploader || details.channel || "YouTube",
        thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url 
                   || details.entries?.[0]?.thumbnails?.[0]?.url 
                   || "https://i.ytimg.com/img/no_thumbnail.jpg", 
        totalVideos: details.entry_count || details.entries?.length || 0,
        tracks: (details.entries || []).map((item: RawTrack) => ({
          id: item.id,
          title: item.title,
          duration: formatDuration(item.duration)
        }))
      };
      return NextResponse.json(playlistData);
    
    } else {
      const videoData: VideoInfo = {
        type: 'video',
        title: details.title,
        author: details.uploader || details.channel || "Desconocido",
        thumbnail: details.thumbnail || details.thumbnails?.[0]?.url,
        duration: formatDuration(details.duration),
      };
      return NextResponse.json(videoData);
    }

  } catch (error: unknown) {
    let errorMessage = "Error desconocido";
    if (error instanceof Error) errorMessage = error.message;
    else if (typeof error === 'string') errorMessage = error;

    console.error('[API Error]:', errorMessage);
    
    return NextResponse.json({ error: 'Error al obtener datos', details: errorMessage }, { status: 500 });
  }
}