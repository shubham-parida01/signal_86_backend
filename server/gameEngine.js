const config = require("./config");
const { haversineMeters } = require("./distanceMath");
const { sendMovementLogs } = require("./aiClient");

function nowMs() {
  return Date.now();
}

function isRadarVisible(roomState, tMs) {
  if (!roomState.game || roomState.game.phase !== "running") return false;
  const elapsed = tMs - roomState.game.startedAtMs;
  if (elapsed < 0) return false;
  const inCycle = elapsed % config.durationsMs.demogorgonRadarCycle;
  return inCycle < config.durationsMs.demogorgonRadarVisible;
}

function getDemogorgon(roomState) {
  return roomState.players.find((p) => p.role === "demogorgon" && p.alive);
}

function aliveCyphers(roomState) {
  return roomState.players.filter((p) => p.role === "cypher" && p.alive);
}

function ensureRoomTimers(io, roomState) {
  if (roomState._timersStarted) return;
  roomState._timersStarted = true;

  roomState._radarInterval = setInterval(() => {
    if (!roomState.game || roomState.game.phase !== "running") return;
    broadcastRadar(io, roomState);
  }, config.tick.radarBroadcastMs);

  roomState._clockInterval = setInterval(() => {
    if (!roomState.game || (roomState.game.phase !== "running" && roomState.game.phase !== "voting")) {
      return;
    }
    const t = nowMs();
    const remainingMs = Math.max(0, roomState.game.endsAtMs - t);
    io.to(roomState.roomSocket).emit("game_state", {
      event: "game_state",
      timeRemainingSeconds: Math.ceil(remainingMs / 1000),
      aliveCyphers: roomState.players.filter((p) => p.role === "cypher" && p.alive).length,
      aliveDemogorgon: roomState.players.filter((p) => p.role === "demogorgon" && p.alive).length,
      phase: roomState.game.phase,
    });

    if (
      roomState.game.phase === "running" &&
      !roomState.game.voteStarted &&
      t - roomState.game.startedAtMs >= config.durationsMs.voteAt
    ) {
      startVote(io, roomState, t);
    }

    if (roomState.game.phase === "voting" && roomState.game.voteEndsAtMs <= t) {
      resolveVote(io, roomState);
    }

    if (remainingMs === 0 && roomState.game.phase !== "ended") {
      endGame(io, roomState, "cyphers");
    }
  }, config.tick.gameClockMs);
}

function stopRoomTimers(roomState) {
  if (roomState._radarInterval) clearInterval(roomState._radarInterval);
  if (roomState._clockInterval) clearInterval(roomState._clockInterval);
  roomState._radarInterval = null;
  roomState._clockInterval = null;
  roomState._timersStarted = false;
}

function startGame(io, roomState) {
  if (roomState.game && roomState.game.phase !== "lobby") {
    return { ok: false, code: "ALREADY_STARTED", message: "Game already started." };
  }

  const players = roomState.players;
  if (players.length < config.limits.minPlayers || players.length > config.limits.maxPlayers) {
    return { ok: false, code: "INVALID_PLAYER_COUNT", message: "Need 4–8 players to start." };
  }

  const idx = Math.floor(Math.random() * players.length);
  for (let i = 0; i < players.length; i += 1) {
    players[i].role = i === idx ? "demogorgon" : "cypher";
  }

  for (const p of players) {
    io.to(p.socketId).emit("role_assignment", { role: p.role, playerNumber: p.playerNumber });
  }

  const t = nowMs();
  roomState.game = {
    phase: "running",
    startedAtMs: t,
    endsAtMs: t + config.durationsMs.gameTotal,
    voteStarted: false,
    voteEndsAtMs: 0,
    votesByVoterId: new Map(),
  };

  roomState.capture = {
    active: new Map(),
  };

  roomState._lastRadarVisible = false;
  ensureRoomTimers(io, roomState);

  return { ok: true };
}

function endGame(io, roomState, winner) {
  if (!roomState.game || roomState.game.phase === "ended") return;
  roomState.game.phase = "ended";
  stopRoomTimers(roomState);
  io.to(roomState.roomSocket).emit("game_end", { event: "game_end", winner });
}

