// src/app/api/download/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import stream from 'stream';
const pipeline = promisify(stream.pipeline);
const unlinkAsync = promisify(fs.unlink);

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // valor aconsejable para plataforma (s)

function sanitizeFilename(name: string) {
  return name.replace(/[^\w\s\-\.]/gi, '').trim() || 'audio_track';
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  const format = (searchParams.get('format') || 'mp3').toLowerCase();
  if (!url) return NextResponse.json({ error: 'URL inválida' }, { status: 400 });

  const tempId = randomUUID();
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? path.join(process.cwd(), 'bin', 'yt-dlp.exe') : 'python3';
  const tmpDir = os.tmpdir();

  // Preparar args para obtener título
  const titleArgs = isWindows
    ? ['--print', 'title', '--no-warnings', url]
    : ['-m', 'yt_dlp', '--print', 'title', '--no-warnings', url];
  const spawnOptions = { env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin' } };

  let cleanTitle = 'audio_track';
  try {
    const titleProc = spawn(cmd, titleArgs, spawnOptions);
    const titleBuffers: Buffer[] = [];
    const titleErr: Buffer[] = [];

    titleProc.stdout.on('data', (c) => titleBuffers.push(Buffer.from(c)));
    titleProc.stderr.on('data', (c) => titleErr.push(Buffer.from(c)));

    // Timeout corto para obtener título
    const titleTimeoutMs = 10_000;
    let titleTimedOut = false;
    const tto = setTimeout(() => { titleTimedOut = true; titleProc.kill('SIGKILL'); }, titleTimeoutMs);

    await new Promise<void>((resolve, reject) => {
      titleProc.on('error', (e) => { clearTimeout(tto); reject(e); });
      titleProc.on('close', (code) => {
        clearTimeout(tto);
        if (titleTimedOut) return reject(new Error('Timeout obteniendo título'));
        if (titleBuffers.length > 0) return resolve();
        const stderr = Buffer.concat(titleErr).toString('utf-8').trim();
        if (code === 0) return resolve(); // a veces no escribe pero exit 0
        return reject(new Error('No se pudo obtener título: ' + stderr));
      });
    });

    const titleOut = Buffer.concat(titleBuffers).toString('utf-8').trim();
    cleanTitle = sanitizeFilename(titleOut.split('\n')[0] || 'audio_track');

  } catch (err) {
    console.warn(`[${tempId}] No se pudo obtener título rápido:`, err instanceof Error ? err.message : String(err));
    // seguimos con default name
  }

  const userFilename = `${cleanTitle}.${format === 'mp3' ? 'mp3' : 'mp4'}`;
  const tempFilePath = path.join(tmpDir, `wavepipe_${tempId}.${format === 'mp3' ? 'mp3' : 'mp4'}`);

  // Construir args de descarga
  const downloadArgsBase = isWindows
    ? ['--no-warnings','--no-call-home','--output', tempFilePath,'--embed-thumbnail','--add-metadata', url]
    : ['-m', 'yt_dlp', '--no-warnings','--no-call-home','--output', tempFilePath,'--embed-thumbnail','--add-metadata', url];

  const audioArgs = format === 'mp3'
    ? ['--extract-audio', '--audio-format', 'mp3', '--audio-quality', '0']
    : ['--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', '--merge-output-format', 'mp4'];

  const finalArgs = isWindows ? [...downloadArgsBase, ...audioArgs] : [...downloadArgsBase, ...audioArgs];

  console.log(`[${tempId}] Ejecutando descarga: ${cmd} ${finalArgs.join(' ')}`);

  // Timeout largo para descarga (en ms)
  const downloadTimeoutMs = 5 * 60 * 1000; // 5 minutos (ajustable)

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(cmd, finalArgs, spawnOptions);
      const errBufs: Buffer[] = [];
      let timedOut = false;
      const dto = setTimeout(() => { timedOut = true; proc.kill('SIGKILL'); }, downloadTimeoutMs);

      proc.stderr.on('data', (d) => {
        const s = d.toString();
        errBufs.push(Buffer.from(d));
        // Logueo controlado para Render
        if (s.includes('ERROR')) console.error(`[${tempId}] yt-dlp ERROR:`, s);
      });

      proc.on('error', (e) => { clearTimeout(dto); reject(e); });
      proc.on('close', (code) => {
        clearTimeout(dto);
        if (timedOut) return reject(new Error('Timeout en descarga'));
        if (code === 0) return resolve();
        const stderr = Buffer.concat(errBufs).toString('utf-8').trim();
        return reject(new Error(`yt-dlp salió con código ${code}. stderr: ${stderr}`));
      });
    });

    // Verificar fichero
    if (!fs.existsSync(tempFilePath)) throw new Error('Archivo temporal no creado por yt-dlp');

    const stats = fs.statSync(tempFilePath);
    const fileStream = fs.createReadStream(tempFilePath);
    const headers = new Headers();
    headers.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(userFilename)}`);
    headers.set('Content-Type', format === 'mp3' ? 'audio/mpeg' : 'video/mp4');
    headers.set('Content-Length', stats.size.toString());

    // Stream en la respuesta y borrar archivo al terminar
    const responseStream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk));
        fileStream.on('end', () => {
          controller.close();
          unlinkAsync(tempFilePath).catch(() => {});
        });
        fileStream.on('error', (err) => {
          controller.error(err);
          unlinkAsync(tempFilePath).catch(() => {});
        });
      }
    });

    return new NextResponse(responseStream, { headers });

  } catch (err: unknown) {
    // Intentar borrar archivo si quedó
    try { if (fs.existsSync(tempFilePath)) await unlinkAsync(tempFilePath); } catch {}
    const msg = typeof err === 'string' ? err : (err instanceof Error ? err.message : 'Error desconocido');
    console.error(`[${tempId}] Error descarga:`, msg);
    return NextResponse.json({ error: 'Fallo en la descarga', details: msg }, { status: 500 });
  }
}
