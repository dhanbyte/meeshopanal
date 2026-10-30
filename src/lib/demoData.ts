import type { WorkspaceData } from "./types";

const now = new Date();
const earlier = new Date(now.getTime() - 2 * 60 * 60 * 1000);

export const demoWorkspaceData: WorkspaceData = {
  clients: [
    { id: "demo-client-a", name: "Aarav Home Store", panelName: "Panel A · Demo", contactName: "Demo contact", serviceFeePercent: 5, openingBalance: 0, active: true, createdAt: earlier },
    { id: "demo-client-b", name: "Nisha Daily Needs", panelName: "Panel B · Demo", contactName: "Demo contact", serviceFeePercent: 3, openingBalance: 0, active: true, createdAt: earlier },
    { id: "demo-client-label", name: "Label Test Client", panelName: "Sample Panel · Demo", contactName: "Fictional sample", serviceFeePercent: 0, openingBalance: 0, active: true, createdAt: earlier },
  ],
  balances: [
    { id: "demo-client-a", clientId: "demo-client-a", payable: 4700, receivable: 850, cash: 4700, updatedAt: now },
    { id: "demo-client-b", clientId: "demo-client-b", payable: 2900, receivable: 350, cash: 2900, updatedAt: now },
    { id: "demo-client-label", clientId: "demo-client-label", payable: 0, receivable: 0, cash: 0, updatedAt: now },
  ],
  shipments: [
    {
      id: "demo-shipment-1", clientId: "demo-client-a", clientName: "Aarav Home Store", orderNumber: "DEMO-ORD-1001", subOrderNumber: "DEMO-SUB-1001", awb: "DEMO-AWB-001", courier: "Demo courier", customerName: "Riya Sharma", customerAddress: "Jaipur, Rajasthan", items: [{ productName: "Portable blender", sku: "DEMO-BLEND-01", quantity: 1, unitCost: 170 }], invoiceTotal: 515.76, status: "delivered", createdBy: "demo-user", createdAt: now, updatedAt: now,
    },
    {
      id: "demo-shipment-2", clientId: "demo-client-a", clientName: "Aarav Home Store", orderNumber: "DEMO-ORD-1002", awb: "DEMO-AWB-002", courier: "Demo courier", customerName: "Kabir Patel", customerAddress: "Surat, Gujarat", items: [{ productName: "Kitchen storage set", sku: "DEMO-STORE-02", quantity: 1, unitCost: 240 }], invoiceTotal: 699, status: "rto", createdBy: "demo-user", createdAt: now, updatedAt: now,
    },
    {
      id: "demo-shipment-3", clientId: "demo-client-b", clientName: "Nisha Daily Needs", orderNumber: "DEMO-ORD-2001", awb: "DEMO-AWB-003", courier: "Demo courier", customerName: "Anaya Verma", customerAddress: "Indore, Madhya Pradesh", items: [{ productName: "Cotton bedsheet", sku: "DEMO-BED-03", quantity: 1, unitCost: 310 }], invoiceTotal: 899, status: "dispatched", createdBy: "demo-user", createdAt: now, updatedAt: now,
    },
  ],
  returns: [
    {
      id: "demo-return-1", clientId: "demo-client-a", shipmentId: "demo-shipment-2", orderNumber: "DEMO-ORD-1002", awb: "DEMO-AWB-002", returnAwb: "DEMO-RET-002", productName: "Kitchen storage set", quantity: 1, reason: "Demo return for inspection", condition: "quarantine", notes: "Fictional preview record.", evidence: [], sharedWithClient: false, claimStatus: "raised", claimAmount: 120, createdBy: "demo-user", createdAt: now,
    },
  ],
  ledgerEntries: [
    { id: "demo-ledger-1", clientId: "demo-client-a", orderNumber: "DEMO-ORD-1001", type: "settlement", amount: 8200, direction: "in", payableDelta: 8200, receivableDelta: 0, cashDelta: 8200, description: "Demo Meesho settlement", reference: "DEMO-SET-001", createdBy: "demo-user", createdAt: now },
    { id: "demo-ledger-2", clientId: "demo-client-a", type: "client_payment", amount: 3500, direction: "out", payableDelta: -3500, receivableDelta: 0, cashDelta: -3500, description: "Demo client payout", reference: "DEMO-PAY-001", createdBy: "demo-user", createdAt: now },
    { id: "demo-ledger-3", clientId: "demo-client-b", orderNumber: "DEMO-ORD-2001", type: "settlement", amount: 5400, direction: "in", payableDelta: 5400, receivableDelta: 0, cashDelta: 5400, description: "Demo Meesho settlement", reference: "DEMO-SET-002", createdBy: "demo-user", createdAt: now },
    { id: "demo-ledger-4", clientId: "demo-client-b", type: "client_payment", amount: 2500, direction: "out", payableDelta: -2500, receivableDelta: 0, cashDelta: -2500, description: "Demo client payout", reference: "DEMO-PAY-002", createdBy: "demo-user", createdAt: now },
  ],
  productPriceDefaults: [
    { id: "demo-blender", sku: "DEMO-BLEND-01", productName: "Portable blender", unitCost: 170, updatedAt: now },
    { id: "demo-storage", sku: "DEMO-STORE-02", productName: "Kitchen storage set", unitCost: 240, updatedAt: now },
    { id: "demo-bedsheet", sku: "DEMO-BED-03", productName: "Cotton bedsheet", unitCost: 310, updatedAt: now },
  ],
};
