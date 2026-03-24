const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { Pool } = require("pg");

let database;
let databaseType;

const translatePlaceholders = (sql) => {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
};

const createSqliteAdapter = (dbFilePath) => {
  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

  const sqlite = new DatabaseSync(dbFilePath);
  sqlite.exec("PRAGMA foreign_keys = ON;");

  return {
    exec(sql) {
      sqlite.exec(sql);
    },
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        all: (...params) => statement.all(...params),
        get: (...params) => statement.get(...params),
        run: (...params) => {
          const result = statement.run(...params);
          return {
            changes: Number(result.changes || 0),
            lastInsertRowid: Number(result.lastInsertRowid || 0),
          };
        },
      };
    },
  };
};

const createPostgresAdapter = (pool) => ({
  async exec(sql) {
    await pool.query(sql);
  },
  prepare(sql) {
    const translatedSql = translatePlaceholders(sql);

    return {
      all: async (...params) => {
        const result = await pool.query(translatedSql, params);
        return result.rows;
      },
      get: async (...params) => {
        const result = await pool.query(translatedSql, params);
        return result.rows[0] || null;
      },
      run: async (...params) => {
        let sqlToRun = translatedSql;

        if (/^\s*insert\s+into/i.test(sqlToRun) && !/\breturning\b/i.test(sqlToRun)) {
          sqlToRun = `${sqlToRun} RETURNING id`;
        }

        const result = await pool.query(sqlToRun, params);
        return {
          changes: result.rowCount || 0,
          lastInsertRowid: Number(result.rows[0]?.id || 0),
        };
      },
    };
  },
});

const ensurePostgresColumn = async (db, tableName, columnName, definition) => {
  await db.exec(
    `ALTER TABLE ${tableName} ADD COLUMN IF NOT EXISTS ${columnName} ${definition};`
  );
};

const ensureSqliteColumn = async (db, tableName, columnName, definition) => {
  const columns = await db.prepare(`PRAGMA table_info(${tableName})`).all();
  const hasColumn = columns.some((column) => String(column.name).trim() === columnName);

  if (!hasColumn) {
    await db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
  }
};

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id SERIAL PRIMARY KEY,
    adminName TEXT NOT NULL,
    sector TEXT NOT NULL,
    organization TEXT NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    appointmentDuration INTEGER NOT NULL,
    maxAppointments INTEGER NOT NULL DEFAULT 0,
    createdBy TEXT NOT NULL,
    roomCode TEXT NOT NULL UNIQUE,
    isActive INTEGER NOT NULL DEFAULT 1,
    extendedUntil TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    roomCode TEXT NOT NULL REFERENCES rooms(roomCode) ON DELETE CASCADE,
    userName TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    estimatedTime TEXT NOT NULL,
    estimatedTimeValue TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    appointmentDate TEXT,
    actualStartTime TEXT,
    completedAt TEXT,
    actualDurationMinutes INTEGER,
    lastDelayNotificationEstimateValue TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    sector TEXT NOT NULL,
    uniqueCode TEXT UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_rooms_createdBy ON rooms(createdBy);
  CREATE INDEX IF NOT EXISTS idx_rooms_roomCode ON rooms(roomCode);
  CREATE INDEX IF NOT EXISTS idx_rooms_isActive ON rooms(isActive);
  CREATE INDEX IF NOT EXISTS idx_appointments_roomCode ON appointments(roomCode);
  CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
  CREATE INDEX IF NOT EXISTS idx_appointments_email ON appointments(email);
