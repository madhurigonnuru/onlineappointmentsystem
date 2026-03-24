import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Login from "./pages/login";
import Register from "./pages/Register";
import AdminHome from "./pages/AdminHome";
import UserHome from "./pages/UserHome";
import "./App.css";


function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/admin-home" element={<AdminHome />} />
        <Route path="/user-home" element={<UserHome />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;