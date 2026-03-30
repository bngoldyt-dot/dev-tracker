const ApiError = require("../../../../utils/apiErrors");
const jwt = require('jsonwebtoken')
const { registerSchema } = require("../../schemas/auth.schema");
const {registerdev, otpToCreatAcc} = require("../../services/auth.service");

const register = async (req, res, next) => {
  try {
    const { error } = registerSchema.validate(req.body);
    if (error) return next(new ApiError(400, error.details[0].message));
    const { name, email, password } = req.body;
    const token = await registerdev(name, email, password);
    res.status(201).json({
      otpMessage:'please check youe email , otp was sent to your email',
      token
    });
  } catch (err) {
    next(err);
  }
};

const creatAccount = async (req , res , next) => {
  try {
    const { otp, token } = req.body; 
    const developer = await otpToCreatAcc(otp, token);
    
    res.status(200).json({
      message: "Account created",
      id: developer._id, 
      name: developer.name, 
      email: developer.email, 
      role: developer.role,
      subscription: developer.subscription 
    })
  } catch (error) {
    next(error)
  }
}

module.exports = {register , creatAccount}; 