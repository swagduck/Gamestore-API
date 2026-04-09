const User = require("../models/User");

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

module.exports = {
  getAllUsers,
  toggleAdminStatus
};
