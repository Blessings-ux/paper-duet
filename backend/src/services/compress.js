import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const run = promisify(execFile);
const PRESETS = ['/printer', '/ebook', '/screen']; // best quality -> smallest

async function runGhostscript(inputPath, outputPath, preset) {
  await run(
    'gs',
    [
      '-sDEVICE=pdfwrite',
      '-dCompatibilityLevel=1.4',
      `-dPDFSETTINGS=${preset}`,
      '-dNOPAUSE',
      '-dQUIET',
      '-dBATCH',
      '-dSAFER',
      `-sOutputFile=${outputPath}`,
      inputPath,
    ],
    { timeout: 120000 }
  );
}

// Returns { bytes, reachedTarget }. Never returns a file bigger than the input.
export async function compressToTarget(mergedBytes, targetBytes, workDir) {
  if (mergedBytes.length <= targetBytes) {
    return { bytes: mergedBytes, reachedTarget: true };
  }

  const inputPath = path.join(workDir, 'merged-input.pdf');
  await fs.writeFile(inputPath, mergedBytes);

  let best = mergedBytes;

  for (const preset of PRESETS) {
    const outputPath = path.join(workDir, `compressed${preset.replace('/', '-')}.pdf`);
    try {
      await runGhostscript(inputPath, outputPath, preset);
    } catch (err) {
      console.error(`Ghostscript ${preset} failed:`, err.message);
      continue;
    }
    const out = await fs.readFile(outputPath);
    if (out.length < best.length) best = out;
    if (out.length <= targetBytes) return { bytes: out, reachedTarget: true };
  }

  return { bytes: best, reachedTarget: false };
}