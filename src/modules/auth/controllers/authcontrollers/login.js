const ApiError = require("../../../../utils/apiErrors");
const { loginSchema } = require("../../schemas/auth.schema");
const { logindev, googleLoginDev } = require("../../services/auth.service");

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const { error } = loginSchema.validate(req.body);
    if (error) return next(new ApiError(400, error.details[0].message));
    const { developer, token } = await logindev(email, password);
    res.status(200).json({
      message: "Login successful",
      developer: {
        id: developer._id,
        name: developer.name,
        email: developer.email,
        role: developer.role,
      },

      token,
    });
  } catch (error) {
    next(error)
    
  }
};
const googleLogin = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return next(new ApiError(400, "Google Token is required"));

    const { developer, token } = await googleLoginDev (idToken);

    res.status(200).json({
      message: "Google Login successful",
      developer: {
        id: developer._id,
        name: developer.name,
        email: developer.email,
        role: developer.role,
      },
      token,
    });
  } catch (error) { next(error); }
};
module.exports = {login ,googleLogin}; 
