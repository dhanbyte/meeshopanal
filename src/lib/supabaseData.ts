import { supabase } from "./supabase";
import type { Client, ClientBalance, EvidenceFile, LedgerEntry, ProductPriceDefault, ReturnRecord, Shipment, UserProfile, WorkspaceData } from "./types";

function clientIdsFor(profile: UserProfile): string[] {
  if (profile.role === "client") return profile.clientId ? [profile.clientId] : [];
  return profile.clientIds ?? [];
}

function camelizeKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => camelizeKeys(entry)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
        const nextKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
        return [nextKey, camelizeKeys(entryValue)];
      }),
    ) as T;
  }
  return value;
}

function snakeCase(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/\s+/g, "_").toLowerCase();
}

function toSupabaseRow<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [snakeCase(key), item])) as Record<string, unknown>;
}

async function fetchRows<T>(table: string, filters: Array<{ column: string; op: "eq" | "in" | "gte" | "lt"; value: unknown }> = []) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const sortColumn = table === "client_balances" || table === "product_price_defaults" ? "updated_at" : "created_at";
  const rows: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let query = supabase.from(table).select("*");
    for (const filter of filters) {
      if (filter.op === "eq") query = query.eq(filter.column, filter.value as never);
      if (filter.op === "in") query = query.in(filter.column, filter.value as never[]);
      if (filter.op === "gte") query = query.gte(filter.column, filter.value as never);
      if (filter.op === "lt") query = query.lt(filter.column, filter.value as never);
    }
    const { data, error } = await query.order(sortColumn, { ascending: false, nullsFirst: false }).range(offset, offset + 499);
    if (error) throw error;
    rows.push(...(data ?? []).map((row) => camelizeKeys(row) as T));
    if ((data?.length ?? 0) < 500) return rows;
  }
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload";
}

