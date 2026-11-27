/**
 * "Pobierz PDF": the same operator sheet as the printout, saved straight to a file. Every A4 page
 * of the print sheet is drawn to an image (2.5× for sharp lines and text) and put on a PDF page.
 * The libraries are loaded only when a PDF is made.
 */
export async function downloadSheetPdf(sheet: HTMLElement, fileName: string): Promise<void> {
  const [{ toCanvas }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  sheet.classList.add('is-capturing');
  const restore = inlineSvgStyles(sheet);
  try {
    await document.fonts?.ready;
    const pages = [...sheet.querySelectorAll<HTMLElement>('.bb-a4')];
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const canvas = await toCanvas(page, { pixelRatio: 2.5, backgroundColor: '#ffffff', cacheBust: false });
      const img = canvas.toDataURL('image/png');
      if (i > 0) pdf.addPage('a4', 'landscape');
      // A4 landscape 297 × 210 mm; a page that grew taller (many holes) is scaled to fit.
      let w = 297;
      let h = (page.offsetHeight * w) / page.offsetWidth;
      if (h > 210) {
        w *= 210 / h;
        h = 210;
      }
      pdf.addImage(img, 'PNG', (297 - w) / 2, 0, w, h, undefined, 'FAST');
    }
    pdf.save(fileName);
  } finally {
    restore();
    sheet.classList.remove('is-capturing');
  }
}

/** SVG properties set by CSS classes; the image renderer only sees them when written on the elements. */
const SVG_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'paint-order',
  'display',
  'visibility',
];

/** Write the computed SVG styles on every SVG element of the sheet; returns a function that undoes it. */
function inlineSvgStyles(root: HTMLElement): () => void {
  const saved: [Element, string | null][] = [];
  root.querySelectorAll('svg, svg *').forEach((el) => {
    const cs = getComputedStyle(el);
    saved.push([el, el.getAttribute('style')]);
    const css = SVG_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
    el.setAttribute('style', `${el.getAttribute('style') ?? ''};${css}`);
  });
  return () => {
    for (const [el, st] of saved) {
      if (st === null) el.removeAttribute('style');
      else el.setAttribute('style', st);
    }
  };
}

/** File name from the bar name and the order number, without characters Windows does not allow. */
export function pdfFileName(name: string, orderNo: string): string {
  const base = [name, orderNo]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim();
  return `${base || 'szyna'}.pdf`;
}
