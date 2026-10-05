import { compressToTarget } from '../services/compress.js';
import { PDFDocument } from 'pdf-lib';
import fs from 'fs/promises';

/**
 * Takes an array of PDF file paths, in the order the user chose, and
 * returns the bytes of a single merged PDF.
 */
export async function mergePdfs(pdfPaths) {
  const merged = await PDFDocument.create();

  for (const pdfPath of pdfPaths) {
    const bytes = await fs.readFile(pdfPath);
    const doc = await PDFDocument.load(bytes);
    const copiedPages = await merged.copyPages(doc, doc.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }

  return merged.save();
}