export async function uploadSupabaseFile(bucket: "labels" | "return-evidence", clientId: string, recordId: string, file: File): Promise<EvidenceFile> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const maxSize = bucket === "labels" ? 25 * 1024 * 1024 : 300 * 1024 * 1024;
  if (file.size <= 0 || file.size > maxSize) throw new Error(`Choose a file smaller than ${bucket === "labels" ? "25 MB" : "300 MB"}.`);
  if (bucket === "labels" && !(file.type === "application/pdf" || file.type === "image/jpeg" || file.type === "image/png")) throw new Error("Labels must be a PDF, JPG or PNG.");
  if (bucket === "return-evidence" && !(file.type.startsWith("image/") || file.type.startsWith("video/"))) throw new Error("Return evidence must be a photo or video.");
  const path = `${clientId}/${recordId}/${Date.now()}-${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
  if (error) throw error;
  return { name: file.name, path, provider: "supabase", bucket, contentType: file.type || "application/octet-stream", size: file.size };
}

export async function removeSupabaseFile(bucket: "labels" | "return-evidence", path: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
}

export async function downloadSupabaseFile(bucket: "labels" | "return-evidence", path: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return URL.createObjectURL(data);
}

export async function loadWorkspaceSupabase(profile: UserProfile): Promise<WorkspaceData> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const ids = profile.role === "admin" ? [] : clientIdsFor(profile);
  const clientsPromise = profile.role === "admin"
    ? fetchRows<Client>("clients")
    : ids.length === 0
      ? Promise.resolve([] as Client[])
      : fetchRows<Client>("clients", [{ column: "id", op: "in", value: ids }, { column: "active", op: "eq", value: true }]);

  const balancesPromise = profile.role === "admin"
    ? fetchRows<ClientBalance>("client_balances")
    : ids.length === 0
      ? Promise.resolve([] as ClientBalance[])
      : fetchRows<ClientBalance>("client_balances", [{ column: "client_id", op: "in", value: ids }]);

  const shipmentsPromise = profile.role === "admin"
    ? fetchRows<Shipment>("shipments")
    : ids.length === 0
      ? Promise.resolve([] as Shipment[])
      : fetchRows<Shipment>("shipments", [{ column: "client_id", op: "in", value: ids }]);

  const returnsPromise = profile.role === "admin"
    ? fetchRows<ReturnRecord>("returns")
    : ids.length === 0
      ? Promise.resolve([] as ReturnRecord[])
      : fetchRows<ReturnRecord>("returns", [{ column: "client_id", op: "in", value: ids }]);

  const ledgerEntriesPromise = profile.role === "admin"
    ? fetchRows<LedgerEntry>("ledger_entries")
    : ids.length === 0
      ? Promise.resolve([] as LedgerEntry[])
      : fetchRows<LedgerEntry>("ledger_entries", [{ column: "client_id", op: "in", value: ids }]);

  const productPriceDefaultsPromise = fetchRows<ProductPriceDefault>("product_price_defaults");

  const [clients, balances, shipments, returns, ledgerEntries, productPriceDefaults] = await Promise.all([
    clientsPromise,
    balancesPromise,
    shipmentsPromise,
    returnsPromise,
    ledgerEntriesPromise,
    productPriceDefaultsPromise,
  ]);

  const clientIds = new Set(clients.map((client) => client.id));
  const activeShipments = shipments.filter((shipment) => clientIds.has(shipment.clientId));
  const activeLedgerEntries = ledgerEntries.filter((entry) => clientIds.has(entry.clientId));
  const calculatedBalances = clients.map((client) => {
    const stored = balances.find((balance) => balance.clientId === client.id);
    return { id: client.id, clientId: client.id, payable: stored?.payable ?? 0, receivable: stored?.receivable ?? 0, cash: stored?.cash ?? 0, updatedAt: stored?.updatedAt ?? null };
  });
  return {
    clients,
    balances: calculatedBalances,
    shipments: activeShipments.map((shipment) => ({ ...shipment, clientAmountPosted: true })),
    returns: returns.filter((record) => clientIds.has(record.clientId)),
    ledgerEntries: activeLedgerEntries,
    productPriceDefaults,
  };
}

export async function loadClientHistorySupabase(clientId: string): Promise<{ shipments: Shipment[]; ledgerEntries: LedgerEntry[] }> {
  const [shipments, ledgerEntries] = await Promise.all([
    fetchRows<Shipment>("shipments", [{ column: "client_id", op: "eq", value: clientId }]),
    fetchRows<LedgerEntry>("ledger_entries", [{ column: "client_id", op: "eq", value: clientId }]),
  ]);
  return { shipments, ledgerEntries };
}

export async function loadDailyActivitySupabase(profile: UserProfile, dateValue: string): Promise<Pick<WorkspaceData, "shipments" | "returns" | "ledgerEntries">> {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return { shipments: [], returns: [], ledgerEntries: [] };

  const start = new Date(year, month - 1, day).toISOString();
  const end = new Date(year, month - 1, day + 1).toISOString();
  const activeClients = profile.role === "admin"
    ? await fetchRows<Client>("clients", [{ column: "active", op: "eq", value: true }])
    : [];
  const ids = profile.role === "admin" ? activeClients.map((client) => client.id) : clientIdsFor(profile);
  if (ids.length === 0) return { shipments: [], returns: [], ledgerEntries: [] };

  const shipmentsPromise = profile.role === "admin"
    ? fetchRows<Shipment>("shipments", [{ column: "client_id", op: "in", value: ids }, { column: "created_at", op: "gte", value: start }, { column: "created_at", op: "lt", value: end }])
    : fetchRows<Shipment>("shipments", [{ column: "client_id", op: "in", value: ids }, { column: "created_at", op: "gte", value: start }, { column: "created_at", op: "lt", value: end }]);

  const returnsPromise = profile.role === "admin"
    ? fetchRows<ReturnRecord>("returns", [{ column: "client_id", op: "in", value: ids }, { column: "created_at", op: "gte", value: start }, { column: "created_at", op: "lt", value: end }])
    : fetchRows<ReturnRecord>("returns", [{ column: "client_id", op: "in", value: ids }, { column: "created_at", op: "gte", value: start }, { column: "created_at", op: "lt", value: end }]);

  const ledgerEntriesPromise = profile.role === "admin"
    ? fetchRows<LedgerEntry>("ledger_entries", [{ column: "client_id", op: "in", value: ids }, { column: "created_at", op: "gte", value: start }, { column: "created_at", op: "lt", value: end }])
    : fetchRows<LedgerEntry>("ledger_entries", [{ column: "client_id", op: "in", value: ids }, { column: "created_at", op: "gte", value: start }, { column: "created_at", op: "lt", value: end }]);

  const [shipments, returns, ledgerEntries] = await Promise.all([shipmentsPromise, returnsPromise, ledgerEntriesPromise]);
  return { shipments, returns, ledgerEntries };
}

export async function createClientSupabase(input: Omit<Client, "id" | "createdAt">, createdBy: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const id = crypto.randomUUID();
  const row = toSupabaseRow({
    ...input,
    id,
    createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const { error } = await supabase.from("clients").insert(row);
  if (error) throw error;
  return { id };
}

export async function updateClientDetailsSupabase(id: string, patch: Pick<Client, "name" | "businessName" | "panelName" | "contactName" | "phone" | "email" | "serviceFeePercent" | "active">) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("update_client_details", { p_client_id: id, p_patch: patch });
  if (error) throw error;
}

export async function createShipmentSupabase(profile: UserProfile, shipment: Omit<Shipment, "id" | "createdAt" | "updatedAt" | "createdBy" | "labelUrl" | "labelPath">, labelFile: File, shipmentId?: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  void profile;
  const id = shipmentId ?? crypto.randomUUID();
  const label = labelFile?.size ? await uploadSupabaseFile("labels", shipment.clientId, id, labelFile) : null;
  const { data, error } = await supabase.rpc("create_shipment_with_charge", {
    p_id: id,
    p_shipment: shipment,
    p_label: label ? { path: label.path, name: label.name } : null,
  });
  if (error) {
    if (label) await removeSupabaseFile("labels", label.path).catch(() => undefined);
    throw error;
  }
  return String(data ?? id);
}

export async function createReturnRecordSupabase(profile: UserProfile, record: Omit<ReturnRecord, "id" | "createdAt" | "createdBy">, id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  void profile;
  const { error } = await supabase.rpc("create_return_record", { p_id: id, p_record: record });
  if (error) throw error;
  return id;
}

export async function createLedgerEntrySupabase(profile: UserProfile, input: Omit<LedgerEntry, "id" | "createdAt" | "createdBy">, idempotencyKey: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  void profile;
  const { data, error } = await supabase.rpc("record_ledger_entry", {
    p_client_id: input.clientId,
    p_type: input.type,
    p_amount: input.amount,
    p_direction: input.direction,
    p_payable_delta: input.payableDelta,
    p_receivable_delta: input.receivableDelta,
    p_cash_delta: input.cashDelta,
    p_description: input.description,
    p_reference: input.reference || null,
    p_shipment_id: input.shipmentId || null,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  return { id: String(data) };
}

export async function deleteLedgerEntrySupabase(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("reverse_ledger_entry", { p_entry_id: id, p_idempotency_key: crypto.randomUUID() });
  if (error) throw error;
}

export async function deleteClientSupabase(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("archive_client", { p_client_id: id });
  if (error) throw error;
}

export async function deleteShipmentSupabase(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("delete_shipment", { p_shipment_id: id });
  if (error) throw error;
}

export async function updateReturnRecordSupabase(id: string, patch: Partial<ReturnRecord>) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("update_return_record", { p_return_id: id, p_patch: patch });
  if (error) throw error;
}

export async function updateShipmentStatusSupabase(id: string, status: Shipment["status"]) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("update_shipment_status", { p_shipment_id: id, p_status: status });
  if (error) throw error;
}

export async function updateShipmentDetailsSupabase(id: string, patch: Pick<Shipment, "orderNumber" | "subOrderNumber" | "courier" | "customerName" | "customerAddress" | "customerPhone" | "items" | "invoiceTotal" | "status">) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.rpc("update_shipment_details", { p_shipment_id: id, p_patch: patch });
  if (error) throw error;
}

export async function saveProductPriceDefaultSupabase(profile: UserProfile, input: { sku: string; productName: string; unitCost: number }): Promise<"synced" | "local" | "memory"> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const id = `${profile.uid}-${input.sku || input.productName}`;
  const row = toSupabaseRow({ id, sku: input.sku, productName: input.productName, unitCost: input.unitCost, updatedAt: new Date().toISOString() });
  const { error } = await supabase.from("product_price_defaults").upsert(row, { onConflict: "id" });
  if (error) throw error;
  return "synced";
}
