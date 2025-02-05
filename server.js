require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const axios = require("axios");
const twilio = require("twilio");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON request bodies
app.use(express.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

// Define Farmer Schema with an updated regular expression to allow an optional +91 prefix.
const farmerSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    // This regex allows an optional '+91' followed by exactly 10 digits.
    match: /^(\+91)?[0-9]{10}$/,
  },
});
const Farmer = mongoose.model("Farmer", farmerSchema);

// Twilio Credentials
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
const client = twilio(accountSid, authToken);

// API Endpoint for Soil Moisture Data
const API_ENDPOINT = "https://iot-backend-6oxx.onrender.com/api/sensor-data/latest";

// Function to get the latest stored farmer's phone number
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
      from: twilioNumber,
      to: to,
    });
    console.log(`📩 SMS Sent to ${to}! Message SID: ${sms.sid}`);
  } catch (error) {
    console.error("❌ Error sending SMS:", error.message);
  }
};

// API Endpoint to update the farmer's phone number
app.post("/api/farmer-number", async (req, res) => {
  let { name, phoneNumber } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({ error: "phoneNumber is required" });
  }

  // Prepend +91 if missing. This does not break validation now because our regex supports both.
  if (!phoneNumber.startsWith("+91")) {
    phoneNumber = `+91${phoneNumber}`;
  }

  try {
    // Use upsert to create a new document or update the existing one.
    await Farmer.findOneAndUpdate(
      {},
      { name, phoneNumber },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ message: "Farmer number updated successfully", name, phoneNumber });
  } catch (error) {
    console.error("❌ Error updating farmer number:", error.message);
    res.status(500).json({ error: "Failed to update farmer number" });
  }
});

// API Endpoint to get the current farmer's phone number
app.get("/api/farmer-number", async (req, res) => {
  try {
    const farmer = await Farmer.findOne();
    if (!farmer) {
      return res.status(404).json({ error: "⚠️ Farmer number is not set" });
    }
    res.json(farmer);
  } catch (error) {
    console.error("❌ Error fetching farmer number:", error.message);
    res.status(500).json({ error: "Failed to retrieve farmer number" });
  }
});

// API Endpoint to manually trigger an SMS with current soil moisture
app.get("/api/trigger-sms", async (req, res) => {
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
    console.error("❌ Error fetching soil moisture for manual SMS:", error.message);
    res.status(500).json({ error: "Failed to fetch soil moisture data" });
  }
});

// **Run an Immediate Check on Startup (Optional)**
checkSoilMoisture();

// **Schedule a Daily Check at 9:00 AM**
cron.schedule("0 9 * * *", () => {
  console.log("⏰ Running daily soil moisture check at 9:00 AM");
  checkSoilMoisture();
});

// **Home Route for Health Check**
app.get("/", (req, res) => {
  res.send("🌍 Twilio SMS Alert Service Running...");
});

// **Start Express Server**
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});