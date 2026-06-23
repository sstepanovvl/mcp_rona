#!/usr/bin/env node
/**
 * MCP server for RONA (rona.ca).
 *
 * Tools:
 *   - rona_search: product search / listings (Constructor.io index)
 *   - rona_product: full product card by SKU + online availability
 *   - rona_store_availability: online purchasability of a SKU
 *   - rona_stores: store finder near a postal code / coordinates
 *
 * RONA does not expose unit price or real-time per-store stock through its public
 * APIs, so those fields are reported as null/unknown.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { search, SORTS } from "./search.js";
import { getProduct, getStoreAvailability } from "./product.js";
import { getStores } from "./stores.js";
import { RonaError } from "./rona.js";

/** Wrap a tool body so RonaError (and anything else) becomes a clean MCP error result. */
async function toolResult(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  } catch (err) {
    const msg = err instanceof RonaError ? err.message : String(err);
    return { isError: true, content: [{ type: "text" as const, text: msg }] };
  }
}

const server = new McpServer({
  name: "mcp-rona",
  version: "0.1.0",
});

server.registerTool(
  "rona_search",
  {
    title: "Search RONA",
    description:
      "Search RONA (rona.ca) for products by keyword. Returns matching products " +
      "with SKU, name, brand, model, rating, category, URL and image, plus the total " +
      "result count, available filters (facets) and sort options. Use `page` to " +
      "paginate. Note: prices and live stock are not in the search index — use " +
      "rona_product for a full card.",
    inputSchema: {
      query: z.string().min(1).describe("Search keyword, e.g. 'cordless drill', 'paint roller'."),
      lang: z.enum(["en", "fr"]).optional().describe("Response language for facet labels. Default 'en'."),
      sort: z.enum(SORTS).optional().describe("Sort order. Default 'relevance'."),
      page: z.number().int().min(1).optional().describe("1-indexed page number. Default 1."),
      pageSize: z.number().int().min(1).max(60).optional().describe("Results per page (1-60). Default 24."),
      brand: z.string().optional().describe("Filter by brand, e.g. 'DEWALT' (from a facet value)."),
    },
  },
  (args) => toolResult(() => search(args)),
);

server.registerTool(
  "rona_product",
  {
    title: "Get RONA product by SKU",
    description:
      "Fetch the full product card for a RONA SKU (item number): name, brand, model, " +
      "description, image, rating, barcode, category path, URL, and online availability. " +
      "Note: RONA does not expose unit price or per-store stock through its public APIs, " +
      "so price is null.",
    inputSchema: {
      sku: z.string().min(1).describe("Product SKU / item number, e.g. '00277649' (from rona_search results)."),
      lang: z.enum(["en", "fr"]).optional().describe("Response language. Default 'en'."),
    },
  },
  ({ sku, lang }) => toolResult(() => getProduct(sku, { lang })),
);

server.registerTool(
  "rona_store_availability",
  {
    title: "Check RONA online availability for a SKU",
    description:
      "Check whether a RONA SKU is available to buy online (inventory status). " +
      "Note: real-time per-store stock levels and aisle/bay locations are not " +
      "available from RONA's public APIs — this reports online purchasability only. " +
      "Use rona_stores to find stores near a location.",
    inputSchema: {
      sku: z.string().min(1).describe("Product SKU / item number, e.g. '00277649'."),
      lang: z.enum(["en", "fr"]).optional().describe("Response language. Default 'en'."),
    },
  },
  ({ sku, lang }) => toolResult(() => getStoreAvailability(sku, { lang })),
);

server.registerTool(
  "rona_stores",
  {
    title: "Find RONA stores near a location",
    description:
      "Find RONA stores nearest to a Canadian postal code (geocoded) or to " +
      "latitude/longitude. Returns, per store: id, name, banner, address, city, " +
      "province, postal code, phone, coordinates, distance (km), time zone, store " +
      "URL and opening hours — sorted nearest first.",
    inputSchema: {
      postalCode: z.string().optional().describe("Canadian postal code, e.g. 'M5V 2T6' or 'H2W 1Y8'."),
      latitude: z.number().optional().describe("Latitude (alternative to postalCode; use with longitude)."),
      longitude: z.number().optional().describe("Longitude (use with latitude)."),
      lang: z.enum(["en", "fr"]).optional().describe("Language for store URLs. Default 'en'."),
      limit: z.number().int().min(1).max(50).optional().describe("Max stores to return (1-50). Default 10."),
    },
  },
  ({ postalCode, latitude, longitude, lang, limit }) =>
    toolResult(() => getStores({ postalCode, latitude, longitude, lang, limit })),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logging; stdout is reserved for the MCP protocol.
  console.error("mcp-rona server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
