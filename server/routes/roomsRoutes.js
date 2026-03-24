const express = require("express");
const Appointment = require("../models/Appointment");
const Room = require("../models/Room");
const {
  buildDateTime,
  closeRoom,
  ensureRoomAvailability,
  getRoomAppointments,
  getRoomCapacity,
  getRoomExtendedUntilDateTime,
  isRoomPastScheduledEnd,
  recalculateQueueTimes,
  shouldPromptRoomContinuation,
} = require("../services/roomQueueService");

const router = express.Router();

const generateUniqueRoomCode = async () => {
  let roomCode = "";

  while (!roomCode) {
    const candidate = Math.random().toString(36).substring(2, 8).toUpperCase();
    const existingRoom = await Room.findOne({ roomCode: candidate });

    if (!existingRoom) {
      roomCode = candidate;
    }
  }

  return roomCode;
};

const ensureRoomHasCode = async (room) => {
  if (!room || String(room.roomCode || "").trim()) {
    return room;
  }

  room.roomCode = await generateUniqueRoomCode();
  await room.save();
  return room;
};

const getRoomSummary = async (room) => {
  await ensureRoomHasCode(room);

  const queueState = await recalculateQueueTimes(room);
  const appointments = await Appointment.find(
    { roomCode: room.roomCode },
    { sort: { createdAt: 1 }, lean: true }
  );
  const waitingAppointmentsById = new Map(
    queueState.waitingAppointments.map((appointment) => [Number(appointment.id), appointment])
  );
  const inProgressAppointmentId = Number(queueState.inProgressAppointment?.id);
  const requiresContinuationDecision = await shouldPromptRoomContinuation(room);
  const extendedUntil = getRoomExtendedUntilDateTime(room);

  return {
    appointmentCount: appointments.length,
    inProgressAppointment: queueState.inProgressAppointment,
    waitingAppointments: queueState.waitingAppointments,
    requiresContinuationDecision,
    isPastScheduledEnd: isRoomPastScheduledEnd(room),
    extendedUntil: extendedUntil ? extendedUntil.toISOString() : null,
    appointments: appointments.map((appointment) => {
      const waitingAppointment = waitingAppointmentsById.get(Number(appointment.id));
      const inProgressAppointment =
        Number(appointment.id) === inProgressAppointmentId
          ? queueState.inProgressAppointment
          : null;

      return {
        id: appointment.id,
        userName: appointment.userName,
        phone: appointment.phone,
        email: appointment.email,
        status: appointment.status,
        estimatedTime: waitingAppointment?.estimatedTime || appointment.estimatedTime,
        delayMinutes:
          waitingAppointment?.delayMinutes || inProgressAppointment?.delayMinutes || 0,
        actualStartTime:
          inProgressAppointment?.actualStartTime || appointment.actualStartTime || null,
        completedAt: appointment.completedAt || null,
      };
    }),
  };
};

const enrichRooms = async (rooms) =>
  Promise.all(
    rooms.map(async (room) => {
      await ensureRoomHasCode(room);
      const summary = await getRoomSummary(room);
      return {
        ...room.toObject(),
        id: room._id,
        appointmentCount: summary.appointmentCount,
        waitingAppointments: summary.waitingAppointments,
        appointments: summary.appointments,
        inProgressAppointment: summary.inProgressAppointment,
        requiresContinuationDecision: summary.requiresContinuationDecision,
        isPastScheduledEnd: summary.isPastScheduledEnd,
        extendedUntil: summary.extendedUntil,
      };
    })
  );

const toPastRoomSummary = (room) => ({
  id: room.id,
  roomCode: room.roomCode,
  organization: room.organization,
  adminName: room.adminName,
  date: room.date,
  createdAt: room.createdAt,
  appointmentCount: room.appointmentCount,
});

const ensureRoomsAvailability = async (rooms) =>
  Promise.all(
    rooms.map(async (room) => ensureRoomHasCode(await ensureRoomAvailability(room)))
  );

const getAppointmentOutcome = (appointment) => {
  if (appointment.status === "completed") {
    return "Completed successfully";
  }

  if (appointment.status === "closed") {
    if (!appointment.actualStartTime) {
      return "Not started because the room ended before the appointment could begin";
    }

    return "Closed after room end";
  }

  return "Waiting";
};

const buildPastRoomMessage = (room, appointments) => {
  if (!appointments.length) {
    return "No appointments were recorded before this room ended.";
  }

  const completedCount = appointments.filter(
    (appointment) => appointment.status === "completed"
  ).length;
  const closedCount = appointments.filter(
    (appointment) => appointment.status === "closed"
  ).length;

  if (!completedCount && closedCount) {
    return "Appointments were not started because the room ran out of time and was closed.";
  }

  if (closedCount) {
    return `${closedCount} appointment(s) were not started because the room ended before their turn.`;
  }

  return "All recorded appointments in this room were completed before it ended.";
};

