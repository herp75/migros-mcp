import { api } from "../auth/api.js";
import { credsFromEnv } from "./_shared.js";

/**
 * The address the migros.ch website reads the Cumulus card from. The old one,
 * `/retentionapi/public/web/v1/customers/cumulus/details`, answers 404 since
 * November 2026.
 */
export const CUMULUS_PROFILE_PATH = "/retentionapi/public/web/v1/cumulus-profile";

/** Shape the Cumulus profile for the LLM. `null` means the account has no Cumulus card. */
export function formatCumulusProfile(data: Record<string, unknown> | null): string {
  if (!data) {
    return JSON.stringify({ hasCumulus: false, message: "No Cumulus card is linked to this Migros account." }, null, 2);
  }
  const owner = data.cumulusCardOwner as Record<string, unknown> | undefined;
  const cardholder = owner ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() : "";
  const memberships = Array.isArray(data.memberships) ? (data.memberships as unknown[]) : [];
  return JSON.stringify(
    {
      hasCumulus: true,
      cumulusNumber: data.cumulusNumber,
      pointsBalance: data.periodToDatePointsBalance,
      cardholder: cardholder || undefined,
      memberships,
      isFamigrosMember: memberships.includes("FAMIGROS"),
      hint: "pointsBalance is the points collected in the current period.",
      raw: data, // keep raw for the LLM in case it wants other fields
    },
    null,
    2
  );
}

/**
 * Cumulus card: points collected this period, card number, cardholder and
 * memberships (such as Famigros). Like the website, a 404 means the account
 * has no Cumulus card.
 */
export async function getCumulusStatus(
  fetchProfile: () => Promise<unknown> = () => api("GET", CUMULUS_PROFILE_PATH, undefined, { creds: credsFromEnv() })
): Promise<string> {
  try {
    return formatCumulusProfile((await fetchProfile()) as Record<string, unknown>);
  } catch (err) {
    if (err instanceof Error && / -> 404\b/.test(err.message)) return formatCumulusProfile(null);
    throw err;
  }
}

/**
 * List in-store receipts (Kassenbons) over a date range. Default range: last
 * 30 days. The supermarketOnly flag excludes online order invoices, so this
 * tool answers "what did I buy at the physical store?".
 */
export async function getInStoreReceipts(
  args: {
    startDate?: string;
    endDate?: string;
    limit?: number;
  } = {}
): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const startDate = args.startDate ?? thirtyDaysAgo;
  const endDate = args.endDate ?? today;
  const limit = args.limit ?? 50;

  const url =
    `/retentionapi/public/web/v1/receipts?startDate=${encodeURIComponent(startDate)}` +
    `&endDate=${encodeURIComponent(endDate)}` +
    `&supermarketOnly=true&limit=${limit}`;
  const data = await api("GET", url, undefined, { creds: credsFromEnv() });

  // Response may be an array or an envelope; normalize.
  const list = Array.isArray(data) ? data : ((data as { receipts?: unknown[] }).receipts ?? []);
  return JSON.stringify(
    {
      startDate,
      endDate,
      count: list.length,
      receipts: list,
      hint:
        list.length > 0
          ? "Use get_receipt_details with a receipt id to inspect line items."
          : `No in-store receipts in ${startDate} to ${endDate}.`,
    },
    null,
    2
  );
}

/**
 * In-store receipt line items live on `account.migros.ch` behind a legacy
 * CSRF-cookie auth flow that the modern Bearer JWT doesn't access. Rather
 * than implement a parallel auth path, return the URL where the user can
 * inspect the receipt in their browser. The list endpoint
 * (get_in_store_receipts) already gives store, date, total, and points;
 * line-by-line is rarely the deciding factor for LLM workflows.
 */
export async function getReceiptDetails(args: { receiptId: string | number }): Promise<string> {
  const id = String(args.receiptId);
  return JSON.stringify(
    {
      receiptId: id,
      message:
        "Full line items aren't accessible via the public API used by this MCP. Open the URL below in your browser to view the receipt details directly.",
      url: `https://account.migros.ch/purchases/receipts`,
      hint: "The receipt list (get_in_store_receipts) returns store, date, amount, and Cumulus points which is enough for most spending-analysis queries.",
    },
    null,
    2
  );
}

