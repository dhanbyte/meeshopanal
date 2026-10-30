import { ArrowDownLeft, ArrowUpRight, ArrowUpRightFromSquare, ClipboardList, Eye, KeyRound, PackageCheck, PackageOpen, Pencil, Plus, Search, ShieldAlert, WalletCards, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { clientPendingAmount, loadClientHistory } from "../lib/data";
import type { Client, ClientBalance, LedgerEntry, ReturnRecord, Shipment, WorkspaceData } from "../lib/types";

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function formatMoney(amount: number) {
  return currency.format(Number.isFinite(amount) ? amount : 0);
}

export function timestampDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") return value.toDate();
  return null;
}

function dayMatches(value: unknown, selectedDate: string) {
  const date = timestampDate(value);
  if (!date || !selectedDate) return false;
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return local === selectedDate;
}

export function todayInputValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function DashboardPage({ clients, balances, shipments, returns, ledgerEntries, dailyActivity, dailyLoading = false, selectedDate, onDateChange, onGoOrders }: {
  clients: Client[];
  balances: ClientBalance[];
  shipments: Shipment[];
  returns: ReturnRecord[];
  ledgerEntries: LedgerEntry[];
  dailyActivity?: Pick<WorkspaceData, "shipments" | "returns" | "ledgerEntries">;
  dailyLoading?: boolean;
  selectedDate: string;
  onDateChange: (value: string) => void;
  onGoOrders: () => void;
}) {
  const dailyShipments = dailyActivity?.shipments ?? shipments.filter((shipment) => dayMatches(shipment.createdAt, selectedDate));
  const dailyReturns = dailyActivity?.returns ?? returns.filter((record) => dayMatches(record.createdAt, selectedDate));
  const dailyLedger = dailyActivity?.ledgerEntries ?? ledgerEntries.filter((entry) => dayMatches(entry.createdAt, selectedDate));
  const cashIn = dailyLedger.reduce((sum, entry) => sum + Math.max(entry.cashDelta, 0), 0);
  const cashOut = dailyLedger.reduce((sum, entry) => sum + Math.max(-entry.cashDelta, 0), 0);
  const payable = balances.reduce((sum, balance) => sum + balance.payable, 0);
  const receivable = clients.reduce((sum, client) => sum + clientPendingAmount(client.id, shipments, balances), 0);
  const waitingInspection = returns.filter((record) => record.condition === "quarantine").length;

  return <div className="page-stack">
    <div className="daily-toolbar"><div><span className="eyebrow">DAILY REPORT</span><h2>What moved today?</h2><p>Orders and money entries created on this date. Balances show current totals.{dailyLoading ? " Updating report…" : ""}</p></div><label className="date-field"><span>Date</span><input className="input" type="date" value={selectedDate} onChange={(event) => onDateChange(event.target.value)} /></label></div>
    <div className="stat-grid">
      <StatCard label="Labels added" value={String(dailyShipments.length)} detail="Uploaded on selected date" icon={<PackageOpen size={19} />} tone="blue" />
      <StatCard label="Returns recorded" value={String(dailyReturns.length)} detail={`${waitingInspection} waiting for inspection`} icon={<ShieldAlert size={19} />} tone="amber" />
      <StatCard label="Money received" value={formatMoney(cashIn)} detail="Ledger entries for selected date" icon={<ArrowDownLeft size={19} />} tone="green" />
      <StatCard label="Money paid out" value={formatMoney(cashOut)} detail="Ledger entries for selected date" icon={<ArrowUpRight size={19} />} tone="rose" />
    </div>
    <div className="stat-grid stat-grid-secondary">
      <StatCard label="Due to clients" value={formatMoney(payable)} detail="Current payable balance" icon={<WalletCards size={18} />} tone="green" />
      <StatCard label="Due from clients" value={formatMoney(receivable)} detail="Current receivable balance" icon={<ArrowUpRightFromSquare size={18} />} tone="blue" />
      <StatCard label="Delivered orders" value={String(shipments.filter((shipment) => shipment.status === "delivered").length)} detail="Current status across loaded orders" icon={<PackageCheck size={18} />} tone="violet" />
      <StatCard label="RTO orders" value={String(shipments.filter((shipment) => shipment.status === "rto").length)} detail="Current status across loaded orders" icon={<ClipboardList size={18} />} tone="amber" />
    </div>
    <section className="panel-card">
      <div className="panel-heading"><div><h3>Client balances</h3><p>Current amounts, with activity for the selected day.</p></div><button className="button button-secondary button-small" onClick={onGoOrders} type="button">View orders</button></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Client / panel</th><th>Labels added</th><th>Money received</th><th>Money paid</th><th>Due to client</th><th>Due from client</th></tr></thead><tbody>
        {clients.map((client) => {
          const balance = balances.find((row) => row.clientId === client.id);
          const clientOrders = dailyShipments.filter((row) => row.clientId === client.id).length;
          const clientLedger = dailyLedger.filter((row) => row.clientId === client.id);
          return <tr key={client.id}><td><div className="table-primary">{client.businessName || client.name}</div><div className="table-secondary">{client.panelName}</div></td><td>{clientOrders}</td><td className="money-positive">{formatMoney(clientLedger.reduce((sum, entry) => sum + Math.max(entry.cashDelta, 0), 0))}</td><td>{formatMoney(clientLedger.reduce((sum, entry) => sum + Math.max(-entry.cashDelta, 0), 0))}</td><td className="money-positive">{formatMoney(balance?.payable ?? 0)}</td><td>{formatMoney(clientPendingAmount(client.id, shipments, balances))}</td></tr>;
        })}
        {clients.length === 0 ? <tr><td colSpan={6}><EmptyState title="No clients yet" text="Add your first client to start tracking panels and balances." /></td></tr> : null}
      </tbody></table></div>
    </section>
    <p className="data-note">Reports use up to the latest 500 records per section. Invoice totals are reference only; record actual Meesho settlements in Money.</p>
  </div>;
}

