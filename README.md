# mcp-rona

[![License: PolyForm Noncommercial 1.0.0](https://img.shields.io/badge/license-PolyForm--Noncommercial--1.0.0-blue.svg)](./LICENSE.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-stdio-purple.svg)](https://modelcontextprotocol.io)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **RONA**
(rona.ca). It exposes RONA's catalogue — product search, product detail, online
availability and a store finder — to MCP clients such as Claude and Cursor.

> **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by
> RONA inc. It reads publicly available endpoints of rona.ca for personal,
> noncommercial use. Respect RONA's terms of service and use responsibly.

## Tools

| Tool | Description |
|------|-------------|
| `rona_search` | Product search / listings by keyword. Returns products (SKU, name, brand, model, rating, category, URL, image), total count, facets and sort options. Keywords that map to a category page fall back to a best-effort product list. |
| `rona_product` | Full product card by SKU: name, brand, model, description, image, rating, barcode, category path, URL and online availability. |
| `rona_store_availability` | Online purchasability (inventory status) of a SKU. |
| `rona_stores` | Find stores nearest a Canadian postal code (geocoded) or to latitude/longitude — id, name, banner, address, phone, coordinates, distance (km), time zone, URL and opening hours. |

### `rona_search`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `query` | string | — | Search keyword (required). |
| `lang` | `en` \| `fr` | `en` | Language for facet labels. |
| `sort` | `relevance` \| `price-asc` \| `price-desc` \| `rating` \| `newest` \| `best-sellers` | `relevance` | Sort order. |
| `page` | int ≥ 1 | `1` | 1-indexed page. |
| `pageSize` | int (1–60) | `24` | Results per page. |
| `brand` | string | — | Filter by a brand facet value, e.g. `DEWALT`. |

### `rona_product`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `sku` | string | — | Product SKU / item number (required), e.g. `00277649`. |
| `lang` | `en` \| `fr` | `en` | Response language. |

### `rona_store_availability`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `sku` | string | — | Product SKU / item number (required). |
| `lang` | `en` \| `fr` | `en` | Response language. |

### `rona_stores`

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `postalCode` | string | — | Canadian postal code, e.g. `M5V 2T6`. Geocoded to coordinates. |
| `latitude` / `longitude` | number | — | Alternative to `postalCode`. |
| `lang` | `en` \| `fr` | `en` | Language for store URLs. |
| `limit` | int (1–50) | `10` | Max stores to return. |

> The store locator geosorts by coordinates only, so a postal code is first
> geocoded via [`api.zippopotam.us`](https://api.zippopotam.us) (free, no key).
> Distance is reported by RONA's API, with a local haversine fallback.

## A note on prices and store stock

RONA **does not expose unit prices or real-time per-store stock** (quantities,
aisle/bay) through its public APIs:

- Prices are guest-gated (the price endpoint returns no value without a session).
- Real-time per-store inventory sits behind a [DataDome](https://datadome.co)
  JavaScript challenge that a headless client cannot solve.

So `price` is reported as `null`, and availability is limited to **online
purchasability** (`Available` / `Unavailable`). Search, product detail and the
store finder are fully functional.

## How it talks to RONA

`rona.ca` is behind **Cloudflare**, which gates requests on both the HTTP version
and the client's TLS (JA3) fingerprint. Node's native HTTP stack (`fetch`/undici)
gets `403`; only **`curl --http2`** is allowlisted, so every request shells out to
`curl`. No cookies are required for the public endpoints used here.

| Surface | Host | Used for |
|---------|------|----------|
| Constructor.io | `tvbajuset-zone.cnstrc.com` | search, product lookup |
| App API (BFF) | `www.rona.ca/v2/api` | store finder |
| WebSphere Commerce REST | `www.rona.ca/wcs` | online availability |

**Requirement:** `curl` with HTTP/2 support must be on `PATH` (standard on macOS
and most Linux distros).

## Build & run

```bash
npm install
npm run build
npm start          # runs the MCP server on stdio
```

Quick smoke test of the search layer:

```bash
node --input-type=module -e 'import {search} from "./dist/search.js"; console.log(await search({query:"drill", pageSize:3}))'
```

Inspect with the MCP Inspector:

```bash
npm run inspect
```

## Connecting a client

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`),
pointing at the built entrypoint:

```json
{
  "mcpServers": {
    "rona": {
      "command": "node",
      "args": ["/absolute/path/to/mcp_rona/dist/index.js"]
    }
  }
}
```

## Project layout

```
src/
  index.ts    MCP server + tool registration (stdio)
  rona.ts     curl --http2 transport for rona.ca + Constructor.io
  search.ts   rona_search (Constructor.io search + category-redirect fallback)
  product.ts  rona_product + rona_store_availability (catalogue + WCS availability)
  stores.ts   rona_stores (postal-code geocode → store locator)
```

## License

[PolyForm Noncommercial License 1.0.0](./LICENSE.md) — free to use, modify and share
for **noncommercial** purposes. Commercial use requires a separate license from the author.
