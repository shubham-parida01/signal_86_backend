function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

// Returns meters
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius (m)
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lat2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

module.exports = {
  haversineMeters,
};

