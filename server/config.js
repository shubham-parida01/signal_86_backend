const SECOND = 1000;

module.exports = {
  port: Number(process.env.PORT || 3000),

  limits: {
    minPlayers: 4,
    maxPlayers: 8,
  },

  tick: {
    radarBroadcastMs: 2000,
    gameClockMs: 1000,
  },

  distances: {
    captureRadiusMeters: 10,
    mothergateMeters: 400,
  },

  durationsMs: {
    gameTotal: 20 * 60 * SECOND,
    voteAt: 10 * 60 * SECOND,
    captureHold: 30 * SECOND,
    demogorgonRadarCycle: 60 * SECOND,
    demogorgonRadarVisible: 10 * SECOND,
    mothergateWindow: 2 * 60 * SECOND,
    mothergateImmunity: 2 * 60 * SECOND,
  },
};

