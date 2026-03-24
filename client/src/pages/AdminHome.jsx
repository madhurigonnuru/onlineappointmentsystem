import { useEffect, useState } from "react";
import API from "../services/api";
import { QRCodeCanvas } from "qrcode.react";
import "./AdminHome.css";

const getNowDate = () => new Date().toISOString().split("T")[0];
const ADMIN_ROOM_CODES_KEY = "adminRoomCodes";

const getNowTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes()
  ).padStart(2, "0")}`;
};

const getStoredRoomCodes = () => {
  try {
    return JSON.parse(localStorage.getItem(ADMIN_ROOM_CODES_KEY) || "[]");
  } catch {
    return [];
  }
};

const saveRoomCode = (roomCode) => {
  const nextCodes = [...new Set([...getStoredRoomCodes(), roomCode])];
  localStorage.setItem(ADMIN_ROOM_CODES_KEY, JSON.stringify(nextCodes));
};

const mergeRooms = (rooms = []) =>
  Array.from(
    new Map((rooms || []).map((room) => [room.roomCode, room])).values()
  ).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

const getRoomJoinUrl = (roomCode) => {
  if (typeof window === "undefined") {
    return roomCode;
  }

  return `${window.location.origin}/user-home?roomCode=${encodeURIComponent(roomCode)}`;
};

const formatCompletedTime = (completedAt) =>
  completedAt
    ? new Date(completedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Completed";

const formatClockTime = (date, time) =>
  new Date(`${date}T${time}:00`).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

function AdminHome() {
  const email = localStorage.getItem("email");
  const [section, setSection] = useState("create");
  const [sectorOther, setSectorOther] = useState("");
  const [activeRooms, setActiveRooms] = useState([]);
  const [pastRooms, setPastRooms] = useState([]);
  const [selectedPastRoom, setSelectedPastRoom] = useState(null);
  const [pastRoomDetails, setPastRoomDetails] = useState({});
  const [successRoom, setSuccessRoom] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [continuationPromptedRooms, setContinuationPromptedRooms] = useState({});
  const [continuationModalRoom, setContinuationModalRoom] = useState(null);
  const [form, setForm] = useState({
    adminName: "",
    sector: "",
    organization: "",
    date: "",
    startTime: "",
    endTime: "",
    appointmentDuration: "",
  });

  const fetchStoredRooms = async () => {
    const roomCodes = getStoredRoomCodes();

    if (!roomCodes.length) {
      return { active: [], past: [] };
    }

    const res = await API.post("/rooms/lookup", { roomCodes });
    return {
      active: res.data?.active || [],
      past: res.data?.past || [],
    };
  };

  const fetchActiveRooms = async () => {
    try {
      const [emailRooms, storedRooms] = await Promise.all([
        email
          ? API.get(`/rooms/active/${encodeURIComponent(email)}`).then(
              (res) => res.data || []
            )
          : Promise.resolve([]),
        fetchStoredRooms().then((data) => data.active),
      ]);

      setActiveRooms(mergeRooms([...emailRooms, ...storedRooms]));
    } catch (err) {
      console.log(err);
    }
  };

  const fetchPastRooms = async () => {
    try {
      const [emailRooms, storedRooms] = await Promise.all([
        email
          ? API.get(`/rooms/past/${encodeURIComponent(email)}`).then(
              (res) => res.data || []
            )
          : Promise.resolve([]),
        fetchStoredRooms().then((data) => data.past),
      ]);

      setPastRooms(mergeRooms([...emailRooms, ...storedRooms]));
    } catch (err) {
      console.log(err);
    }
  };

  useEffect(() => {
    const loadRooms = async () => {
      try {
        const [emailActive, emailPast, storedRooms] = await Promise.all([
          email
            ? API.get(`/rooms/active/${encodeURIComponent(email)}`).then(
                (res) => res.data || []
              )
            : Promise.resolve([]),
          email
            ? API.get(`/rooms/past/${encodeURIComponent(email)}`).then(
                (res) => res.data || []
              )
            : Promise.resolve([]),
          fetchStoredRooms(),
        ]);

        setActiveRooms(mergeRooms([...emailActive, ...(storedRooms.active || [])]));
        setPastRooms(mergeRooms([...emailPast, ...(storedRooms.past || [])]));
      } catch (err) {
        console.log(err);
      }
    };

    loadRooms();
  }, [email]);

  useEffect(() => {
    if (section !== "existing") return undefined;

    const refreshActiveRooms = async () => {
      try {
        const [emailRooms, storedRooms] = await Promise.all([
          email
            ? API.get(`/rooms/active/${encodeURIComponent(email)}`).then(
                (res) => res.data || []
              )
            : Promise.resolve([]),
          fetchStoredRooms().then((data) => data.active),
        ]);

        setActiveRooms(mergeRooms([...emailRooms, ...storedRooms]));
      } catch (err) {
        console.log(err);
      }
    };

    const intervalId = setInterval(() => {
      refreshActiveRooms();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [section, email]);

  useEffect(() => {
    if (section !== "existing") {
      return undefined;
    }

    const roomNeedingDecision = activeRooms.find(
      (room) =>
        room.requiresContinuationDecision && !continuationPromptedRooms[room.roomCode]
    );

    if (!roomNeedingDecision) {
      return undefined;
    }

    setContinuationPromptedRooms((prev) => ({
      ...prev,
      [roomNeedingDecision.roomCode]: true,
    }));
    setContinuationModalRoom(roomNeedingDecision);

    return undefined;
  }, [activeRooms, continuationPromptedRooms, section]);

  const handleContinueRoom = async (roomId) => {
    try {
      await API.put(`/rooms/continue/${roomId}`);
      setContinuationModalRoom(null);
      await Promise.all([fetchActiveRooms(), fetchPastRooms()]);
    } catch (err) {
      console.log(err);
    }
  };

  const handleCloseRoomAtEndTime = async (roomId) => {
    try {
      await API.put(`/rooms/end/${roomId}`);
      setContinuationModalRoom(null);
      await Promise.all([fetchActiveRooms(), fetchPastRooms()]);
    } catch (err) {
      console.log(err);
    }
  };

  const handleSectionChange = (nextSection) => {
    setSection(nextSection);

    if (nextSection === "existing") {
      fetchActiveRooms();
    }

    if (nextSection === "past") {
      fetchPastRooms();
    }
  };

  const handleInputChange = (field, value) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const validateRoomForm = () => {
    const today = getNowDate();
    const nowTime = getNowTime();
    const duration = Number(form.appointmentDuration);

    if (!form.date || !form.startTime || !form.endTime) {
      return "Please select date and time";
    }

    if (Number.isNaN(duration) || duration <= 0) {
      return "Appointment duration must be greater than 0";
    }

    if (form.date < today) {
      return "Room date cannot be in the past";
    }

    if (form.date === today && form.startTime <= nowTime) {
      return "Start time must be in the future";
    }

    if (form.endTime <= form.startTime) {
      return "End time must be after start time";
    }

    return "";
  };

  const resetCreateForm = () => {
    setForm({
      adminName: "",
      sector: "",
      organization: "",
      date: "",
      startTime: "",
      endTime: "",
      appointmentDuration: "",
    });
    setSectorOther("");
  };

  const handleCreate = async (e) => {
    e.preventDefault();

    const finalSector = form.sector === "Others" ? sectorOther.trim() : form.sector;
    const validationMessage = validateRoomForm();

    if (validationMessage) {
      setErrorMessage(validationMessage);
      return;
    }

    if (form.sector === "Others" && !finalSector) {
      setErrorMessage("Please enter the sector name");
      return;
    }

    try {
      const payload = {
        ...form,
        sector: finalSector,
        createdBy: email,
      };
      const res = await API.post("/rooms/create", payload);

      setSuccessRoom({
        ...payload,
        roomCode: res.data.roomCode,
        maxAppointments: res.data.maxAppointments,
      });
      saveRoomCode(res.data.roomCode);
      setErrorMessage("");
      resetCreateForm();
      await Promise.all([fetchActiveRooms(), fetchPastRooms()]);
    } catch (err) {
      setErrorMessage(err.response?.data?.message || "Error creating room");
    }
  };

  const endRoom = async (roomId) => {
    try {
      await API.put(`/rooms/end/${roomId}`);
      await Promise.all([fetchActiveRooms(), fetchPastRooms()]);
    } catch (err) {
      console.log(err);
    }
  };

  const endAppointment = async (appointmentId) => {
    try {
      await API.post(`/appointments/end/${appointmentId}`);
      await fetchActiveRooms();
    } catch (err) {
      console.log(err);
    }
  };

  const startAppointment = async (appointmentId) => {
    try {
      await API.post(`/appointments/start/${appointmentId}`);
      await fetchActiveRooms();
    } catch (err) {
      console.log(err);
    }
  };

  const loadPastRoomDetails = async (roomCode) => {
    try {
      const res = await API.get(`/rooms/details/${roomCode}`);
      setPastRoomDetails((prev) => ({
        ...prev,
        [roomCode]: res.data,
      }));
      setSelectedPastRoom((prev) => (prev === roomCode ? null : roomCode));
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <div className="admin-container">
      {continuationModalRoom ? (
        <div className="continuation-modal-backdrop">
          <div className="continuation-modal">
            <p className="continuation-modal-label">Room Time Is Up</p>
            <h3>Continue room till the appointments are completed?</h3>
            <p>
              Room <strong>{continuationModalRoom.roomCode}</strong> reached its scheduled
              end time of{" "}
              <strong>
                {formatClockTime(
                  continuationModalRoom.date,
                  continuationModalRoom.endTime
                )}
              </strong>
              .
            </p>
            <p>
              Pending appointments:{" "}
              <strong>
                {(continuationModalRoom.waitingAppointments?.length || 0) +
                  (continuationModalRoom.inProgressAppointment ? 1 : 0)}
              </strong>
            </p>
            <div className="continuation-modal-actions">
              <button
                className="small-start-btn"
                onClick={() => handleContinueRoom(continuationModalRoom.id)}
              >
                Continue Room
              </button>
              <button
                className="small-end-btn"
                onClick={() => handleCloseRoomAtEndTime(continuationModalRoom.id)}
              >
                End Room
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <h2>Admin Dashboard</h2>

      <div className="admin-blocks">
        <div onClick={() => handleSectionChange("create")} className="block">
          Create Room
        </div>

        <div onClick={() => handleSectionChange("existing")} className="block">
          Existing Room
        </div>

        <div onClick={() => handleSectionChange("past")} className="block">
          View Past Rooms
        </div>
      </div>

      {section === "create" && (
        <div className="card">
          <form onSubmit={handleCreate} className="form-grid">
            <input
              placeholder="Admin Name"
              required
              value={form.adminName}
              onChange={(e) => handleInputChange("adminName", e.target.value)}
            />

            <select
              required
              value={form.sector}
              onChange={(e) => handleInputChange("sector", e.target.value)}
            >
              <option value="">Select Sector</option>
              <option>Healthcare</option>
              <option>Education</option>
              <option>Banking</option>
              <option>Government</option>
              <option>Others</option>
            </select>

            {form.sector === "Others" && (
              <input
                placeholder="Enter Sector"
                required
                value={sectorOther}
                onChange={(e) => setSectorOther(e.target.value)}
              />
            )}

            <input
              placeholder="Organization Name"
              required
              value={form.organization}
              onChange={(e) => handleInputChange("organization", e.target.value)}
            />

            <input
              type="date"
              min={getNowDate()}
              required
              value={form.date}
              onChange={(e) => handleInputChange("date", e.target.value)}
            />

            <input
              type="time"
              required
              value={form.startTime}
              onChange={(e) => handleInputChange("startTime", e.target.value)}
            />

            <input
              type="time"
              required
              value={form.endTime}
              onChange={(e) => handleInputChange("endTime", e.target.value)}
            />

            <input
              type="number"
              min="1"
              placeholder="Appointment Duration (mins)"
              required
              value={form.appointmentDuration}
              onChange={(e) =>
                handleInputChange("appointmentDuration", e.target.value)
              }
            />

            {errorMessage && <p className="form-message error">{errorMessage}</p>}

            <button type="submit" className="create-btn">
              Create Room
            </button>
          </form>

          {successRoom && (
            <div className="success-box">
              <h3>Room Created Successfully</h3>
              <p>
                Room Code: <strong>{successRoom.roomCode}</strong>
              </p>
              <p>
                Max Appointments: <strong>{successRoom.maxAppointments}</strong>
              </p>
              <QRCodeCanvas value={getRoomJoinUrl(successRoom.roomCode)} size={150} />
            </div>
          )}
        </div>
      )}

      {section === "existing" && (
        <div className="card">
          {activeRooms.length === 0 ? (
            <p>No Active Rooms</p>
          ) : (
            activeRooms.map((room) => (
              <div key={room.id} className="room-card">
                {(() => {
                  const completedAppointments = (room.appointments || []).filter(
                    (appointment) => appointment.status === "completed"
                  );
                  const waitingOffset = completedAppointments.length;
                  const pendingCount =
                    (room.waitingAppointments?.length || 0) +
                    (room.inProgressAppointment ? 1 : 0);
                  const scheduledEndTime = formatClockTime(room.date, room.endTime);

                  return (
                    <>
                <div className="room-header">
                  <div>
                    <h3>{room.organization}</h3>
                    <p>
                      <strong>Admin:</strong> {room.adminName}
                    </p>
                    <p>
                      <strong>Room Code:</strong> {room.roomCode}
                    </p>
                    <p>
                      <strong>Date:</strong> {room.date}
                    </p>
                    <p>
                      <strong>Appointments:</strong> {room.appointmentCount}
                    </p>
                    <p>
                      <strong>Capacity:</strong> {room.maxAppointments}
                    </p>
                  </div>

                  <div className="qr-wrapper">
                    <QRCodeCanvas value={getRoomJoinUrl(room.roomCode)} size={150} />
                  </div>
                </div>

                <div className="appointments-list">
                  <h4>Queue</h4>
                  <p className="queue-note">
                    Actual appointment time is tracked from when you click Start to when
                    you click End, so it can be shorter or longer than the planned duration.
                  </p>

                  {room.requiresContinuationDecision ? (
                    <div className="continuation-alert">
                      <p>
                        This room reached its scheduled end time of {scheduledEndTime}.
                        {" "}There {pendingCount === 1 ? "is" : "are"} {pendingCount} pending
                        {" "}appointment{pendingCount === 1 ? "" : "s"}. Continue for up to
                        {" "}24 more hours or end the room now.
                      </p>
                      <div className="appointment-actions">
                        <button
                          className="small-start-btn"
                          onClick={async () => {
                            try {
                              await API.put(`/rooms/continue/${room.id}`);
                              await Promise.all([fetchActiveRooms(), fetchPastRooms()]);
                            } catch (err) {
                              console.log(err);
                            }
                          }}
                        >
                          Continue
                        </button>
                        <button
                          className="small-end-btn"
                          onClick={() => endRoom(room.id)}
                        >
                          End Room
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {completedAppointments.length ? (
                    completedAppointments.map((appointment, index) => (
                      <div key={appointment.id} className="appointment-card">
                        <div>
                          <strong>
                            {index + 1}. {appointment.userName}
                          </strong>
                          <p>{appointment.phone}</p>
                          <p>Completed at {formatCompletedTime(appointment.completedAt)}</p>
                          <p className="appointment-status-text">Status: Completed</p>
                        </div>

                        <span className="queue-badge queue-badge-completed">
                          Completed
                        </span>
                      </div>
                    ))
                  ) : null}

                  {room.inProgressAppointment ? (
                    <div className="appointment-card appointment-card-active">
                      <div>
                        <strong>
                          {waitingOffset + 1}. {room.inProgressAppointment.userName}
                        </strong>
                        <p>{room.inProgressAppointment.phone}</p>
                        <p>
                          Started at{" "}
                          {room.inProgressAppointment.actualStartTime
                            ? new Date(
                                room.inProgressAppointment.actualStartTime
                              ).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "Just now"}
                        </p>
                        <p className="appointment-status-text">Status: In Progress</p>
                      </div>

                      <div className="appointment-actions">
                        <button className="small-start-btn" disabled>
                          Start
                        </button>
                        <button
                          className="small-end-btn"
                          onClick={() => endAppointment(room.inProgressAppointment.id)}
                        >
                          End
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {room.waitingAppointments?.length ? (
                    room.waitingAppointments.map((appointment, index) => (
                      <div key={appointment.id} className="appointment-card">
                        <div>
                          <strong>
                            {index + waitingOffset + (room.inProgressAppointment ? 2 : 1)}.{" "}
                            {appointment.userName}
                          </strong>
                          <p>{appointment.phone}</p>
                          <p>
                            {appointment.estimatedTime}
                            {appointment.delayMinutes > 0
                              ? ` (Delayed by ${appointment.delayMinutes} min)`
                              : ""}
                          </p>
                        </div>

                        {index === 0 && !room.inProgressAppointment ? (
                          <div className="appointment-actions">
                            <button
                              className="small-start-btn"
                              onClick={() => startAppointment(appointment.id)}
                            >
                              Start
                            </button>
                            <button className="small-end-btn" disabled>
                              End
                            </button>
                          </div>
                        ) : (
                          <span className="queue-badge">Waiting</span>
                        )}
                      </div>
                    ))
                  ) : (
                    <p>
                      {room.inProgressAppointment
                        ? "No more appointments waiting"
                        : "No appointments joined yet"}
                    </p>
                  )}

                </div>

                <div className="end-room-container">
                  <button
                    className="end-room-btn"
                    onClick={() => endRoom(room.id)}
                  >
                    End Room
                  </button>
                </div>
                    </>
                  );
                })()}
              </div>
            ))
          )}
        </div>
      )}

      {section === "past" && (
        <div className="card">
          {pastRooms.length === 0 ? (
            <p>No Past Rooms</p>
          ) : (
            pastRooms.map((room) => (
              <div key={room.id} className="room-card">
                <h4>{room.organization}</h4>
                <p>
                  <strong>Admin Name:</strong> {room.adminName}
                </p>
                <p>
                  <strong>Room Code:</strong> {room.roomCode}
                </p>
                <p>
                  <strong>Date:</strong> {room.date}
                </p>
                <p>
                  <strong>No. of Appointments:</strong> {room.appointmentCount}
                </p>
                <button
                  className="small-end-btn"
                  onClick={() => loadPastRoomDetails(room.roomCode)}
                >
                  View Details
                </button>

                {selectedPastRoom === room.roomCode && pastRoomDetails[room.roomCode] && (
                  <div className="appointments-list">
                    <h4>Appointment Details</h4>
                    <p>{pastRoomDetails[room.roomCode].roomMessage}</p>

                    {pastRoomDetails[room.roomCode].appointments.length === 0 ? (
                      <p>No appointments available</p>
                    ) : (
                      pastRoomDetails[room.roomCode].appointments.map((appointment, index) => (
                        <div key={appointment.id} className="appointment-card">
                          <div>
                            <strong>
                              {index + 1}. {appointment.userName}
                            </strong>
                            <p>Phone: {appointment.phone}</p>
                            <p>Email: {appointment.email || "Not provided"}</p>
                            <p>Date: {appointment.appointmentDate}</p>
                            <p>
                              Time Taken:{" "}
                              {appointment.actualDurationMinutes
                                ? `${appointment.actualDurationMinutes} mins`
                                : "Not completed"}
                            </p>
                            <p>Status: {appointment.outcome}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default AdminHome;
