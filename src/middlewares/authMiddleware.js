const jwt = require("jsonwebtoken");
const User = require("../models/User");

const verifyToken = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ message: "Không có token, không được phép truy cập" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { 
      _id: decoded.userId,
      isAdmin: decoded.isAdmin // Ensure isAdmin is available
    };
    next();
  } catch (error) {
    res.status(401).json({ message: "Token không hợp lệ" });
  }
};

const verifyAdmin = async (req, res, next) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ message: "Không có token, không được phép truy cập" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: "Yêu cầu quyền admin" });
    }

    req.user = user; // Gắn thông tin user vào request
    next();
  } catch (error) {
    res.status(401).json({ message: "Token không hợp lệ" });
  }
};

module.exports = { verifyToken, verifyAdmin };