export function OrdersPage({ shipments, clients, canManage, canUpload = canManage, search, onSearch, onUpload, onStatusChange, onEdit, onDelete, busyId }: {
  shipments: Shipment[];
  clients: Client[];
  canManage: boolean;
  canUpload?: boolean;
  search: string;
  onSearch: (value: string) => void;
  onUpload: () => void;
  onStatusChange: (id: string, status: Shipment["status"]) => void;
  onEdit: (shipment: Shipment) => void;
  onDelete?: (shipment: Shipment) => void;
  busyId: string;
}) {
  const [statusFilter, setStatusFilter] = useState("all");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return shipments.filter((shipment) => {
      const matchesStatus = statusFilter === "all" || shipment.status === statusFilter;
      if (!matchesStatus) return false;
      if (!needle) return true;
      const client = clients.find((row) => row.id === shipment.clientId);
      return [shipment.orderNumber, shipment.subOrderNumber, shipment.awb, shipment.customerName, shipment.customerAddress, client?.name, ...shipment.items.flatMap((item) => [item.productName, item.sku])].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [shipments, clients, search, statusFilter]);

  return <div className="page-stack">
    <div className="page-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search orders" placeholder="Search order, AWB, SKU or customer" value={search} onChange={(event) => onSearch(event.target.value)} /></div><label className="filter-select"><span>Status</span><select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All orders</option>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>{canUpload ? <button className="button button-primary" type="button" onClick={onUpload}><Plus size={17} />Upload label</button> : null}</div>
    <section className="panel-card table-panel"><div className="panel-heading"><div><h3>Shipment ledger</h3><p>{filtered.length} shipment{filtered.length === 1 ? "" : "s"} · status can be changed here and order details edited</p></div><span className="date-range-chip">Latest activity</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Order / customer</th><th>Product</th><th>Client / panel</th><th>AWB</th><th>Invoice (ref)</th><th>Status</th><th>Added</th><th>Action</th></tr></thead><tbody>
        {filtered.map((shipment) => {
          const client = clients.find((row) => row.id === shipment.clientId);
          return <tr key={shipment.id}>
            <td><div className="table-primary">{shipment.customerName || "Customer not captured"}</div><div className="table-secondary">{shipment.orderNumber}{shipment.subOrderNumber ? ` · ${shipment.subOrderNumber}` : ""}</div><div className="table-tertiary record-id-text" title={shipment.id}>Firestore ID · {shipment.id}</div><div className="table-tertiary truncate-address">{shipment.customerAddress}</div></td>
            <td><div className="table-primary">{shipment.items[0]?.productName ?? "—"}</div><div className="table-secondary">{shipment.items[0]?.sku || "No SKU"}{shipment.items.length > 1 ? ` · +${shipment.items.length - 1} more` : ""} · Qty {shipment.items.reduce((sum, item) => sum + item.quantity, 0)}</div></td>
            <td><div className="table-primary">{client?.name ?? shipment.clientName ?? "Unknown client"}</div><div className="table-secondary">{client?.panelName ?? ""}</div></td>
            <td><span className="mono-chip">{shipment.awb}</span>{shipment.courier ? <div className="table-secondary">{shipment.courier}</div> : null}</td>
            <td>{formatMoney(shipment.invoiceTotal)}</td>
            <td>{canManage ? <select className={`status-select status-${shipment.status}`} value={shipment.status} disabled={busyId === shipment.id} onChange={(event) => onStatusChange(shipment.id, event.target.value as Shipment["status"])} aria-label={`Change status for ${shipment.orderNumber}`}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : <StatusPill status={shipment.status} />}</td>
            <td>{formatDate(shipment.createdAt)}</td>
            <td>{canManage ? <div className="table-actions-stack"><button className="button button-secondary button-small" type="button" onClick={() => onEdit(shipment)}><Pencil size={13} />Edit</button>{onDelete ? <button className="button button-secondary button-small danger-button" type="button" onClick={() => onDelete(shipment)}><X size={13} />Delete</button> : null}</div> : "—"}</td>
          </tr>;
        })}
        {filtered.length === 0 ? <tr><td colSpan={8}><EmptyState title="No shipments match" text={shipments.length ? "Try another search or status filter." : "Upload a label to create the first shipment."} action={canUpload && shipments.length === 0 ? onUpload : undefined} /></td></tr> : null}
      </tbody></table></div>
    </section>
  </div>;
}

export function ReturnsPage({ returns, clients, canManage, profileRole, onAdd, onView, onShare, onClaimUpdate }: {
  returns: ReturnRecord[];
  clients: Client[];
  canManage: boolean;
  profileRole: string;
  onAdd: () => void;
  onView: (record: ReturnRecord, fileIndex: number) => void;
  onShare: (record: ReturnRecord) => void;
  onClaimUpdate: (id: string, status: ReturnRecord["claimStatus"]) => void;
}) {
  return <div className="page-stack">
    <div className="page-toolbar"><div className="toolbar-description"><span className="eyebrow">REVERSE LOGISTICS</span><strong>Returns and RTO are tracked separately from delivered orders.</strong></div>{canManage ? <button className="button button-primary" type="button" onClick={onAdd}><Plus size={17} />Record return</button> : null}</div>
    <section className="panel-card table-panel"><div className="panel-heading"><div><h3>Return inspections</h3><p>{returns.length} record{returns.length === 1 ? "" : "s"} · {returns.filter((record) => record.condition === "quarantine").length} waiting for inspection</p></div><span className="date-range-chip">Evidence is private</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Order / AWB</th><th>Product / client</th><th>Condition</th><th>Evidence</th><th>Claim</th><th>Received</th></tr></thead><tbody>
        {returns.map((record) => {
          const client = clients.find((row) => row.id === record.clientId);
          return <tr key={record.id}><td><div className="table-primary">{record.orderNumber}</div><div className="table-secondary">AWB {record.awb}{record.returnAwb ? ` · Return ${record.returnAwb}` : ""}</div></td>
            <td><div className="table-primary">{record.productName}</div><div className="table-secondary">{client?.name ?? "Client"} · Qty {record.quantity}</div><div className="table-tertiary">{record.reason || "No reason recorded"}</div></td>
            <td><span className={`condition-pill condition-${record.condition}`}>{conditionLabel(record.condition)}</span></td>
            <td><div className="evidence-buttons">{record.evidence.map((file, index) => <button key={file.path} className="button button-ghost button-small" type="button" onClick={() => onView(record, index)}>{file.contentType.startsWith("video/") ? "Video" : "Photo"} {index + 1}</button>)}{record.evidence.length === 0 ? <span className="table-secondary">No evidence</span> : null}</div>{canManage ? <button className={`share-button ${record.sharedWithClient ? "is-shared" : ""}`} type="button" onClick={() => onShare(record)}>{record.sharedWithClient ? "Visible to client" : "Share with client"}</button> : profileRole === "client" ? <span className="table-secondary">Shared with your panel</span> : null}</td>
            <td>{canManage ? <select className={`claim-select claim-${record.claimStatus}`} value={record.claimStatus} onChange={(event) => onClaimUpdate(record.id, event.target.value as ReturnRecord["claimStatus"])} aria-label={`Claim status for order ${record.orderNumber}`}><option value="not_raised">Not raised</option><option value="raised">Raised</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select> : <span className={`condition-pill condition-${record.claimStatus}`}>{record.claimStatus.replace("_", " ")}</span>}{record.claimAmount > 0 ? <div className="table-secondary">{formatMoney(record.claimAmount)}</div> : null}</td><td>{formatDate(record.createdAt)}</td></tr>;
        })}
        {returns.length === 0 ? <tr><td colSpan={6}><EmptyState title="No returns recorded" text={profileRole === "client" ? "Shared return inspections will appear here." : "Record the parcel when it comes back, then attach its photos and unboxing video."} action={canManage ? onAdd : undefined} /></td></tr> : null}
      </tbody></table></div>
    </section>
  </div>;
}

export function ClientsPage({ clients, balances, shipments, ledgerEntries, canAdd, canRecordPayment, onAdd, onRecordPayment, onEditClient, onManageLogin, onDeleteClient }: { clients: Client[]; balances: ClientBalance[]; shipments: Shipment[]; ledgerEntries: LedgerEntry[]; canAdd: boolean; canRecordPayment: boolean; onAdd: () => void; onRecordPayment: (clientId: string, dueFromClient?: number) => void; onEditClient: (client: Client) => void; onManageLogin: (client: Client) => void; onDeleteClient?: (client: Client) => void }) {
  const [selectedClientId, setSelectedClientId] = useState("");
  const selectedClient = clients.find((client) => client.id === selectedClientId);
  return <div className="page-stack">
    <div className="page-toolbar"><div className="toolbar-description"><span className="eyebrow">CLIENT DIRECTORY</span><strong>{clients.length} active client{clients.length === 1 ? "" : "s"}</strong></div>{canAdd ? <button className="button button-primary" type="button" onClick={onAdd}><Plus size={17} />Add client</button> : null}</div>
    <div className="client-grid">{clients.map((client) => {
      const balance = balances.find((row) => row.clientId === client.id);
      const clientShipments = shipments.filter((row) => row.clientId === client.id);
      const clientOrders = clientShipments.length;
      const clientUnits = clientShipments.reduce((sum, shipment) => sum + shipment.items.reduce((quantity, item) => quantity + Math.max(0, Number(item.quantity) || 0), 0), 0);
      const pending = clientPendingAmount(client.id, shipments, balances);
      return <article className="client-card" key={client.id}>
        <div className="client-card-main" role="button" tabIndex={0} onClick={() => setSelectedClientId(client.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedClientId(client.id); } }} aria-label={`Open full profile for ${client.businessName || client.name}`}>
          <div className="client-card-top"><span className="client-avatar">{initials(client.businessName || client.name)}</span><span className={`live-dot ${client.active ? "" : "inactive"}`} title={client.active ? "Active" : "Inactive"} /></div>
          <h3>{client.businessName || client.name}</h3><p>{client.panelName}</p>
          <span className="client-details-trigger"><Eye size={13} />Open full client profile</span>
          <div className="client-stats">
            <div><small>Shipments</small><strong>{clientOrders}</strong></div>
            <div><small>Products</small><strong>{clientUnits}</strong></div>
            <div><small>Due to client</small><strong className="money-positive">{formatMoney(balance?.payable ?? 0)}</strong></div>
            <div><small>{pending < 0 ? "Client credit" : "Pending from client"}</small><strong>{formatMoney(Math.abs(pending))}</strong></div>
          </div>
        </div>
        <div className="client-card-footer"><span>{client.serviceFeePercent}% service fee</span>{canRecordPayment ? <button className="button button-secondary button-small client-payment-button" type="button" onClick={() => onRecordPayment(client.id, pending)}><ArrowDownLeft size={13} />Record payment</button> : <span className="active-label"><i className={client.active ? "" : "inactive"} />{client.active ? "Active" : "Inactive"}</span>}{onDeleteClient ? <button className="button button-secondary button-small danger-button" type="button" onClick={(event) => { event.stopPropagation(); onDeleteClient(client); }}><X size={13} />Delete</button> : null}</div>
      </article>;
    })}{clients.length === 0 ? <div className="empty-card"><EmptyState title="No clients added yet" text="Add a client and panel to begin tracking orders and payments." action={canAdd ? onAdd : undefined} /></div> : null}</div>
    {selectedClient ? <ClientDetailsModal client={selectedClient} shipments={shipments.filter((shipment) => shipment.clientId === selectedClient.id)} ledgerEntries={ledgerEntries.filter((entry) => entry.clientId === selectedClient.id)} clientBalance={balances.find((balance) => balance.clientId === selectedClient.id)} canRecordPayment={canRecordPayment} canEdit={canAdd} onRecordPayment={(clientId, due) => { setSelectedClientId(""); onRecordPayment(clientId, due); }} onEditClient={(client) => { setSelectedClientId(""); onEditClient(client); }} onManageLogin={(client) => { setSelectedClientId(""); onManageLogin(client); }} onClose={() => setSelectedClientId("")} /> : null}
  </div>;
}

