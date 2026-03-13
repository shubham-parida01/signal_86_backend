require("dotenv").config();

const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const config = require("./config");
const db = require("./db");
const { createRoomStore, generateUniqueRoomCode } = require("./roomManager");
const { createPlayer, roomPublicPlayers } = require("./playerManager");
const {
  startGame,
  broadcastLobby,
  handleLocationUpdate,
  handleMothergateStart,
  updateMothergateProgress,
  handleVoteSubmit,
} = require("./gameEngine");

const app = express();
app.get("/health", (req, res) => res.json({ ok: true }));
app.head("/",(req,res)=>{
res.status(200).end()
})
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
});

const roomStore = createRoomStore();

function roomSocketName(roomCode) {
  return `room:${roomCode}`;
}

function findRoom(roomCode) {
  return roomStore.roomsByCode.get(roomCode);
}

function findPlayer(roomState, playerId) {
  return roomState.players.find((p) => p.playerId === playerId);
}

function emitError(socket, code, message) {
  socket.emit("error", { code, message });
}

io.on("connection", (socket) => {
  socket.on("create_room", async (payload = {}) => {
    const { playerName } = payload;
    const roomCode = generateUniqueRoomCode(roomStore);
    const roomSocket = roomSocketName(roomCode);

    const roomState = {
      roomCode,
      roomSocket,
      players: [],
      game: { phase: "lobby" },
      capture: null,
      _timersStarted: false,
      _radarInterval: null,
      _clockInterval: null,
      _lastRadarVisible: false,
    };

    const host = createPlayer({
      roomCode,
      playerNumber: 1,
      name: playerName,
      socketId: socket.id,
      isHost: true,
    });
    host.role = "host";

    roomState.players.push(host);
    roomStore.roomsByCode.set(roomCode, roomState);

    // Persist room + host to DB (best-effort; game still runs in-memory if this fails)
    try {
      const insertedRooms = await db("rooms")
        .insert({ code: roomCode, status: "lobby" })
        .returning(["id"]);
      const roomRow = Array.isArray(insertedRooms) ? insertedRooms[0] : insertedRooms;
      const roomId = typeof roomRow === "object" ? roomRow.id : roomRow;

      await db("players").insert({
        room_id: roomId,
        external_id: host.playerId,
        player_number: host.playerNumber,
        name: host.name,
        role: host.role,
        is_host: host.isHost,
        alive: host.alive,
        ready: host.ready,
        connected: host.connected,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[db] failed to persist create_room:", err.message);
    }

    socket.join(roomSocket);

    socket.emit("room_created", {
      roomCode,
      playerId: host.playerId,
      playerNumber: host.playerNumber,
      role: "host",
    });

    broadcastLobby(io, roomState);
  });

  socket.on("join_room", async (payload = {}) => {
    const { roomCode, playerName } = payload;
    if (typeof roomCode !== "string") return emitError(socket, "BAD_REQUEST", "roomCode required");

    const roomState = findRoom(roomCode);
    if (!roomState) return emitError(socket, "ROOM_NOT_FOUND", "Room not found");
    if (roomState.game && roomState.game.phase !== "lobby") {
      return emitError(socket, "ROOM_ALREADY_STARTED", "Game already started");
    }
    if (roomState.players.length >= config.limits.maxPlayers) {
      return emitError(socket, "ROOM_FULL", "Room already has 8 players");
    }

    const nextNumber =
      roomState.players.reduce((m, p) => Math.max(m, p.playerNumber), 0) + 1;
    const player = createPlayer({
      roomCode,
      playerNumber: nextNumber,
      name: playerName,
      socketId: socket.id,
      isHost: false,
    });
    roomState.players.push(player);

    socket.join(roomState.roomSocket);

    // Persist player join to DB
    try {
      const roomRow = await db("rooms").where({ code: roomCode }).first();
      if (roomRow) {
        await db("players").insert({
          room_id: roomRow.id,
          external_id: player.playerId,
          player_number: player.playerNumber,
          name: player.name,
          role: player.role,
          is_host: player.isHost,
          alive: player.alive,
          ready: player.ready,
          connected: player.connected,
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[db] failed to persist join_room:", err.message);
    }

    socket.emit("room_joined", {
      roomCode,
      playerId: player.playerId,
      playerNumber: player.playerNumber,
    });

    broadcastLobby(io, roomState);
  });

  socket.on("player_ready", async (payload = {}) => {
    const { roomCode, playerId } = payload;
    const roomState = findRoom(roomCode);
    if (!roomState) return emitError(socket, "ROOM_NOT_FOUND", "Room not found");
    const player = findPlayer(roomState, playerId);
    if (!player) return emitError(socket, "PLAYER_NOT_FOUND", "Player not found");
    if (player.socketId !== socket.id) return emitError(socket, "FORBIDDEN", "Wrong socket");
    player.ready = true;

    try {
      await db("players").where({ external_id: player.playerId }).update({ ready: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[db] failed to update player_ready:", err.message);
    }
    broadcastLobby(io, roomState);
  });

  socket.on("start_game", async (payload = {}) => {
    const { roomCode, playerId } = payload;
    const roomState = findRoom(roomCode);
    if (!roomState) return emitError(socket, "ROOM_NOT_FOUND", "Room not found");
    const host = findPlayer(roomState, playerId);
    if (!host) return emitError(socket, "PLAYER_NOT_FOUND", "Player not found");
    if (!host.isHost) return emitError(socket, "FORBIDDEN", "Only host can start");
    if (host.socketId !== socket.id) return emitError(socket, "FORBIDDEN", "Wrong socket");

    const result = startGame(io, roomState);
    if (!result.ok) return emitError(socket, result.code, result.message);

    // Mark room running and create a game_session row
    try {
      const roomRow = await db("rooms").where({ code: roomCode }).first();
      if (roomRow) {
        await db("rooms").where({ id: roomRow.id }).update({
          status: "running",
          started_at: new Date(roomState.game.startedAtMs),
        });
        await db("game_sessions")
          .insert({
            room_id: roomRow.id,
            state: "running",
            started_at: new Date(roomState.game.startedAtMs),
            game_ends_at: new Date(roomState.game.endsAtMs),
          })
          .onConflict("room_id")
          .merge();
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[db] failed to persist start_game:", err.message);
    }

    // After start, refresh lobby list (still useful to show ready/players)
    socket.emit("room_players", {
      event: "room_players",
      players: roomPublicPlayers(roomState),
    });
  });

  socket.on("location_update", (payload = {}) => {
    const { roomCode, playerId } = payload;
    const roomState = findRoom(roomCode);
    if (!roomState) return;
    const player = findPlayer(roomState, playerId);
    if (!player) return;
    if (player.socketId !== socket.id) return;
    handleLocationUpdate(io, roomState, player, payload);
    updateMothergateProgress(io, roomState, player);
  });

  socket.on("mothergate_start", (payload = {}) => {
    const { roomCode, playerId } = payload;
    const roomState = findRoom(roomCode);
    if (!roomState) return;
    const player = findPlayer(roomState, playerId);
    if (!player) return;
    if (player.socketId !== socket.id) return;
    handleMothergateStart(io, roomState, player);
  });

  socket.on("vote_submit", (payload = {}) => {
    const { roomCode, voterId, targetPlayerId } = payload;
    const roomState = findRoom(roomCode);
    if (!roomState) return;
    const voter = findPlayer(roomState, voterId);
    if (!voter) return;
    if (voter.socketId !== socket.id) return;
    handleVoteSubmit(roomState, voterId, targetPlayerId);
  });

  socket.on("player_disconnect", (payload = {}) => {
    const { roomCode, playerId } = payload;
    const roomState = findRoom(roomCode);
    if (!roomState) return;
    const player = findPlayer(roomState, playerId);
    if (!player) return;
    if (player.socketId !== socket.id) return;
    player.connected = false;
  });

  socket.on("disconnect", () => {
    // Mark any player with this socket as disconnected.
    for (const roomState of roomStore.roomsByCode.values()) {
      const p = roomState.players.find((pl) => pl.socketId === socket.id);
      if (p) {
        p.connected = false;
        break;
      }
    }
  });
});

httpServer.listen(config.port, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`[signal86] listening on :${config.port}`);
});

