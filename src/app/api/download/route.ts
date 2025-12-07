import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';
import { randomUUID } from 'crypto'; // <--- USAMOS CRIPTO PARA ID ÚNICOS

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutos máximo por descarga (para listas o vídeos largos)

const unlinkAsync = promisify(fs.unlink);

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s\-\.]/gi, '').trim();
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  const format = searchParams.get('format') || 'mp3';

  if (!url) return NextResponse.json({ error: 'URL inválida' }, { status: 400 });

  // Generamos un ID único real para evitar colisiones si bajas 2 canciones a la vez
  const tempId = randomUUID(); 

  // DETECCIÓN INTELIGENTE DE SISTEMA OPERATIVO
  const isWindows = process.platform === 'win32';
  const binaryName = isWindows ? 'yt-dlp.exe' : 'yt-dlp'; // En Linux no lleva .exe
  const binPath = path.join(process.cwd(), 'bin', binaryName);
  const tempDir = os.tmpdir(); 
  
  try {
    // 1. Obtener Título (Rápido)
    const titleProcess = spawn(binPath, ['--print', 'title', '--no-warnings', url]);
    let videoTitle = '';
    for await (const chunk of titleProcess.stdout) videoTitle += chunk.toString();
    const cleanTitle = videoTitle ? sanitizeFilename(videoTitle) : 'audio_track';
    
    // Nombre para el usuario y ruta temporal
    const userFilename = `${cleanTitle}.${format === 'mp3' ? 'mp3' : 'mp4'}`;
    const tempFilePath = path.join(tempDir, `wavepipe_${tempId}.${format === 'mp3' ? 'mp3' : 'mp4'}`);

    // 2. Argumentos de Descarga
    const args = [
      '--no-warnings',
      '--no-call-home',
      '--output', tempFilePath,
      '--embed-thumbnail', 
      '--add-metadata', 
      url
    ];

    if (format === 'mp3') {
      args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
      args.push('--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
      args.push('--merge-output-format', 'mp4');
    }

    // 3. Ejecutar descarga en el servidor
    await new Promise((resolve, reject) => {
      const process = spawn(binPath, args);
      
      // Capturamos error si yt-dlp falla (ej: video borrado)
      process.stderr.on('data', (data) => {
         const msg = data.toString();
         if (msg.includes('ERROR')) console.error(`[${tempId}] yt-dlp error:`, msg);
      });

      process.on('close', (code) => {
        if (code === 0) resolve(true);
        else reject(new Error(`yt-dlp salió con código ${code}`));
      });
      process.on('error', (err) => reject(err));
    });

    // 4. Verificar que el archivo existe (por si acaso)
    if (!fs.existsSync(tempFilePath)) {
        throw new Error("El archivo temporal no se creó correctamente.");
    }

    const stats = fs.statSync(tempFilePath);
    const fileStream = fs.createReadStream(tempFilePath);

    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(userFilename)}`);
    headers.set('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    headers.set('Content-Length', stats.size.toString());

    // 5. Enviar stream
    const responseStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => {
          controller.close();
          unlinkAsync(tempFilePath).catch(() => {}); // Borrar temp al terminar
        });
        fileStream.on('error', (err) => {
          controller.error(err);
          unlinkAsync(tempFilePath).catch(() => {});
        });
      }
    });

    return new NextResponse(responseStream, { headers });

  } catch (error: unknown) {
    // 1. Tipamos como 'unknown' porque no sabemos qué ha fallado
    
    // 2. Extraemos el mensaje de forma segura
    let errorMessage = "Error desconocido";
    
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    console.error('Error descarga:', errorMessage);
    
    return NextResponse.json(
      { error: 'Fallo en la descarga', details: errorMessage }, 
      { status: 500 }
    );
  }
}