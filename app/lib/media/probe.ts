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

const FF_TIMEOUT_MS = 20_000;

interface RunResult {
  stdout: string;
  stderr: string;
}

function runProcess(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${FF_TIMEOUT_MS}ms`));
    }, FF_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`${cmd} spawn: ${e.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${cmd} exit ${code}: ${err.slice(-500)}`));
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

export interface ProbeResult {
  width: number;
  height: number;
  durationMs: number;
}

export async function probeVideo(path: string): Promise<VideoProbe> {
  const { stdout } = await runProcess("ffprobe", [
    "-v", "error",
    "-nostdin",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-show_entries", "format=duration",
    "-of", "json",
    "--",
    path,
  ]);
  const j = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number }[];
    format?: { duration?: string | number };
  };
  const s = j.streams?.[0];
  const w = s?.width ?? 0;
  const h = s?.height ?? 0;
  const dur = Number(j.format?.duration ?? 0);
  if (!w || !h) throw new Error("ffprobe: no dimensions");
  return { width: w, height: h, durationMs: Math.round(dur * 1000) };
}

export async function generateVideoPoster(videoPath: string, posterPath: string): Promise<void> {
  await runProcess("ffmpeg", [
    "-y",
    "-nostdin",
    "-v", "error",
    "-i", videoPath,
    "-ss", "00:00:01.000",
    "-vframes", "1",
    "-vf", "scale=1280:-1",
    "-f", "image2",
    "--",
    posterPath,
  ]);
}
