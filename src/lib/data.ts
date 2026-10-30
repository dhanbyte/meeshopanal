import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  startAfter,
  setDoc,
  updateDoc,
  where,
  Timestamp,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QueryConstraint,
} from "firebase/firestore";
import { deleteObject, getBlob, ref } from "firebase/storage";
import { deleteImageKitAsset, getImageKitReturnUrl, uploadToImageKit } from "./imagekit";
import { requireFirebase } from "./firebase";
import { supabase } from "./supabase";
import { createClientSupabase, createLedgerEntrySupabase, createReturnRecordSupabase, createShipmentSupabase, deleteLedgerEntrySupabase, loadClientHistorySupabase, loadDailyActivitySupabase, loadWorkspaceSupabase, saveProductPriceDefaultSupabase, updateClientDetailsSupabase, updateReturnRecordSupabase, updateShipmentDetailsSupabase, updateShipmentStatusSupabase } from "./supabaseData";
import type { Client, ClientBalance, EvidenceFile, LedgerEntry, ProductPriceDefault, ReturnRecord, Shipment, ShipmentItem, UserProfile, WorkspaceData } from "./types";

const PAGE_LIMIT = 500;
const PRODUCT_PRICE_CACHE_KEY = "parceldesk.product-price-defaults.v1";

function isPermissionDenied(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "permission-denied" || /missing or insufficient permissions/i.test(message);
}

function withFirestoreContext<T>(resource: string, request: Promise<T>): Promise<T> {
  return request.catch((error: unknown) => {
    if (isPermissionDenied(error)) {
      throw new Error(`Firestore Rules blocked access to ${resource}. Check that rules are published in project messhoflipkart-f62f6 and that users/{your UID} has active=true (boolean), the correct role, and the right client access.`);
    }
    throw error;
  });
}

function clientIdsFor(profile: UserProfile): string[] {
  if (profile.role === "client") return profile.clientId ? [profile.clientId] : [];
  return profile.clientIds ?? [];
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function shipmentAmount(items: ShipmentItem[] = []) {
  return items.reduce((sum, item) => sum + Math.max(0, Number(item.unitCost) || 0) * Math.max(0, Number(item.quantity) || 0), 0);
}

export async function syncLegacyWorkspaceToSupabase(profile: UserProfile): Promise<{ clients: number; balances: number; shipments: number; returns: number; ledgerEntries: number }> {
  if (!supabase || profile.role !== "admin") {
    return { clients: 0, balances: 0, shipments: 0, returns: 0, ledgerEntries: 0 };
  }

  // Firebase is intentionally disabled. No legacy Firestore sync is performed.
  return { clients: 0, balances: 0, shipments: 0, returns: 0, ledgerEntries: 0 };
}

export function clientPendingAmount(clientId: string, shipments: Shipment[], balances: ClientBalance[]) {
  const postedReceivable = balances.find((balance) => balance.clientId === clientId)?.receivable ?? 0;
  const olderUnpostedShipments = shipments
    .filter((shipment) => shipment.clientId === clientId && !shipment.clientAmountPosted)
    .reduce((sum, shipment) => sum + shipmentAmount(shipment.items ?? []), 0);
  return postedReceivable + olderUnpostedShipments;
}

async function readCollection<T extends DocumentData>(name: string, profile: UserProfile): Promise<T[]> {
  const { db } = requireFirebase();
  const base = collection(db, name);
  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc"), limit(PAGE_LIMIT)];

  if (profile.role === "admin") {
    const snapshot = await withFirestoreContext(name, getDocs(query(base, ...constraints)));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as unknown as T);
  }

  const ids = clientIdsFor(profile);
  if (ids.length === 0) return [];
  const clientShareConstraint: QueryConstraint[] = profile.role === "client" && name === "returns"
    ? [where("sharedWithClient", "==", true)]
    : [];
  const snapshots = await Promise.all(chunks(ids, 30).map((group) =>
    withFirestoreContext(name, getDocs(query(base, where("clientId", "in", group), ...clientShareConstraint, ...constraints))),
  ));
  return snapshots
    .flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as unknown as T))
    .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt))
    .slice(0, PAGE_LIMIT);
}

