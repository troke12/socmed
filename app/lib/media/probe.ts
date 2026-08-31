import sharp from "sharp";
import { spawn } from "node:child_process";

export interface ImageProbe {
  width: number;
  height: number;
}

export interface VideoProbe {
  width: number;
  height: number;
  durationMs: number;
}

export async function probeImage(buf: Buffer): Promise<ImageProbe> {
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) throw new Error("image probe: no dimensions");
  return { width: meta.width, height: meta.height };
}

export interface ProbeResult {
  width: number;
  height: number;
  durationMs: number;
}

export async function probeVideo(path: string): Promise<VideoProbe> {
  return new Promise((resolve, reject) => {
    const ffprobe = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-show_entries", "format=duration",
      "-of", "json",
      path,
    ]);
    let out = "";
    let err = "";
    ffprobe.stdout.on("data", (d) => (out += d.toString()));
    ffprobe.stderr.on("data", (d) => (err += d.toString()));
    ffprobe.on("error", (e) => reject(new Error(`ffprobe spawn: ${e.message}`)));
    ffprobe.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exit ${code}: ${err}`));
        return;
      }
      try {
        const j = JSON.parse(out) as {
          streams?: { width?: number; height?: number }[];
          format?: { duration?: string | number };
        };
        const s = j.streams?.[0];
        const w = s?.width ?? 0;
        const h = s?.height ?? 0;
        const dur = Number(j.format?.duration ?? 0);
        if (!w || !h) throw new Error("ffprobe: no dimensions");
        resolve({ width: w, height: h, durationMs: Math.round(dur * 1000) });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

export async function generateVideoPoster(videoPath: string, posterPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-y",
      "-i", videoPath,
      "-ss", "00:00:01.000",
      "-vframes", "1",
      "-vf", "scale=1280:-1",
      posterPath,
    ]);
    let err = "";
    ffmpeg.stderr.on("data", (d) => (err += d.toString()));
    ffmpeg.on("error", (e) => reject(new Error(`ffmpeg spawn: ${e.message}`)));
    ffmpeg.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`));
      else resolve();
    });
  });
}
