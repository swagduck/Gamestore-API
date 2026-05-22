import { Request, Response, NextFunction } from 'express';
import Notification from "../models/Notification";
import User from "../models/User";

const getNotifications = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, unreadOnly = false } = req.query;
    let query = { user: (req as any).user._id };

    if (unreadOnly === "true") {
      // @ts-ignore - TODO: Fix TS error
      query.read = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      // @ts-ignore - TODO: Fix TS error
      .limit(limit * 1)
      // @ts-ignore - TODO: Fix TS error
      .skip((page - 1) * limit)
      .exec();

    const total = await Notification.countDocuments(query);

    res.json({
      notifications,
      // @ts-ignore - TODO: Fix TS error
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error: any) {
    console.error("Lỗi khi lấy notifications:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy thông báo." });
  }
};

const markAsRead = async (req: Request, res: Response) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: (req as any).user._id },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: "Không tìm thấy thông báo." });
    }

    res.json({ message: "Đã đánh dấu đã đọc.", notification });
  } catch (error: any) {
    console.error("Lỗi khi đánh dấu đã đọc:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
};

const getUnreadCount = async (req: Request, res: Response) => {
  try {
    const unreadCount = await Notification.countDocuments({
      user: (req as any).user._id,
      read: false,
    });

    res.json({ unreadCount });
  } catch (error: any) {
    console.error("Lỗi khi lấy số lượng thông báo:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
};

const markAllAsRead = async (req: Request, res: Response) => {
  try {
    await Notification.updateMany(
      { user: (req as any).user._id, read: false },
      { read: true, readAt: new Date() }
    );
    res.json({ message: "Đã đánh dấu tất cả thông báo là đã đọc." });
  } catch (error: any) {
    console.error("Lỗi khi đánh dấu tất cả đã đọc:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
};

const createNotification = async (req: Request, res: Response) => {
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
  } catch (error: any) {
    console.error("Lỗi khi tạo notification:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi tạo thông báo." });
  }
};

export default {
  getNotifications,
  markAsRead,
  markAllAsRead,
  getUnreadCount,
  createNotification
};
