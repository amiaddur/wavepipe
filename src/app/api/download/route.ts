import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';

const unlinkAsync = promisify(fs.unlink);

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get('url');
  const format = request.nextUrl.searchParams.get('format') || 'mp3';

  if (!url) return NextResponse.json({ error: 'URL requerida' }, { status: 400 });

  // 1. Detectar binario
  const isWindows = process.platform === 'win32';
  const binName = isWindows ? 'yt-dlp.exe' : 'yt-dlp';
  const ytPath = path.join(process.cwd(), 'bin', binName);

  if (!fs.existsSync(ytPath)) {
    return NextResponse.json({ error: 'Binario yt-dlp no encontrado' }, { status: 500 });
  }

  // 2. Preparar rutas
  const tempId = Math.random().toString(36).substring(7);
  const tempDir = os.tmpdir(); 
  const tempFilePathTemplate = path.join(tempDir, `wavepipe_${tempId}.%(ext)s`);
  const expectedFilePath = path.join(tempDir, `wavepipe_${tempId}.${format === 'mp3' ? 'mp3' : 'mp4'}`);

  // 3. Argumentos BLINDADOS (Aquí está la magia)
  const args = [
    '--no-warnings',
    '--output', tempFilePathTemplate,
    '--embed-thumbnail',
    '--add-metadata',
    '--no-cache-dir',
    '--no-check-certificate',
    
    // USAR EL MISMO DISFRAZ DE IPHONE (Sin User-Agent manual)
    '--extractor-args', 'youtube:player_client=ios',
    
    url
  ];

  if (format === 'mp3') {
    args.push('--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0');
  } else {
    args.push('--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best');
    args.push('--merge-output-format', 'mp4');
  }

  console.log(`[Download] Iniciando: ${ytPath} con ID ${tempId}`);

  try {
    await new Promise((resolve, reject) => {
      const process = spawn(ytPath, args);
      
      // CAPTURAMOS EL ERROR REAL
      let errorLog = '';
      process.stderr.on('data', (d) => {
        errorLog += d.toString();
        console.log(`[YT-DLP Log]: ${d.toString()}`);
      });

      process.on('close', (code) => {
        if (code === 0) resolve(true);
        else {
            // Aquí devolvemos el log del error en lugar de solo el código
            reject(new Error(`Fallo yt-dlp (Code ${code}). Log: ${errorLog}`));
        }
      });
      process.on('error', (err) => reject(err));
    });

    // Verificación final
    if (!fs.existsSync(expectedFilePath)) {
      throw new Error('El archivo no se creó. Posible fallo de FFmpeg.');
    }

    const stats = fs.statSync(expectedFilePath);
    const fileStream = fs.createReadStream(expectedFilePath);
    const filename = `download.${format}`; // Nombre genérico por defecto

    // Intentamos limpiar
    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    headers.set('Content-Length', stats.size.toString());

    const responseStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => {
          controller.close();
          unlinkAsync(expectedFilePath).catch(() => {});
        });
        fileStream.on('error', (err) => {
          controller.error(err);
          unlinkAsync(expectedFilePath).catch(() => {});
        });
      }
    });

    return new NextResponse(responseStream, { headers });

  } catch (error: any) {
    console.error('Download Error:', error);
    // Ahora el frontend verá el error real
    return NextResponse.json({ 
        error: 'Fallo en la descarga', 
        details: error.message || String(error) 
    }, { status: 500 });
  }
}