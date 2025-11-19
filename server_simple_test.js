// server_simple_test.js
const express = require("express");
const cors = require("cors");
const PORT = 4000; // Dùng port 4000

const app = express();

console.log(">>> Simple Server: Setting up middleware...");
app.use(cors());
console.log(">>> Simple Server: CORS applied.");
app.use(express.json());
console.log(">>> Simple Server: JSON applied.");

console.log(">>> Simple Server: Defining routes...");

// Chỉ route search (trả về dữ liệu giả)
app.get("/api/games/search", (req, res) => {
  console.log(">>> SIMPLE SEARCH ROUTE HIT <<<"); // Log quan trọng nhất
  const query = req.query.q;
  console.log(`Simple search query: "${query}"`);
  res.json([{ name: `Fake result for ${query}` }]); // Trả về JSON giả
});

// Bắt lỗi cuối cùng
app.use((err, req, res, next) => {
  console.error("!!! SIMPLE UNHANDLED ERROR:", err.stack || err);
  res.status(500).send("Simple Server Broke!");
});

app.listen(PORT, () => {
  console.log(`Simple API Server đang chạy tại http://localhost:${PORT}`);
});
