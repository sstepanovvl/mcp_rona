/**
 * RONA store finder.
 *
 * The store locator (www.rona.ca/v2/api) geosorts by latitude/longitude only, so
 * a Canadian postal code is first geocoded via zippopotam.us (free, no key, not
 * behind Cloudflare — reached with plain fetch). The locator returns each store's
 * straight-line distance; we also keep a haversine fallback.
 */
import { ronaGet, qs, BASE, RonaError } from "./rona.js";

interface RawAddress {
  address?: string;
  city?: string;
  state?: string;
  stateName?: string;
  zip?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
}
interface RawStoreDetails {
  storeIdentifier?: string;
  storeName?: string;
  address?: RawAddress;
  bisName?: string;
  timeZoneId?: string;
  banner?: { displayedBanner?: string };
  openHours?: { type?: string; dayOfWeek?: string; open?: string; close?: string }[];
}
interface RawLocatorEntry {
  details?: RawStoreDetails;
  distance?: number;
}

export interface StoreHours {
  day: string;
  open: string;
  close: string;
}

export interface StoreInfo {
  storeId: string;
  name: string | null;
  banner: string | null;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** Straight-line distance from the searched location, km. */
  distanceKm: number | null;
  timeZone: string | null;
  url: string | null;
  hours: StoreHours[];
}

export interface StoresResult {
  /** Normalized postal code searched (null when a lat/lng was given). */
  postalCode: string | null;
  origin: { latitude: number; longitude: number };
  count: number;
  stores: StoreInfo[];
}

/** Normalize a Canadian postal code: uppercase, no spaces. */
function normalizePostal(pc: string): string {
  return pc.replace(/\s+/g, "").toUpperCase();
}

/** Geocode a Canadian postal code (FSA) to lat/lng via zippopotam.us. */
async function geocodePostal(pc: string): Promise<{ latitude: number; longitude: number }> {
  const fsa = normalizePostal(pc).slice(0, 3);
  let res: Response;
  try {
    res = await fetch(`https://api.zippopotam.us/ca/${encodeURIComponent(fsa)}`, {
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new RonaError(`Failed to geocode postal code ${pc}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    throw new RonaError(`Could not resolve postal code ${pc} (geocoder HTTP ${res.status}).`, res.status);
  }
  const data = (await res.json()) as { places?: { latitude?: string; longitude?: string }[] };
  const place = data.places?.[0];
  const lat = place ? Number(place.latitude) : NaN;
  const lng = place ? Number(place.longitude) : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new RonaError(`Could not resolve coordinates for postal code ${pc}.`);
  }
  return { latitude: lat, longitude: lng };
}

/** Haversine distance in km. */
function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude?: number; longitude?: number },
): number | null {
  if (b.latitude == null || b.longitude == null) return null;
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return Math.round(2 * R * Math.asin(Math.sqrt(h)) * 10) / 10;
}

function mapStore(
  e: RawLocatorEntry,
  origin: { latitude: number; longitude: number },
  lang: string,
): StoreInfo {
  const d = e.details ?? {};
  const a = d.address ?? {};
  const distance = typeof e.distance === "number" ? Math.round(e.distance * 10) / 10 : haversineKm(origin, a);
  return {
    storeId: d.storeIdentifier ?? "",
    name: d.storeName ?? null,
    banner: d.banner?.displayedBanner ?? null,
    address: a.address ?? null,
    city: a.city ?? null,
    province: a.state ?? null,
    postalCode: a.zip ?? null,
    phone: a.phone?.trim() || null,
    latitude: a.latitude ?? null,
    longitude: a.longitude ?? null,
    distanceKm: distance,
    timeZone: d.timeZoneId ?? null,
    url: d.bisName ? `${BASE}/${lang}/store/${d.bisName}` : null,
    hours: (d.openHours ?? [])
      .filter((h) => h.type === "regular" && h.dayOfWeek && h.open)
      .map((h) => ({ day: h.dayOfWeek!, open: h.open!, close: h.close ?? "" })),
  };
}

export interface StoresOpts {
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  lang?: string;
  limit?: number;
}

export async function getStores(opts: StoresOpts = {}): Promise<StoresResult> {
  const { postalCode, lang = "en" } = opts;
  const limit = opts.limit ?? 10;

  let origin: { latitude: number; longitude: number };
  if (opts.latitude != null && opts.longitude != null) {
    origin = { latitude: opts.latitude, longitude: opts.longitude };
  } else if (postalCode) {
    origin = await geocodePostal(postalCode);
  } else {
    throw new RonaError("Provide a postalCode or latitude+longitude to find stores.");
  }

  const data = await ronaGet<RawLocatorEntry[]>(
    "/v2/api/services/store/locator/by-geo-coordinate?" +
      qs({
        latitude: origin.latitude,
        longitude: origin.longitude,
        minStoreCount: 1,
        maxStoreCount: Math.max(1, limit),
      }),
  );

  const stores = (Array.isArray(data) ? data : [])
    .map((e) => mapStore(e, origin, lang))
    .filter((s) => s.storeId)
    .sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity))
    .slice(0, limit);

  return {
    postalCode: postalCode ? normalizePostal(postalCode) : null,
    origin,
    count: stores.length,
    stores,
  };
}
