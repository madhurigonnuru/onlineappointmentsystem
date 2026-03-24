const dotenv = require("dotenv");
const connectDB = require("../config/db");
const Appointment = require("../models/Appointment");
const Room = require("../models/Room");
const User = require("../models/User");

dotenv.config();

const resetDatabase = async () => {
  await connectDB();

  await Promise.all([
    Appointment.deleteMany({}),
    Room.deleteMany({}),
    User.deleteMany({}),
  ]);

  console.log("Supabase/Postgres data cleared: users, rooms, appointments");
  process.exit(0);
};

resetDatabase().catch((error) => {
  console.error("Failed to reset Supabase/Postgres data:", error.message);
  process.exit(1);
});
