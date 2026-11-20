const cache = new Map();
const TTL = 10 * 60 * 1000;

export function getExposureCache(versionId) {
  const hit = cache.get(versionId);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL) {
    cache.delete(versionId);
    return null;
  }
  return hit.data;
}

export function setExposureCache(versionId, data) {
  if (!versionId) return;
  cache.set(versionId, { at: Date.now(), data });
}

export function clearExposureCache(versionId) {
  if (versionId) cache.delete(versionId);
  else cache.clear();
}
