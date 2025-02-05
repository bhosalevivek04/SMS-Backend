require("dotenv").config();
const express = require("express");
const axios = require("axios");
const twilio = require("twilio");
const cron = require("node-cron");

const app = express();
const PORT = process.env.PORT || 3000;

// Use express.json() to parse JSON request bodies
app.use(express.json());

// Twilio Credentials from .env
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
// Initially, we can set the farmer's phone number from the environment (or null)
let farmerNumber = process.env.FARMER_PHONE_NUMBER || null;

const client = twilio(accountSid, authToken);

// Your API endpoint that provides soil moisture data
const API_ENDPOINT = "https://iot-backend-6oxx.onrender.com/api/sensor-data/latest";
const MOISTURE_THRESHOLD = 30; // Set your threshold value

// Function to check soil moisture and send SMS if needed
const checkSoilMoisture = async () => {
    try {
        const response = await axios.get(API_ENDPOINT);
        const { soilmoisture } = response.data; // use the correct key from your API response
        console.log(`Current Soil Moisture: ${soilmoisture}%`);

        if (soilmoisture < MOISTURE_THRESHOLD) {
            if (!farmerNumber) {
                console.warn("Farmer number is not set. SMS cannot be sent.");
                return;
            }
            const message = `Alert! Soil moisture is too low (${soilmoisture}%). Please irrigate your crops immediately.`;
            await sendSMS(message);
        } else {
            console.log("Soil moisture is above the threshold; no SMS sent.");
        }
    } catch (error) {
        console.error("Error fetching soil moisture data:", error.message);
    }
};

// Function to send SMS using Twilio
const sendSMS = async (message) => {
    try {
        const sms = await client.messages.create({
            body: message,
            from: twilioNumber,
            to: farmerNumber
        });
        console.log(`SMS Sent! Message SID: ${sms.sid}`);
    } catch (error) {
        console.error("Error sending SMS:", error.message);
    }
};

// API Endpoint to update the farmer's phone number
app.post("/api/farmer-number", (req, res) => {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
        return res.status(400).json({ error: "phoneNumber is required" });
    }

    // (Optional) Validate phone number format using regex or a library
    // For now, we'll just set it.
    farmerNumber = phoneNumber;
    console.log(`Farmer's phone number updated to: ${farmerNumber}`);
    res.json({ message: "Farmer number updated successfully", farmerNumber });
});

// API Endpoint to get the current farmer's phone number
app.get("/api/farmer-number", (req, res) => {
    if (!farmerNumber) {
        return res.status(404).json({ error: "Farmer number is not set" });
    }
    res.json({ farmerNumber });
});

// **New Manual Trigger Endpoint**
// This will allow you to manually trigger an SMS
app.get("/api/trigger-sms", async (req, res) => {
    if (!farmerNumber) {
        return res.status(404).json({ error: "Farmer number is not set" });
    }

    const message = "This is a manual SMS test! Please check the soil moisture and take appropriate action.";
    await sendSMS(message);
    
    res.json({ message: "Manual SMS sent successfully" });
});

// Immediately check soil moisture once at startup (optional)
checkSoilMoisture();

// Schedule a daily check at 9:00 AM using node-cron
cron.schedule('0 9 * * *', () => {
    console.log('Running daily soil moisture check at 9:00 AM');
    checkSoilMoisture();
});

// Start Express server (for monitoring or additional endpoints)
app.get("/", (req, res) => {
    res.send("Twilio SMS Alert Service Running...");
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});