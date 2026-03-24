import { useEffect, useRef, useState } from "react";
import API from "../services/api";
import "./userHome.css";

const parseRoomCodeValue = (value = "") => {
  const trimmedValue = String(value || "").trim();

  if (!trimmedValue) {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedValue);
    const queryRoomCode = parsedUrl.searchParams.get("roomCode");

    if (queryRoomCode) {
      return queryRoomCode.trim().toUpperCase();
    }

    const lastPathSegment = parsedUrl.pathname.split("/").filter(Boolean).at(-1);
    return String(lastPathSegment || "").trim().toUpperCase();
  } catch {
    return trimmedValue.toUpperCase();
  }
};

function UserHome() {
  const [section, setSection] = useState("join");
  const [joinMethod, setJoinMethod] = useState("code");
  const [joinForm, setJoinForm] = useState({
    roomCode: "",
    userName: "",
    phone: "",
    email: "",
  });
  const [trackedAppointment, setTrackedAppointment] = useState(() => ({
    roomCode: localStorage.getItem("trackedRoomCode") || "",
    userName: localStorage.getItem("trackedUserName") || "",
    phone: localStorage.getItem("trackedPhone") || "",
    email: localStorage.getItem("trackedEmail") || "",
  }));
  const [queue, setQueue] = useState([]);
  const [joinedMessage, setJoinedMessage] = useState("");
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [scannerMessage, setScannerMessage] = useState("");
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(true);
  const [cameraPermissionError, setCameraPermissionError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    const roomCodeFromUrl = new URLSearchParams(window.location.search).get("roomCode");

    if (!roomCodeFromUrl) {
      return;
    }

    const parsedRoomCode = parseRoomCodeValue(roomCodeFromUrl);

    if (!parsedRoomCode) {
      return;
    }

    setSection("join");
    setJoinMethod("code");
    setJoinForm((prev) =>
      prev.roomCode === parsedRoomCode
        ? prev
        : {
            ...prev,
            roomCode: parsedRoomCode,
          }
    );
  }, []);

  useEffect(() => {
    if (!scannerActive) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }

      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    }
  }, [scannerActive]);

  useEffect(
    () => () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    },
    []
  );

  const fetchQueue = async (code = trackedAppointment.roomCode) => {
    const trimmedCode = (code || "").trim().toUpperCase();

    if (!trimmedCode) {
      setQueue([]);
      setStatusMessage("");
      return;
    }

    try {
      const res = await API.get(`/appointments/${trimmedCode}`, {
        params: {
          phone: trackedAppointment.phone,
          email: trackedAppointment.email,
        },
      });
      setQueue(res.data?.queue || []);
      setStatusMessage(res.data?.message || "");
      setError("");
    } catch (err) {
      setQueue([]);
      setStatusMessage("");
      setError(err.response?.data?.message || "No Queue Found");
    }
  };

  useEffect(() => {
    if (!trackedAppointment.roomCode) return undefined;

    const loadQueue = async () => {
      try {
        const res = await API.get(
          `/appointments/${trackedAppointment.roomCode.trim().toUpperCase()}`,
          {
            params: {
              phone: trackedAppointment.phone,
              email: trackedAppointment.email,
            },
          }
        );
        setQueue(res.data?.queue || []);
        setStatusMessage(res.data?.message || "");
      } catch (err) {
        setQueue([]);
        setStatusMessage("");
        setError(err.response?.data?.message || "No Queue Found");
      }
    };

    loadQueue();

    const intervalId = setInterval(() => {
      loadQueue();
    }, 5000);

    return () => clearInterval(intervalId);
  }, [trackedAppointment.roomCode, trackedAppointment.phone, trackedAppointment.email]);

  const handleJoinInputChange = (field, value) => {
    setJoinForm((prev) => ({
      ...prev,
      [field]: field === "roomCode" ? parseRoomCodeValue(value) : value,
    }));
  };

  const stopScanner = () => {
    setScannerActive(false);
  };

  const handleScanResult = (scannedValue) => {
    const parsedRoomCode = parseRoomCodeValue(scannedValue);

    if (!parsedRoomCode) {
      setScannerMessage("QR scanned, but no room code was found.");
      return;
    }

    setJoinForm((prev) => ({
      ...prev,
      roomCode: parsedRoomCode,
    }));
    setScannerMessage(`Room code ${parsedRoomCode} captured successfully.`);
    setCameraPermissionError("");
    stopScanner();
  };

  const startScanner = async () => {
    if (
      typeof window === "undefined" ||
      !("mediaDevices" in navigator) ||
      !("getUserMedia" in navigator.mediaDevices)
    ) {
      setScannerSupported(false);
      setCameraPermissionError(
        "Camera scanning is not supported on this device. Use your phone camera app or enter the room code."
      );
      return;
    }

    if (!("BarcodeDetector" in window)) {
      setScannerSupported(false);
      setCameraPermissionError(
        "This browser does not support in-app QR scanning. Use your phone camera app to open the QR link or enter the room code."
      );
      return;
    }

    try {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      streamRef.current = stream;
      setScannerSupported(true);
      setCameraPermissionError("");
      setScannerMessage("Point the camera at the room QR code.");
      setScannerActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const scanFrame = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          animationFrameRef.current = requestAnimationFrame(scanFrame);
          return;
        }

        try {
          const detectedCodes = await detector.detect(videoRef.current);

          if (detectedCodes.length > 0) {
            handleScanResult(detectedCodes[0].rawValue);
            return;
          }
        } catch (scanError) {
          setCameraPermissionError(
            scanError.message || "Unable to scan the QR code right now."
          );
          stopScanner();
          return;
        }

        animationFrameRef.current = requestAnimationFrame(scanFrame);
      };

      animationFrameRef.current = requestAnimationFrame(scanFrame);
    } catch (scanError) {
      setCameraPermissionError(
        scanError.message ||
          "Camera access was blocked. Please allow camera access or enter the room code manually."
      );
      stopScanner();
    }
  };

  const handleJoin = async (e) => {
    e.preventDefault();
    setJoinedMessage("");
    setError("");

    const cleanRoomCode = parseRoomCodeValue(joinForm.roomCode);
    const cleanName = joinForm.userName.trim();
    const cleanPhone = joinForm.phone.trim();
    const cleanEmail = joinForm.email.trim().toLowerCase();

    if (!cleanRoomCode || !cleanName || !cleanPhone || !cleanEmail) {
      setError("All fields are required");
      return;
    }

    try {
      const res = await API.post("/appointments/join", {
        roomCode: cleanRoomCode,
        userName: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
      });

      const nextTrackedAppointment = {
        roomCode: cleanRoomCode,
        userName: cleanName,
        phone: cleanPhone,
        email: cleanEmail,
      };

      localStorage.setItem("trackedRoomCode", cleanRoomCode);
      localStorage.setItem("trackedUserName", cleanName);
      localStorage.setItem("trackedPhone", cleanPhone);
      localStorage.setItem("trackedEmail", cleanEmail);

      setTrackedAppointment(nextTrackedAppointment);
      setQueue(res.data.queue || []);
      setStatusMessage(res.data?.message || "");
      setJoinedMessage("Joined successfully");
      setJoinForm({
        roomCode: "",
        userName: "",
        phone: "",
        email: "",
      });
      setSection("view");
    } catch (err) {
      if (err.response?.data?.alreadyJoined) {
        const nextTrackedAppointment = {
          roomCode: cleanRoomCode,
          userName: cleanName,
          phone: cleanPhone,
          email: cleanEmail,
        };

        localStorage.setItem("trackedRoomCode", cleanRoomCode);
        localStorage.setItem("trackedUserName", cleanName);
        localStorage.setItem("trackedPhone", cleanPhone);
        localStorage.setItem("trackedEmail", cleanEmail);

        setTrackedAppointment(nextTrackedAppointment);
        setQueue(err.response.data.queue || []);
        setStatusMessage(err.response.data?.message || "");
        setError(err.response.data.message);
        setSection("view");
        return;
      }

      setError(err.response?.data?.message || "Unable to join room");
    }
  };

  const visibleQueue = (() => {
    const currentIndex = queue.findIndex(
      (person) => person.phone === trackedAppointment.phone
    );

    if (currentIndex === -1) {
      return queue;
    }

    return queue.slice(0, currentIndex + 1);
  })();

  return (
    <div className="user-container">
      <h2>User Dashboard</h2>

      <div className="user-blocks">
        <div
          onClick={() => {
            setSection("join");
            setError("");
          }}
          className="block"
        >
          Join Room
        </div>

        <div
          onClick={() => {
            setSection("view");
            fetchQueue();
          }}
          className="block"
        >
          View Room
        </div>
      </div>

      {section === "join" && (
        <div className="card">
          <div className="join-methods">
            <button
              type="button"
              className={`join-method-btn ${joinMethod === "code" ? "active" : ""}`}
              onClick={() => {
                setJoinMethod("code");
                setScannerMessage("");
                setCameraPermissionError("");
                stopScanner();
              }}
            >
              Enter Room Code
            </button>

            <button
              type="button"
              className={`join-method-btn ${joinMethod === "scan" ? "active" : ""}`}
              onClick={() => {
                setJoinMethod("scan");
                setError("");
                setJoinedMessage("");
              }}
            >
              Scan QR
            </button>
          </div>

          {joinMethod === "scan" && (
            <div className="scan-panel">
              <p className="scan-copy">
                Scan the admin QR on your phone, or use your camera here to fill the room
                code automatically.
              </p>

              <div className="scan-actions">
                <button type="button" className="join-btn" onClick={startScanner}>
                  {scannerActive ? "Scanning..." : "Start Camera Scan"}
                </button>

                {scannerActive && (
                  <button type="button" className="secondary-btn" onClick={stopScanner}>
                    Stop Scan
                  </button>
                )}
              </div>

              <div className="scanner-shell">
                {scannerActive ? (
                  <video ref={videoRef} className="scanner-video" playsInline muted />
                ) : (
                  <div className="scanner-placeholder">
                    Open the camera to scan the live room QR.
                  </div>
                )}
              </div>

              {!scannerSupported && (
                <p className="error-message">
                  This browser does not support in-app QR scanning yet.
                </p>
              )}

              {scannerMessage && <p className="success">{scannerMessage}</p>}
              {cameraPermissionError && (
                <p className="error-message">{cameraPermissionError}</p>
              )}
            </div>
          )}

          <form onSubmit={handleJoin} className="form-grid">
            <input
              placeholder={
                joinMethod === "scan"
                  ? "Room Code auto-fills after scan or paste QR link"
                  : "Enter Room Code"
              }
              required
              value={joinForm.roomCode}
              onChange={(e) => handleJoinInputChange("roomCode", e.target.value)}
            />

            <input
              placeholder="Your Name"
              required
              value={joinForm.userName}
              onChange={(e) => handleJoinInputChange("userName", e.target.value)}
            />

            <input
              placeholder="Phone Number"
              required
              value={joinForm.phone}
              onChange={(e) => handleJoinInputChange("phone", e.target.value)}
            />

            <input
              type="email"
              placeholder="Email Address"
              required
              value={joinForm.email}
              onChange={(e) => handleJoinInputChange("email", e.target.value)}
            />

            <button type="submit" className="join-btn">
              Join Queue
            </button>
          </form>

          {joinedMessage && <p className="success">{joinedMessage}</p>}
          {error && <p className="error-message">{error}</p>}
        </div>
      )}

      {section === "view" && (
        <div className="card">
          {!trackedAppointment.roomCode ? (
            <p>Join a room first to track your appointment.</p>
          ) : (
            <>
              <div className="tracking-box">
                <p>
                  <strong>Tracking Room:</strong> {trackedAppointment.roomCode}
                </p>
                <p>
                  <strong>Name:</strong> {trackedAppointment.userName}
                </p>
                <p>
                  <strong>Email:</strong> {trackedAppointment.email}
                </p>
              </div>

              {error && <p className="error-message">{error}</p>}
              {statusMessage && (
                <p
                  className={
                    statusMessage.toLowerCase().includes("completed")
                      ? "success"
                      : "error-message"
                  }
                >
                  {statusMessage}
                </p>
              )}

              {statusMessage.toLowerCase().includes("completed") ||
              statusMessage.toLowerCase().includes("room ended") ? null : visibleQueue.length === 0 ? (
                <p>No Queue Found</p>
              ) : (
                <table className="queue-table">
                  <thead>
                    <tr>
                      <th>S.No</th>
                      <th>Name</th>
                      <th>Estimated Time</th>
                    </tr>
                  </thead>

                  <tbody>
                    {visibleQueue.map((person, index) => (
                      <tr
                        key={person.id}
                        className={
                          person.phone === trackedAppointment.phone
                            ? "highlight-row"
                            : ""
                        }
                      >
                        <td>{index + 1}</td>
                        <td>{person.userName}</td>
                        <td>
                          {person.estimatedTime}
                          {person.delayMinutes > 0
                            ? ` (Delayed by ${person.delayMinutes} min)`
                            : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default UserHome;
