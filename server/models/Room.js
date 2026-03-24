const { getDb } = require("../config/db");
const {
  buildOrderByClause,
  buildWhereClause,
  nowIso,
  readRowValue,
} = require("./modelUtils");

class Room {
  constructor({
    id,
    adminName,
    sector,
    organization,
    date,
    startTime,
    endTime,
    appointmentDuration,
    maxAppointments,
    createdBy,
    roomCode,
    isActive,
    extendedUntil,
    createdAt,
    updatedAt,
  }) {
    this._id = id;
    this.adminName = adminName;
    this.sector = sector;
    this.organization = organization;
    this.date = date;
    this.startTime = startTime;
    this.endTime = endTime;
    this.appointmentDuration = Number(appointmentDuration);
    this.maxAppointments = Number(maxAppointments || 0);
    this.createdBy = createdBy;
    this.roomCode = roomCode;
    this.isActive = Boolean(isActive);
    this.extendedUntil = extendedUntil || null;
    this.createdAt = createdAt ? new Date(createdAt) : null;
    this.updatedAt = updatedAt ? new Date(updatedAt) : null;
  }

  static fromRow(row) {
    return row
      ? new Room({
          id: readRowValue(row, "id"),
          adminName: readRowValue(row, "adminName"),
          sector: readRowValue(row, "sector"),
          organization: readRowValue(row, "organization"),
          date: readRowValue(row, "date"),
          startTime: readRowValue(row, "startTime"),
          endTime: readRowValue(row, "endTime"),
          appointmentDuration: readRowValue(row, "appointmentDuration"),
          maxAppointments: readRowValue(row, "maxAppointments"),
          createdBy: readRowValue(row, "createdBy"),
          roomCode: readRowValue(row, "roomCode"),
          isActive: readRowValue(row, "isActive"),
          extendedUntil: readRowValue(row, "extendedUntil"),
          createdAt: readRowValue(row, "createdAt"),
          updatedAt: readRowValue(row, "updatedAt"),
        })
      : null;
  }

  static async find(criteria = {}, options = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const orderByClause = buildOrderByClause(options.sort);
    const sql = `SELECT * FROM rooms ${clause} ${orderByClause}`.trim();
    const rows = await db.prepare(sql).all(...values);
    return rows.map((row) => Room.fromRow(row));
  }

  static async findOne(criteria = {}) {
    const rooms = await Room.find(criteria, { sort: { id: 1 } });
    return rooms[0] || null;
  }

  static async findById(id) {
    const db = getDb();
    const row = await db.prepare("SELECT * FROM rooms WHERE id = ? LIMIT 1").get(Number(id));
    return Room.fromRow(row);
  }

  static async create(data) {
    const db = getDb();
    const timestamp = nowIso();
    const result = await db
      .prepare(
        `INSERT INTO rooms
          (adminName, sector, organization, date, startTime, endTime, appointmentDuration, maxAppointments, createdBy, roomCode, isActive, extendedUntil, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.adminName,
        data.sector,
        data.organization,
        data.date,
        data.startTime,
        data.endTime,
        Number(data.appointmentDuration),
        Number(data.maxAppointments || 0),
        data.createdBy,
        data.roomCode,
        data.isActive === undefined ? 1 : Number(Boolean(data.isActive)),
        data.extendedUntil || null,
        timestamp,
        timestamp
      );

    return Room.findById(result.lastInsertRowid);
  }

  static async updateMany(criteria = {}, update = {}) {
    const db = getDb();
    const fields = Object.entries(update.$set || {});

    if (!fields.length) {
      return { modifiedCount: 0 };
    }

    const { clause, values } = buildWhereClause(criteria);
    const setClause = fields.map(([field]) => `${field} = ?`).join(", ");
    const updateValues = fields.map(([, value]) =>
      typeof value === "boolean" ? Number(value) : value
    );
    const updatedAt = nowIso();

    const result = await db
      .prepare(
        `UPDATE rooms
         SET ${setClause}, updatedAt = ?
         ${clause}`.trim()
      )
      .run(...updateValues, updatedAt, ...values);

    return { modifiedCount: result.changes };
  }

  static async deleteMany(criteria = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const result = await db.prepare(`DELETE FROM rooms ${clause}`.trim()).run(...values);
    return { deletedCount: result.changes };
  }

  async save() {
    const db = getDb();
    const updatedAt = nowIso();

    await db.prepare(
      `UPDATE rooms
       SET adminName = ?, sector = ?, organization = ?, date = ?, startTime = ?, endTime = ?,
           appointmentDuration = ?, maxAppointments = ?, createdBy = ?, roomCode = ?, isActive = ?, extendedUntil = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      this.adminName,
      this.sector,
      this.organization,
      this.date,
      this.startTime,
      this.endTime,
      Number(this.appointmentDuration),
      Number(this.maxAppointments || 0),
      this.createdBy,
      this.roomCode,
      Number(Boolean(this.isActive)),
      this.extendedUntil,
      updatedAt,
      Number(this._id)
    );

    this.updatedAt = new Date(updatedAt);
    return this;
  }

  toObject() {
    return {
      _id: this._id,
      adminName: this.adminName,
      sector: this.sector,
      organization: this.organization,
      date: this.date,
      startTime: this.startTime,
      endTime: this.endTime,
      appointmentDuration: this.appointmentDuration,
      maxAppointments: this.maxAppointments,
      createdBy: this.createdBy,
      roomCode: this.roomCode,
      isActive: this.isActive,
      extendedUntil: this.extendedUntil,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = Room;
