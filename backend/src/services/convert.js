import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { PDFDocument } from 'pdf-lib';

const execFileAsync = promisify(execFile);
const SOFFICE_PATH = process.env.SOFFICE_PATH || 'soffice';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

/**
 * Converts a single file on disk into a PDF on disk and returns the new path.
 * - PDFs pass through untouched.
 * - Images are wrapped in a single-page PDF.
 * - Everything else (docx, pptx, xlsx, odt, txt, rtf, etc.) is converted
 *   with LibreOffice headless, which handles nearly every office format.
 */
export async function convertToPdf(inputPath, workDir) {
  const ext = path.extname(inputPath).toLowerCase();

  if (ext === '.pdf') {
    return inputPath;
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return imageToPdf(inputPath, workDir);
  }

  return officeToPdf(inputPath, workDir);
}

async function imageToPdf(inputPath, workDir) {
  const bytes = await fs.readFile(inputPath);
  const pdfDoc = await PDFDocument.create();
  const ext = path.extname(inputPath).toLowerCase();

  const image =
    ext === '.png' ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);

  const page = pdfDoc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });

  const outPath = path.join(workDir, `${path.parse(inputPath).name}.pdf`);
  await fs.writeFile(outPath, await pdfDoc.save());
  return outPath;
}

async function officeToPdf(inputPath, workDir) {
  // soffice writes <basename>.pdf into --outdir using the same file name.
  const {  stdout, stderr } = await execFileAsync(SOFFICE_PATH, [
    '--headless',
    '--norestore',
        `-env:UserInstallation=file://${workDir}/lo-profile`,
    '--convert-to',
    'pdf',
    '--outdir',
    workDir,
    inputPath,
  ]);
    console.log('soffice said:', stdout, stderr);

  const outPath = path.join(workDir, `${path.parse(inputPath).name}.pdf`);

  // Guard against slow/odd conversions before the caller tries to read it.
  await fs.access(outPath);
  return outPath;
}

export async function makeTempWorkDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'paper-duet-'));
}
