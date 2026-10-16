// Shapes and choice lists shared by the server and the browser.

export const ROLES = ["admin", "manager", "staff"] as const;
export type Role = (typeof ROLES)[number];

/** The signed-in person as Commerce sees them. */
export type Ctx = { email: string; name: string; role: Role };

export type Member = { email: string; name: string; role: Role; lastSeen: string };

export type Location = { id: string; name: string; kind: "store" | "warehouse"; address: string; active: boolean };

export type Vendor = {
  id: string; name: string; email: string; phone: string; address: string; notes: string; leadDays: number; active: boolean;
};

export type Product = {
  id: string; sku: string; barcode: string; name: string; description: string; category: string; unit: string;
  price: string; cost: string; taxRate: string | null; trackStock: boolean; reorderPoint: number; reorderQty: number;
  vendorId: string | null; vendorName: string | null; vendorSku: string; imageUrl: string; online: boolean; active: boolean;
  /** Across every location. */
  onHand: number;
  modifiedAt: string;
};

export type StockLevel = { locationId: string; locationName: string; onHand: number };

export const MOVEMENT_KINDS = ["receive", "sale", "return", "adjust", "count", "transfer_in", "transfer_out", "cancel"] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export type Movement = {
  id: string; productId: string; sku: string; productName: string; locationName: string; qty: number; unitCost: string;
  kind: MovementKind; refType: string | null; refId: string | null; note: string; by: string; at: string;
};

export const PO_STATUSES = ["draft", "ordered", "partial", "received", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export type PoLine = {
  id: string; productId: string; sku: string; name: string; qty: number; unitCost: string; received: number;
};

export type PurchaseOrder = {
  id: string; number: string; vendorId: string; vendorName: string; locationId: string; locationName: string;
  status: PoStatus; expected: string | null; notes: string; createdBy: string; createdAt: string; orderedAt: string | null;
  total: string; lines: PoLine[];
  receipts: { seq: number; vendorRef: string; receivedBy: string; receivedAt: string; total: string }[];
};

export const ORDER_STATUSES = ["pending", "paid", "partially_refunded", "refunded", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const FULFILLMENTS = ["unfulfilled", "ready", "fulfilled"] as const;
export type Fulfillment = (typeof FULFILLMENTS)[number];
export const PAYMENT_METHODS = ["cash", "card", "online", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type OrderLine = {
  id: string; productId: string | null; sku: string; name: string; qty: number; unitPrice: string; discount: string;
  taxRate: string; tax: string; total: string; refunded: number;
};

export type Order = {
  id: string; number: string; channel: "pos" | "online"; status: OrderStatus; fulfillment: Fulfillment;
  delivery: "in_store" | "pickup" | "ship"; locationId: string; locationName: string; cashier: string | null;
  customerName: string; customerEmail: string; customerPhone: string; shipAddress: string; notes: string;
  subtotal: string; discount: string; tax: string; total: string; paid: string; refunded: string;
  createdAt: string; paidAt: string | null; fulfilledAt: string | null;
  lines: OrderLine[];
  payments: { method: PaymentMethod; amount: string; tendered: string | null; change: string | null; ref: string; at: string }[];
  refunds: { seq: number; amount: string; method: string; restock: boolean; reason: string; by: string; at: string }[];
};

export type Register = { id: string; name: string; locationId: string; locationName: string; active: boolean; shift: Shift | null };

export type Shift = {
  id: string; registerId: string; openedBy: string; openedAt: string; openingFloat: string;
  closedBy: string | null; closedAt: string | null; countedCash: string | null; expectedCash: string | null; note: string;
  /** Sales so far, by method. */
  takings?: Record<string, string>;
};

/** Books account numbers each kind of money lands in. Defaults match Books' standard chart. */
export const ACCOUNT_KEYS = ["cash", "card", "online", "other", "sales", "tax", "returns", "inventory", "cogs", "shrinkage", "payable"] as const;
export type AccountKey = (typeof ACCOUNT_KEYS)[number];

export type Settings = {
  storeName: string;
  currency: string;
  /** Percent. */
  defaultTaxRate: number;
  receiptFooter: string;
  store: {
    enabled: boolean;
    tagline: string;
    /** Where online orders are picked from. */
    locationId: string | null;
    pickup: boolean;
    shipping: boolean;
    /** Cents, flat, per order. */
    shippingFee: number;
    /** Orders can be placed now and paid at pickup or on delivery. */
    payLater: boolean;
    accent: string;
  };
  accounts: Record<AccountKey, string>;
};

export type Posting = {
  id: string; reference: string; kind: string; date: string; status: "pending" | "posted" | "failed"; error: string;
  attempts: number; booksRef: string | null; createdAt: string; postedAt: string | null; total: string; description: string;
};

export const LABELS: Record<string, string> = {
  admin: "Admin", manager: "Manager", staff: "Staff",
  store: "Store", warehouse: "Warehouse",
  receive: "Received", sale: "Sold", return: "Returned", adjust: "Adjusted", count: "Counted",
  transfer_in: "Transferred in", transfer_out: "Transferred out", cancel: "Order cancelled",
  draft: "Draft", ordered: "Ordered", partial: "Partly received", received: "Received", cancelled: "Cancelled",
  pending: "Awaiting payment", paid: "Paid", partially_refunded: "Partly refunded", refunded: "Refunded",
  unfulfilled: "To pick", ready: "Ready", fulfilled: "Fulfilled",
  in_store: "In store", pickup: "Pickup", ship: "Delivery",
  pos: "Point of sale", online: "Online store",
  cash: "Cash", card: "Card", other: "Other",
  sales: "Product sales", tax: "Sales tax payable", returns: "Returns and allowances", inventory: "Inventory",
  cogs: "Cost of goods sold", shrinkage: "Stock losses", payable: "Accounts payable",
  posted: "Posted", failed: "Failed",
  refund: "Refund", receipt: "Stock received", adjustment: "Stock adjustment",
};
