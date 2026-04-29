const User = require("../models/User");
const bcrypt = require("bcryptjs");

const getAllUsers = async (req, res) => {
  try {
    const { startYear, endYear, startMonth, endMonth, startDay, endDay } = req.query;
    let query = {};

    if (startYear || endYear || startMonth || endMonth || startDay || endDay) {
      const startDate = new Date(2024, 0, 1, 0, 0, 0, 0);
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);

      if (startYear) startDate.setFullYear(parseInt(startYear));
      if (startMonth) startDate.setMonth(parseInt(startMonth) - 1);
      if (startDay) startDate.setDate(parseInt(startDay));
      startDate.setHours(0, 0, 0, 0);

      if (endYear) endDate.setFullYear(parseInt(endYear));
      if (endMonth) endDate.setMonth(parseInt(endMonth) - 1);
      if (endDay) endDate.setDate(parseInt(endDay));
      endDate.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: startDate, $lte: endDate };
    }

    const users = await User.find(query, "-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách người dùng:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const toggleAdminStatus = async (req, res) => {
  try {
    const userToUpdate = await User.findById(req.params.id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    if (userToUpdate._id.equals(req.user._id)) {
      return res
        .status(400)
        .json({ message: "Không thể tự tước quyền admin của chính mình." });
    }

    userToUpdate.isAdmin = !userToUpdate.isAdmin;
    await userToUpdate.save();

    const updatedUser = userToUpdate.toObject();
    delete updatedUser.password;

    res.json(updatedUser);
  } catch (error) {
    console.error("Lỗi khi thay đổi quyền admin:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    if (req.body.name) {
      user.name = req.body.name;
    }

    // Nếu có file upload từ Cloudinary (req.file)
    if (req.file && req.file.path) {
      user.avatar = req.file.path;
    } 
    // Nếu truyền lên một avatar URL dạng text
    else if (req.body.avatar) {
      user.avatar = req.body.avatar;
    }

    // Đổi mật khẩu
    if (req.body.newPassword) {
      // Nếu user đăng ký qua Google, có thể không có pass hoặc là pass random.
      // Do đó nếu họ muốn đặt mật khẩu, họ có thể cần currentPassword nếu họ tạo tài khoản bình thường.
      if (!req.body.currentPassword && user.password) {
        return res.status(400).json({ message: "Vui lòng nhập mật khẩu hiện tại" });
      }
      
      if (req.body.currentPassword) {
        const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
        if (!isMatch) {
          return res.status(400).json({ message: "Mật khẩu hiện tại không đúng" });
        }
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(req.body.newPassword, salt);
    }

    await user.save();

    res.json({
      message: "Cập nhật hồ sơ thành công",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật hồ sơ:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật hồ sơ" });
  }
};

module.exports = {
  getAllUsers,
  toggleAdminStatus,
  updateUserProfile
};
