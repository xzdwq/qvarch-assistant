import { degrees, PDFDocument } from 'pdf-lib'
import { pdfImageBox, type PageBox, type Placed } from '@shared/pdfPlacement'

/**
 * The signed copy: the original PDF with every placed drawing drawn on its page (each picture embedded once;
 * `imageOf` gives the drawing as shown — its tint).
 */
export async function signedPdf(original: Uint8Array, items: Placed[], pages: PageBox[], imageOf: (it: Placed) => Promise<string>): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original)
  const embedded = new Map<string, Awaited<ReturnType<typeof pdf.embedPng>>>()
  for (const it of items) {
    const page = pdf.getPage(it.page - 1)
    const src = await imageOf(it)
    let png = embedded.get(src)
    if (!png) embedded.set(src, (png = await pdf.embedPng(src)))
    const box = pdfImageBox(it, pages[it.page - 1].view)
    page.drawImage(png, { x: box.x, y: box.y, width: box.width, height: box.height, rotate: degrees(box.rotateDeg), opacity: it.opacity })
  }
  return pdf.save()
}
