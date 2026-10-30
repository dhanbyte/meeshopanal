import { createWorker } from "tesseract.js";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { parseLabelText, parsePositionedLabel, type PositionedText } from "./labelParser";
import type { LabelDraft } from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_PDF_PAGES = 30;

function textItemsFromPdf(items: unknown[]): PositionedText[] {
  return items.flatMap((value) => {
    if (!value || typeof value !== "object" || !("str" in value) || !("transform" in value)) return [];
    const item = value as { str: string; transform: number[] };
    return [{ text: item.str, x: item.transform[4] ?? 0, y: item.transform[5] ?? 0 }];
  });
}

function canvasForImage(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("This browser could not prepare the label for reading."));
        return;
      }
      const scale = Math.min(1.25, 1500 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      resolve(canvas);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image could not be opened. Please try a JPG or PNG label."));
    };
    image.src = objectUrl;
  });
}

async function recognizeCanvas(canvas: HTMLCanvasElement, worker: Awaited<ReturnType<typeof createWorker>>) {
  const result = await worker.recognize(canvas);
  return result.data.text;
}

function needsOcrFallback(draft: LabelDraft) {
  return !draft.orderNumber || !draft.awb || !draft.customerName || !draft.customerAddress || !draft.productName;
}

function fillMissingFields(primary: LabelDraft, fallback: LabelDraft): LabelDraft {
  return {
    ...primary,
    orderNumber: primary.orderNumber || fallback.orderNumber,
    subOrderNumber: primary.subOrderNumber || fallback.subOrderNumber,
    awb: primary.awb || fallback.awb,
    courier: primary.courier || fallback.courier,
    customerName: primary.customerName || fallback.customerName,
    customerAddress: primary.customerAddress || fallback.customerAddress,
    customerPhone: primary.customerPhone || fallback.customerPhone,
    productName: primary.productName || fallback.productName,
    sku: primary.sku || fallback.sku,
    quantity: primary.quantity || fallback.quantity,
    invoiceTotal: primary.invoiceTotal || fallback.invoiceTotal,
    rawText: `${primary.rawText}\n\n[OCR fallback]\n${fallback.rawText}`,
  };
}

export { parseLabelText };

export async function readLabel(file: File, onProgress?: (progress: number) => void): Promise<LabelDraft[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error("Label file is too large. Please use a file smaller than 25 MB.");
  if (!(file.type.startsWith("image/") || file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"))) {
    throw new Error("Upload a PDF, JPG or PNG label.");
  }

  let activeOcrPage = 1;
  let pageCount = 1;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  const getWorker = async () => {
    if (!worker) {
      worker = await createWorker("eng", 1, { logger: (message) => {
        if (message.status === "recognizing text") {
          onProgress?.(Math.round(((activeOcrPage - 1 + message.progress) / pageCount) * 100));
        }
      } });
    }
    return worker;
  };

  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    try {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > MAX_PDF_PAGES) throw new Error(`This PDF has ${pdf.numPages} pages. Upload up to ${MAX_PDF_PAGES} label pages at a time.`);
      pageCount = pdf.numPages;
      const drafts: LabelDraft[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        activeOcrPage = pageNumber;
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items = textItemsFromPdf(content.items);
        const extractedText = items.map((item) => item.text).join(" ").trim();
        if (extractedText.length >= 120) {
          const directDraft = parsePositionedLabel(items, viewport.width, viewport.height);
          if (!needsOcrFallback(directDraft)) {
            drafts.push(directDraft);
            onProgress?.(Math.round((pageNumber / pdf.numPages) * 100));
            continue;
          }

          const ocrWorker = await getWorker();
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("This browser could not prepare the PDF for reading.");
          const renderViewport = page.getViewport({ scale: 1.2 });
          canvas.width = Math.ceil(renderViewport.width);
          canvas.height = Math.ceil(renderViewport.height);
          await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
          const fallbackDraft = parseLabelText(await recognizeCanvas(canvas, ocrWorker));
          drafts.push(fillMissingFields(directDraft, fallbackDraft));
          canvas.width = 0;
          canvas.height = 0;
          onProgress?.(Math.round((pageNumber / pdf.numPages) * 100));
          continue;
        }

        const ocrWorker = await getWorker();
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("This browser could not prepare the PDF for reading.");
        const renderViewport = page.getViewport({ scale: 1.2 });
        canvas.width = Math.ceil(renderViewport.width);
        canvas.height = Math.ceil(renderViewport.height);
        await page.render({ canvas, canvasContext: context, viewport: renderViewport }).promise;
        drafts.push(parseLabelText(await recognizeCanvas(canvas, ocrWorker)));
        canvas.width = 0;
        canvas.height = 0;
        onProgress?.(Math.round((pageNumber / pdf.numPages) * 100));
      }
      return drafts;
    } finally {
      if (worker) await worker.terminate();
      await loadingTask.destroy();
    }
  }

  const ocrWorker = await getWorker();
  try {
    const canvas = await canvasForImage(file);
    const rawText = await recognizeCanvas(canvas, ocrWorker);
    onProgress?.(100);
    canvas.width = 0;
    canvas.height = 0;
    return [parseLabelText(rawText)];
  } finally {
    await ocrWorker.terminate();
  }
}
