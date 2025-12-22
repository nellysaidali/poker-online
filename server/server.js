const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();

/* =====================
   CORS
===================== */

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",

  // FRONT Render (statique)
  "https://poker-online-1.onrender.com",
];

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl / postman
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error("CORS blocked: " + origin));
  },
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

/* =====================
   HTTP SERVER
===================== */

const server = http.createServer(app);

/* =====================
   SOCKET.IO
===================== */

const io = new Server(server, {
  cors: corsOptions,
  transports: ["polling", "websocket"], // IMPORTANT pour Render
});

/* =====================
   ROUTES HTTP
===================== */

app.get("/", (req, res) => {
  res.send("Poker server OK");
});

/* =====================
   SOCKET EVENTS
===================== */

io.on("connection", (socket) => {
  console.log("Client connecté :", socket.id);

  socket.on("disconnect", () => {
    console.log("Client déconnecté :", socket.id);
  });

  // TEST SIMPLE
  socket.on("ping:test", (cb) => {
    cb({ ok: true });
  });

  // 👉 tes vrais handlers (room:create, game:startHand, etc.)
});

/* =====================
   START
===================== */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Server running on", PORT);
});
