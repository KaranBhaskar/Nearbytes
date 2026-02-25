function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const earthKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthKm * c;
}

function encodeCursor(offset) {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}

function decodeCursor(cursor) {
  if (!cursor) return 0;

  try {
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch (_err) {
    return 0;
  }
}

function combineRatings(googleAvg, googleCount, appAvg, appCount) {
  const gCount = Number(googleCount) || 0;
  const aCount = Number(appCount) || 0;
  const gAvg = Number(googleAvg) || 0;
  const aAvg = Number(appAvg) || 0;

  if (gCount > 0 && aCount > 0) {
    const combinedCount = gCount + aCount;
    const combinedAvg = (gAvg * gCount + aAvg * aCount) / combinedCount;
    return { combinedAvg, combinedCount };
  }

  if (gCount > 0) {
    return { combinedAvg: gAvg, combinedCount: gCount };
  }

  if (aCount > 0) {
    return { combinedAvg: aAvg, combinedCount: aCount };
  }

  return { combinedAvg: null, combinedCount: 0 };
}

module.exports = {
  haversineKm,
  encodeCursor,
  decodeCursor,
  combineRatings,
};
