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

const app = express();
const port = process.env.PORT || 3000;

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
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Accept"]
}));

// ==========================================
// 2️⃣ ثاني خطوة: ضبط الـ Helmet عشان يوافق على الـ WebSockets
// ==========================================
app.use(
  helmet({
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

// ✅ ميديليوير الـ webhook والـ json body لسه في مكانه
app.use((req, res, next) => {
  if (req.originalUrl.includes('/webhooks/')) {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json({ limit: "10kb" })(req, res, next);
  }
});

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

// الـ Authentication بتاع السوكيت
io.use((socket, next) => {
  const token = socket.handshake.auth.token;

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