interface Coupon {
  ean?: string;
  uniqueId?: string;
  name?: string;
  subtitle?: string;
  description?: string;
  status?: string;
  activationDisabled?: boolean;
  discountAmount?: number;
  discountType?: string;
  minimumPurchase?: string;
  expiryDate?: string;
  fulfilments?: unknown;
  redeemableAt?: string;
  quantity?: number;
  wholeAssortment?: boolean;
}

const RETENTION = "/retentionapi/public/web/v1";

/**
 * The fields of a coupon a person cares about. Colours, campaign ids and
 * other display data are left out; texts are Migros' own (still data, not
 * instructions).
 */
export function formatCoupon(c: Coupon) {
  return {
    ean: c.ean,
    name: c.name,
    subtitle: c.subtitle,
    description: c.description,
    status: c.status,
    canActivate: c.status === "AVAILABLE" && !c.activationDisabled,
    discountAmount: c.discountAmount,
    discountType: c.discountType,
    minimumPurchase: c.minimumPurchase,
    expiryDate: c.expiryDate,
    redeemableAt: c.redeemableAt,
    fulfilments: c.fulfilments,
    quantity: c.quantity,
    wholeAssortment: c.wholeAssortment,
  };
}

/** An authenticated request; tests pass a fake. */
export type Request = (method: "GET" | "POST", path: string, body?: unknown) => Promise<unknown>;
const migros: Request = (method, path, body) => api(method, path, body, { creds: credsFromEnv() });

async function coupons(request: Request): Promise<Coupon[]> {
  // The SPA calls cumulus-coupons with a deliveryRequestKey when in checkout
  // context (filters to coupons valid for the active delivery). For a general
  // "what coupons do I have" view, omit the key — the server returns all.
  const data = await request("GET", `${RETENTION}/cumulus-coupons`);
  return Array.isArray(data) ? (data as Coupon[]) : ((data as { coupons?: Coupon[] } | null)?.coupons ?? []);
}

/**
 * Active Cumulus coupons targeted at the user. Migros personalises these based
 * on shopping history — they typically expire after a few weeks.
 */
export async function getCumulusCoupons(request: Request = migros): Promise<string> {
  const list = (await coupons(request)).map(formatCoupon);
  return JSON.stringify(
    {
      count: list.length,
      coupons: list,
      hint:
        list.length > 0
          ? "status ACTIVE means the coupon is on the Cumulus card for the next purchase. activate_cumulus_coupon " +
            "and deactivate_cumulus_coupon take the ean."
          : "No active personal coupons.",
    },
    null,
    2
  );
}

/**
 * Put a coupon on the Cumulus card (ACTIVE), or take it off again
 * (AVAILABLE). This is what the website's coupon switch does; nothing is
 * bought or redeemed.
 */
export async function setCouponActive(
  args: { ean: string },
  active: boolean,
  request: Request = migros
): Promise<string> {
  const coupon = (await coupons(request)).find((c) => c.ean === args.ean);
  if (!coupon) throw new Error(`no coupon with ean ${args.ean}: use get_cumulus_coupons for the eans`);
  const wanted = active ? "ACTIVE" : "AVAILABLE";
  if (coupon.status !== wanted) {
    if (active && coupon.activationDisabled) throw new Error("Migros does not allow activating this coupon");
    await request(
      "POST",
      `${RETENTION}/cumulus-coupons/${encodeURIComponent(args.ean)}/${active ? "activate" : "deactivate"}`,
      {}
    );
  }
  const after = (await coupons(request)).find((c) => c.ean === args.ean);
  return JSON.stringify(
    {
      ean: args.ean,
      name: coupon.name,
      status: after?.status ?? wanted,
      changed: coupon.status !== wanted,
    },
    null,
    2
  );
}

/**
 * Cumulus bons: the vouchers Cumulus points turn into. Read only; redeeming
 * one is left to the website, as it spends the voucher.
 */
export async function getCumulusBons(request: Request = migros): Promise<string> {
  const data = await request("GET", `${RETENTION}/cumulus-bons`);
  const list = Array.isArray(data) ? data : ((data as { bons?: unknown[] } | null)?.bons ?? []);
  return JSON.stringify(
    {
      count: list.length,
      bons: list,
      hint:
        list.length > 0 ? "Bons are redeemed at checkout on migros.ch or in a store." : "No Cumulus bons right now.",
    },
    null,
    2
  );
}
