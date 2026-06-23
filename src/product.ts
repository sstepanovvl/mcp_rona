/**
 * RONA product detail + online availability.
 *
 * Catalogue data (name, brand, model, description, images, rating, categories)
 * comes from the Constructor.io index. Online purchasability comes from RONA's
 * legacy WebSphere Commerce (WCS) REST inventory endpoint, keyed by the internal
 * catalog id (hcl_product_id) resolved from the SKU.
 *
 * NOTE: RONA does not expose unit price or real-time per-store stock through its
 * public APIs (price is guest-gated; per-store inventory + aisle/bay sit behind a
 * DataDome JS challenge). Those fields are therefore reported as null/unknown.
 */
import { ronaGet, qs, BASE, WCS_STORE, CNSTRC_BASE, CNSTRC_KEY, CNSTRC_CLIENT_ID, RonaError } from "./rona.js";
import { mapProduct, type Product } from "./search.js";

interface RawResult {
  value?: string;
  data?: Record<string, unknown>;
}
interface RawItemsResponse {
  response?: { results?: RawResult[] };
}

interface RawInventory {
  InventoryAvailability?: {
    availableQuantity?: string;
    inventoryStatus?: string;
    onlineStoreId?: string;
    productId?: string;
  }[];
}

export interface OnlineAvailability {
  /** WCS inventory status, e.g. "Available", "Unavailable", "Backorderable". */
  status: string | null;
  /** True when the SKU is purchasable online. */
  available: boolean;
}

export interface ProductCard extends Product {
  barcode: string | null;
  categories: string[];
  /** null — RONA's public API does not expose price headlessly. */
  price: null;
  currency: "CAD";
  onlineAvailability: OnlineAvailability;
  note: string;
}

export interface AvailabilityResult {
  sku: string;
  productId: string | null;
  productName: string | null;
  onlineAvailability: OnlineAvailability;
  note: string;
}

const NO_PRICE_NOTE =
  "RONA does not expose unit price or real-time per-store stock (aisle/bay, quantities) through its public APIs — price is guest-gated and store inventory sits behind a bot challenge. Only online availability is reported.";

/** Look up the raw Constructor.io record for a single SKU (item number). */
async function fetchRawItem(sku: string): Promise<RawResult | null> {
  const url =
    `${CNSTRC_BASE}/browse/items?` +
    qs({
      key: CNSTRC_KEY,
      i: CNSTRC_CLIENT_ID,
      s: 1,
      c: "mcp-rona-1",
      section: "Products",
      ids: sku,
      num_results_per_page: 1,
    });
  const data = await ronaGet<RawItemsResponse>(url);
  return data.response?.results?.[0] ?? null;
}

/** Online availability for an internal catalog id (hcl_product_id) via WCS. */
async function fetchOnlineAvailability(productId: string): Promise<OnlineAvailability> {
  try {
    const data = await ronaGet<RawInventory>(
      `${BASE}/wcs/resources/store/${WCS_STORE}/inventoryavailability/${encodeURIComponent(productId)}`,
    );
    const inv = data.InventoryAvailability?.[0];
    const status = inv?.inventoryStatus ?? null;
    return { status, available: status?.toLowerCase() === "available" };
  } catch {
    return { status: null, available: false };
  }
}

/** Full category path (e.g. ["Tools","Power Tools","Cordless Drills..."]). */
function categoriesOf(raw: RawResult): string[] {
  const g = (raw.data?.groups as { display_name?: string; path_list?: { display_name?: string }[] }[] | undefined)?.[0];
  if (!g) return [];
  const path = (g.path_list ?? []).map((p) => p.display_name).filter((n): n is string => !!n && n !== "All");
  if (g.display_name) path.push(g.display_name);
  return [...new Set(path)];
}

export async function getProduct(sku: string, _opts: { lang?: string } = {}): Promise<ProductCard> {
  const raw = await fetchRawItem(sku);
  if (!raw) throw new RonaError(`No product found for SKU ${sku}`, 404);

  const base = mapProduct(raw as never);
  const productId = base.productId;
  const online = productId
    ? await fetchOnlineAvailability(productId)
    : { status: null, available: false };

  return {
    ...base,
    barcode: (raw.data?.barcode as string) || null,
    categories: categoriesOf(raw),
    price: null,
    currency: "CAD",
    onlineAvailability: online,
    note: NO_PRICE_NOTE,
  };
}

export async function getStoreAvailability(
  sku: string,
  _opts: { lang?: string } = {},
): Promise<AvailabilityResult> {
  const raw = await fetchRawItem(sku);
  if (!raw) throw new RonaError(`No product found for SKU ${sku}`, 404);

  const productId = (raw.data?.hcl_product_id as string) || null;
  const online = productId
    ? await fetchOnlineAvailability(productId)
    : { status: null, available: false };

  return {
    sku,
    productId,
    productName: raw.value ?? null,
    onlineAvailability: online,
    note:
      "Per-store stock levels and aisle/bay locations are not available from RONA's public APIs (they sit behind a bot challenge). This reports online purchasability only. Use rona_stores to find stores near you.",
  };
}