const getRoomsByCodes = async (roomCodes = []) => {
  const normalizedCodes = [
    ...new Set(
      roomCodes
        .map((roomCode) => String(roomCode || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  const rooms = (
    await Promise.all(normalizedCodes.map((roomCode) => Room.findOne({ roomCode })))
  ).filter(Boolean);

  await ensureRoomsAvailability(rooms);

  const refreshedRooms = (
    await Promise.all(normalizedCodes.map((roomCode) => Room.findOne({ roomCode })))
  ).filter(Boolean);

  const sortByNewest = (left, right) => right.createdAt - left.createdAt;
  const activeRooms = refreshedRooms.filter((room) => room.isActive).sort(sortByNewest);
  const pastRooms = refreshedRooms.filter((room) => !room.isActive).sort(sortByNewest);

  return {
    active: await enrichRooms(activeRooms),
    past: (await enrichRooms(pastRooms)).map(toPastRoomSummary),
  };
};

router.post("/lookup", async (req, res) => {
  try {
    const { roomCodes } = req.body;

    if (!Array.isArray(roomCodes)) {
      return res.status(400).json({ message: "roomCodes must be an array" });
    }

    res.json(await getRoomsByCodes(roomCodes));
  } catch (error) {
    console.error("ROOM LOOKUP ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/create", async (req, res) => {
  try {
    let {
      adminName,
      sector,
      organization,
      date,
      startTime,
      endTime,
      appointmentDuration,
      createdBy,
    } = req.body;

    if (
      !adminName ||
      !sector ||
      !organization ||
      !date ||
      !startTime ||
      !endTime ||
      !appointmentDuration ||
      !createdBy
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    adminName = adminName.trim();
    sector = sector.trim();
    organization = organization.trim();
    createdBy = createdBy.trim().toLowerCase();

    const duration = parseInt(String(appointmentDuration).trim(), 10);
    const roomStart = buildDateTime(date, startTime);
    const roomEnd = buildDateTime(date, endTime);

    if (Number.isNaN(duration) || duration <= 0) {
      return res.status(400).json({
        message: "Appointment duration must be greater than 0",
      });
    }

    if (roomStart <= new Date()) {
      return res.status(400).json({
        message: "Room start time must be in the future",
      });
    }

    if (roomEnd <= roomStart) {
      return res.status(400).json({
        message: "End time must be after start time",
      });
    }

    const maxAppointments = getRoomCapacity({
      date,
      startTime,
      endTime,
      appointmentDuration: duration,
    });

    if (maxAppointments <= 0) {
      return res.status(400).json({
        message: "Room time is too short for the selected appointment duration",
      });
    }

    const overlappingRooms = await Room.find({
      createdBy,
      date,
      isActive: true,
    });

    for (const room of overlappingRooms) {
      if (startTime < room.endTime && endTime > room.startTime) {
        return res.status(400).json({
          message: "Room time overlaps with existing room",
        });
      }
    }

    const roomCode = await generateUniqueRoomCode();

    const room = await Room.create({
      adminName,
      sector,
      organization,
      date,
      startTime,
      endTime,
      appointmentDuration: duration,
      maxAppointments,
      createdBy,
      roomCode,
      isActive: true,
    });

    res.status(201).json({
      id: room._id,
      roomCode: room.roomCode,
      maxAppointments: room.maxAppointments,
      message: "Room created successfully",
    });
  } catch (error) {
    console.error("CREATE ROOM ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/active/:email", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const rooms = await Room.find(
      { createdBy: email, isActive: true },
      { sort: { createdAt: -1 } }
    );

    await ensureRoomsAvailability(rooms);

    const refreshedRooms = await Room.find(
      { createdBy: email, isActive: true },
      { sort: { createdAt: -1 } }
    );

    res.json(await enrichRooms(refreshedRooms));
  } catch (error) {
    console.error("ACTIVE ROOM ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/past/:email", async (req, res) => {
  try {
    const email = req.params.email.trim().toLowerCase();
    const activeRooms = await Room.find({ createdBy: email, isActive: true });

    await ensureRoomsAvailability(activeRooms);

    const rooms = await Room.find(
      { createdBy: email, isActive: false },
      { sort: { createdAt: -1 } }
    );

    res.json((await enrichRooms(rooms)).map(toPastRoomSummary));
  } catch (error) {
    console.error("PAST ROOM ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/details/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const room = await ensureRoomHasCode(await Room.findOne({ roomCode }));

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const appointments = await getRoomAppointments(roomCode);

    res.json({
      room: {
        id: room._id,
        roomCode: room.roomCode,
        organization: room.organization,
        adminName: room.adminName,
        date: room.date,
        startTime: room.startTime,
        endTime: room.endTime,
        appointmentDuration: room.appointmentDuration,
        maxAppointments: room.maxAppointments,
      },
      roomMessage: buildPastRoomMessage(room, appointments),
      appointments: appointments.map((appointment) => ({
        id: appointment._id,
        userName: appointment.userName,
        phone: appointment.phone,
        email: appointment.email,
        appointmentDate: appointment.appointmentDate || room.date,
        estimatedTime: appointment.estimatedTime,
        actualDurationMinutes: appointment.actualDurationMinutes,
        completedAt: appointment.completedAt,
        status: appointment.status,
        outcome: getAppointmentOutcome(appointment),
      })),
    });
  } catch (error) {
    console.error("ROOM DETAILS ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/end/:roomId", async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    await closeRoom(room, "closed");

    res.json({ message: "Room ended and pending appointments closed" });
  } catch (error) {
    console.error("END ROOM ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.put("/continue/:roomId", async (req, res) => {
  try {
    const room = await Room.findById(req.params.roomId);

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    room.extendedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await room.save();

    res.json({
      message: "Room will remain active for up to 24 more hours or until you end it",
      extendedUntil: room.extendedUntil,
    });
  } catch (error) {
    console.error("CONTINUE ROOM ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
