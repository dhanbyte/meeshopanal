import type { Timestamp } from "firebase/firestore";

export type UserRole = "admin" | "staff" | "client";

export interface UserProfile {
  uid: string;
  name?: string;
  role: UserRole;
  active: boolean;
  clientId?: string;
  clientIds?: string[];
}

export interface Client {
  id: string;
  name: string;
  businessName?: string;
  panelName: string;
  contactName?: string;
  phone?: string;
  email?: string;
  loginEmail?: string;
  authUid?: string;
  serviceFeePercent: number;
  openingBalance: number;
  active: boolean;
  createdAt?: Timestamp | Date | null;
}

export interface ClientBalance {
  id: string;
  clientId: string;
  payable: number;
  receivable: number;
  cash: number;
  updatedAt?: Timestamp | Date | null;
}

export interface ProductPriceDefault {
  id: string;
  sku: string;
  productName: string;
  unitCost: number;
  updatedAt?: Timestamp | Date | null;
}

export type ShipmentStatus =
  | "ready"
  | "dispatched"
  | "delivered"
  | "rto"
  | "return_initiated"
  | "returned"
  | "reconciled";

export interface ShipmentItem {
  productName: string;
  sku: string;
  quantity: number;
  variant?: string;
  unitCost: number;
}

export interface Shipment {
  id: string;
  clientId: string;
  clientName?: string;
  orderNumber: string;
  subOrderNumber?: string;
  awb: string;
  courier?: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string;
  items: ShipmentItem[];
  invoiceTotal: number;
  actualSettlement?: number;
  status: ShipmentStatus;
  clientAmountPosted?: boolean;
  labelUrl?: string;
  labelPath?: string;
  labelFileId?: string;
  labelProvider?: "firebase" | "imagekit";
  createdBy: string;
  createdAt?: Timestamp | Date | null;
  updatedAt?: Timestamp | Date | null;
}

export type ReturnCondition = "sellable" | "damaged" | "wrong_item" | "missing_parts" | "quarantine" | "disposed";

export interface EvidenceFile {
  name: string;
  url?: string;
  path: string;
  provider?: "firebase" | "imagekit";
  fileId?: string;
  contentType: string;
  size: number;
}

export interface ReturnRecord {
  id: string;
  clientId: string;
  shipmentId?: string;
  orderNumber: string;
  awb: string;
  returnAwb?: string;
  productName: string;
  quantity: number;
  reason: string;
  condition: ReturnCondition;
  notes: string;
  evidence: EvidenceFile[];
  sharedWithClient: boolean;
  claimStatus: "not_raised" | "raised" | "approved" | "rejected";
  claimAmount: number;
  createdBy: string;
  createdAt?: Timestamp | Date | null;
}

export type LedgerType = "settlement" | "product_cost" | "shipping" | "return_charge" | "claim_recovery" | "service_fee" | "client_payment" | "client_receipt" | "shipment_charge" | "adjustment";

export interface LedgerEntry {
  id: string;
  clientId: string;
  shipmentId?: string;
  orderNumber?: string;
  type: LedgerType;
  amount: number;
  direction: "in" | "out";
  payableDelta: number;
  receivableDelta: number;
  cashDelta: number;
  description: string;
  reference?: string;
  createdBy: string;
  createdAt?: Timestamp | Date | null;
}

export interface WorkspaceData {
  clients: Client[];
  balances: ClientBalance[];
  shipments: Shipment[];
  returns: ReturnRecord[];
  ledgerEntries: LedgerEntry[];
  productPriceDefaults: ProductPriceDefault[];
}

export interface LabelDraft {
  orderNumber: string;
  subOrderNumber: string;
  awb: string;
  courier: string;
  customerName: string;
  customerAddress: string;
  customerPhone: string;
  productName: string;
  sku: string;
  quantity: string;
  invoiceTotal: string;
  rawText: string;
}