`;

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adminName TEXT NOT NULL,
    sector TEXT NOT NULL,
    organization TEXT NOT NULL,
    date TEXT NOT NULL,
    startTime TEXT NOT NULL,
    endTime TEXT NOT NULL,
    appointmentDuration INTEGER NOT NULL,
    maxAppointments INTEGER NOT NULL DEFAULT 0,
    createdBy TEXT NOT NULL,
    roomCode TEXT NOT NULL UNIQUE,
    isActive INTEGER NOT NULL DEFAULT 1,
    extendedUntil TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roomCode TEXT NOT NULL,
    userName TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    estimatedTime TEXT NOT NULL,
    estimatedTimeValue TEXT,
    status TEXT NOT NULL DEFAULT 'waiting',
    appointmentDate TEXT,
    actualStartTime TEXT,
    completedAt TEXT,
    actualDurationMinutes INTEGER,
    lastDelayNotificationEstimateValue TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (roomCode) REFERENCES rooms(roomCode) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sector TEXT NOT NULL,
    uniqueCode TEXT UNIQUE,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  CREATE INDEX IF NOT EXISTS idx_rooms_createdBy ON rooms(createdBy);
  CREATE INDEX IF NOT EXISTS idx_rooms_roomCode ON rooms(roomCode);
  CREATE INDEX IF NOT EXISTS idx_rooms_isActive ON rooms(isActive);
  CREATE INDEX IF NOT EXISTS idx_appointments_roomCode ON appointments(roomCode);
  CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
  CREATE INDEX IF NOT EXISTS idx_appointments_email ON appointments(email);
`;

const ensureSchema = async (db, type) => {
  await db.exec(type === "postgres" ? postgresSchema : sqliteSchema);

  if (type === "postgres") {
    await ensurePostgresColumn(db, "rooms", "maxAppointments", "INTEGER NOT NULL DEFAULT 0");
    await ensurePostgresColumn(db, "rooms", "extendedUntil", "TEXT");
    await ensurePostgresColumn(db, "appointments", "email", "TEXT NOT NULL DEFAULT ''");
    await ensurePostgresColumn(db, "appointments", "estimatedTimeValue", "TEXT");
    await ensurePostgresColumn(db, "appointments", "appointmentDate", "TEXT");
    await ensurePostgresColumn(db, "appointments", "actualStartTime", "TEXT");
    await ensurePostgresColumn(db, "appointments", "completedAt", "TEXT");
    await ensurePostgresColumn(db, "appointments", "actualDurationMinutes", "INTEGER");
    await ensurePostgresColumn(
      db,
      "appointments",
      "lastDelayNotificationEstimateValue",
      "TEXT"
    );
    return;
  }

  await ensureSqliteColumn(db, "rooms", "extendedUntil", "TEXT");
};

const normalizeDatabaseUrl = () =>
  String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || "")
    .trim()
    .replace(/\s+/g, "");

const shouldUseSqlite = () =>
  ["sqlite", "local"].includes(String(process.env.DB_CLIENT || "").trim().toLowerCase());

const getSqlitePath = () =>
  path.join(__dirname, "..", "data", process.env.SQLITE_DB_FILE || "appointment-system.db");

const initializeSqlite = async (reason) => {
  database = createSqliteAdapter(getSqlitePath());
  databaseType = "sqlite";
  await ensureSchema(database, "sqlite");
  console.log(`SQLite connected${reason ? ` (${reason})` : ""}`);
  return database;
};

const initializePostgres = async (databaseUrl) => {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl:
      String(process.env.DATABASE_SSL || "").trim().toLowerCase() === "false"
        ? false
        : { rejectUnauthorized: false },
  });

  const adapter = createPostgresAdapter(pool);
  await ensureSchema(adapter, "postgres");
  database = adapter;
  databaseType = "postgres";
  console.log("PostgreSQL connected");
  return database;
};

const connectDB = async () => {
  if (database) {
    return database;
  }

  if (shouldUseSqlite()) {
    return initializeSqlite("forced by DB_CLIENT");
  }

  const databaseUrl = normalizeDatabaseUrl();

  if (!databaseUrl) {
    return initializeSqlite("DATABASE_URL missing");
  }

  try {
    return await initializePostgres(databaseUrl);
  } catch (error) {
    const canFallbackToSqlite =
      String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";

    if (canFallbackToSqlite && ["EACCES", "ENETUNREACH", "EHOSTUNREACH"].includes(error.code)) {
      console.warn(
        "PostgreSQL direct host is unreachable. Falling back to local SQLite for development."
      );
      return initializeSqlite("PostgreSQL unreachable");
    }

    throw error;
  }
};

const getDb = () => {
  if (!database) {
    throw new Error("Database is not initialized. Call connectDB() first.");
  }

  return database;
};

const getDbType = () => databaseType || "unknown";

module.exports = connectDB;
module.exports.getDb = getDb;
module.exports.getDbType = getDbType;
