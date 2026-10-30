import type { LabelDraft } from "./types";

export interface PositionedText {
  text: string;
  x: number;
  y: number;
}

interface TextLine {
  text: string;
  x: number;
  y: number;
  parts: PositionedText[];
}

const emptyDraft: LabelDraft = {
  orderNumber: "", subOrderNumber: "", awb: "", courier: "", customerName: "", customerAddress: "", customerPhone: "",
  productName: "", sku: "", quantity: "1", invoiceTotal: "", rawText: "",
};

function normalizeLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function groupPositionedText(items: PositionedText[], include: (item: PositionedText) => boolean = () => true): TextLine[] {
  const groups: { y: number; parts: PositionedText[] }[] = [];
  for (const item of items) {
    if (!item.text.trim() || !include(item)) continue;
    let group = groups.find((candidate) => Math.abs(candidate.y - item.y) <= 2.5);
    if (!group) {
      group = { y: item.y, parts: [] };
      groups.push(group);
    }
    group.parts.push(item);
  }
  return groups
    .map((group) => {
      const parts = group.parts.sort((left, right) => left.x - right.x);
      return {
        text: normalizeLine(parts.map((part) => part.text).join(" ")),
        x: parts[0]?.x ?? 0,
        y: group.y,
        parts,
      };
    })
    .filter((line) => line.text)
    .sort((left, right) => right.y - left.y);
}

function valueMatches(text: string, expression: RegExp) {
  return text.match(expression)?.[1]?.trim() ?? "";
}