function ClientDetailsModal({ client, shipments, ledgerEntries, clientBalance, canRecordPayment, canEdit, onRecordPayment, onEditClient, onManageLogin, onClose }: { client: Client; shipments: Shipment[]; ledgerEntries: LedgerEntry[]; clientBalance?: ClientBalance; canRecordPayment: boolean; canEdit: boolean; onRecordPayment: (clientId: string, dueFromClient?: number) => void; onEditClient: (client: Client) => void; onManageLogin: (client: Client) => void; onClose: () => void }) {
  const demoClient = client.id.startsWith("demo-");
  const [fullHistory, setFullHistory] = useState<{ shipments: Shipment[]; ledgerEntries: LedgerEntry[] } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(!demoClient);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    if (demoClient) return;
    let active = true;
    setFullHistory(null);
    setHistoryError("");
    setHistoryLoading(true);
    loadClientHistory(client.id).then((history) => {
      if (active) setFullHistory(history);
    }).catch((issue: unknown) => {
      if (active) setHistoryError(issue instanceof Error ? issue.message : "Full client history could not be loaded.");
    }).finally(() => {
      if (active) setHistoryLoading(false);
    });
    return () => { active = false; };
  }, [client.id, demoClient]);

  const allShipments = demoClient ? shipments : fullHistory?.shipments ?? shipments;
  const allLedgerEntries = demoClient ? ledgerEntries : fullHistory?.ledgerEntries ?? ledgerEntries;
  const orderedShipments = [...allShipments].sort((left, right) => (timestampDate(right.createdAt)?.getTime() ?? 0) - (timestampDate(left.createdAt)?.getTime() ?? 0));
  const orderedEntries = [...allLedgerEntries].sort((left, right) => (timestampDate(right.createdAt)?.getTime() ?? 0) - (timestampDate(left.createdAt)?.getTime() ?? 0));
  const products = useMemo(() => {
    const totals = new Map<string, { productName: string; sku: string; quantity: number; amount: number }>();
    for (const shipment of allShipments) {
      for (const item of shipment.items ?? []) {
        const sku = item.sku?.trim() ?? "";
        const productName = item.productName?.trim() || "Unknown product";
        const key = sku ? `sku:${sku.toLowerCase()}` : `name:${productName.toLowerCase()}`;
        const total = totals.get(key) ?? { productName, sku, quantity: 0, amount: 0 };
        total.quantity += Math.max(0, Number(item.quantity) || 0);
        total.amount += Math.max(0, Number(item.unitCost) || 0) * Math.max(0, Number(item.quantity) || 0);
        totals.set(key, total);
      }
    }
    return [...totals.values()].sort((left, right) => right.quantity - left.quantity);
  }, [allShipments]);
  const totalUnits = products.reduce((sum, product) => sum + product.quantity, 0);
  const totalProductAmount = products.reduce((sum, product) => sum + product.amount, 0);
  const deliveredCount = allShipments.filter((shipment) => shipment.status === "delivered").length;
  const returnCount = allShipments.filter((shipment) => ["rto", "return_initiated", "returned"].includes(shipment.status)).length;
  const dueFromClient = clientPendingAmount(client.id, allShipments, clientBalance ? [clientBalance] : []);
  const dueToClient = clientBalance?.payable ?? 0;

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="modal-card modal-wide client-details-modal" role="dialog" aria-modal="true" aria-labelledby="client-details-title">
      <header className="modal-header"><div><span className="modal-icon"><Eye size={18} /></span><div><h2 id="client-details-title">{client.businessName || client.name}</h2><p>{client.panelName} · full client profile and account history</p></div></div><button className="icon-button" type="button" onClick={onClose} aria-label="Close client details"><X size={19} /></button></header>
      <div className="modal-body client-details-body">
        <div className="client-detail-summary" aria-label="Client shipment totals">
          <div><small>Label orders</small><strong>{allShipments.length}</strong></div>
          <div><small>Products shipped</small><strong>{totalUnits}</strong></div>
          <div><small>Product amount</small><strong>{formatMoney(totalProductAmount)}</strong></div>
          <div><small>Delivered</small><strong>{deliveredCount}</strong></div>
          <div><small>RTO / returned</small><strong>{returnCount}</strong></div>
        </div>
        <div className="client-detail-grid">
          <div><small>Business name</small><strong>{client.businessName || client.name}</strong></div>
          <div><small>Account / contact name</small><strong>{client.contactName || client.name}</strong></div>
          <div><small>Phone</small><strong>{client.phone || "Not added"}</strong></div>
          <div><small>Contact email</small><strong>{client.email || "Not added"}</strong></div>
          <div><small>Parcel Desk login ID</small><strong>{client.loginEmail || "Not set"}</strong></div>
          <div><small>Password</small><strong>{client.authUid ? "Hidden · reset with admin control" : "No linked login"}</strong></div>
          <div><small>Meesho panel</small><strong>{client.panelName}</strong></div>
          <div><small>Client record ID</small><strong className="mono-chip">{client.id}</strong></div>
          <div><small>Firebase login UID</small><strong className="mono-chip">{client.authUid || "Not linked"}</strong></div>
          <div><small>{dueFromClient < 0 ? "Client credit" : "Pending from client"}</small><strong>{formatMoney(Math.abs(dueFromClient))}</strong></div>
          <div><small>Due to client</small><strong>{formatMoney(dueToClient)}</strong></div>
        </div>
        {canRecordPayment || canEdit ? <div className="client-detail-actions">{canRecordPayment ? <button className="button button-primary button-small" type="button" disabled={historyLoading} onClick={() => onRecordPayment(client.id, dueFromClient)}><ArrowDownLeft size={14} />{historyLoading ? "Loading balance…" : "Record payment received"}</button> : null}{canEdit ? <><button className="button button-secondary button-small" type="button" onClick={() => onEditClient(client)}><Pencil size={13} />Edit client details</button><button className="button button-secondary button-small" type="button" onClick={() => onManageLogin(client)}><KeyRound size={13} />{client.authUid ? "Set / reset login ID & password" : "Create client login ID & password"}</button></> : null}</div> : null}
        {historyLoading ? <p className="client-history-status" role="status">Loading full order and payment history…</p> : null}
        {historyError ? <p className="client-history-error" role="alert">Full history could not be loaded. Showing the records already loaded: {historyError}</p> : null}
        <section className="client-detail-section"><h3>Products shipped ({products.length} product{products.length === 1 ? "" : "s"})</h3><div className="table-wrap client-history-table"><table className="data-table"><thead><tr><th>Product</th><th>Units</th><th>Product amount</th></tr></thead><tbody>{products.map((product) => <tr key={`${product.sku}:${product.productName}`}><td>{product.productName}</td><td>{product.quantity}</td><td>{formatMoney(product.amount)}</td></tr>)}{!products.length ? <tr><td colSpan={3}>No products shipped yet.</td></tr> : null}{products.length ? <tr><td><strong>Total</strong></td><td><strong>{totalUnits}</strong></td><td><strong>{formatMoney(totalProductAmount)}</strong></td></tr> : null}</tbody></table></div></section>
        <section className="client-detail-section"><h3>All shipments ({allShipments.length})</h3><div className="table-wrap client-history-table"><table className="data-table"><thead><tr><th>Order / customer</th><th>Product</th><th>Tracking ID</th><th>Product amount</th><th>Status</th></tr></thead><tbody>{orderedShipments.map((shipment) => <tr key={shipment.id}><td><div className="table-primary">{shipment.orderNumber}</div><div className="table-secondary">{shipment.customerName || "Customer not captured"}</div></td><td>{shipment.items.map((item) => `${item.productName} × ${item.quantity}`).join(", ") || "—"}</td><td><span className="mono-chip">{shipment.awb}</span></td><td>{formatMoney(shipment.items.reduce((sum, item) => sum + item.unitCost * item.quantity, 0))}</td><td><StatusPill status={shipment.status} /></td></tr>)}{!orderedShipments.length ? <tr><td colSpan={5}>No shipments yet.</td></tr> : null}</tbody></table></div></section>
        <section className="client-detail-section"><h3>All payments and account changes ({allLedgerEntries.length})</h3><div className="table-wrap client-history-table"><table className="data-table"><thead><tr><th>Entry</th><th>Details</th><th>Account effect</th><th>Date</th></tr></thead><tbody>{orderedEntries.map((entry) => {
          const effects = [
            entry.cashDelta ? `Cash ${entry.cashDelta > 0 ? "+" : "−"}${formatMoney(Math.abs(entry.cashDelta))}` : "",
            entry.payableDelta ? `Due to client ${entry.payableDelta > 0 ? "+" : "−"}${formatMoney(Math.abs(entry.payableDelta))}` : "",
            entry.receivableDelta ? `Client due ${entry.receivableDelta > 0 ? "+" : "−"}${formatMoney(Math.abs(entry.receivableDelta))}` : "",
          ].filter(Boolean).join(" · ") || "No balance change";
          const effectClass = entry.cashDelta < 0 ? "money-negative" : entry.cashDelta > 0 || entry.receivableDelta > 0 ? "money-positive" : "";
          return <tr key={entry.id}><td>{ledgerLabel(entry)}</td><td>{entry.description}</td><td className={effectClass}>{effects}</td><td>{formatDate(entry.createdAt)}</td></tr>;
        })}{!orderedEntries.length ? <tr><td colSpan={4}>No payment entries yet.</td></tr> : null}</tbody></table></div></section>
      </div>
    </section>
  </div>;
}

