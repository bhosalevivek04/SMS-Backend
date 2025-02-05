require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const twilio = require("twilio");
const cron = require("node-cron");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Validate environment variables
if (!process.env.MONGO_URI || !process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
  console.error("❌ Missing required environment variables.");
  process.exit(1);
}

// Middleware
app.use(express.json());

// CORS Configuration
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173", // Allow only your frontend's origin
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
    process.exit(1);
  });

// Define Farmer Schema
const farmerSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    match: /^(\+91)?[0-9]{10}$/, // Adjust to match valid phone numbers
  },
});
const Farmer = mongoose.model("Farmer", farmerSchema);

// Twilio Setup
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// API Endpoint for Soil Moisture Data
const API_ENDPOINT = "https://iot-backend-6oxx.onrender.com/api/sensor-data/latest";

// Function to get the latest farmer's phone number
const getFarmerNumber = async () => {
  const farmer = await Farmer.findOne().sort({ _id: -1 });
  return farmer ? farmer.phoneNumber : null;
};

// Function to check soil moisture and send an SMS alert if needed
const checkSoilMoisture = async () => {
  try {
    const response = await axios.get(API_ENDPOINT);
    const { soilmoisture } = response.data;

    console.log(`🌱 Current Soil Moisture: ${soilmoisture}%`);

    const farmerNumber = await getFarmerNumber();
    if (!farmerNumber) {
      console.warn("⚠️ Farmer number is not set. Cannot send SMS.");
      return;
    }

    if (soilmoisture < 30) {
      const message = `🚨 Alert! Soil moisture is too low (${soilmoisture}%). Please irrigate your crops immediately.`;
      await sendSMS(farmerNumber, message);
    } else {
      console.log("✅ Soil moisture is above threshold; no SMS sent.");
    }
  } catch (error) {
    console.error("❌ Error fetching soil moisture data:", error.message);
  }
};

// Function to send SMS using Twilio
const sendSMS = async (to, message) => {
  try {
    const sms = await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: to,
    });
    console.log(`📩 SMS Sent to ${to}! Message SID: ${sms.sid}`);
  } catch (error) {
    console.error("❌ Error sending SMS:", error.message);
  }
};

// API Endpoint to update the farmer's phone number
app.post("/api/farmer-number", async (req, res, next) => {
  try {
    let { name, phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: "phoneNumber is required" });
    }

    if (!phoneNumber.startsWith("+91")) {
      phoneNumber = `+91${phoneNumber}`;
    }

    await Farmer.findOneAndUpdate({}, { name, phoneNumber }, { upsert: true, new: true, runValidators: true });
    res.json({ message: "Farmer number updated successfully", name, phoneNumber });
  } catch (error) {
    next(error);
  }
});

// API Endpoint to get the current farmer's phone number
app.get("/api/farmer-number", async (req, res, next) => {
  try {
    const farmer = await Farmer.findOne();
    if (!farmer) {
      return res.status(404).json({ error: "⚠️ Farmer number is not set" });
    }
    res.json(farmer);
  } catch (error) {
    next(error);
  }
});

// API Endpoint to manually trigger an SMS with current soil moisture
app.get("/api/trigger-sms", async (req, res, next) => {
  try {
    const farmer = await Farmer.findOne();
    if (!farmer) {
      return res.status(404).json({ error: "⚠️ Farmer number is not set" });
    }

    const response = await axios.get(API_ENDPOINT);
    const { soilmoisture } = response.data;

    const message = `📢 Manual SMS Triggered! Current Soil Moisture: ${soilmoisture}%. Please monitor your crops accordingly.`;
    await sendSMS(farmer.phoneNumber, message);

    res.json({ message: "✅ Manual SMS sent successfully with current soil moisture" });
  } catch (error) {
    next(error);
  }
});

// Immediate Check on Startup
// checkSoilMoisture();

// Schedule a Daily Check at 9:00 AM
cron.schedule("0 9 * * *", () => {
  console.log("⏰ Running daily soil moisture check at 9:00 AM");
  checkSoilMoisture();
});

// Home Route for Health Check
app.get("/", (req, res) => {
  res.send("🌍 Twilio SMS Alert Service Running...");
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("❌ Server Error:", err.message);
  res.status(500).json({ error: "Internal Server Error" });
});

// Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});