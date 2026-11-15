// Lunar surface geometry shared by the mission designer.
//
// Model: the Moon is a sphere of IAU mean radius 1737.4 km. Distances along the
// surface are great-circle arcs on that sphere. Real terrain height and the
// Moon's small flattening (about 0.0012) are ignored, so a surface distance can
// differ from a path over the terrain by up to roughly 0.1 percent.
//
// Coordinates are selenographic: latitude in degrees north (-90 to 90),
// longitude in degrees east. Longitude is accepted in any range and wrapped, so
// 180, -180 and 540 name the same meridian.

export const MOON_MEAN_RADIUS_KM = 1737.4;
const D = Math.PI / 180;

/** Wrap a longitude in degrees to the range [-180, 180). Returns NaN for non-numbers. */
export function normalizeLongitude(lon) {
  if (!Number.isFinite(lon)) return NaN;
  const x = ((lon + 180) % 360 + 360) % 360 - 180;
  return Object.is(x, -0) ? 0 : x;
}

/** True when lat is a finite latitude in [-90, 90] and lon is any finite number. */
export function isValidLatLon(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90;
}

/** Unit vector (Moon-centred, body-fixed; x toward 0°E, z toward the north pole). */
export function unitVector(lat, lon) {
  const p = lat * D, l = lon * D, c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}

/**
 * Angle in radians between two vectors (not necessarily unit length).
 * Uses atan2(|a x b|, a . b), which stays accurate for very small and nearly
 * antipodal separations, where acos and haversine both lose precision.
 */
export function centralAngleVectors(a, b) {
  const cx = a[1] * b[2] - a[2] * b[1];
  const cy = a[2] * b[0] - a[0] * b[2];
  const cz = a[0] * b[1] - a[1] * b[0];
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
}

/** Great-circle angle in radians between two surface points. NaN for invalid input. */
export function centralAngle(lat1, lon1, lat2, lon2) {
  if (!isValidLatLon(lat1, lon1) || !isValidLatLon(lat2, lon2)) return NaN;
  return centralAngleVectors(unitVector(lat1, lon1), unitVector(lat2, lon2));
}

/** Great-circle distance in km on the lunar mean sphere. NaN for invalid input. */
export function surfaceDistanceKm(lat1, lon1, lat2, lon2) {
  return centralAngle(lat1, lon1, lat2, lon2) * MOON_MEAN_RADIUS_KM;
}

/** Distance in km from a unit (or any non-zero) vector to a surface point. */
export function surfaceDistanceToVectorKm(v, lat, lon) {
  return centralAngleVectors(v, unitVector(lat, lon)) * MOON_MEAN_RADIUS_KM;
}
