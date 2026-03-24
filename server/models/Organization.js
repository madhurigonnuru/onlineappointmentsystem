const { getDb } = require("../config/db");
const { buildWhereClause, nowIso, readRowValue } = require("./modelUtils");

class Organization {
  constructor({ id, name, sector, uniqueCode, createdAt, updatedAt }) {
    this._id = id;
    this.name = name;
    this.sector = sector;
    this.uniqueCode = uniqueCode;
    this.createdAt = createdAt ? new Date(createdAt) : null;
    this.updatedAt = updatedAt ? new Date(updatedAt) : null;
  }

  static ensureTable() {
    const db = getDb();
    return db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        sector TEXT NOT NULL,
        uniqueCode TEXT UNIQUE,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);
  }

  static fromRow(row) {
    return row
      ? new Organization({
          id: readRowValue(row, "id"),
          name: readRowValue(row, "name"),
          sector: readRowValue(row, "sector"),
          uniqueCode: readRowValue(row, "uniqueCode"),
          createdAt: readRowValue(row, "createdAt"),
          updatedAt: readRowValue(row, "updatedAt"),
        })
      : null;
  }

  static async create(data) {
    await Organization.ensureTable();
    const db = getDb();
    const timestamp = nowIso();
    const result = await db
      .prepare(
        `INSERT INTO organizations (name, sector, uniqueCode, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(data.name, data.sector, data.uniqueCode, timestamp, timestamp);

    return Organization.findById(result.lastInsertRowid);
  }

  static async findById(id) {
    await Organization.ensureTable();
    const db = getDb();
    const row = await db
      .prepare("SELECT * FROM organizations WHERE id = ? LIMIT 1")
      .get(Number(id));
    return Organization.fromRow(row);
  }

  static async findOne(criteria = {}) {
    await Organization.ensureTable();
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const row = await db
      .prepare(`SELECT * FROM organizations ${clause} LIMIT 1`)
      .get(...values);
    return Organization.fromRow(row);
  }
}

module.exports = Organization;