function startVote(io, roomState, now) {
  roomState.game.phase = "voting";
  roomState.game.voteStarted = true;
  roomState.game.voteEndsAtMs = now + 60 * 1000;
  roomState.game.votesByVoterId.clear();

  const candidates = roomState.players
    .filter((p) => p.alive)
    .map((p) => ({ playerNumber: p.playerNumber }));

  io.to(roomState.roomSocket).emit("vote_start", {
    event: "vote_start",
    duration: 60,
    candidates,
  });
}

function resolveVote(io, roomState) {
  const voteEntries = Array.from(roomState.game.votesByVoterId.entries());
  if (voteEntries.length === 0) {
    roomState.game.phase = "running";
    return;
  }

  const tally = new Map();
  for (const [, targetId] of voteEntries) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }

  let maxVotes = -1;
  let chosenTargetId = null;
  for (const [targetId, count] of tally.entries()) {
    if (count > maxVotes) {
      maxVotes = count;
      chosenTargetId = targetId;
    }
  }

  const target = roomState.players.find((p) => p.playerId === chosenTargetId);
  if (!target) {
    roomState.game.phase = "running";
    return;
  }

  let outcome = "continue";
  if (target.role === "demogorgon") {
    outcome = "cyphers_win";
    endGame(io, roomState, "cyphers");
  } else {
    target.alive = false;
    io.to(roomState.roomSocket).emit("player_eliminated", {
      event: "player_eliminated",
      playerNumber: target.playerNumber,
    });
    const remainingCyphers = aliveCyphers(roomState).length;
    if (remainingCyphers === 0) {
      endGame(io, roomState, "demogorgon");
    } else {
      roomState.game.phase = "running";
    }
  }

  io.to(roomState.roomSocket).emit("vote_result", {
    event: "vote_result",
    revealedPlayerNumber: target.playerNumber,
    revealedRole: target.role,
    outcome,
  });
}

function broadcastLobby(io, roomState) {
  io.to(roomState.roomSocket).emit("room_players", {
    event: "room_players",
    players: roomState.players
      .slice()
      .sort((a, b) => a.playerNumber - b.playerNumber)
      .map((p) => ({
        playerId: p.playerId,
        playerNumber: p.playerNumber,
        isHost: p.isHost,
        ready: p.ready,
      })),
  });
}

function broadcastRadar(io, roomState) {
  const t = nowMs();
  const visible = isRadarVisible(roomState, t);

  if (visible !== roomState._lastRadarVisible) {
    roomState._lastRadarVisible = visible;
    const demo = getDemogorgon(roomState);
    if (demo) {
      if (visible) {
        io.to(demo.socketId).emit("demogorgon_radar_active", {
          event: "demogorgon_radar_active",
          duration: Math.floor(config.durationsMs.demogorgonRadarVisible / 1000),
        });
      } else {
        io.to(demo.socketId).emit("demogorgon_radar_off", { event: "demogorgon_radar_off" });
      }
    }
  }

  const basePlayers = roomState.players
    .filter((p) => p.alive && p.last && typeof p.last.lat === "number" && typeof p.last.lng === "number")
    .map((p) => ({ playerNumber: p.playerNumber, latitude: p.last.lat, longitude: p.last.lng }));

  for (const c of aliveCyphers(roomState)) {
    io.to(c.socketId).emit("radar_update", { event: "radar_update", players: basePlayers });
  }

  const demo = getDemogorgon(roomState);
  if (demo && visible) {
    const filtered = roomState.players
      .filter((p) => p.alive && p.last && typeof p.last.lat === "number" && typeof p.last.lng === "number")
      .filter((p) => {
        if (p.role !== "cypher") return true;
        return t >= (p.immunityUntilMs || 0);
      })
      .map((p) => ({ playerNumber: p.playerNumber, latitude: p.last.lat, longitude: p.last.lng }));

    io.to(demo.socketId).emit("radar_update", { event: "radar_update", players: filtered });
  }
}

