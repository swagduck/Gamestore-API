const Notification = require("../models/Notification");
const User = require("../models/User");

const getNotifications = async (req, res) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    let query = { user: req.user._id };

    if (unreadOnly === "true") {
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .exec();

    const total = await Notification.countDocuments(query);

    res.json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Lỗi khi lấy notifications:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy thông báo." });
  }
};

const markAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Không tìm thấy thông báo." });
    }

    res.json({ message: "Đã đánh dấu đã đọc.", notification });
  } catch (error) {
    console.error("Lỗi khi đánh dấu đã đọc:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
};

const getUnreadCount = async (req, res) => {
  try {
    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      read: false,
    });

    res.json({ unreadCount });
  } catch (error) {
    console.error("Lỗi khi lấy số lượng thông báo:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
};

const createNotification = async (req, res) => {
  try {
    const { userId, type, title, message, data, priority = "medium" } = req.body;

    if (!userId || !type || !title || !message) {
      return res.status(400).json({ message: "UserId, type, title, và message là bắt buộc." });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy user." });
    }

    const notification = new Notification({
      user: userId, type, title, message, data, priority,
    });

    await notification.save();

    res.status(201).json({
      message: "Thông báo đã được tạo.",
      notification,
    });
  } catch (error) {
    console.error("Lỗi khi tạo notification:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi tạo thông báo." });
  }
};

module.exports = {
  getNotifications,
  markAsRead,
  getUnreadCount,
  createNotification
};
