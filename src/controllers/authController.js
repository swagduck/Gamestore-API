const User = require("../models/User");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
  maxAge: 60 * 60 * 1000 // 1 hour
};

const register = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ message: "Email và mật khẩu (ít nhất 6 ký tự) là bắt buộc." });
  }
  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) return res.status(400).json({ message: "Email này đã được đăng ký." });
    
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    const newUser = new User({ email: email.toLowerCase(), password: hashedPassword, isAdmin: false });
    const savedUser = await newUser.save();
    
    const token = jwt.sign(
      { userId: savedUser._id, email: savedUser.email, isAdmin: savedUser.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.cookie('token', token, cookieOptions).status(201).json({
      message: "Đăng ký thành công!",
      user: { id: savedUser._id, email: savedUser.email, isAdmin: savedUser.isAdmin },
    });
  } catch (error) {
    console.error("Lỗi đăng ký:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đăng ký." });
  }
};

const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Vui lòng cung cấp email và mật khẩu." });
  
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(400).json({ message: "Email hoặc mật khẩu không đúng." });
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Email hoặc mật khẩu không đúng." });
    
    const token = jwt.sign(
      { userId: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.cookie('token', token, cookieOptions).json({
      message: "Đăng nhập thành công!",
      user: { id: user._id, email: user.email, isAdmin: user.isAdmin },
    });
  } catch (error) {
    console.error("Lỗi đăng nhập:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đăng nhập." });
  }
};

const googleLogin = async (req, res) => {
  try {
    const { token } = req.body;
    const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!googleResponse.ok) throw new Error('Google token invalid or expired');
    
    const payload = await googleResponse.json();
    const { sub: googleId, email, name, picture } = payload;
    let user = await User.findOne({ email });

    if (!user) {
      const randomPassword = await bcrypt.hash(Math.random().toString(36).slice(-8) + Date.now().toString(), 10);
      user = new User({ name, email, password: randomPassword, googleId, isAdmin: false });
      await user.save();
    } else {
      if (!user.googleId) {
        user.googleId = googleId;
        await user.save();
      }
    }

    const gamestoreToken = jwt.sign(
      { userId: user._id, email: user.email, isAdmin: user.isAdmin },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.cookie('token', gamestoreToken, cookieOptions).json({
      message: "Đăng nhập bằng Google thành công!",
      user: { id: user._id, email: user.email, isAdmin: user.isAdmin, name: user.name, avatar: picture },
    });
  } catch (error) {
    console.error("Lỗi xác thực Google:", error);
    res.status(401).json({ message: "Xác thực Google thất bại. Token không hợp lệ hoặc đã hết hạn." });
  }
};

const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ message: "Vui lòng cung cấp email." });
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng với email này." });

    const resetToken = crypto.randomBytes(20).toString("hex");
    user.resetPasswordToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    await user.save();

    console.log(`[Mock Email] Password reset token for ${email}: ${resetToken}`);
    res.status(200).json({ message: "Email khôi phục mật khẩu đã được gửi (Vui lòng kiểm tra console log trong development để lấy token)." });
  } catch (error) {
    console.error("Lỗi quên mật khẩu:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi xử lý quên mật khẩu." });
  }
};

const resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body;
  if (!resetToken || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: "Token không hợp lệ hoặc mật khẩu phải trên 6 ký tự." });
  }
  try {
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: "Token khôi phục không hợp lệ hoặc đã hết hạn." });

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ message: "Mật khẩu đã được cập nhật thành công!" });
  } catch (error) {
    console.error("Lỗi đặt lại mật khẩu:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đặt lại mật khẩu." });
  }
};

const logout = (req, res) => {
  res.clearCookie('token', cookieOptions).json({ message: 'Đã đăng xuất thành công' });
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'Không tìm thấy người dùng' });
    res.json({ user: { id: user._id, email: user.email, isAdmin: user.isAdmin, name: user.name } });
  } catch (error) {
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
};

module.exports = { register, login, googleLogin, forgotPassword, resetPassword, logout, getMe };
