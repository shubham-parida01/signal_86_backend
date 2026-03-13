const AI_ENDPOINT = process.env.AI_ENDPOINT;

function buildMovementPayload(roomState) {
  const players = roomState.players
    .filter(
      (p) =>
        p.last &&
        typeof p.last.lat === "number" &&
        typeof p.last.lng === "number"
    )
    .map((p) => ({
      playerId: p.playerId,
      latitude: p.last.lat,
      longitude: p.last.lng,
      speed: typeof p.last.speed === "number" ? p.last.speed : null,
      timestamp:
        typeof p.last.timestamp === "number"
          ? p.last.timestamp
          : Math.floor(p.last.receivedAtMs / 1000),
    }));

  if (players.length === 0) return null;

  return {
    roomCode: roomState.roomCode,
    players,
  };
}

async function sendMovementLogs(roomState) {
  if (!AI_ENDPOINT) return null;

  const body = buildMovementPayload(roomState);
  if (!body) return null;

  const res = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`AI_ENDPOINT HTTP ${res.status}`);
  }

  return res.json();
}

module.exports = {
  sendMovementLogs,
};

