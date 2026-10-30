import { Check, Copy, FileImage, FileVideo, KeyRound, LoaderCircle, Plus, UploadCloud, X } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ReactNode } from "react";
import { createClient, createLedgerEntry, createReturnRecord, deleteUploadedFile, getProtectedFileUrl, IMAGEKIT_UPLOAD_ENABLED, newReturnId, normalizeAwb, updateClientDetails, updateShipmentDetails, uploadReturnFile } from "../lib/data";
import { saveClientLogin } from "../lib/clientLogin";
import type { Client, EvidenceFile, LedgerType, ReturnCondition, Shipment, UserProfile } from "../lib/types";

export function AddClientModal({ profile, onClose, onSaved }: { profile: UserProfile; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [panelName, setPanelName] = useState("");
  const [contactName, setContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceFeePercent, setServiceFeePercent] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await createClient({ name: name.trim(), businessName: businessName.trim(), panelName: panelName.trim(), contactName: contactName.trim(), phone: phone.trim(), email: email.trim(), serviceFeePercent: Number(serviceFeePercent) || 0, openingBalance: 0, active: true }, profile.uid);
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not add client.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Add a client" description="Keep each Meesho panel and its money ledger separate." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <Field label="Client name" value={name} onChange={setName} required />
        <Field label="Business / shop name" value={businessName} onChange={setBusinessName} />
        <Field label="Meesho panel name / ID" value={panelName} onChange={setPanelName} required />
        <Field label="Contact person" value={contactName} onChange={setContactName} />
        <Field label="Phone" value={phone} onChange={setPhone} />
        <Field label="Email" value={email} onChange={setEmail} type="email" />
        <Field label="Service fee (%)" value={serviceFeePercent} onChange={setServiceFeePercent} type="number" min="0" max="100" step="0.01" />
      </div>
      {error ? <FormError>{error}</FormError> : null}
      <ModalFooter onClose={onClose} busy={busy} action="Save client" />
    </form>
  </Modal>;
}

export function EditClientModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => Promise<void> }) {
  const [name, setName] = useState(client.name);
  const [businessName, setBusinessName] = useState(client.businessName ?? "");
  const [panelName, setPanelName] = useState(client.panelName);
  const [contactName, setContactName] = useState(client.contactName ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [email, setEmail] = useState(client.email ?? "");
  const [serviceFeePercent, setServiceFeePercent] = useState(String(client.serviceFeePercent));
  const [active, setActive] = useState(client.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const fee = Number(serviceFeePercent);
    if (!name.trim() || !panelName.trim()) return setError("Client name and Meesho panel are required.");
    if (!Number.isFinite(fee) || fee < 0 || fee > 100) return setError("Service fee must be between 0 and 100%.");
    setBusy(true);
    try {
      await updateClientDetails(client.id, { name: name.trim(), businessName: businessName.trim(), panelName: panelName.trim(), contactName: contactName.trim(), phone: phone.trim(), email: email.trim(), serviceFeePercent: fee, active });
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Client details could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Edit client details" description="Update the business and contact information. Client record ID stays fixed." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <div className="hint-box"><strong>Client record ID</strong><span>{client.id}</span></div>
      <div className="form-grid">
        <Field label="Client / account name" value={name} onChange={setName} required />
        <Field label="Business / shop name" value={businessName} onChange={setBusinessName} />
        <Field label="Meesho panel" value={panelName} onChange={setPanelName} required />
        <Field label="Contact name" value={contactName} onChange={setContactName} />
        <Field label="Phone" value={phone} onChange={setPhone} />
        <Field label="Contact email" value={email} onChange={setEmail} type="email" />
        <Field label="Service fee (%)" value={serviceFeePercent} onChange={setServiceFeePercent} type="number" min="0" max="100" step="0.01" />
        <label className="form-field"><span className="field-label">Client account</span><select className="input" value={active ? "active" : "inactive"} onChange={(event) => setActive(event.target.value === "active")}><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      </div>
      {error ? <FormError>{error}</FormError> : null}
      <ModalFooter onClose={onClose} busy={busy} action="Save client" />
    </form>
  </Modal>;
}

export function ClientLoginModal({ client, onClose, onSaved }: { client: Client; onClose: () => void; onSaved: () => Promise<void> }) {
  const [email, setEmail] = useState(client.loginEmail || client.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savedCredentials, setSavedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasLogin = Boolean(client.authUid);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password && password !== confirmPassword) return setError("Passwords do not match.");
    if (!hasLogin && password.length < 6) return setError("New client password must contain at least 6 characters.");
    setBusy(true);
    try {
      await saveClientLogin(client.id, email, password);
      if (password) {
        setSavedCredentials({ email: email.trim(), password });
        setPassword("");
        setConfirmPassword("");
        void onSaved().catch(() => setError("Login saved, but the client list could not refresh. Use Refresh records."));
      } else {
        await onSaved();
        onClose();
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Client login could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCredentials() {
    if (!savedCredentials) return;
    try {
      await navigator.clipboard.writeText(`Login ID: ${savedCredentials.email}\nPassword: ${savedCredentials.password}`);
      setCopied(true);
      setError("");
    } catch {
      setError("Copy was blocked by the browser. You can select and copy the login details above.");
    }
  }

  return <Modal title={savedCredentials ? "Client login is ready" : hasLogin ? "Edit client login" : "Set client login"} description={savedCredentials ? "Copy these details to share with the client. The password is shown only once." : "Create or update the client’s Parcel Desk sign-in."} onClose={onClose}>
    {savedCredentials ? <div className="client-login-success">
      <div className="client-login-credentials"><div><small>Login ID</small><strong>{savedCredentials.email}</strong></div><div><small>New password · one-time view</small><strong className="one-time-password">{savedCredentials.password}</strong></div></div>
      <div className="hint-box"><KeyRound size={16} /><span>This password is not stored in Parcel Desk. Copy it now; if it is lost, set a new password from this client profile.</span></div>
      {error ? <FormError>{error}</FormError> : null}
      <div className="modal-footer"><button className="button button-secondary" type="button" onClick={onClose}>Done</button><button className="button button-primary" type="button" onClick={() => void copyCredentials()}><Copy size={16} />{copied ? "Copied" : "Copy login details"}</button></div>
    </div> : <form className="modal-form" onSubmit={submit}>
      <Field label="Login ID (email)" value={email} onChange={setEmail} type="email" required />
      <label className="form-field"><span className="field-label">{hasLogin ? "New password (optional)" : "Password"}</span><input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={6} required={!hasLogin} placeholder={hasLogin ? "Leave blank to keep current password" : "At least 6 characters"} /></label>
      {password ? <label className="form-field"><span className="field-label">Confirm password</span><input className="input" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required /></label> : null}
      <div className="hint-box"><Check size={16} /><span>Existing passwords cannot be viewed. Firebase Authentication manages passwords; they are never stored in the client record.</span></div>
      {error ? <FormError>{error}</FormError> : null}
      <ModalFooter onClose={onClose} busy={busy} action={hasLogin ? "Save login" : "Create client login"} />
    </form>}
  </Modal>;
}

export function ReturnModal({ clients, shipments, profile, onClose, onSaved }: { clients: Client[]; shipments: Shipment[]; profile: UserProfile; onClose: () => void; onSaved: () => Promise<void> }) {
  const initialClientId = profile.role === "client" ? profile.clientId ?? "" : "";
  const [clientId, setClientId] = useState(initialClientId);
  const [shipmentId, setShipmentId] = useState("");
  const [trackingIdInput, setTrackingIdInput] = useState("");
  const [returnAwb, setReturnAwb] = useState("");
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState<ReturnCondition>("quarantine");
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [video, setVideo] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const selectedShipment = shipments.find((shipment) => shipment.id === shipmentId);
  const clientShipments = useMemo(() => {
    if (!clientId) return shipments;
    return shipments.filter((shipment) => shipment.clientId === clientId);
  }, [shipments, clientId]);

  useEffect(() => {
    if (!trackingIdInput.trim()) {
      if (shipmentId && !selectedShipment) setShipmentId("");
      return;
    }
    const normalizedInput = trackingIdInput.trim().toUpperCase();
    const match = shipments.find((shipment) => (
      normalizeAwb(shipment.awb) === normalizeAwb(normalizedInput) ||
      shipment.orderNumber.toUpperCase() === normalizedInput ||
      shipment.orderNumber.toUpperCase().includes(normalizedInput) ||
      normalizeAwb(shipment.awb).includes(normalizeAwb(normalizedInput))
    ));
    if (!match) return;
    setClientId(match.clientId);
    setShipmentId(match.id);
    setTrackingIdInput(match.awb || match.orderNumber);
  }, [trackingIdInput, shipments, selectedShipment, shipmentId]);

  useEffect(() => {
    if (selectedShipment && selectedShipment.clientId !== clientId) {
      setClientId(selectedShipment.clientId);
    }
  }, [selectedShipment, clientId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!clientId) return setError("Choose a client.");
    if (!selectedShipment) return setError("Choose the original shipment.");
    setBusy(true);
    const evidence: EvidenceFile[] = [];
    let recordSaved = false;
    try {
      const id = newReturnId();
      const allFiles = IMAGEKIT_UPLOAD_ENABLED ? [...photos, ...(video ? [video] : [])] : [];
      for (const file of allFiles) {
        try {
          evidence.push(await uploadReturnFile(clientId, id, file));
        } catch (issue) {
          console.warn("ImageKit return upload failed; saving return without media.", issue);
        }
      }
      await createReturnRecord(profile, {
        clientId,
        shipmentId: selectedShipment.id,
        orderNumber: selectedShipment.orderNumber,
        awb: selectedShipment.awb,
        returnAwb: returnAwb.trim(),
        productName: selectedShipment.items.map((item) => item.productName).join(", "),
        quantity: selectedShipment.items.reduce((total, item) => total + item.quantity, 0),
        reason: reason.trim(),
        condition,
        notes: notes.trim(),
        evidence,
        sharedWithClient: true,
        claimStatus: "not_raised",
        claimAmount: 0,
      }, id);
      recordSaved = true;
      await onSaved();
      onClose();
    } catch (issue) {
      if (!recordSaved) await Promise.all(evidence.map((file) => deleteUploadedFile(file, clientId).catch(() => undefined)));
      setError(issue instanceof Error ? issue.message : "Return record could not be saved. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Record a return" description={IMAGEKIT_UPLOAD_ENABLED ? "Attach the return parcel photos and one continuous unboxing video." : "Save the return details now; photo and video storage is on hold."} onClose={onClose} wide>
    <form className="modal-form" onSubmit={submit}>
      <div className="form-grid">
        <label className="form-field"><span className="field-label">Tracking ID / AWB</span><input className="input" value={trackingIdInput} onChange={(event) => setTrackingIdInput(event.target.value)} placeholder="Paste tracking ID or AWB" /></label>
        <label className="form-field"><span className="field-label">Client / panel</span><select className="input" value={clientId} onChange={(event) => { setClientId(event.target.value); if (!event.target.value) setShipmentId(""); }} required><option value="">Choose client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.panelName}</option>)}</select></label>
        <label className="form-field"><span className="field-label">Original shipment</span><select className="input" value={shipmentId} onChange={(event) => { setShipmentId(event.target.value); const next = shipments.find((shipment) => shipment.id === event.target.value); if (next) { setClientId(next.clientId); setTrackingIdInput(next.awb || next.orderNumber); } }} required><option value="">Choose order / AWB</option>{clientShipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipment.orderNumber} · {shipment.awb} · {shipment.items[0]?.productName ?? "Product"} · {clients.find((client) => client.id === shipment.clientId)?.name ?? shipment.clientId}</option>)}</select></label>
        <Field label="Return AWB (if shown)" value={returnAwb} onChange={setReturnAwb} />
        <Field label="Return reason" value={reason} onChange={setReason} placeholder="Wrong item, damaged, customer return…" />
      </div>
      {selectedShipment ? <div className="linked-order"><strong>{selectedShipment.customerName}</strong><span>{selectedShipment.items.map((item) => `${item.productName} × ${item.quantity}`).join(" · ")}</span><span>Order {selectedShipment.orderNumber} · AWB {selectedShipment.awb}</span></div> : null}
      <label className="form-field"><span className="field-label">Inspection result</span><select className="input" value={condition} onChange={(event) => setCondition(event.target.value as ReturnCondition)}><option value="quarantine">Needs inspection / quarantine</option><option value="sellable">Sellable / restock</option><option value="damaged">Damaged</option><option value="wrong_item">Wrong item received</option><option value="missing_parts">Missing parts</option><option value="disposed">Disposed</option></select></label>
      <label className="form-field"><span className="field-label">Notes</span><textarea className="input textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Describe the parcel and product condition." /></label>
      {IMAGEKIT_UPLOAD_ENABLED ? <>
        <div className="evidence-inputs">
          <label className="evidence-drop"><FileImage size={19} /><strong>Return photos</strong><span>{photos.length ? `${photos.length} photo(s) selected` : "Choose one or more images"}</span><input type="file" accept="image/*" multiple onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} /></label>
          <label className="evidence-drop"><FileVideo size={19} /><strong>Unboxing video</strong><span>{video ? video.name : "Choose one continuous video"}</span><input type="file" accept="video/*" onChange={(event) => setVideo(event.target.files?.[0] ?? null)} /></label>
        </div>
        <div className="hint-box"><UploadCloud size={16} /><span>Evidence is stored in the client’s private folder. The client can view it after the record is saved.</span></div>
      </> : <div className="hint-box"><UploadCloud size={16} /><span>Photo and video storage is on hold. Return details can still be saved without media; no files will be uploaded.</span></div>}
      {error ? <FormError>{error}</FormError> : null}
      <ModalFooter onClose={onClose} busy={busy} action={busy ? "Uploading evidence…" : "Save return"} />
    </form>
  </Modal>;
}

export function EditShipmentModal({ shipment, onClose, onSaved }: { shipment: Shipment; onClose: () => void; onSaved: () => Promise<void> }) {
  const firstItem = shipment.items[0] ?? { productName: "", sku: "", quantity: 1, unitCost: 0 };
  const [orderNumber, setOrderNumber] = useState(shipment.orderNumber);
  const [subOrderNumber, setSubOrderNumber] = useState(shipment.subOrderNumber ?? "");
  const [courier, setCourier] = useState(shipment.courier ?? "");
  const [customerName, setCustomerName] = useState(shipment.customerName);
  const [customerPhone, setCustomerPhone] = useState(shipment.customerPhone ?? "");
  const [customerAddress, setCustomerAddress] = useState(shipment.customerAddress);
  const [productName, setProductName] = useState(firstItem.productName);
  const [sku, setSku] = useState(firstItem.sku);
  const [quantity, setQuantity] = useState(String(firstItem.quantity));
  const [unitCost, setUnitCost] = useState(String(firstItem.unitCost));
  const [invoiceTotal, setInvoiceTotal] = useState(String(shipment.invoiceTotal));
  const [status, setStatus] = useState<Shipment["status"]>(shipment.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const parsedQuantity = Number(quantity);
    const parsedUnitCost = Number(unitCost);
    const parsedInvoiceTotal = Number(invoiceTotal);
    if (!orderNumber.trim()) return setError("Enter the order number.");
    if (!customerName.trim()) return setError("Enter the customer name.");
    if (!productName.trim()) return setError("Enter the product name.");
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1) return setError("Quantity must be a whole number greater than zero.");
    if (!Number.isFinite(parsedUnitCost) || parsedUnitCost < 0) return setError("Enter a valid product cost.");
    if (!Number.isFinite(parsedInvoiceTotal) || parsedInvoiceTotal < 0) return setError("Enter a valid invoice total.");
    setBusy(true);
    try {
      const items = [{ ...firstItem, productName: productName.trim(), sku: sku.trim(), quantity: parsedQuantity, unitCost: parsedUnitCost }, ...shipment.items.slice(1)];
      await updateShipmentDetails(shipment.id, {
        orderNumber: orderNumber.trim(),
        subOrderNumber: subOrderNumber.trim(),
        courier: courier.trim(),
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerAddress: customerAddress.trim(),
        items,
        invoiceTotal: parsedInvoiceTotal,
        status,
      });
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Shipment details could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title="Edit shipment" description="Update the customer, product, amount and delivery status." onClose={onClose} wide>
    <form className="modal-form" onSubmit={submit}>
      <div className="hint-box"><strong>Tracking ID</strong><span>{shipment.awb} · kept fixed to protect duplicate tracking checks.</span></div>
      <div className="form-grid">
        <Field label="Order number" value={orderNumber} onChange={setOrderNumber} required />
        <Field label="Sub-order number" value={subOrderNumber} onChange={setSubOrderNumber} />
        <Field label="Courier" value={courier} onChange={setCourier} />
        <Field label="Customer name" value={customerName} onChange={setCustomerName} required />
        <Field label="Customer phone" value={customerPhone} onChange={setCustomerPhone} />
        <Field label="Product name" value={productName} onChange={setProductName} required />
        <Field label="Quantity" value={quantity} onChange={setQuantity} type="number" min="1" step="1" required />
        <Field label="Product cost ₹" value={unitCost} onChange={setUnitCost} type="number" min="0" step="0.01" required />
        <Field label="Invoice total ₹ (reference)" value={invoiceTotal} onChange={setInvoiceTotal} type="number" min="0" step="0.01" required />
        <Field label="SKU (optional)" value={sku} onChange={setSku} />
        <label className="form-field"><span className="field-label">Shipment status</span><select className="input" value={status} onChange={(event) => setStatus(event.target.value as Shipment["status"])}><option value="ready">Ready to ship</option><option value="dispatched">Dispatched</option><option value="delivered">Delivered</option><option value="rto">RTO</option><option value="return_initiated">Return initiated</option><option value="returned">Returned</option><option value="reconciled">Reconciled</option></select></label>
      </div>
      <label className="form-field"><span className="field-label">Customer address</span><textarea className="input textarea" rows={3} value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} /></label>
      {error ? <FormError>{error}</FormError> : null}
      <ModalFooter onClose={onClose} busy={busy} action="Save shipment" />
    </form>
  </Modal>;
}

type LedgerAction = "settlement" | "claim" | "payout" | "deduction" | "receivable" | "client-receipt" | "expense" | "adjustment-up" | "adjustment-down";

const actionLabels: Record<LedgerAction, string> = {
  settlement: "Meesho settlement received",
  claim: "Claim recovery received",
  payout: "Paid to client",
  deduction: "Deduct from client payable",
  receivable: "Client owes this amount",
  "client-receipt": "Payment received from client",
  expense: "Business expense (not charged to client)",
  "adjustment-up": "Increase client payable",
  "adjustment-down": "Decrease client payable",
};

export function LedgerModal({ clients, profile, onClose, onSaved, initialClientId = "", presetAction, dueFromClient = 0 }: { clients: Client[]; profile: UserProfile; onClose: () => void; onSaved: () => Promise<void>; initialClientId?: string; presetAction?: "client-receipt" | "receivable"; dueFromClient?: number }) {
  const [clientId, setClientId] = useState(initialClientId || (profile.role === "client" ? profile.clientId ?? "" : ""));
  const [action, setAction] = useState<LedgerAction>(presetAction ?? "settlement");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState(presetAction === "client-receipt" ? "Payment received from client" : presetAction === "receivable" ? "Amount due from client" : "");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const value = Number(amount);
    if (!clientId) return setError("Choose a client.");
    if (!Number.isFinite(value) || value <= 0) return setError("Enter an amount greater than zero.");
    if (!description.trim()) return setError("Add a short description for the ledger.");
    const actionData: Record<LedgerAction, { type: LedgerType; direction: "in" | "out"; payableDelta: number; receivableDelta: number; cashDelta: number }> = {
      settlement: { type: "settlement", direction: "in", payableDelta: value, receivableDelta: 0, cashDelta: value },
      claim: { type: "claim_recovery", direction: "in", payableDelta: value, receivableDelta: 0, cashDelta: value },
      payout: { type: "client_payment", direction: "out", payableDelta: -value, receivableDelta: 0, cashDelta: -value },
      deduction: { type: "adjustment", direction: "out", payableDelta: -value, receivableDelta: 0, cashDelta: 0 },
      receivable: { type: "adjustment", direction: "out", payableDelta: 0, receivableDelta: value, cashDelta: 0 },
      "client-receipt": { type: "client_receipt", direction: "in", payableDelta: 0, receivableDelta: -value, cashDelta: value },
      expense: { type: "product_cost", direction: "out", payableDelta: 0, receivableDelta: 0, cashDelta: -value },
      "adjustment-up": { type: "adjustment", direction: "in", payableDelta: value, receivableDelta: 0, cashDelta: 0 },
      "adjustment-down": { type: "adjustment", direction: "out", payableDelta: -value, receivableDelta: 0, cashDelta: 0 },
    };
    setBusy(true);
    try {
      await createLedgerEntry(profile, { clientId, ...actionData[action], amount: value, description: description.trim(), reference: reference.trim() });
      await onSaved();
      onClose();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save this ledger entry.");
    } finally {
      setBusy(false);
    }
  }

  return <Modal title={presetAction === "client-receipt" ? "Record client payment" : presetAction === "receivable" ? "Add amount due" : "Add a money entry"} description="This entry updates the client balance and keeps an audit record." onClose={onClose}>
    <form className="modal-form" onSubmit={submit}>
      <label className="form-field"><span className="field-label">Client / panel</span><select className="input" value={clientId} onChange={(event) => setClientId(event.target.value)} required disabled={Boolean(presetAction)}><option value="">Choose client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name} · {client.panelName}</option>)}</select></label>
      {presetAction ? <div className="hint-box"><Check size={16} /><span>{presetAction === "client-receipt" ? `Payment received · pending balance ${formatRupees(dueFromClient)}. The amount adds to cash and reduces the pending balance; any extra remains as client credit.` : "Adding this amount increases the total pending from this client."}</span></div> : <label className="form-field"><span className="field-label">Entry type</span><select className="input" value={action} onChange={(event) => setAction(event.target.value as LedgerAction)}>{Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
      <Field label="Amount ₹" value={amount} onChange={setAmount} type="number" min="0.01" step="0.01" required />
      <Field label="Description" value={description} onChange={setDescription} required placeholder="e.g. Settlement for orders delivered today" />
      <Field label="Order / payment reference" value={reference} onChange={setReference} />
      <div className="hint-box"><Check size={16} /><span>Ledger entries are append-only. Correct a mistake with an adjustment entry so the history stays clear.</span></div>
      {error ? <FormError>{error}</FormError> : null}
      <ModalFooter onClose={onClose} busy={busy} action="Save entry" />
    </form>
  </Modal>;
}

export function MediaViewer({ returnId, file, onClose }: { returnId: string; file: EvidenceFile; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let generatedUrl = "";
    getProtectedFileUrl(returnId, file).then((nextUrl) => {
      generatedUrl = nextUrl;
      if (active) setUrl(nextUrl);
      else if (nextUrl.startsWith("blob:")) URL.revokeObjectURL(nextUrl);
    }).catch((issue: unknown) => {
      if (active) setError(issue instanceof Error ? issue.message : "Could not load this file.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      if (generatedUrl.startsWith("blob:")) URL.revokeObjectURL(generatedUrl);
    };
  }, [returnId, file]);

  return <div className="modal-backdrop media-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="media-viewer" role="dialog" aria-modal="true" aria-label={file.name}>
      <header><div><strong>{file.name}</strong><span>Private evidence preview</span></div><button className="icon-button" type="button" onClick={() => { if (url.startsWith("blob:")) URL.revokeObjectURL(url); onClose(); }} aria-label="Close"><X size={19} /></button></header>
      <div className="media-stage">{loading ? <LoaderCircle className="spin" size={28} /> : error ? <p className="form-error">{error}</p> : file.contentType.startsWith("image/") ? <img src={url} alt={file.name} /> : file.contentType.startsWith("video/") ? <video src={url} controls playsInline /> : <iframe title={file.name} src={url} />}</div>
    </section>
  </div>;
}

function Modal({ title, description, onClose, children, wide = false }: { title: string; description: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`modal-card ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><header className="modal-header"><div><span className="modal-icon"><Plus size={19} /></span><div><h2 id="modal-title">{title}</h2><p>{description}</p></div></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close"><X size={19} /></button></header><div className="modal-body"><div>{children}</div></div></section></div>;
}

function ModalFooter({ onClose, busy, action }: { onClose: () => void; busy: boolean; action: string }) {
  return <footer className="modal-footer"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancel</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" size={16} /> Saving…</> : <><Check size={16} /> {action}</>}</button></footer>;
}

function Field({ label, value, onChange, required, type = "text", min, max, step, placeholder }: { label: string; value: string; onChange: (value: string) => void; required?: boolean; type?: string; min?: string; max?: string; step?: string; placeholder?: string }) {
  return <label className="form-field"><span className="field-label">{label}</span><input className="input" type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} min={min} max={max} step={step} placeholder={placeholder} /></label>;
}

function FormError({ children }: { children: ReactNode }) {
  return <div className="form-error" role="alert">{children}</div>;
}

function formatRupees(amount: number) {
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
