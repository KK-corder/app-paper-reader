import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('bundled pdf.js parses the generated PDF and all 12 numbered pages', async () => {
  // Parsing text needs no canvas. Node lacks browser geometry; no raster rendering is claimed here.
  globalThis.DOMMatrix ||= class {};
  const pdfjs = await import('../vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await readFile(new URL('../demo/reader-demo.pdf', import.meta.url))),
    useSystemFonts: true, isEvalSupported: false,
  });
  try {
    const pdf = await task.promise;
    assert.equal(pdf.numPages, 12);
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const text = (await page.getTextContent()).items.map(item => item.str);
      assert.ok(text.includes(`Page ${number} / 12`));
      assert.ok(text.includes(String(number).padStart(2, '0')));
      assert.ok((await page.getOperatorList()).fnArray.length > 0);
    }
  } finally { await task.destroy(); }
});
