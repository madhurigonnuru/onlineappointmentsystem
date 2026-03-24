const { getDb } = require("../config/db");
const {
  buildOrderByClause,
  buildWhereClause,
  nowIso,
  readRowValue,
} = require("./modelUtils");

class User {
  constructor({
    id,
    name = "",
    email,
    password,
    role = "user",
    createdAt,
    updatedAt,
  }) {
    this._id = id;
    this.name = name;
    this.email = email;
    this.password = password;
    this.role = role;
    this.createdAt = createdAt ? new Date(createdAt) : null;
    this.updatedAt = updatedAt ? new Date(updatedAt) : null;
  }

  static fromRow(row) {
    return row
      ? new User({
          id: readRowValue(row, "id"),
          name: readRowValue(row, "name") || "",
          email: readRowValue(row, "email"),
          password: readRowValue(row, "password"),
          role: readRowValue(row, "role") || "user",
          createdAt: readRowValue(row, "createdAt"),
          updatedAt: readRowValue(row, "updatedAt"),
        })
      : null;
  }

  static async findOne(criteria = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const row = await db.prepare(`SELECT * FROM users ${clause} LIMIT 1`).get(...values);
    return User.fromRow(row);
  }

  static async find(criteria = {}, options = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const orderByClause = buildOrderByClause(options.sort);
    const rows = await db
      .prepare(`SELECT * FROM users ${clause} ${orderByClause}`.trim())
      .all(...values);
    return rows.map((row) => User.fromRow(row));
  }

  static async create(data) {
    const db = getDb();
    const timestamp = nowIso();
    const result = await db
      .prepare(
        `INSERT INTO users (name, email, password, role, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(data.name || "", data.email, data.password, data.role || "user", timestamp, timestamp);

    return User.findById(result.lastInsertRowid);
  }

  static async findById(id) {
    const db = getDb();
    const row = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").get(Number(id));
    return User.fromRow(row);
  }

  static async deleteMany(criteria = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const result = await db.prepare(`DELETE FROM users ${clause}`.trim()).run(...values);
    return { deletedCount: result.changes };
  }

  async save() {
    const db = getDb();
    const updatedAt = nowIso();

    await db.prepare(
      `UPDATE users
       SET name = ?, email = ?, password = ?, role = ?, updatedAt = ?
       WHERE id = ?`
    ).run(this.name || "", this.email, this.password, this.role, updatedAt, Number(this._id));

    this.updatedAt = new Date(updatedAt);
    return this;
  }

  toObject() {
    return {
      _id: this._id,
      name: this.name,
      email: this.email,
      password: this.password,
      role: this.role,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = User;