export function LedgerPage({ clients, balances, shipments, entries, dailyEntries, dailyLoading = false, selectedDate, onDateChange, canAdd, onAdd, onDelete }: { clients: Client[]; balances: ClientBalance[]; shipments: Shipment[]; entries: LedgerEntry[]; dailyEntries?: LedgerEntry[]; dailyLoading?: boolean; selectedDate: string; onDateChange: (value: string) => void; canAdd: boolean; onAdd: () => void; onDelete?: (entry: LedgerEntry) => void }) {
  const [clientFilter, setClientFilter] = useState("all");
  const filtered = (dailyEntries ?? entries.filter((entry) => dayMatches(entry.createdAt, selectedDate))).filter((entry) => clientFilter === "all" || entry.clientId === clientFilter);
  const cashIn = filtered.reduce((sum, entry) => sum + Math.max(entry.cashDelta, 0), 0);
  const cashOut = filtered.reduce((sum, entry) => sum + Math.max(-entry.cashDelta, 0), 0);
  const totalPayable = balances.filter((balance) => clientFilter === "all" || balance.clientId === clientFilter).reduce((sum, balance) => sum + balance.payable, 0);
  const totalReceivable = clients.filter((client) => clientFilter === "all" || client.id === clientFilter).reduce((sum, client) => sum + clientPendingAmount(client.id, shipments, balances), 0);

  return <div className="page-stack">
    <div className="page-toolbar"><div className="toolbar-description"><span className="eyebrow">CLIENT MONEY LEDGER</span><strong>Track settlements, deductions and payouts.</strong></div>{canAdd ? <button className="button button-primary" type="button" onClick={onAdd}><Plus size={17} />Add money entry</button> : null}</div>
    <div className="ledger-filters"><label className="filter-select"><span>Client</span><select className="input" value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><label className="date-field"><span>Activity date{dailyLoading ? " · updating" : ""}</span><input className="input" type="date" value={selectedDate} onChange={(event) => onDateChange(event.target.value)} /></label></div>
    <div className="stat-grid stat-grid-four"><StatCard label="Received that day" value={formatMoney(cashIn)} detail="Cash received / settlements" icon={<ArrowDownLeft size={19} />} tone="green" /><StatCard label="Paid that day" value={formatMoney(cashOut)} detail="Cash paid out" icon={<ArrowUpRight size={19} />} tone="rose" /><StatCard label="Current due to clients" value={formatMoney(totalPayable)} detail="Current payable balance" icon={<WalletCards size={19} />} tone="blue" /><StatCard label="Current due from clients" value={formatMoney(totalReceivable)} detail="Current receivable balance" icon={<ClipboardList size={19} />} tone="amber" /></div>
    <section className="panel-card table-panel"><div className="panel-heading"><div><h3>Money entries</h3><p>{filtered.length} {filtered.length === 1 ? "entry" : "entries"} on {formatInputDate(selectedDate)}</p></div><span className="date-range-chip">Actual cash movement is tracked separately from balance changes</span></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Client / panel</th><th>Entry</th><th>Reference</th><th>Cash flow</th><th>Payable change</th><th>Receivable change</th><th>Recorded</th>{onDelete ? <th>Action</th> : null}</tr></thead><tbody>{filtered.map((entry) => {
        const client = clients.find((row) => row.id === entry.clientId);
        return <tr key={entry.id}><td><div className="table-primary">{client?.name ?? "Unknown client"}</div><div className="table-secondary">{client?.panelName ?? ""}</div></td><td><div className="table-primary">{ledgerLabel(entry)}</div><div className="table-secondary">{entry.description}</div></td><td>{entry.reference || "—"}</td><td className={entry.cashDelta >= 0 ? "money-positive" : "money-negative"}>{entry.cashDelta === 0 ? "—" : `${entry.cashDelta > 0 ? "+" : "−"}${formatMoney(Math.abs(entry.cashDelta))}`}</td><td>{formatDelta(entry.payableDelta)}</td><td>{formatDelta(entry.receivableDelta)}</td><td>{formatDate(entry.createdAt)}</td>{onDelete ? <td><button className="button button-secondary button-small danger-button" type="button" onClick={() => onDelete(entry)}>Remove</button></td> : null}</tr>;
      })}{filtered.length === 0 ? <tr><td colSpan={onDelete ? 8 : 7}><EmptyState title="No entries for this date" text="Record the Meesho settlement, client payout or deduction when it happens." action={canAdd ? onAdd : undefined} /></td></tr> : null}</tbody></table></div>
    </section>
    <p className="data-note">Ledger entries can be added or removed when needed. Use a correction entry if you want to keep the audit trail clear.</p>
  </div>;
}

