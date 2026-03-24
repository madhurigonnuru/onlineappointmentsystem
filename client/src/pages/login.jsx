import { useEffect, useState } from "react";
import API from "../services/api";
import { useNavigate } from "react-router-dom";
import "./Auth.css";

function Login() {
  const [form, setForm] = useState({
    email: "",
    password: "",
  });
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    localStorage.removeItem("role");
    localStorage.removeItem("email");
    localStorage.removeItem("trackedRoomCode");
    localStorage.removeItem("trackedUserName");
    localStorage.removeItem("trackedPhone");
    localStorage.removeItem("trackedEmail");
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    const email = form.email.trim().toLowerCase();
    const password = form.password;

    if (!email || !password) {
      setMessage("Email and password are required");
      return;
    }

    try {
      const payload = { email, password };
      const res = await API.post("/auth/login", payload);
      const role = res.data.role;

      localStorage.setItem("role", role);
      localStorage.setItem("email", res.data.email);

      setMessage("Login successful");

      setTimeout(() => {
        navigate(role === "admin" ? "/admin-home" : "/user-home");
      }, 800);
    } catch (err) {
      setMessage(
        err.response?.data?.message ||
          "Unable to login. Please check your email and password."
      );
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Login</h2>

        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="Email"
            required
            value={form.email}
            onChange={(e) =>
              setForm({ ...form, email: e.target.value })
            }
          />

          <input
            type="password"
            placeholder="Password"
            required
            value={form.password}
            onChange={(e) =>
              setForm({ ...form, password: e.target.value })
            }
          />

          {message && (
            <p
              style={{
                color: message.toLowerCase().includes("successful")
                  ? "green"
                  : "red",
                fontSize: "14px",
                marginTop: "10px",
              }}
            >
              {message}
            </p>
          )}

          <button type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}

export default Login;
