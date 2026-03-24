const express = require("express");
const Appointment = require("../models/Appointment");
const Room = require("../models/Room");
const { queueNotification } = require("../services/notificationService");
const {
  buildDateTime,
  buildScheduleEntries,
  closeRoom,
  ensureRoomAvailability,
  formatDateTime,
  floorToMinute,
  getRoomAppointments,
  getRoomEndDateTime,
  getTrackedAppointmentSummary,
  isRoomPastScheduledEnd,
  recalculateQueueTimes,
} = require("../services/roomQueueService");

const router = express.Router();

const getRoomByCode = async (roomCode) =>
  Room.findOne({ roomCode: roomCode.trim().toUpperCase() });

const findDuplicateAppointment = (appointments, phone, email) =>
  appointments.find(
    (appointment) =>
      appointment.status !== "closed" &&
      (appointment.phone === phone || appointment.email === email)
  );

const buildTrackedResponse = async (roomCode, trackedContact) => ({
  trackedAppointment: await getTrackedAppointmentSummary(roomCode, trackedContact),
});

router.post("/join", async (req, res) => {
  try {
    let { roomCode, userName, phone, email } = req.body;

    if (!roomCode || !userName || !phone || !email) {
      return res.status(400).json({ message: "All fields are required" });
    }

    roomCode = roomCode.trim().toUpperCase();
    userName = userName.trim();
    phone = phone.trim();
    email = email.trim().toLowerCase();

    const room = await ensureRoomAvailability(await getRoomByCode(roomCode));

    if (!room) {
      return res.status(404).json({ message: "Room does not exist" });
    }

    if (!room.isActive) {
      return res.status(400).json({ message: "Room is closed" });
    }

    if (isRoomPastScheduledEnd(room)) {
      return res.status(400).json({
        message: "Room is closed for new appointments because the scheduled end time has passed",
      });
    }

    const allAppointments = await getRoomAppointments(room.roomCode);

    if (allAppointments.length >= room.maxAppointments) {
      return res.status(400).json({
        message: `Room is full. Only ${room.maxAppointments} appointments are allowed for this time window`,
      });
    }

    const duplicateAppointment = findDuplicateAppointment(allAppointments, phone, email);

    if (duplicateAppointment) {
      const queueState = await recalculateQueueTimes(room);
      return res.status(409).json({
        message: "You already joined this room",
        alreadyJoined: true,
        queue: queueState.waitingAppointments,
        inProgressAppointment: queueState.inProgressAppointment,
        ...(await buildTrackedResponse(room.roomCode, { phone, email })),
      });
    }

    await Appointment.create({
      roomCode,
      userName,
      phone,
      email,
      estimatedTime: formatDateTime(buildDateTime(room.date, room.startTime)),
      estimatedTimeValue: buildDateTime(room.date, room.startTime).toISOString(),
      status: "waiting",
      appointmentDate: room.date,
    });

    const updatedQueueState = await recalculateQueueTimes(room);
    const joinedAppointment = updatedQueueState.waitingAppointments.find(
      (appointment) => appointment.phone === phone || appointment.email === email
    );

    res.status(201).json({
      position: joinedAppointment
        ? updatedQueueState.waitingAppointments.findIndex(
            (appointment) => appointment.id === joinedAppointment.id
          ) + 1
        : updatedQueueState.waitingAppointments.length,
      queue: updatedQueueState.waitingAppointments,
      inProgressAppointment: updatedQueueState.inProgressAppointment,
      message: "Appointment booked successfully",
      ...(await buildTrackedResponse(room.roomCode, { phone, email })),
    });
  } catch (error) {
    console.error("JOIN ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/:roomCode", async (req, res) => {
  try {
    const roomCode = req.params.roomCode.trim().toUpperCase();
    const trackedPhone = String(req.query.phone || "").trim();
    const trackedEmail = String(req.query.email || "").trim().toLowerCase();
    const room = await ensureRoomAvailability(await getRoomByCode(roomCode));

    if (!room) {
      return res.status(404).json({ message: "Room does not exist" });
    }

    const queueState = room.isActive
      ? await recalculateQueueTimes(room)
      : { inProgressAppointment: null, waitingAppointments: [] };
    const trackedAppointment = await getTrackedAppointmentSummary(roomCode, {
      phone: trackedPhone,
      email: trackedEmail,
    });

    if (trackedAppointment?.status === "completed") {
      return res.json({
        queue: [],
        trackedAppointment,
        message: "Appointment completed successfully",
      });
    }

    if (trackedAppointment?.status === "closed") {
      return res.json({
        queue: [],
        trackedAppointment,
        message: "Room ended before your appointment could be completed",
      });
    }

    res.json({
      queue: queueState.waitingAppointments,
      inProgressAppointment: queueState.inProgressAppointment,
      trackedAppointment,
      message: queueState.waitingAppointments.length
        ? ""
        : room.isActive
          ? "No Queue Found"
          : "Room is closed",
    });
  } catch (error) {
    console.error("GET APPOINTMENTS ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/start/:id", async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.status === "completed") {
      return res.status(400).json({ message: "Appointment is already completed" });
    }

    if (appointment.status === "in_progress") {
      return res.status(400).json({ message: "Appointment is already started" });
    }

    if (appointment.status !== "waiting") {
      return res.status(400).json({ message: "Only waiting appointments can be started" });
    }

    const room = await ensureRoomAvailability(await getRoomByCode(appointment.roomCode));

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const queueState = await recalculateQueueTimes(room);

    if (queueState.inProgressAppointment) {
      return res.status(400).json({ message: "Another appointment is already in progress" });
    }

    const firstWaitingAppointment = queueState.waitingAppointments[0];

    if (!firstWaitingAppointment || Number(firstWaitingAppointment.id) !== Number(appointment._id)) {
      return res.status(400).json({ message: "Only the next appointment in queue can be started" });
    }

    appointment.status = "in_progress";
    appointment.actualStartTime = floorToMinute(new Date()).toISOString();
    appointment.appointmentDate = room.date;
    await appointment.save();

    const updatedQueueState = await recalculateQueueTimes(room);

    res.json({
      message: "Appointment started successfully",
      inProgressAppointment: updatedQueueState.inProgressAppointment,
      queue: updatedQueueState.waitingAppointments,
    });
  } catch (error) {
    console.error("START APPOINTMENT ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

router.post("/end/:id", async (req, res) => {
  try {
    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.status === "completed") {
      return res.status(400).json({ message: "Appointment is already completed" });
    }

    // Allow ending appointments that have been started (have actualStartTime) or are in_progress
    if (appointment.status !== "in_progress" && !appointment.actualStartTime) {
      return res.status(400).json({ message: "Appointment must be started before ending it" });
    }

    const room = await ensureRoomAvailability(await getRoomByCode(appointment.roomCode));

    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    const beforeQueueState = await recalculateQueueTimes(room);
    const scheduleEntries = buildScheduleEntries(room, await getRoomAppointments(room.roomCode));
    const scheduleEntry = scheduleEntries.find(
      (entry) => Number(entry.appointment._id) === Number(appointment._id)
    );
    const completedAt = new Date();
    const scheduledStart = scheduleEntry?.effectiveStart || completedAt;
    const actualStart =
      scheduledStart.getTime() > completedAt.getTime() ? completedAt : scheduledStart;
    const actualDurationMinutes = Math.max(
      1,
      Math.ceil((completedAt.getTime() - actualStart.getTime()) / 60000)
    );

    appointment.status = "completed";
    appointment.actualStartTime = actualStart.toISOString();
    appointment.completedAt = completedAt.toISOString();
    appointment.actualDurationMinutes = actualDurationMinutes;
    appointment.appointmentDate = room.date;
    await appointment.save();

    const refreshedRoom = await getRoomByCode(room.roomCode);
    const afterQueueState = refreshedRoom
      ? await recalculateQueueTimes(refreshedRoom)
      : { inProgressAppointment: null, waitingAppointments: [] };

    if (
      refreshedRoom &&
      isRoomPastScheduledEnd(refreshedRoom) &&
      !afterQueueState.inProgressAppointment &&
      !afterQueueState.waitingAppointments.length
    ) {
      await closeRoom(refreshedRoom, "closed");
    }

    const plannedDuration = Number(room.appointmentDuration);
    const scheduleShiftType =
      actualDurationMinutes < plannedDuration
        ? "earlier"
        : actualDurationMinutes > plannedDuration
          ? "delay"
          : "";

    if (scheduleShiftType) {
      const beforeMap = new Map(
        beforeQueueState.waitingAppointments.map((item) => [Number(item.id), item])
      );
      const impactedAppointments = afterQueueState.waitingAppointments
        .filter((item) => beforeMap.has(Number(item.id)))
        .slice(0, 2);

      await queueNotification({
        roomCode: room.roomCode,
        type: scheduleShiftType,
        recipients: impactedAppointments
          .filter((item) => item.email)
          .map((item) => item.email),
        subject:
          scheduleShiftType === "earlier"
            ? `Appointment moved earlier for room ${room.roomCode}`
            : `Appointment delayed for room ${room.roomCode}`,
        message: impactedAppointments
          .map((item) => {
            const previousTime = beforeMap.get(Number(item.id))?.estimatedTime;
            return `${item.userName}: ${previousTime || "N/A"} -> ${item.estimatedTime}`;
          })
          .join("\n"),
      });
    }

    res.json({
      message: "Appointment completed successfully",
      inProgressAppointment: afterQueueState.inProgressAppointment,
      queue: afterQueueState.waitingAppointments,
    });
  } catch (error) {
    console.error("END APPOINTMENT ERROR:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