function toMillis(value: unknown): number {
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value) || 0;
  return 0;
}

async function readClients(profile: UserProfile): Promise<Client[]> {
  const { db } = requireFirebase();
  if (profile.role === "admin") {
    const snapshot = await withFirestoreContext("clients", getDocs(query(collection(db, "clients"), orderBy("name"), limit(PAGE_LIMIT))));
    return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Client);
  }
  const ids = clientIdsFor(profile);
  const snapshots = await Promise.all(ids.map((id) => withFirestoreContext("clients", getDoc(doc(db, "clients", id)))));
  return snapshots.filter((item) => item.exists()).map((item) => ({ id: item.id, ...item.data() }) as Client);
}

function normalizeProductPart(value: string) {
  return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function readLocalProductPriceDefaults(): ProductPriceDefault[] {
  if (typeof window === "undefined") return [];
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(PRODUCT_PRICE_CACHE_KEY) || "[]");
    if (!Array.isArray(stored)) return [];
    return stored.filter((entry): entry is ProductPriceDefault =>
      typeof entry?.id === "string" && typeof entry?.productName === "string" &&
      typeof entry?.unitCost === "number" && Number.isFinite(entry.unitCost) && entry.unitCost > 0,
    );
  } catch {
    return [];
  }
}

function writeLocalProductPriceDefault(value: ProductPriceDefault) {
  if (typeof window === "undefined") return false;
  try {
    const next = [value, ...readLocalProductPriceDefaults().filter((entry) => entry.id !== value.id)];
    window.localStorage.setItem(PRODUCT_PRICE_CACHE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

export function productPriceDefaultKey(sku: string, productName: string) {
  const identity = sku.trim() ? `sku:${normalizeProductPart(sku)}` : `name:${normalizeProductPart(productName)}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const slug = identity.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "product";
  return `${(hash >>> 0).toString(16)}-${slug}`;
}

export function findProductPriceDefault(defaults: ProductPriceDefault[], sku: string, productName: string) {
  const skuKey = sku.trim() ? productPriceDefaultKey(sku, productName) : "";
  const exactSku = skuKey ? defaults.find((entry) => entry.id === skuKey) : undefined;
  if (exactSku) return exactSku;

  const normalizedName = normalizeProductPart(productName);
  if (!normalizedName) return undefined;
  return defaults
    .filter((entry) => normalizeProductPart(entry.productName) === normalizedName)
    .sort((left, right) => toMillis(right.updatedAt) - toMillis(left.updatedAt))[0];
}

export function isSamePricedProduct(left: { sku: string; productName: string }, right: { sku: string; productName: string }) {
  const leftSku = normalizeProductPart(left.sku);
  const rightSku = normalizeProductPart(right.sku);
  if (leftSku && rightSku && leftSku === rightSku) return true;
  const leftName = normalizeProductPart(left.productName);
  return Boolean(leftName && leftName === normalizeProductPart(right.productName));
}

async function readProductPriceDefaults(profile: UserProfile): Promise<ProductPriceDefault[]> {
  if (profile.role === "client") return [];
  const { db } = requireFirebase();
  const local = readLocalProductPriceDefaults();
  try {
    const snapshot = await getDocs(query(collection(db, "productPriceDefaults"), orderBy("productName"), limit(1000)));
    const merged = new Map(local.map((entry) => [entry.id, entry]));
    snapshot.docs.forEach((item) => {
      const remote = { id: item.id, ...item.data() } as ProductPriceDefault;
      const localValue = merged.get(item.id);
      if (!localValue || toMillis(remote.updatedAt) >= toMillis(localValue.updatedAt)) merged.set(item.id, remote);
    });
    return [...merged.values()];
  } catch (error) {
    if (isPermissionDenied(error)) return local;
    throw error;
  }
}

export async function loadWorkspace(profile: UserProfile): Promise<WorkspaceData> {
  if (supabase) {
    try {
      if (profile.role === "admin") {
        await syncLegacyWorkspaceToSupabase(profile);
      }
      return await loadWorkspaceSupabase(profile);
    } catch (error) {
      console.warn("Supabase workspace load failed; falling back to Firestore.", error);
    }
  }

  const [clients, balances, shipments, returns, ledgerEntries, productPriceDefaults] = await Promise.all([
    withFirestoreContext("clients", readClients(profile)),
    withFirestoreContext("clientBalances", readCollection<ClientBalance>("clientBalances", profile)),
    withFirestoreContext("shipments", readCollection<Shipment>("shipments", profile)),
    withFirestoreContext("returns", readCollection<ReturnRecord>("returns", profile)),
    withFirestoreContext("ledgerEntries", readCollection<LedgerEntry>("ledgerEntries", profile)),
    withFirestoreContext("productPriceDefaults", readProductPriceDefaults(profile)),
  ]);
  return { clients, balances, shipments, returns, ledgerEntries, productPriceDefaults };
}

export async function loadClientHistory(clientId: string): Promise<{ shipments: Shipment[]; ledgerEntries: LedgerEntry[] }> {
  if (supabase) {
    try {
      return await loadClientHistorySupabase(clientId);
    } catch (error) {
      console.warn("Supabase client history load failed; falling back to Firestore.", error);
    }
  }
  if (!clientId) throw new Error("Choose a client to load its history.");
  const { db } = requireFirebase();

  async function readAll<T extends DocumentData>(name: "shipments" | "ledgerEntries"): Promise<T[]> {
    const base = collection(db, name);
    const records: T[] = [];
    let cursor: QueryDocumentSnapshot<DocumentData> | undefined;

    while (true) {
      const constraints: QueryConstraint[] = [where("clientId", "==", clientId)];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(PAGE_LIMIT));
      const snapshot = await withFirestoreContext(name, getDocs(query(base, ...constraints)));
      records.push(...snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as unknown as T));
      if (snapshot.size < PAGE_LIMIT) break;
      cursor = snapshot.docs[snapshot.docs.length - 1];
    }

    return records;
  }

  const [shipments, ledgerEntries] = await Promise.all([
    readAll<Shipment>("shipments"),
    readAll<LedgerEntry>("ledgerEntries"),
  ]);
  return { shipments, ledgerEntries };
}

export async function saveProductPriceDefault(profile: UserProfile, input: { sku: string; productName: string; unitCost: number }): Promise<"synced" | "local" | "memory"> {
  if (profile.role !== "admin" && profile.role !== "staff") throw new Error("Only workspace staff can save product cost defaults.");
  if (!Number.isFinite(input.unitCost) || input.unitCost <= 0) throw new Error("Enter a product cost greater than zero to save it as a default.");

  if (supabase) {
    try {
      const result = await saveProductPriceDefaultSupabase(profile, input);
      return result;
    } catch (error) {
      console.warn("Supabase saveProductPriceDefault failed; falling back to local/Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const id = productPriceDefaultKey(input.sku, input.productName);
  const value: ProductPriceDefault = { id, ...input, updatedAt: new Date() };
  const savedLocally = writeLocalProductPriceDefault(value);
  try {
    await setDoc(doc(db, "productPriceDefaults", id), {
    sku: input.sku.trim(),
    productName: input.productName.trim(),
    unitCost: input.unitCost,
    updatedBy: profile.uid,
    updatedAt: serverTimestamp(),
    }, { merge: true });
    return "synced";
  } catch {
    return savedLocally ? "local" : "memory";
  }
}

export async function loadDailyActivity(profile: UserProfile, dateValue: string): Promise<Pick<WorkspaceData, "shipments" | "returns" | "ledgerEntries">> {
  if (supabase) {
    try {
      return await loadDailyActivitySupabase(profile, dateValue);
    } catch (error) {
      console.warn("Supabase daily activity load failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return { shipments: [], returns: [], ledgerEntries: [] };
  const start = Timestamp.fromDate(new Date(year, month - 1, day));
  const end = Timestamp.fromDate(new Date(year, month - 1, day + 1));
  const ids = profile.role === "admin" ? [] : clientIdsFor(profile);
  if (profile.role !== "admin" && ids.length === 0) return { shipments: [], returns: [], ledgerEntries: [] };

  async function readDay<T extends DocumentData>(name: "shipments" | "returns" | "ledgerEntries") {
    const base = collection(db, name);
    const accessGroups = profile.role === "admin" ? [null] : chunks(ids, 30);
    const snapshots = await Promise.all(accessGroups.map((group) => {
      const constraints: QueryConstraint[] = [];
      if (group) constraints.push(where("clientId", "in", group));
      if (profile.role === "client" && name === "returns") constraints.push(where("sharedWithClient", "==", true));
      constraints.push(where("createdAt", ">=", start), where("createdAt", "<", end), orderBy("createdAt", "desc"), limit(PAGE_LIMIT));
      return withFirestoreContext(name, getDocs(query(base, ...constraints)));
    }));
    return snapshots.flatMap((snapshot) => snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as unknown as T))
      .sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));
  }

  const [shipments, returns, ledgerEntries] = await Promise.all([
    readDay<Shipment>("shipments"),
    readDay<ReturnRecord>("returns"),
    readDay<LedgerEntry>("ledgerEntries"),
  ]);
  return { shipments, returns, ledgerEntries };
}

export async function createClient(input: Omit<Client, "id" | "createdAt">, createdBy: string) {
  if (supabase) {
    try {
      return await createClientSupabase(input, createdBy);
    } catch (error) {
      console.warn("Supabase createClient failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const clientRef = doc(collection(db, "clients"));
  const balanceRef = doc(db, "clientBalances", clientRef.id);
  await runTransaction(db, async (transaction) => {
    transaction.set(clientRef, { ...input, createdBy, createdAt: serverTimestamp() });
    transaction.set(balanceRef, { clientId: clientRef.id, payable: 0, receivable: 0, cash: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  });
  return clientRef;
}

export async function updateClientDetails(
  id: string,
  patch: Pick<Client, "name" | "businessName" | "panelName" | "contactName" | "phone" | "email" | "serviceFeePercent" | "active">,
) {
  if (supabase) {
    try {
      await updateClientDetailsSupabase(id, patch);
      return;
    } catch (error) {
      console.warn("Supabase updateClientDetails failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const clientRef = doc(db, "clients", id);
  await runTransaction(db, async (transaction) => {
    const clientSnapshot = await transaction.get(clientRef);
    if (!clientSnapshot.exists()) throw new Error("This client record no longer exists.");
    const authUid = clientSnapshot.data().authUid;
    const profileRef = typeof authUid === "string" ? doc(db, "users", authUid) : null;
    const profileSnapshot = profileRef ? await transaction.get(profileRef) : null;
    transaction.update(clientRef, patch);
    if (profileRef && profileSnapshot?.exists()) {
      transaction.update(profileRef, { name: patch.contactName || patch.businessName || patch.name, active: patch.active });
    }
  });
}

export function normalizeAwb(value: string) {
  return (value ?? "").toUpperCase().replace(/[\s-]/g, "").trim();
}

async function awbDocumentId(awb: string) {
  const bytes = new TextEncoder().encode(normalizeAwb(awb));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function uploadLabel(clientId: string, shipmentId: string, file: File): Promise<EvidenceFile> {
  return uploadToImageKit(clientId, shipmentId, file, "labels");
}

export const IMAGEKIT_UPLOAD_ENABLED = import.meta.env.VITE_IMAGEKIT_UPLOAD_ENABLED === "true";

export function newShipmentId() {
  if (supabase) return crypto.randomUUID();
  const { db } = requireFirebase();
  return doc(collection(db, "shipments")).id;
}

export async function createShipment(
  profile: UserProfile,
  shipment: Omit<Shipment, "id" | "createdAt" | "updatedAt" | "createdBy" | "labelUrl" | "labelPath">,
  labelFile: File,
  shipmentId?: string,
) {
  if (supabase) {
    try {
      return await createShipmentSupabase(profile, shipment, labelFile, shipmentId);
    } catch (error) {
      console.warn("Supabase createShipment failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const key = await awbDocumentId(shipment.awb);
  const indexRef = doc(db, "awbIndex", key);
  const shipmentRef = shipmentId ? doc(db, "shipments", shipmentId) : doc(collection(db, "shipments"));
  const balanceRef = doc(db, "clientBalances", shipment.clientId);
  const ledgerRef = doc(collection(db, "ledgerEntries"));
  const amountDue = shipmentAmount(shipment.items);
  const existing = await getDoc(indexRef);
  if (existing.exists()) {
    const details = existing.data();
    throw new Error(`This AWB already exists under ${details.clientName ?? "another order"} (${details.orderNumber ?? "order details unavailable"}).`);
  }

  const uploadedLabel = IMAGEKIT_UPLOAD_ENABLED
    ? await uploadLabel(shipment.clientId, shipmentRef.id, labelFile)
    : undefined;
  try {
    await runTransaction(db, async (transaction) => {
      const currentIndex = await transaction.get(indexRef);
      const balanceSnapshot = await transaction.get(balanceRef);
      if (currentIndex.exists()) {
        const details = currentIndex.data();
        throw new Error(`This AWB already exists under ${details.clientName ?? "another order"} (${details.orderNumber ?? "order details unavailable"}).`);
      }
      transaction.set(indexRef, {
        awb: shipment.awb,
        normalizedAwb: normalizeAwb(shipment.awb),
        clientId: shipment.clientId,
        clientName: shipment.clientName,
        shipmentId: shipmentRef.id,
        orderNumber: shipment.orderNumber,
        createdAt: serverTimestamp(),
      });
      transaction.set(shipmentRef, {
        ...shipment,
        awbKey: key,
        clientAmountPosted: true,
        ...(uploadedLabel ? {
          labelPath: uploadedLabel.path,
          labelUrl: uploadedLabel.url,
          labelFileId: uploadedLabel.fileId,
          labelProvider: uploadedLabel.provider,
        } : {}),
        createdBy: profile.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const currentBalance = balanceSnapshot.exists() ? balanceSnapshot.data() : { payable: 0, receivable: 0, cash: 0 };
      if (amountDue > 0) {
        transaction.set(ledgerRef, {
          clientId: shipment.clientId,
          shipmentId: shipmentRef.id,
          orderNumber: shipment.orderNumber,
          type: "shipment_charge",
          amount: amountDue,
          direction: "in",
          payableDelta: 0,
          receivableDelta: amountDue,
          cashDelta: 0,
          description: "Product amount added from label",
          reference: shipment.awb,
          createdBy: profile.uid,
          createdAt: serverTimestamp(),
        });
        transaction.set(balanceRef, {
          clientId: shipment.clientId,
          payable: Number(currentBalance.payable ?? 0),
          receivable: Number(currentBalance.receivable ?? 0) + amountDue,
          cash: Number(currentBalance.cash ?? 0),
          createdAt: currentBalance.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    });
  } catch (error) {
    if (uploadedLabel) await deleteUploadedFile(uploadedLabel, shipment.clientId).catch(() => undefined);
    throw error;
  }
  return shipmentRef.id;
}

export async function uploadReturnFile(clientId: string, returnId: string, file: File): Promise<EvidenceFile> {
  if (!IMAGEKIT_UPLOAD_ENABLED) throw new Error("Return photo and video storage is on hold until ImageKit setup is enabled.");
  if (!(file.type.startsWith("image/") || file.type.startsWith("video/"))) {
    throw new Error("Return evidence must be a photo or video.");
  }
  if (file.size > 300 * 1024 * 1024) throw new Error("Return video is too large (maximum 300 MB).");
  return uploadToImageKit(clientId, returnId, file, "returns");
}

export async function createReturnRecord(
  profile: UserProfile,
  record: Omit<ReturnRecord, "id" | "createdAt" | "createdBy">,
  id: string,
) {
  if (supabase) {
    try {
      return await createReturnRecordSupabase(profile, record, id);
    } catch (error) {
      console.warn("Supabase createReturnRecord failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  if (!record.shipmentId) throw new Error("Choose the original shipment before saving a return.");
  const returnRef = doc(db, "returns", id);
  const shipmentRef = doc(db, "shipments", record.shipmentId);
  await runTransaction(db, async (transaction) => {
    const shipmentSnapshot = await transaction.get(shipmentRef);
    if (!shipmentSnapshot.exists()) throw new Error("The original shipment no longer exists.");
    if (shipmentSnapshot.data().clientId !== record.clientId) throw new Error("This return must use a shipment from the selected client.");
    transaction.set(returnRef, { ...record, createdBy: profile.uid, createdAt: serverTimestamp() });
    transaction.update(shipmentRef, { status: "returned", updatedAt: serverTimestamp() });
  });
  return id;
}

export async function deleteUploadedFile(file: EvidenceFile, clientId: string) {
  if (file.provider === "imagekit" && file.fileId) {
    await deleteImageKitAsset(clientId, file.fileId);
    return;
  }
  const { storage } = requireFirebase();
  await deleteObject(ref(storage, file.path));
}

export function newReturnId() {
  if (supabase) return crypto.randomUUID();
  const { db } = requireFirebase();
  return doc(collection(db, "returns")).id;
}

export async function updateReturnRecord(id: string, patch: Partial<ReturnRecord>) {
  if (supabase) {
    try {
      await updateReturnRecordSupabase(id, patch);
      return;
    } catch (error) {
      console.warn("Supabase updateReturnRecord failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  await updateDoc(doc(db, "returns", id), { ...patch, updatedAt: serverTimestamp() });
}

export async function createLedgerEntry(
  profile: UserProfile,
  input: Omit<LedgerEntry, "id" | "createdAt" | "createdBy">,
) {
  if (supabase) {
    try {
      return await createLedgerEntrySupabase(profile, input);
    } catch (error) {
      console.warn("Supabase createLedgerEntry failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const entryRef = doc(collection(db, "ledgerEntries"));
  const balanceRef = doc(db, "clientBalances", input.clientId);
  await runTransaction(db, async (transaction) => {
    const balanceSnapshot = await transaction.get(balanceRef);
    const balance = balanceSnapshot.exists() ? balanceSnapshot.data() : { payable: 0, receivable: 0, cash: 0 };
    transaction.set(entryRef, { ...input, createdBy: profile.uid, createdAt: serverTimestamp() });
    transaction.set(balanceRef, {
      clientId: input.clientId,
      payable: Number(balance.payable ?? 0) + input.payableDelta,
      receivable: Number(balance.receivable ?? 0) + input.receivableDelta,
      cash: Number(balance.cash ?? 0) + input.cashDelta,
      createdAt: balance.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
  return entryRef;
}

export async function deleteLedgerEntry(id: string) {
  if (supabase) {
    try {
      await deleteLedgerEntrySupabase(id);
      return;
    } catch (error) {
      console.warn("Supabase deleteLedgerEntry failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const entryRef = doc(db, "ledgerEntries", id);
  const snapshot = await getDoc(entryRef);
  if (!snapshot.exists()) return;

  const entry = { id, ...snapshot.data() } as LedgerEntry;
  const balanceRef = doc(db, "clientBalances", entry.clientId);
  await runTransaction(db, async (transaction) => {
    const balanceSnapshot = await transaction.get(balanceRef);
    const balance = balanceSnapshot.exists() ? balanceSnapshot.data() : { payable: 0, receivable: 0, cash: 0 };
    transaction.set(balanceRef, {
      clientId: entry.clientId,
      payable: Number(balance.payable ?? 0) - Number(entry.payableDelta ?? 0),
      receivable: Number(balance.receivable ?? 0) - Number(entry.receivableDelta ?? 0),
      cash: Number(balance.cash ?? 0) - Number(entry.cashDelta ?? 0),
      createdAt: balance.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.delete(entryRef);
  });
}

export async function getProtectedFileUrl(returnId: string, file: EvidenceFile) {
  if (file.provider === "imagekit" && file.fileId) {
    return getImageKitReturnUrl(returnId, file.fileId);
  }
  const { storage } = requireFirebase();
  const blob = await getBlob(ref(storage, file.path));
  return URL.createObjectURL(blob);
}

export async function updateShipmentStatus(id: string, status: Shipment["status"]) {
  if (supabase) {
    try {
      await updateShipmentStatusSupabase(id, status);
      return;
    } catch (error) {
      console.warn("Supabase updateShipmentStatus failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  await updateDoc(doc(db, "shipments", id), { status, updatedAt: serverTimestamp() });
}

export async function updateShipmentDetails(
  id: string,
  patch: Pick<Shipment, "orderNumber" | "subOrderNumber" | "courier" | "customerName" | "customerAddress" | "customerPhone" | "items" | "invoiceTotal" | "status">,
) {
  if (supabase) {
    try {
      await updateShipmentDetailsSupabase(id, patch);
      return;
    } catch (error) {
      console.warn("Supabase updateShipmentDetails failed; falling back to Firestore.", error);
    }
  }

  const { db } = requireFirebase();
  const shipmentRef = doc(db, "shipments", id);
  const ledgerRef = doc(collection(db, "ledgerEntries"));
  await runTransaction(db, async (transaction) => {
    const shipmentSnapshot = await transaction.get(shipmentRef);
    if (!shipmentSnapshot.exists()) throw new Error("This shipment no longer exists.");
    const current = { id, ...shipmentSnapshot.data() } as Shipment;
    const amountDelta = shipmentAmount(patch.items) - shipmentAmount(current.items ?? []);
    const balanceRef = doc(db, "clientBalances", current.clientId);
    const balanceSnapshot = current.clientAmountPosted && amountDelta !== 0 ? await transaction.get(balanceRef) : null;
    transaction.update(shipmentRef, { ...patch, updatedAt: serverTimestamp() });
    if (current.clientAmountPosted && amountDelta !== 0 && balanceSnapshot) {
      const currentBalance = balanceSnapshot.exists() ? balanceSnapshot.data() : { payable: 0, receivable: 0, cash: 0 };
      transaction.set(ledgerRef, {
        clientId: current.clientId,
        shipmentId: id,
        orderNumber: patch.orderNumber,
        type: "shipment_charge",
        amount: Math.abs(amountDelta),
        direction: amountDelta > 0 ? "in" : "out",
        payableDelta: 0,
        receivableDelta: amountDelta,
        cashDelta: 0,
        description: "Shipment amount corrected",
        reference: current.awb,
        createdBy: current.createdBy,
        createdAt: serverTimestamp(),
      });
      transaction.set(balanceRef, {
        clientId: current.clientId,
        payable: Number(currentBalance.payable ?? 0),
        receivable: Number(currentBalance.receivable ?? 0) + amountDelta,
        cash: Number(currentBalance.cash ?? 0),
        createdAt: currentBalance.createdAt ?? serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}
