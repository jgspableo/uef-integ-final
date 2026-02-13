const express = require('express');
const path = require('path');
const app = express();

// 1. Middleware to parse POST data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 2. Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// 3. Define the Logic for the Launch
// We put this in a function so we can use it for both GET and POST
const handleLaunch = (req, res) => {
    console.log("-------------------------------------------------------");
    console.log(`Blackboard Launch received via ${req.method}!`);
    console.log("Timestamp:", new Date().toISOString());
    console.log("-------------------------------------------------------");

    // Serve the HTML file that triggers the widget
    res.sendFile(path.join(__dirname, 'public', 'launch.html'));
};

// 4. The Routes
// Listen for POST (standard LTI)
app.post('/launch', handleLaunch);

// Listen for GET (what Blackboard is currently doing)
app.get('/launch', handleLaunch);

// 5. Default route
app.get('/', (req, res) => {
    res.send('UEF Shim is running! Point your LTI tool to /launch');
});

// 6. Start the server
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
