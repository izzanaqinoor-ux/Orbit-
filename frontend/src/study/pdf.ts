/** Reads text out of a PDF (or a plain text file) in the browser. The file never leaves the device. */
export interface Doc { name: string; pages: string[] }

const cleanName = (n: string) => n.replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();

export async function readFile(file: File): Promise<Doc> {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") return extractPdf(file);
  return fromText(cleanName(file.name), await file.text());
}

/** Plain text has no pages, so cut it into page-sized pieces (form feeds first, then about 1,800 characters). */
export function fromText(name: string, text: string): Doc {
  const byFeed = text.split("\f").map((s) => s.trim()).filter(Boolean);
  if (byFeed.length > 1) return { name, pages: byFeed };
  const paras = text.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean), pages: string[] = [];
  let cur = "";
  for (const p of paras) { if (cur && cur.length + p.length > 1800) { pages.push(cur); cur = ""; } cur += (cur ? "\n\n" : "") + p; }
  if (cur) pages.push(cur);
  return { name, pages: pages.length ? pages : [""] };
}

export async function extractPdf(file: File): Promise<Doc> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const raw = (await import("pdfjs-dist/build/pdf.worker.min.mjs?raw")).default;
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([raw], { type: "text/javascript" }));
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 500); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    const lines: { y: number; parts: { x: number; s: string }[] }[] = [];
    for (const it of content.items) {
      if (!("str" in it) || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5];
      const row = lines.find((l) => Math.abs(l.y - y) < 3);
      if (row) row.parts.push({ x, s: it.str }); else lines.push({ y, parts: [{ x, s: it.str }] });
    }
    lines.sort((a, b) => b.y - a.y);
    pages.push(lines.map((l) => l.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " ").trim()).join("\n"));
  }
  return { name: cleanName(file.name), pages };
}
