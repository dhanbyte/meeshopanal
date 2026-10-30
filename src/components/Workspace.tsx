import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { Activity, Bell, ChevronDown, CircleUserRound, LayoutDashboard, LogOut, Menu, PackageCheck, PackageOpen, RefreshCw, RotateCcw, Search, ShieldCheck, UsersRound, WalletCards, X } from "lucide-react";
import { clientPendingAmount, deleteLedgerEntry, deleteShipment, loadDailyActivity, loadWorkspace, normalizeAwb, updateReturnRecord, updateShipmentStatus } from "../lib/data";
import { demoWorkspaceData } from "../lib/demoData";
import type { Client, LedgerEntry, ProductPriceDefault, ReturnRecord, Shipment, UserProfile, WorkspaceData, EvidenceFile } from "../lib/types";
import { AddClientModal, ClientLoginModal, EditClientModal, EditShipmentModal, LedgerModal, MediaViewer, ReturnModal } from "./OperationModals";
import { UploadLabelModal } from "./UploadLabelModal";
import { ClientsPage, DashboardPage, LedgerPage, OrdersPage, ReturnsPage, todayInputValue } from "./Pages";

type PageId = "dashboard" | "orders" | "returns" | "clients" | "ledger";
const navItems: { id: PageId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Overview", icon: LayoutDashboard },
  { id: "orders", label: "Orders & labels", icon: PackageOpen },
  { id: "returns", label: "Returns & RTO", icon: RotateCcw },
  { id: "clients", label: "Clients", icon: UsersRound },
  { id: "ledger", label: "Money ledger", icon: WalletCards },
];

const titles: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: "Overview", subtitle: "A clear view of orders, returns and balances." },
  orders: { title: "Orders & labels", subtitle: "Upload labels, review extracted details and track AWBs." },
  returns: { title: "Returns & RTO", subtitle: "Inspect returned products and keep evidence with each order." },
  clients: { title: "Clients", subtitle: "Keep panel details and balances organized by client." },
  ledger: { title: "Money ledger", subtitle: "Reconcile settlements, client payouts and amounts due." },
};

