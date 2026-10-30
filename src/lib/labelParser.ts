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

function parseCustomerLines(lines: string[]) {
  const marker = lines.findIndex((line) => /\bcustomer\s+address\b/i.test(line));
  if (marker < 0) return { customerName: "", customerAddress: "" };
  const stop = lines.findIndex((line, index) => index > marker && /if\s+undelivered|return\s+to\s*:/i.test(line));
  const block = lines.slice(marker + 1, stop < 0 ? marker + 7 : stop)
    .map((line) => normalizeLine(line))
    .filter((line) => line && !/^(check the payable amount|prepaid:|cod:)/i.test(line));
  return { customerName: block[0] ?? "", customerAddress: block.slice(1).join(", ") };
}

function trackingNumber(text: string) {
  const labeled = text.match(/\b(?:AWB|air\s*way\s*bill|waybill|tracking(?:\s+(?:ID|number|no\.?))?)\s*(?:(?:number|no\.?|ID)\s*)?[:#-]?\s*([A-Z0-9][A-Z0-9-]{7,23})\b/i)?.[1];
  const prefixed = text.match(/\b(?:VL\d{8,18}|SF[A-Z0-9]{8,18}|[A-Z]{2,4}\d{8,18}[A-Z]{0,4})\b/i)?.[0];
  return (labeled || prefixed || "").toUpperCase();
}

export function parseLabelText(text: string): LabelDraft {
  const lines = text.split(/\r?\n/).map(normalizeLine).filter(Boolean);
  const subOrderNumber = text.match(/\b(\d{15,24}_\d{1,4})\b/)?.[1] ?? "";
  const purchaseIndex = lines.findIndex((line) => /purchase\s+order\s+no/i.test(line));
  const purchaseBlock = purchaseIndex >= 0 ? lines.slice(purchaseIndex, purchaseIndex + 4).join(" ") : "";
  const orderNumber = valueMatches(purchaseBlock, /purchase\s+order\s+no\.?\s*([0-9]{15,24})/i)
    || (subOrderNumber ? subOrderNumber.replace(/_\d+$/, "") : "");
  const customer = parseCustomerLines(lines);
  const courier = text.match(/\b(Valmo|Shadowfax|Delhivery|Ecom\s*Express|XpressBees|Blue\s*Dart|Ekart)\s+Pickup\b/i)?.[1] ?? "";
  const skuRow = lines.find((line) => subOrderNumber && line.includes(subOrderNumber)) ?? "";
  const sku = skuRow.split(/\s+/)[0] ?? "";
  const quantity = valueMatches(skuRow, /Free\s+Size\s+(\d{1,4})/i)
    || valueMatches(text, /(?:Qty|Quantity|Pieces)\s*[:#-]?\s*(\d{1,4})/i)
    || "1";
  const invoiceTotalLine = [...lines].reverse().find((line) => /^Total\b/i.test(line) && (line.match(/(?:Rs\.?\s*)?[\d,]+\.\d{2}/gi)?.length ?? 0) >= 2) ?? "";
  const amounts = invoiceTotalLine.match(/[\d,]+(?:\.\d{1,2})?/g) ?? [];
  const phone = text.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] ?? "";
  const descriptionIndex = lines.findIndex((line) => /^Description\b/i.test(line));
  const chargesIndex = lines.findIndex((line, index) => index > descriptionIndex && /^Other\s+Charges\b/i.test(line));
  const productName = descriptionIndex >= 0
    ? lines.slice(descriptionIndex + 1, chargesIndex > descriptionIndex ? chargesIndex : descriptionIndex + 6)
      .filter((line) => !/\b(?:HSN|IGST|Rs\.?\s*\d|850940)\b/i.test(line)).join(" ")
    : "";
  return {
    ...emptyDraft,
    orderNumber,
    subOrderNumber,
    awb: trackingNumber(text),
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
  const customer = parseCustomerLines(leftLines.map((line) => line.text));

  const subOrderNumber = fullText.match(/\b(\d{15,24}_\d{1,4})\b/)?.[1] ?? "";
  const purchaseIndex = allLines.findIndex((line) => /purchase\s+order\s+no/i.test(line.text));
  const purchaseLines = purchaseIndex >= 0 ? allLines.slice(purchaseIndex, purchaseIndex + 4).map((line) => line.text).join(" ") : "";
  const orderNumber = valueMatches(purchaseLines, /purchase\s+order\s+no\.?\s*([0-9]{15,24})/i)
    || (subOrderNumber ? subOrderNumber.replace(/_\d+$/, "") : "");

  const productRow = allLines.find((line) => subOrderNumber && line.text.includes(subOrderNumber))?.text ?? "";
  const sku = productRow.split(/\s+/)[0] ?? "";
  const quantity = valueMatches(productRow, /Free\s+Size\s+(\d{1,4})/i) || "1";
  const descriptionLine = allLines.find((line) => line.parts.some((part) => /^Description$/i.test(part.text.trim())));
  const otherChargesLine = allLines.find((line) => line.parts.some((part) => /^Other\s+Charges$/i.test(part.text.trim())));
  let productName = "";
  if (descriptionLine && otherChargesLine) {
    productName = allLines
      .filter((line) => line.y < descriptionLine.y - 1 && line.y > otherChargesLine.y + 1)
      .map((line) => line.parts.filter((part) => part.x < pageWidth * 0.21).sort((left, right) => left.x - right.x).map((part) => part.text).join(" "))
      .map(normalizeLine)
      .filter((line) => line && !/^Other\s+Charges$/i.test(line))
      .join(" ");
  }

  const totalLine = [...allLines].reverse().find((line) => /^Total\b/i.test(line.text) && (line.text.match(/[\d,]+\.\d{2}/g)?.length ?? 0) >= 2)?.text ?? "";
  const amounts = totalLine.match(/[\d,]+(?:\.\d{1,2})?/g) ?? [];
  const phone = fullText.match(/(?:\+?91[\s-]?)?[6-9]\d{9}\b/)?.[0] ?? "";
  const courier = rightLines.map((line) => line.text).join(" ").match(/\b(Valmo|Shadowfax|Delhivery|Ecom\s*Express|XpressBees|Blue\s*Dart|Ekart)\s+Pickup\b/i)?.[1] ?? "";

  return {
    ...emptyDraft,
    orderNumber,
    subOrderNumber,
    awb: trackingNumber(rightLines.map((line) => line.text).join(" ")),
    courier,
    customerName: customer.customerName,
    customerAddress: customer.customerAddress,
    customerPhone: phone,
    productName,
    sku,
    quantity,
    invoiceTotal: amounts.at(-1)?.replace(/,/g, "") ?? "",
    rawText: fullText,
  };
}