function firstMatch(text: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

function normalizeTextForParsing(rawText: string) {
  return rawText
    .replace(/\u00A0/g, " ")
    .replace(/\|/g, " ")
    .replace(/(\d)(?:\s*[-/\\]\s*)(?=\d)/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCustomerLines(lines: string[]) {
  const lineText = lines.join("\n");
  const markers = [
    /\b(?:customer|consignee|ship\s*to|delivery\s*to|recipient|buyer)\s*(?:name|details)?\b/i,
    /\bcustomer\s+address\b/i,
  ];
  const markerIndex = lines.findIndex((line) => markers.some((pattern) => pattern.test(line)));
  if (markerIndex < 0) {
    const fallbackName = lines.find((line) => /^(?:Mr|Ms|Mrs|M\.?\s*)?[A-Z][A-Za-z\s.'-]{2,40}$/.test(line) && !/order|awb|tracking|phone|address|pincode|city|state/i.test(line));
    return { customerName: fallbackName ?? "", customerAddress: lines.slice(0, 3).join(", ") };
  }

  const block = lines.slice(markerIndex + 1, markerIndex + 8)
    .map((line) => normalizeLine(line))
    .filter((line) => line && !/^(check the payable amount|prepaid:|cod:|contact no|phone|mobile|pincode|shipping label)$/i.test(line));

  const customerName = block.find((line) => !/\b(?:address|city|state|pincode|phone|mobile|pin|phone no)\b/i.test(line)) ?? "";
  const customerAddress = block.filter((line) => !/^(?:mr|ms|mrs|name|customer)$/i.test(line)).join(", ");
  if (customerName || customerAddress) {
    return {
      customerName: customerName || (lineText.match(/(?:customer|consignee|ship\s*to|delivery\s*to)\s*[:\-]?\s*([A-Z][A-Za-z.\s'-]{2,60})/i)?.[1]?.trim() ?? ""),
      customerAddress: customerAddress || "",
    };
  }

  return { customerName: "", customerAddress: "" };
}

function trackingNumber(text: string) {
  const normalized = normalizeTextForParsing(text);
  const explicitPatterns = [
    /\b(?:AWB|air\s*way\s*bill|waybill|tracking(?:\s+(?:ID|number|no\.?))?|consignment(?:\s+(?:ID|number|no\.?))?|shipment(?:\s+(?:ID|number|no\.?))?)\s*(?:(?:number|no\.?|ID)\s*)?[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,23})\b/i,
    /\b(?:waybill|tracking|awb|consignment|shipment)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,23})\b/i,
    /\b(?:[A-Z]{2,5}\d{8,18}[A-Z0-9]{0,6}|\d{12,18}|VL\d{8,18}|SF[A-Z0-9]{8,18})\b/g,
  ];

  const explicit = firstMatch(normalized, explicitPatterns);
  if (explicit) return explicit.toUpperCase();

  const generic = normalized.match(/\b(?:[A-Z]{2,5}\d{8,18}[A-Z0-9]{0,6}|\d{12,18})\b/g)?.find((candidate) => {
    const line = normalized.slice(Math.max(0, normalized.indexOf(candidate) - 50), normalized.indexOf(candidate) + 50);
    return !/\b(?:order|po|purchase|invoice|qty|total)\b/i.test(line);
  });

  return (generic ?? "").toUpperCase();
}

export function parseLabelText(text: string): LabelDraft {
  const rawText = normalizeTextForParsing(text);
  const lines = rawText.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const subOrderNumber = rawText.match(/\b(\d{12,24}_\d{1,6})\b/i)?.[1] ?? rawText.match(/\b(\d{12,24}[A-Z0-9_-]{0,10})\b/)?.[1] ?? "";
  const orderNumber = firstMatch(rawText, [
    /\b(?:purchase\s+order(?:\s+(?:no|number|id))?|order(?:\s+(?:no|number|id))?|po(?:\s+(?:no|number|id))?|merchant\s+order(?:\s+(?:no|number|id))?)\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i,
    /\b[Oo]rder\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i,
  ]) || (subOrderNumber ? subOrderNumber.replace(/_\d+$/, "") : "");

  const customer = parseCustomerLines(lines);
  const courier = rawText.match(/\b(Valmo|Shadowfax|Delhivery|Ecom\s*Express|XpressBees|Blue\s*Dart|Ekart|BlueDart|Dtdc|DTDC|Amazon|Meesho)\b/i)?.[1]
    ?? rawText.match(/\b(?:express|courier|pickup)\s*(?:service|partner)?\s*[:#-]?\s*([A-Za-z0-9 .-]{3,30})/i)?.[1] ?? "";

  const skuRow = lines.find((line) => line.includes(subOrderNumber) || /(?:SKU|Item\s*Code|Product\s*Code)/i.test(line)) ?? "";
  const sku = skuRow.match(/\b(?:SKU|Item\s*Code|Product\s*Code|Product\s*ID|SKU\s*No)\s*[:#-]?\s*([A-Z0-9-]{3,30})\b/i)?.[1]
    || skuRow.split(/\s+/).find((token) => /^[A-Z0-9-]{3,20}$/.test(token))
    || "";
  const quantity = valueMatches(rawText, /(?:Qty|Quantity|Pieces|Units)\s*[:#-]?\s*(\d{1,4})/i)
    || valueMatches(skuRow, /(?:Free\s+Size|Size|Qty)\s+(\d{1,4})/i)
    || "1";

  const invoiceTotalLine = [...lines].reverse().find((line) => /(?:total|amount|payable|invoice|grand total)/i.test(line) && /[\d,]+(?:\.\d{1,2})?/.test(line)) ?? "";
  const amounts = invoiceTotalLine.match(/[\d,]+(?:\.\d{1,2})?/g) ?? [];
  const phone = rawText.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] ?? "";

  const descriptionIndex = Math.max(lines.findIndex((line) => /^Description\b/i.test(line)), lines.findIndex((line) => /^Product\b/i.test(line))); 
  const chargesIndex = lines.findIndex((line, index) => index > (descriptionIndex >= 0 ? descriptionIndex : 0) && /(?:Other\s+Charges|Charges|Amount)/i.test(line));
  const productName = descriptionIndex >= 0
    ? lines.slice(descriptionIndex + 1, chargesIndex > descriptionIndex ? chargesIndex : descriptionIndex + 8)
      .filter((line) => line && !/\b(?:HSN|IGST|GST|SKU|Rs\.?\s*\d|Total|Amount|Qty|Quantity|Price)\b/i.test(line))
      .join(" ")
    : lines.find((line) => !/\b(?:awb|tracking|order|po|customer|phone|address|pincode|city|state|qty|amount|total|courier)\b/i.test(line) && line.length > 3)?.trim() ?? "";

  return {
    ...emptyDraft,
    orderNumber,
    subOrderNumber,
    awb: trackingNumber(rawText),
    courier,
    customerName: customer.customerName,
    customerAddress: customer.customerAddress,
    customerPhone: phone,
    productName,
    sku,
    quantity,
    invoiceTotal: amounts.at(-1)?.replace(/,/g, "") ?? "",
    rawText: text,
  };
}

export function parsePositionedLabel(items: PositionedText[], pageWidth: number, pageHeight: number): LabelDraft {
  const allLines = groupPositionedText(items);
  const leftLines = groupPositionedText(items, (item) => item.x < pageWidth * 0.43 && item.y > pageHeight * 0.55);
  const rightLines = groupPositionedText(items, (item) => item.x > pageWidth * 0.42 && item.y > pageHeight * 0.55);
  const fullText = allLines.map((line) => line.text).join("\n");
  const textForParsing = normalizeTextForParsing(fullText);
  const customer = parseCustomerLines(leftLines.map((line) => line.text));

  const subOrderNumber = textForParsing.match(/\b(\d{12,24}_\d{1,6})\b/i)?.[1] ?? "";
  const orderNumber = firstMatch(textForParsing, [
    /\b(?:purchase\s+order(?:\s+(?:no|number|id))?|order(?:\s+(?:no|number|id))?|po(?:\s+(?:no|number|id))?|merchant\s+order(?:\s+(?:no|number|id))?)\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i,
    /\b[Oo]rder\s*[:#-]?\s*([A-Z0-9-]{6,24})\b/i,
  ]) || (subOrderNumber ? subOrderNumber.replace(/_\d+$/, "") : "");

  const productRow = allLines.find((line) => subOrderNumber && line.text.includes(subOrderNumber))?.text ?? "";
  const sku = productRow.split(/\s+/).find((token) => /^[A-Z0-9-]{3,20}$/.test(token)) ?? "";
  const quantity = valueMatches(productRow, /(?:Free\s+Size|Size|Qty|Quantity)\s+(\d{1,4})/i) || "1";
  const descriptionLine = allLines.find((line) => line.parts.some((part) => /^Description$/i.test(part.text.trim())));
  const otherChargesLine = allLines.find((line) => line.parts.some((part) => /^(?:Other\s+Charges|Charges)$/i.test(part.text.trim())));
  let productName = "";
  if (descriptionLine && otherChargesLine) {
    productName = allLines
      .filter((line) => line.y < descriptionLine.y - 1 && line.y > otherChargesLine.y + 1)
      .map((line) => line.parts.filter((part) => part.x < pageWidth * 0.21).sort((left, right) => left.x - right.x).map((part) => part.text).join(" "))
      .map(normalizeLine)
      .filter((line) => line && !/^(?:Other\s+Charges|Charges)$/i.test(line))
      .join(" ");
  }

  const totalLine = [...allLines].reverse().find((line) => /(?:total|amount|payable|invoice|grand total)/i.test(line.text) && /[\d,]+(?:\.\d{1,2})?/.test(line.text))?.text ?? "";
  const amounts = totalLine.match(/[\d,]+(?:\.\d{1,2})?/g) ?? [];
  const phone = textForParsing.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] ?? "";
  const courier = rightLines.map((line) => line.text).join(" ").match(/\b(Valmo|Shadowfax|Delhivery|Ecom\s*Express|XpressBees|Blue\s*Dart|Ekart|BlueDart|DTDC|Dtdc|Amazon|Meesho)\b/i)?.[1] ?? "";

  return {
    ...emptyDraft,
    orderNumber,
    subOrderNumber,
    awb: trackingNumber(textForParsing),
    courier,
    customerName: customer.customerName,
    customerAddress: customer.customerAddress,
    customerPhone: phone,
    productName: productName || (allLines.find((line) => !/\b(?:awb|tracking|order|po|customer|phone|address|pincode|city|state|qty|amount|total|courier)\b/i.test(line.text) && line.text.length > 3)?.text ?? ""),
    sku,
    quantity,
    invoiceTotal: amounts.at(-1)?.replace(/,/g, "") ?? "",
    rawText: fullText,
  };
}
