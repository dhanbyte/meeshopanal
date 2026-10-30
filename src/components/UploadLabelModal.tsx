import { Check, FileText, LoaderCircle, Pencil, Trash2, UploadCloud, X } from "lucide-react";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { createShipment, findProductPriceDefault, IMAGEKIT_UPLOAD_ENABLED, isSamePricedProduct, newShipmentId, normalizeAwb, productPriceDefaultKey, saveProductPriceDefault } from "../lib/data";
import type { Client, LabelDraft, ProductPriceDefault, Shipment, ShipmentItem, UserProfile } from "../lib/types";

interface UploadLabelModalProps {
  clients: Client[];
  profile: UserProfile;
  demoMode?: boolean;
  existingAwbs?: string[];
  productPriceDefaults?: ProductPriceDefault[];
  onClose: () => void;
  onSaved: (shipment?: Shipment) => Promise<void>;
  onProductPriceDefaultSaved?: (item: ProductPriceDefault) => void;
}

interface LabelReview {
  draft: LabelDraft;
  items: ShipmentItem[];
  priceDraft: string;
  shipmentId: string;
  sourceFile: File;
  saved: boolean;
}

const emptyDraft: LabelDraft = {
  orderNumber: "", subOrderNumber: "", awb: "", courier: "", customerName: "", customerAddress: "", customerPhone: "",
  productName: "", sku: "", quantity: "1", invoiceTotal: "", rawText: "",
};

function lineAmount(items: ShipmentItem[]) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.unitCost) || 0) * Math.max(0, Number(item.quantity) || 0), 0);
}

function totalQuantity(items: ShipmentItem[]) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
}

