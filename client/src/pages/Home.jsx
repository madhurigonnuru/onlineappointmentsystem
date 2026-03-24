import { useNavigate } from "react-router-dom";
import "./Home.css";

function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <div className="card">
        <div className="top-buttons">
          <button onClick={() => navigate("/login")}>Login</button>
          <button onClick={() => navigate("/register")}>Signup</button>
        </div>

        <h1>Welcome to Appointment System</h1>
        <p>Book and manage appointments easily.</p>
      </div>
    </div>
  );
}

export default Home;