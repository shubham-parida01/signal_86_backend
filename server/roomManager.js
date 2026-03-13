const { customAlphabet } = require("nanoid");

const roomCode = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 4);

function createRoomStore() {
  const roomsByCode = new Map();
  return { roomsByCode };
}

function generateUniqueRoomCode(roomStore) {
  // Try a few times; collisions are extremely unlikely.
  for (let i = 0; i < 10; i += 1) {
    const code = roomCode();
    if (!roomStore.roomsByCode.has(code)) return code;
  }
  // Fallback: keep trying until unique.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const code = roomCode();
    if (!roomStore.roomsByCode.has(code)) return code;
  }
}

module.exports = {
  createRoomStore,
  generateUniqueRoomCode,
};

