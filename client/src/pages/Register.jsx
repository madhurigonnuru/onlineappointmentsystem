import { useState } from "react";
import API from "../services/api";
import { useNavigate } from "react-router-dom";
import "./Auth.css";

function Register() {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "user",
  });
  const [message, setMessage] = useState("");
  const navigate = useNavigate();

  const validatePassword = (password) => {
    if (!/[a-z]/.test(password)) {
      return "Must contain at least 1 lowercase letter";
    }
    if (!/[A-Z]/.test(password)) {
      return "Must contain at least 1 uppercase letter";
    }
    if (!/[0-9]/.test(password)) {
      return "Must contain at least 1 number";
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
      return "Must contain at least 1 special character";
    }
    if (password.length < 8) {
      return "Must be at least 8 characters long";
    }

    return "";
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("");

    const validationMessage = validatePassword(form.password);

    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }

    if (form.password !== form.confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }

    try {
      await API.post("/auth/register", {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
      });

      setMessage("Registration successful");
      setTimeout(() => navigate("/login"), 1000);
    } catch (err) {
      setMessage(err.response?.data?.message || "Unable to register");
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        <h2>Sign Up</h2>

        <form onSubmit={handleSubmit}>
          <input
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) =>
              setForm({ ...form, name: e.target.value })
            }
          />

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

          <input
            type="password"
            placeholder="Confirm Password"
            required
            value={form.confirmPassword}
            onChange={(e) =>
              setForm({ ...form, confirmPassword: e.target.value })
            }
          />

          <select
            value={form.role}
            onChange={(e) =>
              setForm({ ...form, role: e.target.value })
            }
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>

          {message && (
            <p
              style={{
                color: message.toLowerCase().includes("successful")
                  ? "green"
                  : "red",
                fontSize: "14px",
              }}
            >
              {message}
            </p>
          )}

          <button type="submit">Sign Up</button>
        </form>
      </div>
    </div>
  );
}

export default Register;