export function UploadLabelModal({ clients, profile, demoMode = false, existingAwbs = [], productPriceDefaults = [], onClose, onSaved, onProductPriceDefaultSaved }: UploadLabelModalProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [clientId, setClientId] = useState(profile.role === "client" ? profile.clientId ?? "" : "");
  const [labels, setLabels] = useState<LabelReview[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState("");
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [priceWarning, setPriceWarning] = useState("");
  const [success, setSuccess] = useState(false);
  const grandTotal = labels.reduce((sum, label) => sum + lineAmount(label.items), 0);
  const remainingCount = labels.filter((label) => !label.saved).length;

  function updateDraft(index: number, key: "awb" | "customerName", value: string) {
    setLabels((current) => current.map((label, labelIndex) => labelIndex === index
      ? { ...label, draft: { ...label.draft, [key]: value } }
      : label));
  }

  function updateProduct(index: number, value: string) {
    setLabels((current) => current.map((label, labelIndex) => {
      if (labelIndex !== index) return label;
      const first = label.items[0] ?? { productName: "", sku: "", quantity: 1, unitCost: 0 };
      return {
        ...label,
        items: [{ ...first, productName: value }, ...label.items.slice(1)],
        draft: { ...label.draft, productName: value },
      };
    }));
  }

  function updateFirstItem(index: number, patch: Partial<ShipmentItem>) {
    setLabels((current) => current.map((label, labelIndex) => {
      if (labelIndex !== index) return label;
      const first = label.items[0] ?? { productName: label.draft.productName, sku: label.draft.sku, quantity: 1, unitCost: 0 };
      return { ...label, items: [{ ...first, ...patch }, ...label.items.slice(1)] };
    }));
  }

  function updatePrice(index: number, value: string) {
    const parsed = Number(value);
    const unitCost = value.trim() && Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    setLabels((current) => current.map((label, labelIndex) => {
      const first = label.items[0] ?? { productName: label.draft.productName, sku: label.draft.sku, quantity: 1, unitCost: 0 };
      if (labelIndex === index) return { ...label, priceDraft: value, items: [{ ...first, unitCost }, ...label.items.slice(1)] };
      if (label.saved) return label;
      const source = current[index]?.items[0] ?? { sku: "", productName: "" };
      const sameProduct = isSamePricedProduct(first, source);
      return sameProduct ? { ...label, priceDraft: value, items: [{ ...first, unitCost }, ...label.items.slice(1)] } : label;
    }));
  }

  function removeLabel(index: number) {
    setLabels((current) => current.filter((_, labelIndex) => labelIndex !== index));
  }

  async function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const nextFiles = Array.from(event.target.files ?? []);
    if (!nextFiles.length) return;
    event.currentTarget.value = "";
    setFiles((current) => [...current, ...nextFiles]);
    setError("");
    setSuccess(false);
    setReading(true);
    setProgress(0);
    try {
      const { readLabel } = await import("../lib/ocr");
      const additions: LabelReview[] = [];
      for (const [fileIndex, sourceFile] of nextFiles.entries()) {
        try {
          const drafts = await readLabel(sourceFile, (value) => setProgress(Math.round(((fileIndex + value / 100) / nextFiles.length) * 100)));
          additions.push(...drafts.map((draft) => {
            const priceDefault = findProductPriceDefault(productPriceDefaults, draft.sku, draft.productName);
            return {
              draft: { ...emptyDraft, ...draft },
              items: [{ productName: draft.productName, sku: draft.sku, quantity: Number(draft.quantity) || 1, unitCost: priceDefault?.unitCost ?? 0 }],
              priceDraft: priceDefault?.unitCost ? String(priceDefault.unitCost) : "",
              shipmentId: demoMode ? `DEMO-${crypto.randomUUID()}` : newShipmentId(),
              sourceFile,
              saved: false,
            };
          }));
        } catch (issue) {
          setError((current) => [current, `${sourceFile.name}: ${issue instanceof Error ? issue.message : "Could not read this file."}`].filter(Boolean).join(" "));
        }
      }
      if (!additions.length) throw new Error("No label pages were read. Choose a clearer PDF, JPG or PNG file.");
      setLabels((current) => [...current, ...additions]);
    } catch (issue) {
      setError((current) => [current, issue instanceof Error ? issue.message : "Could not read these labels."].filter(Boolean).join(" "));
    } finally {
      setReading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!clientId) return setError("Choose the client or panel for these labels.");
    if (!files.length) return setError("Upload the shipment label first.");
    if (!labels.length) return setError("Add at least one label row before confirming.");
    const client = clients.find((entry) => entry.id === clientId);
    if (!client) return setError("Selected client is no longer available.");

    const knownAwbs = new Set(existingAwbs.map(normalizeAwb).filter(Boolean));
    for (const [index, label] of labels.entries()) {
      const awbKey = normalizeAwb(label.draft.awb);
      if (!label.saved && !awbKey) return setError(`Row ${index + 1}: enter the tracking ID.`);
      if (!label.saved && knownAwbs.has(awbKey)) return setError(`Row ${index + 1}: AWB ${label.draft.awb} is already in the database or this upload.`);
      if (awbKey) knownAwbs.add(awbKey);
    }
    for (const [index, label] of labels.entries()) {
      if (label.saved) continue;
      if (!label.draft.customerName.trim()) return setError(`Row ${index + 1}: enter the customer name.`);
      if (!label.items[0]?.productName.trim()) return setError(`Row ${index + 1}: enter the product name.`);
      if (!Number.isFinite(label.items[0]?.quantity) || label.items[0].quantity < 1) return setError(`Row ${index + 1}: quantity must be at least 1.`);
      if (!Number.isFinite(label.items[0]?.unitCost) || label.items[0].unitCost <= 0) return setError(`Row ${index + 1}: enter the product cost.`);
    }

    setSaving(true);
    setPriceWarning("");
    let savedThisRun = 0;
    let failedRow = 0;
    let localOnlyPrice = false;
    try {
      for (const [index, label] of labels.entries()) {
        if (label.saved) continue;
        failedRow = index + 1;
        const awb = label.draft.awb.trim();
        const shipmentDetails = {
          clientId,
          clientName: client.name,
          orderNumber: label.draft.orderNumber.trim() || label.draft.subOrderNumber.trim() || awb,
          subOrderNumber: label.draft.subOrderNumber.trim(),
          awb,
          courier: label.draft.courier.trim(),
          customerName: label.draft.customerName.trim(),
          customerAddress: label.draft.customerAddress.trim(),
          customerPhone: label.draft.customerPhone.trim(),
          items: label.items.map((item) => ({ ...item, productName: item.productName.trim(), sku: item.sku.trim() })),
          invoiceTotal: Number(label.draft.invoiceTotal) || 0,
          status: "ready" as const,
        };
        for (const item of shipmentDetails.items) {
          if (item.unitCost <= 0 || !item.productName) continue;
          const id = productPriceDefaultKey(item.sku, item.productName);
          let saveResult: "synced" | "local" | "memory" = "synced";
          if (!demoMode) {
            try {
              saveResult = await saveProductPriceDefault(profile, item);
            } catch {
              saveResult = "memory";
            }
          }
          onProductPriceDefaultSaved?.({ id, ...item, updatedAt: new Date() });
          if (saveResult === "local") {
            localOnlyPrice = true;
          } else if (saveResult === "memory") {
            localOnlyPrice = true;
          }
        }
        if (demoMode) {
          const demoShipment: Shipment = { ...shipmentDetails, id: label.shipmentId, createdBy: profile.uid, createdAt: new Date(), updatedAt: new Date() };
          await onSaved(demoShipment);
        } else {
          await createShipment(profile, shipmentDetails, label.sourceFile, label.shipmentId);
        }
        savedThisRun += 1;
        setLabels((current) => current.map((entry, labelIndex) => labelIndex === index ? { ...entry, saved: true } : entry));
      }
      if (!demoMode && savedThisRun > 0) await onSaved();
      setSuccess(true);
      const notices = [
        localOnlyPrice ? "Product prices are remembered on this browser only because Firestore sync is blocked." : "",
        !IMAGEKIT_UPLOAD_ENABLED ? "Shipment rows saved; label files were not stored while ImageKit setup is on hold." : "",
      ].filter(Boolean);
      setPriceWarning(notices.join(" "));
      window.setTimeout(onClose, notices.length ? 5000 : 1200);
    } catch (issue) {
      if (!demoMode && savedThisRun > 0) await onSaved().catch(() => undefined);
      const reason = issue instanceof Error ? issue.message : "The shipment could not be saved.";
      setError(`${savedThisRun ? `Saved ${savedThisRun} label${savedThisRun === 1 ? "" : "s"}. ` : ""}Row ${failedRow || 1}: ${reason}`);
    } finally {
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card modal-wide upload-modal" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <header className="modal-header"><div><span className="modal-icon"><UploadCloud size={19} /></span><div><h2 id="upload-title">Upload Meesho labels</h2><p>Confirming adds each row’s price × quantity to that client’s pending amount.</p></div></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>
      <form onSubmit={handleSubmit}>
        <div className="modal-body upload-body upload-compact-body">
          <div className="upload-column upload-compact-sidebar">
            <button type="button" className={`dropzone ${files.length ? "dropzone-ready" : ""}`} onClick={() => fileInput.current?.click()}>
              <input ref={fileInput} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" multiple onChange={handleFiles} hidden />
              <span className="dropzone-icon">{reading ? <LoaderCircle className="spin" size={23} /> : files.length ? <FileText size={23} /> : <UploadCloud size={23} />}</span>
              <strong>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose label files"}</strong>
              <small>{reading ? `Reading… ${progress}%` : "Click to add multiple PDF, JPG or PNG files · max 25 MB each"}</small>
              {reading ? <span className="progress-track"><span style={{ width: `${progress}%` }} /></span> : null}
            </button>
            <div className="upload-client-field"><label className="field-label" htmlFor="label-client">Client / Meesho panel</label><select id="label-client" className="input" value={clientId} onChange={(event) => setClientId(event.target.value)} required><option value="">Select a client</option>{clients.filter((client) => client.active).map((client) => <option value={client.id} key={client.id}>{client.name} · {client.panelName}</option>)}</select></div>
          </div>
          <div className="upload-fields upload-compact-fields">
            <section className="label-preview" aria-live="polite">
              <div className="compact-table-wrap"><table className="data-table compact-label-table"><thead><tr><th>Tracking ID</th><th>Customer</th><th>Product</th><th>Price ₹</th><th>Qty</th><th>Total ₹</th><th>Action</th></tr></thead><tbody>
                {labels.map((label, index) => {
                  const item = label.items[0] ?? { productName: "", sku: "", quantity: 1, unitCost: 0 };
                  const awbKey = normalizeAwb(label.draft.awb);
                  const duplicate = Boolean(awbKey && (existingAwbs.some((value) => normalizeAwb(value) === awbKey) || labels.slice(0, index).some((previous) => normalizeAwb(previous.draft.awb) === awbKey)));
                  const editing = editingId === label.shipmentId;
                  return <tr key={label.shipmentId} className={duplicate && !label.saved ? "duplicate-row" : ""}>
                    <td>{editing && !label.saved ? <CompactInput ariaLabel={`Tracking ID row ${index + 1}`} value={label.draft.awb} onChange={(value) => updateDraft(index, "awb", value)} /> : <><span className="compact-cell-value">{label.draft.awb || "Needs tracking ID"}</span>{duplicate && !label.saved ? <small className="duplicate-awb-note">Already used</small> : null}</>}</td>
                    <td>{editing && !label.saved ? <CompactInput ariaLabel={`Customer name row ${index + 1}`} value={label.draft.customerName} onChange={(value) => updateDraft(index, "customerName", value)} /> : <span className="compact-cell-value">{label.draft.customerName || "Name not detected"}</span>}</td>
                    <td>{editing && !label.saved ? <CompactInput ariaLabel={`Product name row ${index + 1}`} value={item.productName} onChange={(value) => updateProduct(index, value)} /> : <span className="compact-cell-value">{item.productName || "Product not detected"}</span>}</td>
                    <td>{!label.saved ? <CompactInput ariaLabel={`Product cost row ${index + 1}`} type="number" placeholder="Cost" value={label.priceDraft} onChange={(value) => updatePrice(index, value)} disabled={saving} /> : <span>{item.unitCost ? `₹${item.unitCost.toFixed(2)}` : "—"}</span>}</td>
                    <td>{editing && !label.saved ? <CompactInput ariaLabel={`Quantity row ${index + 1}`} type="number" value={String(item.quantity || "")} onChange={(value) => updateFirstItem(index, { quantity: Number(value) || 0 })} /> : <span>{totalQuantity(label.items)}</span>}</td>
                    <td className="compact-line-total">₹{lineAmount(label.items).toFixed(2)}</td>
                    <td><div className="compact-row-actions"><button className="button button-ghost button-small" type="button" onClick={() => setEditingId(editing ? "" : label.shipmentId)} disabled={label.saved || saving} aria-label={`${editing ? "Finish edit" : "Edit row"} ${index + 1}`}>{editing ? <><Check size={13} /><span className="compact-action-label">Done</span></> : <><Pencil size={13} /><span className="compact-action-label">Edit</span></>}</button><button className="icon-button compact-remove" type="button" onClick={() => removeLabel(index)} disabled={label.saved || saving} aria-label={`Remove row ${index + 1}`}><Trash2 size={15} /></button></div></td>
                  </tr>;
                })}
                {!labels.length ? <tr><td colSpan={7}><div className="compact-empty">{reading ? "Reading the selected label pages…" : files.length ? "No rows detected yet. Choose more label files." : "Choose label files to fill this table."}</div></td></tr> : null}
              </tbody></table></div>
            </section>
          </div>
        </div>
        {error ? <div className="modal-message error-message" role="alert">{error}</div> : null}
        {priceWarning ? <div className="modal-message price-warning" role="status">{priceWarning}</div> : null}
        {success ? <div className="modal-message success-message"><Check size={16} />{demoMode ? `${labels.length} demo row${labels.length === 1 ? "" : "s"} saved temporarily.` : `${labels.length} shipment${labels.length === 1 ? "" : "s"} saved; AWBs reserved.`}</div> : null}
        <footer className="modal-footer upload-modal-footer"><div className="upload-grand-total"><small>Total amount</small><strong>₹{grandTotal.toFixed(2)}</strong></div><div className="upload-footer-actions"><button className="button button-secondary" type="button" onClick={onClose}>Cancel</button><button className="button button-primary" type="submit" disabled={saving || reading || success || !remainingCount}>{saving ? "Saving…" : `Confirm ${remainingCount} row${remainingCount === 1 ? "" : "s"}`}<Check size={16} /></button></div></footer>
      </form>
    </section>
  </div>;
}

function CompactInput({ value, onChange, ariaLabel, type = "text", placeholder, disabled }: { value: string; onChange: (value: string) => void; ariaLabel: string; type?: "text" | "number"; placeholder?: string; disabled?: boolean }) {
  return <input className="input compact-input" value={value} type={type} min={type === "number" ? "0" : undefined} step={type === "number" ? "0.01" : undefined} inputMode={type === "number" ? "decimal" : undefined} placeholder={placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={ariaLabel} />;
}
