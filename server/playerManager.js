const { nanoid } = require("nanoid");

function createPlayer({ roomCode, playerNumber, name, socketId, isHost }) {
  return {
    playerId: `p_${nanoid(10)}`,
    roomCode,
    playerNumber,
    name: name || null,
    socketId,
    isHost: Boolean(isHost),

    role: "unknown", // "cypher" | "demogorgon"
    ready: false,
    alive: true,

    last: null, // { lat, lng, speed, timestamp }
    connected: true,

    immunityUntilMs: 0,
    mothergate: null,
  };
}

function roomPublicPlayers(roomState) {
  return roomState.players
    .slice()
    .sort((a, b) => a.playerNumber - b.playerNumber)
    .map((p) => ({
      playerId: p.playerId,
      playerNumber: p.playerNumber,
      isHost: p.isHost,
      ready: p.ready,
    }));
}

module.exports = {
  createPlayer,
  roomPublicPlayers,
};