export function Workspace({ user, profile, onLogout, demoMode = false }: { user: Pick<User, "email">; profile: UserProfile; onLogout: () => Promise<void>; demoMode?: boolean }) {
  const [data, setData] = useState<WorkspaceData>(demoMode ? demoWorkspaceData : { clients: [], balances: [], shipments: [], returns: [], ledgerEntries: [], productPriceDefaults: [] });
  const [dailyActivity, setDailyActivity] = useState<Pick<WorkspaceData, "shipments" | "returns" | "ledgerEntries">>({ shipments: [], returns: [], ledgerEntries: [] });
  const [dailyLoading, setDailyLoading] = useState(!demoMode);
  const [page, setPage] = useState<PageId>("dashboard");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [loginClient, setLoginClient] = useState<Client | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerClientId, setLedgerClientId] = useState("");
  const [ledgerPresetAction, setLedgerPresetAction] = useState<"client-receipt" | "receivable" | undefined>();
  const [ledgerReceiptDue, setLedgerReceiptDue] = useState(0);
  const [editingShipment, setEditingShipment] = useState<Shipment | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<{ returnId: string; file: EvidenceFile } | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(todayInputValue());
  const [busyShipmentId, setBusyShipmentId] = useState("");
  const dailyRequestId = useRef(0);
  const canManage = !demoMode && (profile.role === "admin" || profile.role === "staff");
  const canDeleteOwnOrders = !demoMode && profile.role === "client";
  const canUpload = canManage || demoMode;
  const canAdmin = !demoMode && profile.role === "admin";
  const nav = profile.role === "client" ? navItems.filter((item) => item.id !== "clients") : navItems;
  const pageInfo = titles[page];

  const refresh = useCallback(async (quiet = false) => {
    if (demoMode) {
      setError("");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (quiet) setRefreshing(true);
    else setLoading(true);
    setError("");
    try {
      setData(await loadWorkspace(profile));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not load the workspace.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [profile, demoMode]);

  const refreshDaily = useCallback(async (dateValue: string) => {
    const requestId = ++dailyRequestId.current;
    if (demoMode) {
      setDailyLoading(false);
      return;
    }
    setDailyLoading(true);
    try {
      const result = await loadDailyActivity(profile, dateValue);
      if (requestId === dailyRequestId.current) setDailyActivity(result);
    } catch (issue) {
      if (requestId === dailyRequestId.current) setError(issue instanceof Error ? issue.message : "Could not load activity for this date.");
    } finally {
      if (requestId === dailyRequestId.current) setDailyLoading(false);
    }
  }, [profile, demoMode]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshDaily(selectedDate); }, [refreshDaily, selectedDate]);

  const countOpenReturns = useMemo(() => data.returns.filter((record) => record.condition === "quarantine").length, [data.returns]);
  const showNotice = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3500);
  };

  async function handleStatusChange(id: string, status: Shipment["status"]) {
    setBusyShipmentId(id);
    setError("");
    try {
      await updateShipmentStatus(id, status);
      await refresh(true);
      showNotice("Shipment status updated.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Status could not be updated.");
    } finally {
      setBusyShipmentId("");
    }
  }

  async function handleShare(record: ReturnRecord) {
    try {
      await updateReturnRecord(record.id, { sharedWithClient: !record.sharedWithClient });
      await refresh(true);
      showNotice(record.sharedWithClient ? "Return evidence hidden from the client." : "Return evidence is now visible to the client.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Sharing setting could not be updated.");
    }
  }

  async function handleClaimUpdate(id: string, claimStatus: ReturnRecord["claimStatus"]) {
    try {
      await updateReturnRecord(id, { claimStatus });
      await refresh(true);
      showNotice("Claim status updated.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Claim status could not be updated.");
    }
  }

  async function handleDeleteLedgerEntry(entry: LedgerEntry) {
    try {
      const clientName = data.clients.find((client) => client.id === entry.clientId)?.name ?? "this client";
      const confirmed = window.confirm(`Remove this ledger entry for ${clientName}?`);
      if (!confirmed) return;
      await deleteLedgerEntry(entry.id);
      await refresh(true);
      await refreshDaily(selectedDate);
      showNotice("Ledger entry removed.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Ledger entry could not be removed.");
    }
  }

  async function handleDeleteShipment(shipment: Shipment) {
    if (profile.role === "client" && shipment.clientId !== profile.clientId) {
      setError("You can only delete your own orders.");
      return;
    }
    try {
      const clientName = data.clients.find((client) => client.id === shipment.clientId)?.name ?? "this client";
      const confirmed = window.confirm(`Delete this order for ${clientName} and remove its linked ledger/return records?`);
      if (!confirmed) return;
      await deleteShipment(shipment.id);
      await refresh(true);
      await refreshDaily(selectedDate);
      showNotice("Order removed.");
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Order could not be removed.");
    }
  }

  async function handleShipmentSaved(shipment?: Shipment) {
    if (demoMode && shipment) {
      const key = normalizeAwb(shipment.awb);
      if (data.shipments.some((existing) => normalizeAwb(existing.awb) === key)) {
        throw new Error("This AWB already exists in the demo workspace.");
      }
      const now = new Date();
      const amount = shipment.items.reduce((sum, item) => sum + Math.max(0, item.unitCost) * Math.max(0, item.quantity), 0);
      const charge: LedgerEntry | null = amount > 0 ? { id: `DEMO-${crypto.randomUUID()}`, clientId: shipment.clientId, shipmentId: shipment.id, orderNumber: shipment.orderNumber, type: "shipment_charge", amount, direction: "in", payableDelta: 0, receivableDelta: amount, cashDelta: 0, description: "Product amount added from label", reference: shipment.awb, createdBy: profile.uid, createdAt: now } : null;
      setData((current) => {
        const balance = current.balances.find((row) => row.clientId === shipment.clientId);
        const nextBalance = { id: shipment.clientId, clientId: shipment.clientId, payable: balance?.payable ?? 0, receivable: (balance?.receivable ?? 0) + amount, cash: balance?.cash ?? 0, updatedAt: now };
        return { ...current, shipments: [{ ...shipment, clientAmountPosted: true }, ...current.shipments], balances: [nextBalance, ...current.balances.filter((row) => row.clientId !== shipment.clientId)], ledgerEntries: charge ? [charge, ...current.ledgerEntries] : current.ledgerEntries };
      });
      return;
    }
    await refresh(true);
    await refreshDaily(selectedDate);
  }

  async function handleOperationsSaved() {
    await refresh(true);
    await refreshDaily(selectedDate);
  }

  function handleProductPriceDefaultSaved(productDefault: ProductPriceDefault) {
    setData((current) => ({
      ...current,
      productPriceDefaults: [productDefault, ...current.productPriceDefaults.filter((entry) => entry.id !== productDefault.id)],
    }));
  }

  function openLedgerEntry() {
    setLedgerClientId("");
    setLedgerPresetAction(undefined);
    setLedgerReceiptDue(0);
    setLedgerOpen(true);
  }

  function openClientPayment(clientId: string, dueOverride?: number) {
    const due = Number.isFinite(dueOverride) ? Number(dueOverride) : clientPendingAmount(clientId, data.shipments, data.balances);
    setLedgerClientId(clientId);
    setLedgerPresetAction("client-receipt");
    setLedgerReceiptDue(due);
    setLedgerOpen(true);
  }

  function navigate(nextPage: PageId) {
    setPage(nextPage);
    setMobileNavOpen(false);
  }

  function pageContent() {
    if (loading) return <div className="loading-panel"><span className="loader-mark" /><span>Loading your latest records…</span></div>;
    if (page === "dashboard") return <DashboardPage clients={data.clients} balances={data.balances} shipments={data.shipments} returns={data.returns} ledgerEntries={data.ledgerEntries} dailyActivity={demoMode ? undefined : dailyActivity} dailyLoading={dailyLoading} selectedDate={selectedDate} onDateChange={setSelectedDate} onGoOrders={() => navigate("orders")} />;
    if (page === "orders") return <OrdersPage shipments={data.shipments} clients={data.clients} canManage={canManage} canUpload={canUpload} search={search} onSearch={setSearch} onUpload={() => setUploadOpen(true)} onStatusChange={(id, status) => void handleStatusChange(id, status)} onEdit={setEditingShipment} onDelete={canManage || canDeleteOwnOrders ? handleDeleteShipment : undefined} busyId={busyShipmentId} />;
    if (page === "returns") return <ReturnsPage returns={data.returns} clients={data.clients} canManage={canManage} profileRole={profile.role} onAdd={() => setReturnOpen(true)} onView={(record, fileIndex) => setSelectedEvidence({ returnId: record.id, file: record.evidence[fileIndex] })} onShare={(record) => void handleShare(record)} onClaimUpdate={(id, status) => void handleClaimUpdate(id, status)} />;
    if (page === "clients") return <ClientsPage clients={data.clients} balances={data.balances} shipments={data.shipments} ledgerEntries={data.ledgerEntries} canAdd={canAdmin} canRecordPayment={canAdmin} onAdd={() => setClientOpen(true)} onRecordPayment={openClientPayment} onEditClient={setEditingClient} onManageLogin={setLoginClient} />;
    return <LedgerPage clients={data.clients} balances={data.balances} shipments={data.shipments} entries={data.ledgerEntries} dailyEntries={demoMode ? undefined : dailyActivity.ledgerEntries} dailyLoading={dailyLoading} selectedDate={selectedDate} onDateChange={setSelectedDate} canAdd={canManage} onAdd={openLedgerEntry} onDelete={canManage ? handleDeleteLedgerEntry : undefined} />;
  }

  return <div className="app-shell">
    {mobileNavOpen ? <button className="mobile-scrim" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}
    <aside className={`sidebar ${mobileNavOpen ? "sidebar-open" : ""}`}>
      <div className="brand-lockup"><span className="brand-mark"><PackageCheck size={20} /></span><span><strong>Parcel Desk</strong><small>Meesho operations</small></span><button className="mobile-close icon-button" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="workspace-switch"><span className="workspace-avatar">PD</span><div><strong>{demoMode ? "Demo workspace" : "Operations workspace"}</strong><small>{data.clients.length} client{data.clients.length === 1 ? "" : "s"} connected</small></div><ChevronDown size={15} /></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">{nav.map((item) => {
        const Icon = item.icon;
        return <button type="button" key={item.id} className={`nav-item ${page === item.id ? "nav-active" : ""}`} onClick={() => navigate(item.id)}><Icon size={18} /><span>{item.label}</span>{item.id === "returns" && countOpenReturns > 0 ? <em>{countOpenReturns}</em> : null}</button>;
      })}</nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-help"><div className="help-icon"><Activity size={17} /></div><div><strong>Keep records current</strong><small>Refresh after updating a panel.</small></div><button className="icon-button" type="button" onClick={() => void refresh(true)} aria-label="Refresh records"><RefreshCw size={15} /></button></div>
      <div className="sidebar-profile"><span className="profile-avatar"><CircleUserRound size={18} /></span><div><strong>{profile.name || user.email || "Workspace user"}</strong><small>{demoMode ? "Read-only demo" : profile.role === "admin" ? "Administrator" : profile.role === "staff" ? "Operations staff" : "Client access"}</small></div><button className="icon-button" type="button" onClick={() => void onLogout()} aria-label={demoMode ? "Exit demo" : "Sign out"}><LogOut size={16} /></button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-leading"><button className="mobile-menu icon-button" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation"><Menu size={20} /></button><div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{pageInfo.title}</strong></div></div><div className="topbar-actions"><label className="global-search"><Search size={16} /><input aria-label="Search all orders" value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value) setPage("orders"); }} placeholder="Search order, AWB, SKU…" /><kbd>⌘ K</kbd></label><button className={`icon-button notification-button ${countOpenReturns ? "has-dot" : ""}`} type="button" onClick={() => navigate("returns")} aria-label={`${countOpenReturns} returns need inspection`}><Bell size={18} /></button><span className="topbar-divider" /><span className="topbar-date">{new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(new Date())}</span></div></header>
      {demoMode ? <div className="demo-banner" role="status"><strong>Demo preview</strong><span>Label OCR runs in this browser; saved demo rows are temporary and never reach Firebase.</span><button type="button" onClick={() => void onLogout()}>Exit demo</button></div> : null}
      <section className="page-heading"><div><span className="eyebrow">PARCEL DESK / {demoMode ? "DEMO PREVIEW" : "OPERATIONS"}</span><h1>{pageInfo.title}</h1><p>{pageInfo.subtitle}</p></div></section>
      {!demoMode && profile.role === "client" ? <div className="client-readonly-banner" role="status">View-only client access · contact your administrator to correct order or payment details.</div> : null}
      {error ? <div className="global-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div> : null}
      {notice ? <div className="toast-note" role="status">{notice}</div> : null}
      <section className="content-area">{pageContent()}</section>
      <footer className="app-footer"><span><ShieldCheck size={14} /> {demoMode ? "Fictional sample data" : "Private client workspace"}</span><button type="button" onClick={() => void refresh(true)} disabled={refreshing}>{refreshing ? <><RefreshCw className="spin" size={14} /> Updating</> : <><RefreshCw size={14} /> Refresh records</>}</button></footer>
    </main>
    {uploadOpen ? <UploadLabelModal clients={data.clients} profile={profile} demoMode={demoMode} existingAwbs={data.shipments.map((shipment) => shipment.awb)} productPriceDefaults={data.productPriceDefaults} onProductPriceDefaultSaved={handleProductPriceDefaultSaved} onClose={() => setUploadOpen(false)} onSaved={handleShipmentSaved} /> : null}
    {returnOpen ? <ReturnModal clients={data.clients} shipments={data.shipments} profile={profile} onClose={() => setReturnOpen(false)} onSaved={handleOperationsSaved} /> : null}
    {clientOpen ? <AddClientModal profile={profile} onClose={() => setClientOpen(false)} onSaved={() => refresh(true)} /> : null}
    {editingClient ? <EditClientModal client={editingClient} onClose={() => setEditingClient(null)} onSaved={async () => { await refresh(true); showNotice("Client details updated."); }} /> : null}
    {loginClient ? <ClientLoginModal client={loginClient} onClose={() => setLoginClient(null)} onSaved={async () => { await refresh(true); showNotice("Client login saved."); }} /> : null}
    {editingShipment ? <EditShipmentModal shipment={editingShipment} onClose={() => setEditingShipment(null)} onSaved={async () => { await refresh(true); showNotice("Shipment details updated."); }} /> : null}
    {ledgerOpen ? <LedgerModal clients={data.clients} profile={profile} initialClientId={ledgerClientId} presetAction={ledgerPresetAction} dueFromClient={ledgerReceiptDue} onClose={() => setLedgerOpen(false)} onSaved={handleOperationsSaved} /> : null}
    {selectedEvidence ? <MediaViewer returnId={selectedEvidence.returnId} file={selectedEvidence.file} onClose={() => setSelectedEvidence(null)} /> : null}
  </div>;
}
