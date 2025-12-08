// src/app/api/info/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';

type VideoInfo = { type: 'video'; title: string; author: string; thumbnail: string; duration: string; };
type PlaylistInfo = { type: 'playlist'; title: string; author: string; thumbnail: string; totalVideos: number; tracks: { id: string; title: string; duration: string }[]; };
interface RawTrack { id: string; title: string; duration: number; }

const formatDuration = (seconds: number): string => {
  if (!seconds) return "00:00";
  const date = new Date(seconds * 1000);
  const hh = date.getUTCHours();
  const mm = date.getUTCMinutes();
  const ss = date.getUTCSeconds().toString().padStart(2, '0');
  if (hh) return `${hh}:${mm.toString().padStart(2, '0')}:${ss}`;
  return `${mm}:${ss}`;
};

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'Falta la URL' }, { status: 400 });

  try {
    const isWindows = process.platform === 'win32';
    // En Linux vamos a ejecutar Python para evitar problemas con wrappers
    const ytCmd = isWindows ? path.join(process.cwd(), 'bin', 'yt-dlp.exe') : 'python3';
    const ytArgs = isWindows
      ? ['--dump-single-json','--flat-playlist','--no-warnings','--no-call-home','--no-check-certificate','--prefer-free-formats','--no-cache-dir','--user-agent','Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url]
      : ['-m', 'yt_dlp', '--dump-single-json', '--flat-playlist', '--no-warnings', '--no-call-home', '--no-check-certificate', '--prefer-free-formats', '--no-cache-dir', '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', url];

    console.log('[API Info] Ejecutando:', ytCmd, ytArgs.join(' '));

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    // Forzamos PATH (sencillo y seguro)
    const spawnOptions = { env: { ...process.env, PATH: (process.env.PATH || '') + ':/usr/local/bin' } };

    const child = spawn(ytCmd, ytArgs, spawnOptions);

    child.stdout.on('data', (c) => chunks.push(Buffer.from(c)));
    child.stderr.on('data', (c) => errChunks.push(Buffer.from(c)));

    // Timeout - evita procesos colgados (ej: 20s para info)
    const timeoutMs = 20_000;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    await new Promise<void>((resolve, reject) => {
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        if (timedOut) return reject(new Error(`yt-dlp timeout after ${timeoutMs}ms`));
        // Si hay datos en stdout, confiamos en ellos (aunque code != 0)
        if (chunks.length > 0) return resolve();
        const stderr = Buffer.concat(errChunks).toString('utf-8').trim();
        return reject(new Error(`yt-dlp failed (code ${code}, signal ${signal}): ${stderr}`));
      });
    });

    const stdout = Buffer.concat(chunks).toString('utf-8').trim();
    if (!stdout) {
      const maybeErr = Buffer.concat(errChunks).toString('utf-8').substring(0, 1000);
      console.error('[API Info] stdout vacío. stderr:', maybeErr);
      throw new Error('Salida vacía de yt-dlp');
    }

    // DEBUG log corto para Render
    if (stdout.length < 50) console.log('[API Info] salida corta:', stdout);

    let details: any;
    try {
      details = JSON.parse(stdout);
    } catch {
      console.error('[API Info] Error parseando JSON. stdout:', stdout.substring(0, 1000));
      throw new Error('No se pudo parsear salida JSON de yt-dlp');
    }

    if (!details) throw new Error('Detalles vacíos');

    if (details._type === 'playlist' || (details.entries && details.entries.length > 0)) {
      const playlistData: PlaylistInfo = {
        type: 'playlist',
        title: details.title || 'Playlist',
        author: details.uploader || details.channel || 'YouTube',
        thumbnail: details.thumbnails?.[details.thumbnails.length - 1]?.url || details.entries?.[0]?.thumbnails?.[0]?.url || 'https://i.ytimg.com/img/no_thumbnail.jpg',
        totalVideos: details.entry_count || details.entries?.length || 0,
        tracks: (details.entries || []).map((item: RawTrack) => ({ id: item.id, title: item.title, duration: formatDuration(item.duration) }))
      };
      return NextResponse.json(playlistData);
    } else {
      const videoData: VideoInfo = {
        type: 'video',
        title: details.title,
        author: details.uploader || details.channel || 'Desconocido',
        thumbnail: details.thumbnail || details.thumbnails?.[0]?.url,
        duration: formatDuration(details.duration)
      };
      return NextResponse.json(videoData);
    }

  } catch (err: unknown) {
    let msg = 'Error desconocido';
    if (err instanceof Error) msg = err.message;
    console.error('[API Info] Error:', msg);
    return NextResponse.json({ error: 'Error al obtener datos', details: msg }, { status: 500 });
  }
}
