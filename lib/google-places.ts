import type { Bounds } from './geoapify';

// ── Google Places API (New) — autocomplete + place details ──────────────────
// Το κλειδί ζει ΜΟΝΟ server-side, ίδιο pattern με το GEOAPIFY_API_KEY.
// Session tokens: βλ. OrderCreationForm.tsx — ένα token ανά «αναζήτηση», ώστε
// τα ενδιάμεσα autocomplete requests να είναι δωρεάν και να πληρώνεται μόνο το
// τελικό Place Details που κλείνει το session.

const PLACES_BASE = 'https://places.googleapis.com/v1';

export function getGoogleApiKey(): string | null {
  return process.env.GOOGLE_PLACES_API_KEY || null;
}

/** Μετατρέπει το υπάρχον Geoapify `rect:lon1,lat1,lon2,lat2` σε Google rectangle. */
export function boundsToRectangle(bounds: Bounds) {
  const raw = bounds.filter.replace(/^rect:/, '');
  const [lon1, lat1, lon2, lat2] = raw.split(',').map(Number);
  return {
    low: { latitude: Math.min(lat1, lat2), longitude: Math.min(lon1, lon2) },
    high: { latitude: Math.max(lat1, lat2), longitude: Math.max(lon1, lon2) },
  };
}

export type PlacePrediction = {
  placeId: string;
  mainText: string;
  secondaryText: string;
  types: string[];
};

const ADDRESS_LEVEL_TYPES = ['street_address', 'premise', 'subpremise'];
const POI_TYPES = ['establishment', 'point_of_interest'];

export function isAddressLevel(types: string[]): boolean {
  return types.some((t) => ADDRESS_LEVEL_TYPES.includes(t));
}

export function isPoi(types: string[]): boolean {
  return types.some((t) => POI_TYPES.includes(t)) && !types.includes('route');
}

/** Καλεί places:autocomplete. Γυρνάει [] σε οποιοδήποτε πρόβλημα (fail-open). */
export async function googleAutocomplete(
  text: string,
  bounds: Bounds,
  sessionToken: string,
  apiKey: string
): Promise<PlacePrediction[]> {
  const res = await fetch(`${PLACES_BASE}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
    },
    body: JSON.stringify({
      input: text,
      sessionToken,
      languageCode: 'el',
      includedRegionCodes: ['gr'],
      locationRestriction: { rectangle: boundsToRectangle(bounds) },
    }),
  });
  if (!res.ok) {
    console.error('[google-places] autocomplete status', res.status, await res.text().catch(() => ''));
    return [];
  }
  const json = await res.json();
  type RawSuggestion = {
    placePrediction?: {
      placeId?: string;
      types?: string[];
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  };
  return ((json.suggestions || []) as RawSuggestion[])
    .map((s): PlacePrediction | null => {
      const p = s.placePrediction;
      const placeId = p?.placeId;
      const mainText = p?.structuredFormat?.mainText?.text;
      if (!placeId || !mainText) return null;
      return {
        placeId,
        mainText,
        secondaryText: p?.structuredFormat?.secondaryText?.text || '',
        types: p?.types || [],
      };
    })
    .filter((s): s is PlacePrediction => s !== null);
}

export type PlaceDetails = {
  lat: number;
  lon: number;
  exact: boolean;
  streetName: string | null;
};

/** Καλεί Place Details (Essentials πεδία) και κλείνει το session. null σε αποτυχία. */
export async function googlePlaceDetails(
  placeId: string,
  sessionToken: string,
  apiKey: string
): Promise<PlaceDetails | null> {
  const url = new URL(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set('sessionToken', sessionToken);
  url.searchParams.set('languageCode', 'el');

  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'location,addressComponents,types',
    },
  });
  if (!res.ok) {
    console.error('[google-places] details status', res.status, await res.text().catch(() => ''));
    return null;
  }
  const json = await res.json();
  const lat = json.location?.latitude;
  const lon = json.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  type Component = { types?: string[]; longText?: string };
  const route = ((json.addressComponents || []) as Component[]).find((c) =>
    (c.types || []).includes('route')
  );

  return {
    lat,
    lon,
    exact: isAddressLevel(json.types || []),
    streetName: route?.longText || null,
  };
}
