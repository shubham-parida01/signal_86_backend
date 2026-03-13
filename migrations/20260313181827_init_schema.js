/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable("rooms", (table) => {
    table.increments("id").primary();
    table.string("code", 16).notNullable().unique();
    table.string("status", 32).notNullable().defaultTo("lobby");
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("started_at").nullable();
    table.timestamp("ended_at").nullable();
  });

  await knex.schema.createTable("players", (table) => {
    table.increments("id").primary();
    table
      .integer("room_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("rooms")
      .onDelete("CASCADE");
    table.string("external_id", 64).notNullable().unique();
    table.integer("player_number").notNullable();
    table.string("name", 128).nullable();
    table.string("role", 32).notNullable().defaultTo("unknown");
    table.boolean("is_host").notNullable().defaultTo(false);
    table.boolean("alive").notNullable().defaultTo(true);
    table.boolean("ready").notNullable().defaultTo(false);
    table.boolean("connected").notNullable().defaultTo(true);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["room_id"]);
    table.index(["room_id", "player_number"]);
  });

  await knex.schema.createTable("game_sessions", (table) => {
    table.increments("id").primary();
    table
      .integer("room_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("rooms")
      .onDelete("CASCADE");
    table.string("state", 32).notNullable().defaultTo("lobby");
    table.timestamp("started_at").nullable();
    table.timestamp("vote_triggered_at").nullable();
    table.timestamp("game_ends_at").nullable();
    table.timestamp("ended_at").nullable();

    table.unique(["room_id"]);
  });

  await knex.schema.createTable("votes", (table) => {
    table.increments("id").primary();
    table
      .integer("game_session_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("game_sessions")
      .onDelete("CASCADE");
    table.string("voter_external_id", 64).notNullable();
    table.string("target_external_id", 64).notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());

    table.index(["game_session_id"]);
    table.unique(["game_session_id", "voter_external_id"]);
  });

  await knex.schema.createTable("mothergate_runs", (table) => {
    table.increments("id").primary();
    table
      .integer("game_session_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("game_sessions")
      .onDelete("CASCADE");
    table.string("player_external_id", 64).notNullable();
    table.timestamp("started_at").notNullable();
    table.timestamp("expires_at").notNullable();
    table.boolean("completed").notNullable().defaultTo(false);
    table.float("total_distance_m").notNullable().defaultTo(0);

    table.index(["game_session_id", "player_external_id"]);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists("mothergate_runs");
  await knex.schema.dropTableIfExists("votes");
  await knex.schema.dropTableIfExists("game_sessions");
  await knex.schema.dropTableIfExists("players");
  await knex.schema.dropTableIfExists("rooms");
};

