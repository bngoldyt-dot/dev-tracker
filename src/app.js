const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const dbConnection = require("./config/db");

// استدعاء الـ Routers
const regRouter = require("./modules/auth/routes/auth.routes");
const errorMiddleware = require("./middlewares/error.middleware");
const { projectRouter } = require("./modules/auth/routes/project.routes");
const taskRouter = require("./modules/auth/routes/task.routes");
const TaskActivity = require("./modules/auth/routes/taskActivity.routes");
const { developerRouter } = require("./modules/auth/routes/developer.routes");
const { invitaionsRouter } = require("./modules/auth/routes/invitations.routes");
const subscriptionRouter = require("./modules/subscriptions/routes/subscription.routes");
const feedbackRouter = require("./modules/feedbacks/routers/feedback.routes");
const githubRouter = require("./modules/github/routes/github.routes");
const { onboardingRouter } = require("./modules/onboarding/onboarding.routes");
require('./utils/taskQueue');
const cookieParser = require('cookie-parser');

const app = express();
const port = process.env.PORT || 3000;

app.use(cookieParser());

const ALLOWED_ORIGINS = [
  "http://localhost:4200",
  "https://strong-tartufo-f65dca.netlify.app",        // ← الفرونت إند الحالي المتأكتف
  "https://extraordinary-tartufo-5bfdd1.netlify.app",  // ← الفرونت إند البديل
  "https://dev-tracker-production-3ef3.up.railway.app", // ← الدومين الجديد بتاع ريلواي نفسه
];

// ==========================================
// 1️⃣ أول خطوة: ميديليوير الـ CORS لازم يكون فوق خالص!
// ==========================================
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS policy: origin '${origin}' not allowed`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
}));

// ==========================================
// 2️⃣ ثاني خطوة: ضبط الـ Helmet عشان يوافق على الـ WebSockets
// ==========================================
app.use(
  helmet({
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        // هنا بنقول لهلمت: وافق على اتصالات السوكيت اللي رايحة وجاية للدومينات دي
        connectSrc: ["'self'", "wss://dev-tracker-production-3ef3.up.railway.app", "https://dev-tracker-production-3ef3.up.railway.app", "http://localhost:3000", "ws://localhost:3000"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
  })
);

// ✅ Webhook raw body parser middlewares (MUST be defined before express.json() to prevent body structure destruction)
app.use("/subscribe/webhooks/stripe", express.raw({ type: "*/*" }));
app.use("/github/webhooks/github", express.raw({ type: "*/*" }));

// ✅ Global JSON body parser (Only processes non-webhook routes as they aren't pre-parsed by the raw middleware)
app.use(express.json({ limit: "10kb" }));

app.set('trust proxy', 1);

// ==========================================
// 3️⃣ إعداد سيرفر الـ HTTP والـ Socket.io
// ==========================================
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true // عشان لو فيه توافقية مع إصدارات قديمة من الـ Client
});

global.io = io;

// ── Socket.io Authentication Middleware ───────────────────────────────────
// Tokens now live in HttpOnly cookies. socket.handshake.headers.cookie
// contains the raw "Cookie:" header forwarded by the browser when
// withCredentials: true is set on the client. We parse it manually because
// the Express cookie-parser middleware does NOT run on Socket.io handshakes.
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie || "";

  // Parse: "token=abc123; other=xyz" → find the "token" entry
  const tokenEntry = cookieHeader
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith("token="));

  const token = tokenEntry ? tokenEntry.split("=")[1]?.trim() : null;

  if (!token) {
    return next(new Error("Authentication error: No token provided"));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret_here");
    socket.userId = decoded.id || decoded._id;
    next();
  } catch (err) {
    return next(new Error("Authentication error: Invalid token"));
  }
});

io.on("connection", (socket) => {
  console.log(`User connected securely: ${socket.userId}`);
  socket.join(socket.userId.toString());

  socket.on("disconnect", () => {
    console.log(`User ${socket.userId} disconnected`);
  });
});

// الـ Base Route
app.get("/", (req, res) => {
  res.json({ message: "Hello from secure socket server" });
});

// ==========================================
// 4️⃣ الـ API Routes (جمعتهم تحت الميديليويرز الأساسية)
// ==========================================
app.use('/auth', regRouter);
app.use('/developer', projectRouter);
app.use('/project', taskRouter);
app.use('/activityproject', TaskActivity);
app.use('/developerSettings', developerRouter);
app.use('/invitations', invitaionsRouter);
app.use('/subscribe', subscriptionRouter);
app.use('/feedbacks', feedbackRouter);
app.use('/github', githubRouter);
app.use('/onboarding', onboardingRouter);

// ميديليوير معالجة الأخطاء (بتاع الـ ApiError الكاستم بتاعك)
app.use(errorMiddleware);

// تشغيل السيرفر
server.listen(port, () => {
  console.log(`Server running on port ${port} with SECURE Socket.io support`);
  console.log(`Allowed CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
});

dbConnection();