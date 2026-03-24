const Appointment = require("../models/Appointment");
const { queueNotification } = require("./notificationService");

const ROOM_TIME_FORMAT_OPTIONS = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

const buildDateTime = (date, time) => new Date(`${date}T${time}:00`);

const formatDateTime = (date) => date.toLocaleString([], ROOM_TIME_FORMAT_OPTIONS);

const floorToMinute = (date) => {
  const floored = new Date(date);
  floored.setSeconds(0, 0);
  return floored;
};

const getRoomStartDateTime = (room) => buildDateTime(room.date, room.startTime);

const getRoomEndDateTime = (room) => buildDateTime(room.date, room.endTime);

const getRoomExtendedUntilDateTime = (room) =>
  room?.extendedUntil ? new Date(room.extendedUntil) : null;

const isRoomPastScheduledEnd = (room) => Date.now() >= getRoomEndDateTime(room).getTime();

const hasPendingAppointments = async (roomCode) => {
  const appointments = await getRoomAppointments(roomCode);
  return appointments.some(
    (appointment) =>
      appointment.status === "waiting" || appointment.status === "in_progress"
  );
};

const shouldPromptRoomContinuation = async (room) => {
  if (!room || !room.isActive || room.extendedUntil || !isRoomPastScheduledEnd(room)) {
    return false;
  }

  return hasPendingAppointments(room.roomCode);
};

const isRoomExpired = async (room) => {
  const extendedUntil = getRoomExtendedUntilDateTime(room);

  if (extendedUntil) {
    return Date.now() >= extendedUntil.getTime();
  }

  if (!isRoomPastScheduledEnd(room)) {
    return false;
  }

  return !(await hasPendingAppointments(room.roomCode));
};

const closeRoom = async (room, waitingStatus = "closed") => {
  if (room.isActive) {
    room.isActive = false;
    await room.save();
  }

  await Promise.all([
    Appointment.updateMany(
      { roomCode: room.roomCode, status: "waiting" },
      { $set: { status: waitingStatus } }
    ),
    Appointment.updateMany(
      { roomCode: room.roomCode, status: "in_progress" },
      { $set: { status: waitingStatus } }
    ),
  ]);
};

const ensureRoomAvailability = async (room) => {
  if (!room) {
    return null;
  }

  if (room.isActive && (await isRoomExpired(room))) {
    await closeRoom(room, "closed");
    room.isActive = false;
  }

  return room;
};

const getRoomAppointments = async (roomCode) =>
  Appointment.find({ roomCode }, { sort: { createdAt: 1 } });

const buildScheduleEntries = (room, appointments) => {
  const roomStart = getRoomStartDateTime(room);
  const currentMinute = floorToMinute(new Date());
  let cursor = roomStart;
  let waitingCursorAnchoredToCurrentTime = false;

  return appointments.map((appointment, index) => {
    const baselineStart = new Date(
      roomStart.getTime() + index * Number(room.appointmentDuration) * 60000
    );

    if (appointment.status === "completed") {
      const actualStart = appointment.actualStartTime
        ? floorToMinute(new Date(appointment.actualStartTime))
        : new Date(cursor);
      const completedAt = appointment.completedAt
        ? new Date(appointment.completedAt)
        : new Date(
            actualStart.getTime() + Number(room.appointmentDuration) * 60000
          );

      cursor = new Date(completedAt);

      return {
        appointment,
        baselineStart,
        effectiveStart: actualStart,
        effectiveEnd: completedAt,
        delayMinutes: Math.max(
          0,
          Math.ceil((actualStart.getTime() - baselineStart.getTime()) / 60000)
        ),
      };
    }

    if (appointment.status === "closed") {
      return {
        appointment,
        baselineStart,
        effectiveStart: null,
        effectiveEnd: null,
        delayMinutes: 0,
      };
    }

    if (appointment.status === "in_progress") {
      const actualStart = appointment.actualStartTime
        ? floorToMinute(new Date(appointment.actualStartTime))
        : floorToMinute(new Date(cursor));
      const plannedEnd = new Date(
        actualStart.getTime() + Number(room.appointmentDuration) * 60000
      );
      const effectiveEnd = plannedEnd > currentMinute ? plannedEnd : new Date(currentMinute);

      cursor = new Date(effectiveEnd);

      return {
        appointment,
        baselineStart,
        effectiveStart: actualStart,
        effectiveEnd,
        delayMinutes: Math.max(
          0,
          Math.ceil((actualStart.getTime() - baselineStart.getTime()) / 60000)
        ),
      };
    }

    if (!waitingCursorAnchoredToCurrentTime && currentMinute > cursor) {
      cursor = new Date(currentMinute);
      waitingCursorAnchoredToCurrentTime = true;
    }

    const effectiveStart = new Date(cursor);
    const effectiveEnd = new Date(
      effectiveStart.getTime() + Number(room.appointmentDuration) * 60000
    );

    cursor = new Date(effectiveEnd);

    return {
      appointment,
      baselineStart,
      effectiveStart,
      effectiveEnd,
      delayMinutes: Math.max(
        0,
        Math.ceil((effectiveStart.getTime() - baselineStart.getTime()) / 60000)
      ),
    };
  });
};

