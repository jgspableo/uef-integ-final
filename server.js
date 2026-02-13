const express = require("express");
const path = require("path");
const app = express();

// 1. Middleware to parse the "POST" data Blackboard sends
// This fixes the "405 Method Not Allowed" error you were getting on the static site.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 2. Serve static files (css, js, images) from the 'public' folder
app.use(express.static(path.join(__dirname, "public")));

// 3. The LTI Launch Route
// Blackboard will send a POST request to https://your-app.onrender.com/launch
app.post("/launch", (req, res) => {
  console.log("-------------------------------------------------------");
  console.log("Blackboard has initiated an LTI Launch!");
  console.log("Timestamp:", new Date().toISOString());
  // You can see the data Blackboard sent in the Render logs if needed:
  // console.log("Launch Body:", req.body);
  console.log("-------------------------------------------------------");

  // Serve the HTML file that triggers the widget
  res.sendFile(path.join(__dirname, "public", "launch.html"));
});

// 4. Default route (optional, just to check if the server is running)
app.get("/", (req, res) => {
  res.send("UEF Shim is running! Point your LTI tool to /launch");
});

// 5. Start the server on the port Render provides
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
