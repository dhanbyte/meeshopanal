import { supabase } from "./supabase";
import type { Client, ClientBalance, LedgerEntry, ProductPriceDefault, ReturnRecord, Shipment, UserProfile, WorkspaceData } from "./types";

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

function shipmentAmount(shipment: Shipment) {
  return (shipment.items ?? []).reduce((total, item) => total + Math.max(0, Number(item.unitCost) || 0) * Math.max(0, Number(item.quantity) || 0), 0);
}

async function fetchRows<T>(table: string, filters: Array<{ column: string; op: "eq" | "in" | "gte" | "lt"; value: unknown }> = []) {
  if (!supabase) throw new Error("Supabase is not configured.");
  let query = supabase.from(table).select("*");

  for (const filter of filters) {
    if (filter.op === "eq") query = query.eq(filter.column, filter.value as never);
    if (filter.op === "in") query = query.in(filter.column, filter.value as never[]);
    if (filter.op === "gte") query = query.gte(filter.column, filter.value as never);
    if (filter.op === "lt") query = query.lt(filter.column, filter.value as never);
  }

  const sortColumn = table === "client_balances" || table === "product_price_defaults" ? "updated_at" : "created_at";
  const { data, error } = await query.order(sortColumn, { ascending: false, nullsFirst: false }).limit(500);
  if (error) throw error;
  return (data ?? []).map((row) => camelizeKeys(row)) as T[];
}

