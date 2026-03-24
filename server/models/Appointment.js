const { getDb } = require("../config/db");
const {
  buildOrderByClause,
  buildWhereClause,
  nowIso,
  readRowValue,
} = require("./modelUtils");

class Appointment {
  constructor({
    id,
    roomCode,
    userName,
    phone,
    email,
    estimatedTime,
    estimatedTimeValue,
    status,
    appointmentDate,
    actualStartTime,
    completedAt,
    actualDurationMinutes,
    lastDelayNotificationEstimateValue,
    createdAt,
    updatedAt,
  }) {
    this._id = id;
    this.id = id;
    this.roomCode = roomCode;
    this.userName = userName;
    this.phone = phone;
    this.email = email || "";
    this.estimatedTime = estimatedTime;
    this.estimatedTimeValue = estimatedTimeValue || null;
    this.status = status;
    this.appointmentDate = appointmentDate || null;
    this.actualStartTime = actualStartTime || null;
    this.completedAt = completedAt || null;
    this.actualDurationMinutes =
      actualDurationMinutes === null || actualDurationMinutes === undefined
        ? null
        : Number(actualDurationMinutes);
    this.lastDelayNotificationEstimateValue = lastDelayNotificationEstimateValue || null;
    this.createdAt = createdAt ? new Date(createdAt) : null;
    this.updatedAt = updatedAt ? new Date(updatedAt) : null;
  }

  static fromRow(row) {
    return row
      ? new Appointment({
          id: readRowValue(row, "id"),
          roomCode: readRowValue(row, "roomCode"),
          userName: readRowValue(row, "userName"),
          phone: readRowValue(row, "phone"),
          email: readRowValue(row, "email"),
          estimatedTime: readRowValue(row, "estimatedTime"),
          estimatedTimeValue: readRowValue(row, "estimatedTimeValue"),
          status: readRowValue(row, "status"),
          appointmentDate: readRowValue(row, "appointmentDate"),
          actualStartTime: readRowValue(row, "actualStartTime"),
          completedAt: readRowValue(row, "completedAt"),
          actualDurationMinutes: readRowValue(row, "actualDurationMinutes"),
          lastDelayNotificationEstimateValue: readRowValue(
            row,
            "lastDelayNotificationEstimateValue"
          ),
          createdAt: readRowValue(row, "createdAt"),
          updatedAt: readRowValue(row, "updatedAt"),
        })
      : null;
  }

  static async find(criteria = {}, options = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const orderByClause = buildOrderByClause(options.sort);
    const sql = `SELECT * FROM appointments ${clause} ${orderByClause}`.trim();
    const rows = await db.prepare(sql).all(...values);
    const appointments = rows.map((row) => Appointment.fromRow(row));

    if (options.lean) {
      return appointments.map((appointment) => appointment.toObject());
    }

    return appointments;
  }

  static async findById(id) {
    const db = getDb();
    const row = await db
      .prepare("SELECT * FROM appointments WHERE id = ? LIMIT 1")
      .get(Number(id));
    return Appointment.fromRow(row);
  }

  static async findOne(criteria = {}) {
    const appointments = await Appointment.find(criteria, { sort: { id: 1 } });
    return appointments[0] || null;
  }

  static async create(data) {
    const db = getDb();
    const timestamp = nowIso();
    const result = await db
      .prepare(
        `INSERT INTO appointments
          (roomCode, userName, phone, email, estimatedTime, estimatedTimeValue, status, appointmentDate, actualStartTime, completedAt, actualDurationMinutes, lastDelayNotificationEstimateValue, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.roomCode,
        data.userName,
        data.phone,
        data.email || "",
        data.estimatedTime,
        data.estimatedTimeValue || null,
        data.status || "waiting",
        data.appointmentDate || null,
        data.actualStartTime || null,
        data.completedAt || null,
        data.actualDurationMinutes ?? null,
        data.lastDelayNotificationEstimateValue || null,
        timestamp,
        timestamp
      );

    return Appointment.findById(result.lastInsertRowid);
  }

  static async updateMany(criteria = {}, update = {}) {
    const db = getDb();
    const fields = Object.entries(update.$set || {});

    if (!fields.length) {
      return { modifiedCount: 0 };
    }

    const { clause, values } = buildWhereClause(criteria);
    const setClause = fields.map(([field]) => `${field} = ?`).join(", ");
    const updatedAt = nowIso();
    const result = await db
      .prepare(
        `UPDATE appointments
         SET ${setClause}, updatedAt = ?
         ${clause}`.trim()
      )
      .run(...fields.map(([, value]) => value), updatedAt, ...values);

    return { modifiedCount: result.changes };
  }

  static async deleteMany(criteria = {}) {
    const db = getDb();
    const { clause, values } = buildWhereClause(criteria);
    const result = await db
      .prepare(`DELETE FROM appointments ${clause}`.trim())
      .run(...values);
    return { deletedCount: result.changes };
  }

  async save() {
    const db = getDb();
    const updatedAt = nowIso();

    await db.prepare(
      `UPDATE appointments
       SET roomCode = ?, userName = ?, phone = ?, email = ?, estimatedTime = ?, estimatedTimeValue = ?, status = ?,
           appointmentDate = ?, actualStartTime = ?, completedAt = ?, actualDurationMinutes = ?, lastDelayNotificationEstimateValue = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      this.roomCode,
      this.userName,
      this.phone,
      this.email || "",
      this.estimatedTime,
      this.estimatedTimeValue,
      this.status,
      this.appointmentDate,
      this.actualStartTime,
      this.completedAt,
      this.actualDurationMinutes,
      this.lastDelayNotificationEstimateValue,
      updatedAt,
      Number(this._id)
    );

    this.updatedAt = new Date(updatedAt);
    return this;
  }

  toObject() {
    return {
      id: this._id,
      _id: this._id,
      roomCode: this.roomCode,
      userName: this.userName,
      phone: this.phone,
      email: this.email,
      estimatedTime: this.estimatedTime,
      estimatedTimeValue: this.estimatedTimeValue,
      status: this.status,
      appointmentDate: this.appointmentDate,
      actualStartTime: this.actualStartTime,
      completedAt: this.completedAt,
      actualDurationMinutes: this.actualDurationMinutes,
      lastDelayNotificationEstimateValue: this.lastDelayNotificationEstimateValue,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
    };
  }
}

module.exports = Appointment;