const recalculateQueueTimes = async (room) => {
  const appointments = await getRoomAppointments(room.roomCode);
  const entries = buildScheduleEntries(room, appointments);
  const waitingQueue = [];
  let inProgressAppointment = null;

  for (const { appointment, effectiveStart, delayMinutes } of entries) {
    if (appointment.status === "in_progress" && effectiveStart) {
      inProgressAppointment = {
        id: appointment._id,
        roomCode: appointment.roomCode,
        userName: appointment.userName,
        phone: appointment.phone,
        email: appointment.email,
        estimatedTime: appointment.estimatedTime,
        estimatedTimeValue: appointment.estimatedTimeValue,
        status: appointment.status,
        actualStartTime: appointment.actualStartTime,
        delayMinutes,
        createdAt: appointment.createdAt,
      };
    }

    if (appointment.status !== "waiting" || !effectiveStart) {
      continue;
    }

    const estimatedTimeValue = effectiveStart.toISOString();
    const estimatedTime = formatDateTime(effectiveStart);
    const needsUpdate =
      appointment.estimatedTime !== estimatedTime ||
      appointment.estimatedTimeValue !== estimatedTimeValue ||
      appointment.appointmentDate !== room.date;

    if (needsUpdate) {
      appointment.estimatedTime = estimatedTime;
      appointment.estimatedTimeValue = estimatedTimeValue;
      appointment.appointmentDate = room.date;
      await appointment.save();
    }

    waitingQueue.push({
      id: appointment._id,
      roomCode: appointment.roomCode,
      userName: appointment.userName,
      phone: appointment.phone,
      email: appointment.email,
      estimatedTime: appointment.estimatedTime,
      estimatedTimeValue,
      status: appointment.status,
      delayMinutes,
      createdAt: appointment.createdAt,
    });
  }

  const firstDelayedAppointment = waitingQueue[0];
  const MIN_DELAY_MINUTES_TO_NOTIFY = 10;

  if (firstDelayedAppointment?.delayMinutes >= MIN_DELAY_MINUTES_TO_NOTIFY) {
    const impactedAppointments = waitingQueue.slice(1, 3);

    await Promise.all(
      impactedAppointments.map(async (queueItem) => {
        const appointment = appointments.find(
          (item) => Number(item._id) === Number(queueItem.id)
        );

        if (
          !appointment ||
          !queueItem.email ||
          appointment.lastDelayNotificationEstimateValue === queueItem.estimatedTimeValue
        ) {
          return;
        }

        await queueNotification({
          roomCode: room.roomCode,
          type: "delay",
          recipients: [queueItem.email],
          subject: `Appointment delayed for room ${room.roomCode}`,
          message: `Your appointment has been delayed by ${queueItem.delayMinutes} minute(s). Your updated estimated time is ${queueItem.estimatedTime}.`,
        });

        appointment.lastDelayNotificationEstimateValue = queueItem.estimatedTimeValue;
        await appointment.save();
      })
    );
  }

  waitingQueue.sort((left, right) => new Date(left.estimatedTimeValue) - new Date(right.estimatedTimeValue));

  return {
    inProgressAppointment,
    waitingAppointments: waitingQueue,
  };
};

const getTrackedAppointmentSummary = async (roomCode, { phone, email } = {}) => {
  const appointments = await getRoomAppointments(roomCode);

  const trackedAppointment = appointments.find(
    (appointment) =>
      (phone && appointment.phone === phone) ||
      (email && appointment.email === email)
  );

  if (!trackedAppointment) {
    return null;
  }

  return {
    id: trackedAppointment._id,
    userName: trackedAppointment.userName,
    phone: trackedAppointment.phone,
    email: trackedAppointment.email,
    status: trackedAppointment.status,
    estimatedTime: trackedAppointment.estimatedTime,
    appointmentDate: trackedAppointment.appointmentDate,
    actualDurationMinutes: trackedAppointment.actualDurationMinutes,
    completedAt: trackedAppointment.completedAt,
  };
};

const getRoomCapacity = ({ startTime, endTime, appointmentDuration, date }) => {
  const roomStart = buildDateTime(date, startTime);
  const roomEnd = buildDateTime(date, endTime);
  const totalMinutes = Math.floor((roomEnd - roomStart) / 60000);
  return Math.floor(totalMinutes / Number(appointmentDuration));
};

module.exports = {
  buildDateTime,
  buildScheduleEntries,
  closeRoom,
  ensureRoomAvailability,
  formatDateTime,
  floorToMinute,
  getRoomAppointments,
  getRoomCapacity,
  getRoomEndDateTime,
  getRoomExtendedUntilDateTime,
  getRoomStartDateTime,
  getTrackedAppointmentSummary,
  isRoomExpired,
  isRoomPastScheduledEnd,
  recalculateQueueTimes,
  shouldPromptRoomContinuation,
};
