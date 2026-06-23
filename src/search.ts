/** RONA product search via Constructor.io (the search backend rona.ca uses). */
import { ronaGet, qs, BASE, CNSTRC_BASE, CNSTRC_KEY, CNSTRC_CLIENT_ID } from "./rona.js";

export const SORTS = [
  "relevance",
  "price-asc",
  "price-desc",
  "rating",
  "newest",
  "best-sellers",
] as const;
export type Sort = (typeof SORTS)[number];

/** Map our friendly sort names to Constructor.io (sort_by, sort_order). */
const SORT_MAP: Record<Exclude<Sort, "relevance">, { by: string; order: string }> = {
  "price-asc": { by: "mode_price", order: "ascending" },
  "price-desc": { by: "mode_price", order: "descending" },
  rating: { by: "rating", order: "descending" },
  newest: { by: "product_create_date", order: "descending" },
  "best-sellers": { by: "sales_dollars", order: "descending" },
};

export interface SearchParams {
  query: string;
  /** "en" | "fr". Default "en". */
  lang?: string;
  sort?: Sort;
  /** 1-indexed page. Default 1. */
  page?: number;
  /** Results per page. Default 24. */
  pageSize?: number;
  /** Optional brand facet filter, e.g. "DEWALT". */
  brand?: string;
}

/** Raw Constructor.io result entry (subset we read). */
interface RawResult {
  value?: string;
  data?: {
    id?: string;
    item_number?: string;
    url?: string;
    brand?: string;
    rating?: number;
    model_id?: string;
    image_url?: string;
    description?: string;
    barcode?: string;
    hcl_product_id?: string;
    groups?: { display_name?: string; path_list?: { display_name?: string }[] }[];
  };
}

interface RawSearchResponse {
  response?: {
    results?: RawResult[];
    total_num_results?: number;
    redirect?: { data?: { url?: string } };
    facets?: {
      name?: string;
      display_name?: string;
      type?: string;
      options?: { value?: string; display_name?: string; count?: number }[];
    }[];
    sort_options?: { sort_by?: string; sort_order?: string; display_name?: string; status?: string }[];
  };
  result_id?: string;
}

interface RawAutocompleteResponse {
  sections?: { Products?: RawResult[] };
}

export interface Product {
  /** RONA SKU (item number), e.g. "00277649". Use with rona_product. */
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  rating: number | null;
  /** Plain-text product description (HTML stripped). */
  description: string | null;
  category: string | null;
  url: string;
  imageUrl: string | null;
  /** Internal catalog id used by availability lookups (hcl_product_id). */
  productId: string | null;
}

/** Strip HTML tags / collapse whitespace from RONA's description blobs. */
function stripHtml(s?: string): string | null {
  if (!s) return null;
  const text = s
    .replace(/<li>/gi, " • ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

/** Best category name from a Constructor.io result's group path. */
function categoryOf(r: RawResult): string | null {
  const g = r.data?.groups?.[0];
  if (!g) return null;
  return g.display_name || g.path_list?.[g.path_list.length - 1]?.display_name || null;
}

export function mapProduct(r: RawResult): Product {
  const d = r.data ?? {};
  return {
    sku: d.item_number ?? d.id ?? "",
    name: r.value ?? "",
    brand: d.brand || null,
    model: d.model_id || null,
    rating: typeof d.rating === "number" ? Math.round(d.rating * 100) / 100 : null,
    description: stripHtml(d.description),
    category: categoryOf(r),
    url: d.url ? BASE + d.url : "",
    imageUrl: d.image_url || null,
    productId: d.hcl_product_id || null,
  };
}

export interface SearchResult {
  query: string;
  totalProducts: number;
  page: number;
  pageSize: number;
  sort: string;
  /** Set when the keyword maps to a category page; products are then a best-effort fallback. */
  categoryRedirectUrl: string | null;
  products: Product[];
  facets: { code: string; name: string; values: { value: string; count: number }[] }[];
  availableSorts: { code: string; name: string }[];
  /** Prices and live stock are not in the search index — see rona_product. */
  note: string;
}

/**
 * Fallback for keywords that RONA maps to a category landing page (a search
 * "redirect"): the regular search returns no products, but the autocomplete
 * endpoint still surfaces matching products (no facets/sorts/total).
 */
async function autocompleteProducts(query: string, pageSize: number): Promise<Product[]> {
  const url =
    `${CNSTRC_BASE}/autocomplete/${encodeURIComponent(query)}?` +
    qs({
      key: CNSTRC_KEY,
      i: CNSTRC_CLIENT_ID,
      s: 1,
      c: "mcp-rona-1",
      num_results_Products: pageSize,
    });
  const data = await ronaGet<RawAutocompleteResponse>(url);
  return (data.sections?.Products ?? []).map(mapProduct).filter((p) => p.sku);
}

export async function search(params: SearchParams): Promise<SearchResult> {
  const { query, lang = "en", sort = "relevance", page = 1, pageSize = 24, brand } = params;

  const sortCfg = sort !== "relevance" ? SORT_MAP[sort] : undefined;

  const path =
    `${CNSTRC_BASE}/search/${encodeURIComponent(query)}?` +
    qs({
      key: CNSTRC_KEY,
      i: CNSTRC_CLIENT_ID,
      s: 1,
      c: "mcp-rona-1",
      section: "Products",
      num_results_per_page: pageSize,
      page,
      sort_by: sortCfg?.by,
      sort_order: sortCfg?.order,
      "filters[brand]": brand,
      // RONA serves a single bilingual index; lang only affects facet labels.
      us: lang,
    });

  const data = await ronaGet<RawSearchResponse>(path);
  const resp = data.response ?? {};

  const redirectUrl = resp.redirect?.data?.url ?? null;
  let products = (resp.results ?? []).map(mapProduct).filter((p) => p.sku);
  // Keyword maps to a category page → no search results; fall back to autocomplete.
  if (products.length === 0 && redirectUrl && page === 1) {
    try {
      products = await autocompleteProducts(query, pageSize);
    } catch {
      /* best-effort fallback */
    }
  }

  return {
    query,
    totalProducts: resp.total_num_results ?? products.length,
    page,
    pageSize,
    sort,
    categoryRedirectUrl: redirectUrl ? (redirectUrl.startsWith("http") ? redirectUrl : BASE + redirectUrl) : null,
    products,
    facets: (resp.facets ?? []).map((f) => ({
      code: f.name ?? "",
      name: f.display_name ?? f.name ?? "",
      values: (f.options ?? [])
        .map((o) => ({ value: o.value ?? "", count: o.count ?? 0 }))
        .filter((o) => o.value),
    })),
    availableSorts: [
      { code: "relevance", name: "Relevance" },
      { code: "price-asc", name: "Price: Low to High" },
      { code: "price-desc", name: "Price: High to Low" },
      { code: "rating", name: "Highest Rated" },
      { code: "newest", name: "Newest Arrivals" },
      { code: "best-sellers", name: "Best Sellers" },
    ],
    note: "Prices and real-time store stock are not exposed by RONA's public search index. Use rona_product for a full product card and online availability.",
  };
}
