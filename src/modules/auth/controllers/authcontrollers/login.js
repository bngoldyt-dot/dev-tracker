const ApiError = require("../../../../utils/apiErrors");
const { loginSchema } = require("../../schemas/auth.schema");
const { logindev, googleLoginDev, githubLoginDev } = require("../../services/auth.service");
const { getCookieOptions } = require("../../../../utils/cookieOptions");

// ─────────────────────────────────────────────
// Standard Email / Password Login
// ─────────────────────────────────────────────
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const { error } = loginSchema.validate(req.body);
    if (error) return next(new ApiError(400, error.details[0].message));

    const { developer, token } = await logindev(email, password);

    // Attach the JWT as an HTTP-only cookie.
    // The token is NOT returned in the body – the browser manages it invisibly.
    res
      .cookie("token", token, getCookieOptions())
      .status(200)
      .json({
        message: "Login successful",
        developer: {
          id: developer._id,
          name: developer.name,
          email: developer.email,
          role: developer.role,
        },
      });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// Google OAuth Login
// Flow: Frontend receives a Google idToken from the Google SDK,
//       sends it here, and we verify + issue our own JWT cookie.
//       No redirect involved – this is a direct API call, so "lax"
//       sameSite is perfectly safe.
// ─────────────────────────────────────────────
const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return next(new ApiError(400, "Google Token is required"));

    const { developer, token } = await googleLoginDev(idToken);

    // Set the secure HTTP-only cookie — token is NOT exposed in the body.
    res
      .cookie("token", token, getCookieOptions())
      .status(200)
      .json({
        message: "Google Login successful",
        developer: {
          id: developer._id,
          name: developer.name,
          email: developer.email,
          role: developer.role,
        },
      });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// GitHub OAuth Login
// Flow: Frontend receives a temporary `code` from GitHub's redirect,
//       sends it here (POST /auth/github), we exchange it for an
//       access token, build our session, and set an HTTP-only cookie.
//
// Cross-origin note:
//   Because the frontend sends the code via a regular fetch/axios POST
//   (not a server-side redirect), the response goes directly back to the
//   browser. sameSite: "lax" works fine — the cookie is created in a
//   first-party context (same origin as the API call).
//   Make sure your frontend uses: `fetch(url, { credentials: "include" })`
// ─────────────────────────────────────────────
const githubLogin = async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) return next(new ApiError(400, "GitHub code is required"));

    const { developer, token } = await githubLoginDev(code);

    // Set the secure HTTP-only cookie — token is NOT exposed in the body.
    res
      .cookie("token", token, getCookieOptions())
      .status(200)
      .json({
        message: "GitHub Login successful",
        developer: {
          id: developer._id,
          name: developer.name,
          email: developer.email,
          role: developer.role,
        },
      });
  } catch (error) {
    next(error);
  }
};

// ─────────────────────────────────────────────
// Logout
// HTTP-only cookies CANNOT be cleared from the client via JavaScript.
// The server must overwrite the cookie with an immediately-expired one.
// ─────────────────────────────────────────────
const logout = (req, res) => {
  // Flags must EXACTLY match the ones used when the cookie was SET,
  // otherwise the browser treats it as a different cookie and ignores the clear.
  // getCookieOptions() guarantees the same sameSite / secure values.
  res
    .cookie("token", "", getCookieOptions({ maxAge: 0 }))
    .status(200)
    .json({ message: "Logged out successfully." });
};

module.exports = { login, googleLogin, githubLogin, logout };