function handleLocationUpdate(io, roomState, player, payload) {
  if (!roomState.game || roomState.game.phase !== "running") return;
  if (!player.alive) return;

  const { latitude, longitude, timestamp } = payload || {};
  if (typeof latitude !== "number" || typeof longitude !== "number") return;

  const now = nowMs();
  let derivedSpeed = null;

  if (player.last && typeof player.last.lat === "number" && typeof player.last.lng === "number") {
    const dtMs = now - (player.last.receivedAtMs || now);
    const dtSeconds = dtMs / 1000;
    if (dtSeconds > 0.2 && dtSeconds < 30) {
      const distM = haversineMeters(player.last.lat, player.last.lng, latitude, longitude);
      derivedSpeed = distM / dtSeconds;
    }
  }

  player.last = {
    lat: latitude,
    lng: longitude,
    speed: derivedSpeed,
    timestamp: typeof timestamp === "number" ? timestamp : null,
    receivedAtMs: now,
  };
  broadcastRadar(io, roomState);

  const demo = getDemogorgon(roomState);
  if (!demo || !demo.last) return;
  if (player.role !== "cypher") return;

  const d = haversineMeters(demo.last.lat, demo.last.lng, player.last.lat, player.last.lng);
  const within = d <= config.distances.captureRadiusMeters;
  const key = `${demo.playerId}:${player.playerId}`;

  if (!within) {
    roomState.capture.active.delete(key);
    return;
  }

  const t = nowMs();
  const entry = roomState.capture.active.get(key);
  if (!entry) {
    roomState.capture.active.set(key, { startedAtMs: t });
  }
  const startedAtMs = roomState.capture.active.get(key).startedAtMs;
  const elapsed = t - startedAtMs;
  const remaining = Math.max(0, config.durationsMs.captureHold - elapsed);

  io.to(player.socketId).emit("danger_alert", {
    event: "danger_alert",
    distance: Number(d.toFixed(2)),
    countdownRemaining: Number((remaining / 1000).toFixed(1)),
  });

  if (elapsed >= config.durationsMs.captureHold) {
    player.alive = false;
    roomState.capture.active.delete(key);
    io.to(roomState.roomSocket).emit("player_eliminated", {
      event: "player_eliminated",
      playerNumber: player.playerNumber,
    });

    const remainingCyphers = aliveCyphers(roomState).length;
    if (remainingCyphers === 0) {
      endGame(io, roomState, "demogorgon");
    }
  }
}

function handleMothergateStart(io, roomState, player) {
  if (!roomState.game || roomState.game.phase !== "running") return;
  if (player.role !== "cypher" || !player.alive) return;

  const now = nowMs();
  const elapsedSinceStart = now - roomState.game.startedAtMs;
  if (elapsedSinceStart >= config.durationsMs.voteAt) {
    return;
  }

  if (!player.last) return;

  player.mothergate = {
    startedAtMs: now,
    expiresAtMs: now + config.durationsMs.mothergateWindow,
    distanceM: 0,
    lastLat: player.last.lat,
    lastLng: player.last.lng,
  };
}

function updateMothergateProgress(io, roomState, player) {
  if (!player.mothergate || !player.last) return;
  const mg = player.mothergate;
  const now = nowMs();
  if (now > mg.expiresAtMs) {
    player.mothergate = null;
    return;
  }

  const segment = haversineMeters(mg.lastLat, mg.lastLng, player.last.lat, player.last.lng);
  mg.distanceM += segment;
  mg.lastLat = player.last.lat;
  mg.lastLng = player.last.lng;

  if (mg.distanceM >= config.distances.mothergateMeters) {
    player.immunityUntilMs = now + config.durationsMs.mothergateImmunity;
    player.mothergate = null;
    io.to(player.socketId).emit("mothergate_completed", {
      event: "mothergate_completed",
      immunityDuration: Math.floor(config.durationsMs.mothergateImmunity / 1000),
      immunityUntil: new Date(player.immunityUntilMs).toISOString(),
    });
    if (process.env.AI_ENDPOINT) {
      sendMovementLogs(roomState)
        .then((report) => {
          if (report && report.event === "ai_report") {
            io.to(player.socketId).emit("ai_report", report);
          }
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[ai] failed to fetch AI report:", err.message);
        });
    }
  }
}

function handleVoteSubmit(roomState, voterPlayerId, targetPlayerId) {
  if (!roomState.game || roomState.game.phase !== "voting") return;
  const voter = roomState.players.find((p) => p.playerId === voterPlayerId);
  const target = roomState.players.find((p) => p.playerId === targetPlayerId);
  if (!voter || !target) return;
  if (!voter.alive) return;
  if (voter.role !== "cypher") return;
  roomState.game.votesByVoterId.set(voterPlayerId, targetPlayerId);
}

module.exports = {
  startGame,
  endGame,
  broadcastLobby,
  handleLocationUpdate,
  handleMothergateStart,
  updateMothergateProgress,
  handleVoteSubmit,
};

