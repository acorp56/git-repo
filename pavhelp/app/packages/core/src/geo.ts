export type LatLng = [lat: number, lng: number];

/** Расстояние по большой окружности, км. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r;
  const dLng = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