export async function loadWorkspaceSupabase(profile: UserProfile): Promise<WorkspaceData> {
  if (!supabase) throw new Error("Supabase is not configured.");

  const ids = profile.role === "admin" ? [] : clientIdsFor(profile);
  const clientsPromise = profile.role === "admin"
    ? fetchRows<Client>("clients", [{ column: "active", op: "eq", value: true }])
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

  const activeClientIds = new Set(clients.map((client) => client.id));
  const activeShipments = shipments.filter((shipment) => activeClientIds.has(shipment.clientId));
  const activeLedgerEntries = ledgerEntries.filter((entry) => activeClientIds.has(entry.clientId));
  const calculatedBalances = clients.map((client) => {
    const stored = balances.find((balance) => balance.clientId === client.id);
    const shipmentReceivable = activeShipments
      .filter((shipment) => shipment.clientId === client.id)
      .reduce((total, shipment) => total + shipmentAmount(shipment), 0);
    const ledgerReceivable = activeLedgerEntries
      .filter((entry) => entry.clientId === client.id && entry.type !== "shipment_charge")
      .reduce((total, entry) => total + Number(entry.receivableDelta ?? 0), 0);
    return {
      id: stored?.id ?? client.id,
      clientId: client.id,
      payable: Number(stored?.payable ?? 0),
      receivable: shipmentReceivable + ledgerReceivable,
      cash: Number(stored?.cash ?? 0),
      updatedAt: stored?.updatedAt ?? null,
    };
  });
  return {
    clients,
    balances: calculatedBalances,
    shipments: activeShipments.map((shipment) => ({ ...shipment, clientAmountPosted: true })),
    returns: returns.filter((record) => activeClientIds.has(record.clientId)),
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
  const { error } = await supabase.from("clients").update(toSupabaseRow(patch)).eq("id", id);
  if (error) throw error;
}

export async function createShipmentSupabase(profile: UserProfile, shipment: Omit<Shipment, "id" | "createdAt" | "updatedAt" | "createdBy" | "labelUrl" | "labelPath">, labelFile: File, shipmentId?: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const id = shipmentId ?? crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const row = toSupabaseRow({
    ...shipment,
    id,
    createdBy: profile.uid,
    createdAt,
    updatedAt: createdAt,
    labelFileId: labelFile?.name ? undefined : undefined,
    labelUrl: undefined,
    labelPath: undefined,
  });
  const { error } = await supabase.from("shipments").insert(row);
  if (error) throw error;
  return id;
}

export async function createReturnRecordSupabase(profile: UserProfile, record: Omit<ReturnRecord, "id" | "createdAt" | "createdBy">, id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const row = toSupabaseRow({ ...record, id, createdBy: profile.uid, createdAt: new Date().toISOString() });
  const { error } = await supabase.from("returns").insert(row);
  if (error) throw error;
  return id;
}

export async function createLedgerEntrySupabase(profile: UserProfile, input: Omit<LedgerEntry, "id" | "createdAt" | "createdBy">) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const row = toSupabaseRow({ ...input, id: crypto.randomUUID(), createdBy: profile.uid, createdAt: new Date().toISOString() });
  const { error } = await supabase.from("ledger_entries").insert(row);
  if (error) throw error;
  const { data: currentBalance, error: balanceReadError } = await supabase.from("client_balances").select("*").eq("client_id", input.clientId).maybeSingle();
  if (balanceReadError) throw balanceReadError;
  const { error: balanceWriteError } = await supabase.from("client_balances").upsert({
    client_id: input.clientId,
    payable: Number(currentBalance?.payable ?? 0) + input.payableDelta,
    receivable: Number(currentBalance?.receivable ?? 0) + input.receivableDelta,
    cash: Number(currentBalance?.cash ?? 0) + input.cashDelta,
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (balanceWriteError) throw balanceWriteError;
  return { id: row.id };
}

export async function deleteLedgerEntrySupabase(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("admin-delete-ledger-entry", { body: { id } });
  if (error) {
    let message = error.message || "Could not remove this ledger entry.";
    if (error.context instanceof Response) {
      const body = await error.context.json().catch(() => null) as { error?: string } | null;
      if (body?.error) message = body.error;
    }
    throw new Error(message);
  }
  if (!data?.deleted) throw new Error("The ledger entry was not removed.");
}

export async function deleteClientSupabase(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { error: ledgerError } = await supabase.from("ledger_entries").delete().eq("client_id", id);
  if (ledgerError) throw ledgerError;
  const { error: returnsError } = await supabase.from("returns").delete().eq("client_id", id);
  if (returnsError) throw returnsError;
  const { error: shipmentsError } = await supabase.from("shipments").delete().eq("client_id", id);
  if (shipmentsError) throw shipmentsError;
  const { error: balanceError } = await supabase.from("client_balances").delete().eq("client_id", id);
  if (balanceError) throw balanceError;
  const { error: clientError } = await supabase.from("clients").delete().eq("id", id);
  if (clientError) throw clientError;
}

export async function deleteShipmentSupabase(id: string) {
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data: shipmentData, error: shipmentReadError } = await supabase.from("shipments").select("*").eq("id", id).maybeSingle();
  if (shipmentReadError) throw shipmentReadError;
  if (!shipmentData) return;

  const shipment = camelizeKeys(shipmentData) as Shipment;
  const { data: linkedEntries, error: linkedEntryError } = await supabase.from("ledger_entries").select("*").eq("shipment_id", id);
  if (linkedEntryError) throw linkedEntryError;

  const entries = (linkedEntries ?? []).map((entry) => camelizeKeys(entry) as LedgerEntry);
  const balanceResult = await supabase.from("client_balances").select("*").eq("client_id", shipment.clientId).maybeSingle();
  if (balanceResult.error) throw balanceResult.error;

  const currentBalance = balanceResult.data ? (camelizeKeys(balanceResult.data) as ClientBalance) : { clientId: shipment.clientId, payable: 0, receivable: 0, cash: 0 };
  const receivableReduction = entries.reduce((sum, entry) => sum + Number(entry.receivableDelta ?? 0), 0);
  const payableReduction = entries.reduce((sum, entry) => sum + Number(entry.payableDelta ?? 0), 0);
  const cashReduction = entries.reduce((sum, entry) => sum + Number(entry.cashDelta ?? 0), 0);

  const { error: balanceUpdateError } = await supabase.from("client_balances").upsert({
    client_id: shipment.clientId,
    payable: Number(currentBalance.payable ?? 0) - payableReduction,
    receivable: Number(currentBalance.receivable ?? 0) - receivableReduction,
    cash: Number(currentBalance.cash ?? 0) - cashReduction,
    updated_at: new Date().toISOString(),
  }, { onConflict: "client_id" });
  if (balanceUpdateError) throw balanceUpdateError;

  const { error: returnDeleteError } = await supabase.from("returns").delete().eq("shipment_id", id);
  if (returnDeleteError) throw returnDeleteError;

  const { error: ledgerDeleteError } = await supabase.from("ledger_entries").delete().eq("shipment_id", id);
  if (ledgerDeleteError) throw ledgerDeleteError;

  const { error: shipmentDeleteError } = await supabase.from("shipments").delete().eq("id", id);
  if (shipmentDeleteError) throw shipmentDeleteError;
}

export async function updateReturnRecordSupabase(id: string, patch: Partial<ReturnRecord>) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("returns").update(toSupabaseRow(patch as Record<string, unknown>)).eq("id", id);
  if (error) throw error;
}

export async function updateShipmentStatusSupabase(id: string, status: Shipment["status"]) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("shipments").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

export async function updateShipmentDetailsSupabase(id: string, patch: Pick<Shipment, "orderNumber" | "subOrderNumber" | "courier" | "customerName" | "customerAddress" | "customerPhone" | "items" | "invoiceTotal" | "status">) {
  if (!supabase) throw new Error("Supabase is not configured.");
  const { error } = await supabase.from("shipments").update({
    ...toSupabaseRow(patch as Record<string, unknown>),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
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