function StatCard({ label, value, detail, icon, tone }: { label: string; value: string; detail: string; icon: ReactNode; tone: string }) {
  return <article className="stat-card"><span className={`stat-icon tone-${tone}`}>{icon}</span><div className="stat-content"><span className="stat-label">{label}</span><strong>{value}</strong><small>{detail}</small></div></article>;
}

function StatusPill({ status }: { status: Shipment["status"] }) {
  return <span className={`status-pill status-${status}`}>{statusLabel(status)}</span>;
}

function EmptyState({ title, text, action }: { title: string; text: string; action?: () => void }) {
  return <div className="empty-state"><span className="empty-icon"><PackageOpen size={20} /></span><strong>{title}</strong><p>{text}</p>{action ? <button className="button button-secondary button-small" type="button" onClick={action}><Plus size={15} />Get started</button> : null}</div>;
}

const statusOptions: { value: Shipment["status"]; label: string }[] = [
  { value: "ready", label: "Ready to ship" }, { value: "dispatched", label: "Dispatched" }, { value: "delivered", label: "Delivered" },
  { value: "rto", label: "RTO" }, { value: "return_initiated", label: "Return initiated" }, { value: "returned", label: "Returned" }, { value: "reconciled", label: "Reconciled" },
];

function statusLabel(status: Shipment["status"]) { return statusOptions.find((option) => option.value === status)?.label ?? status; }
function conditionLabel(condition: ReturnRecord["condition"]) { return ({ sellable: "Sellable / restock", damaged: "Damaged", wrong_item: "Wrong item", missing_parts: "Missing parts", quarantine: "Needs inspection", disposed: "Disposed" })[condition]; }
function ledgerLabel(entry: LedgerEntry) { return ({ settlement: "Meesho settlement", product_cost: "Business expense", shipping: "Shipping cost", return_charge: "Return charge", claim_recovery: "Claim recovery", service_fee: "Service fee", client_payment: "Paid to client", client_receipt: "Client payment received", shipment_charge: "Product amount from label", adjustment: "Balance adjustment" })[entry.type]; }
function formatDelta(value: number) { return value === 0 ? "—" : `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`; }
function formatDate(value: unknown) { const date = timestampDate(value); return date ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date) : "—"; }
function formatInputDate(value: string) { if (!value) return "selected date"; return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`)); }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "CL"; }
