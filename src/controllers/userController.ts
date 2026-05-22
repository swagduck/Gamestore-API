import { Request, Response, NextFunction } from 'express';
import User from "../models/User";
import bcrypt from "bcryptjs";

const getAllUsers = async (req: any, res: Response) => {
  try {
    const { startYear, endYear, startMonth, endMonth, startDay, endDay } = req.query;
    let query: any = {};

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
  } catch (error: any) {
    console.error("Lỗi khi lấy danh sách người dùng:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const toggleAdminStatus = async (req: any, res: Response) => {
  try {
    const userToUpdate = await User.findById(req.params.id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "Không tìm thấy người dùng." });
    }

    if (userToUpdate._id.equals((req as any).user._id)) {
      return res
        .status(400)
        .json({ message: "Không thể tự tước quyền admin của chính mình." });
    }

    userToUpdate.isAdmin = !userToUpdate.isAdmin;
    await userToUpdate.save();

    const updatedUser = userToUpdate.toObject();
    // @ts-ignore - TODO: Fix TS error
    delete updatedUser.password;

    res.json(updatedUser);
  } catch (error: any) {
    console.error("Lỗi khi thay đổi quyền admin:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const updateUserProfile = async (req: any, res: Response) => {
  try {
    const user: any = await User.findById((req as any).user._id);

    if (!user) {
      return res.status(404).json({ message: "Không tìm thấy người dùng" });
    }

    if (req.body.name) {
      user.name = req.body.name;
    }

    // Nếu có file upload từ Cloudinary (req.file)
    if (req.file && (req as any).file.path) {
      user.avatar = (req as any).file.path;
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
        createdAt: user.createdAt,
        friendCode: user.friendCode,
        exp: user.exp,
        level: user.level,
        achievements: user.achievements
      }
    });
  } catch (error: any) {
    console.error("Lỗi khi cập nhật hồ sơ:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật hồ sơ" });
  }
};

// --- QUẢN LÝ BẠN BÈ ---

// Lấy danh sách bạn bè và lời mời
const getFriends = async (req: any, res: Response) => {
  try {
    const user: any = await User.findById((req as any).user._id)
      .populate('friends', 'name email avatar friendCode')
      .populate('friendRequests', 'name email avatar friendCode')
      .populate('sentRequests', 'name email avatar friendCode');
    
    if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng" });

    res.json({
      friends: user.friends,
      friendRequests: user.friendRequests,
      sentRequests: user.sentRequests
    });
  } catch (error: any) {
    console.error("Lỗi lấy danh sách bạn bè:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Gửi lời mời kết bạn bằng friendCode hoặc userId
const sendFriendRequest = async (req: any, res: Response) => {
  try {
    const { friendCode, userId } = req.body;
    if (!friendCode && !userId) return res.status(400).json({ message: "Vui lòng nhập mã kết bạn hoặc ID người dùng" });

    const currentUser = await User.findById((req as any).user._id);
    let targetUser;

    if (userId) {
      if (currentUser?._id.toString() === userId) {
        return res.status(400).json({ message: "Bạn không thể tự kết bạn với chính mình" });
      }
      targetUser = await User.findById(userId);
    } else {
      if (currentUser?.friendCode === friendCode) {
        return res.status(400).json({ message: "Bạn không thể tự kết bạn với chính mình" });
      }
      targetUser = await User.findOne({ friendCode });
    }

    if (!targetUser) return res.status(404).json({ message: "Không tìm thấy người dùng" });

    // Kiểm tra xem đã là bạn bè chưa
    if ((currentUser as any).friends.includes(targetUser._id)) {
      return res.status(400).json({ message: "Hai bạn đã là bạn bè" });
    }

    // Kiểm tra xem đã gửi lời mời chưa
    if ((currentUser as any).sentRequests.includes(targetUser._id)) {
      return res.status(400).json({ message: "Bạn đã gửi lời mời kết bạn cho người này rồi" });
    }

    // Kiểm tra xem người kia có đang gửi lời mời cho mình không
    if (currentUser?.friendRequests.includes(targetUser._id)) {
      return res.status(400).json({ message: "Người này đã gửi lời mời cho bạn, vui lòng kiểm tra danh sách lời mời" });
    }

    // Cập nhật Database
    (currentUser as any).sentRequests.push(targetUser._id);
    // @ts-ignore - TODO: Fix TS error
    targetUser.friendRequests.push(currentUser?._id);

    await currentUser?.save();
    await targetUser.save();

    // Phát sự kiện realtime cho người nhận lời mời
    if (req.io && req.onlineUsers) {
      const targetSocketId = req.onlineUsers.get(targetUser._id.toString());
      if (targetSocketId) {
        req.io.to(targetSocketId).emit('new_friend_request', {
          message: `${currentUser?.name} đã gửi cho bạn một lời mời kết bạn!`,
          fromUser: { id: currentUser?._id, name: currentUser?.name, avatar: currentUser?.avatar }
        });
      }
    }

    res.json({ message: "Đã gửi lời mời kết bạn thành công", targetUser: { id: targetUser._id, name: targetUser.name } });
  } catch (error: any) {
    console.error("Lỗi gửi lời mời kết bạn:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Chấp nhận lời mời kết bạn
const acceptFriendRequest = async (req: any, res: Response) => {
  try {
    const { requestId } = req.body; // ObjectId của người đã gửi lời mời
    const currentUser = await User.findById((req as any).user._id);
    const requestingUser = await User.findById(requestId);

    if (!requestingUser) return res.status(404).json({ message: "Người dùng không tồn tại" });

    if (!currentUser?.friendRequests.includes(requestId)) {
      return res.status(400).json({ message: "Không tìm thấy lời mời kết bạn này" });
    }

    // Chuyển từ friendRequests/sentRequests sang friends
    // @ts-ignore - TODO: Fix TS error
    if (currentUser) currentUser.friendRequests = currentUser.friendRequests.filter((id: any) => id.toString() !== requestId.toString());
    (currentUser as any).friends.push(requestId);

    requestingUser.sentRequests = requestingUser.sentRequests.filter((id: any) => id.toString() !== currentUser?._id.toString());
    requestingUser.friends.push(currentUser?._id);

    await currentUser?.save();
    await requestingUser.save();

    try {
      // import leveling
      // @ts-ignore - TODO: Fix TS error
      await addExpAndCheckBadges(currentUser?._id, 50); // 50 exp for making a friend
      // @ts-ignore - TODO: Fix TS error
      await addExpAndCheckBadges(requestingUser._id, 50);
    } catch (e) {
      console.error("Leveling error in friends:", e);
    }

    // Phát sự kiện realtime cho người gửi lời mời gốc biết rằng lời mời đã được chấp nhận
    if (req.io && req.onlineUsers) {
      const requesterSocketId = req.onlineUsers.get(requestingUser._id.toString());
      if (requesterSocketId) {
        req.io.to(requesterSocketId).emit('friend_request_accepted', {
          message: `${currentUser?.name} đã chấp nhận lời mời kết bạn của bạn!`,
          fromUser: { id: currentUser?._id, name: currentUser?.name, avatar: currentUser?.avatar }
        });
      }
    }

    res.json({ message: "Đã chấp nhận lời mời kết bạn" });
  } catch (error: any) {
    console.error("Lỗi chấp nhận lời mời:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Từ chối hoặc Hủy lời mời kết bạn
const rejectFriendRequest = async (req: any, res: Response) => {
  try {
    const { requestId } = req.body;
    const currentUser = await User.findById((req as any).user._id);
    const targetUser = await User.findById(requestId);

    if (!targetUser) return res.status(404).json({ message: "Người dùng không tồn tại" });

    // Hủy lời mời mình nhận được
    if (currentUser?.friendRequests.includes(requestId)) {
      // @ts-ignore - TODO: Fix TS error
      if (currentUser) currentUser.friendRequests = currentUser.friendRequests.filter((id: any) => id.toString() !== requestId.toString());
      targetUser.sentRequests = targetUser.sentRequests.filter((id: any) => id.toString() !== currentUser?._id.toString());
    } 
    // Hoặc hủy lời mời mình đã gửi đi
    else if ((currentUser as any).sentRequests.includes(requestId)) {
      // @ts-ignore - TODO: Fix TS error
      (currentUser as any).sentRequests = (currentUser as any).sentRequests.filter((id: any) => id.toString() !== requestId.toString());
      targetUser.friendRequests = targetUser.friendRequests.filter((id: any) => id.toString() !== currentUser?._id.toString());
    } else {
      return res.status(400).json({ message: "Không tìm thấy lời mời này" });
    }

    await currentUser?.save();
    await targetUser.save();

    res.json({ message: "Đã hủy lời mời kết bạn" });
  } catch (error: any) {
    console.error("Lỗi hủy lời mời:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Xóa bạn bè
const removeFriend = async (req: any, res: Response) => {
  try {
    const { friendId } = req.body;
    const currentUser = await User.findById((req as any).user._id);
    const targetUser = await User.findById(friendId);

    if (!targetUser) return res.status(404).json({ message: "Người dùng không tồn tại" });

    if (!(currentUser as any).friends.includes(friendId)) {
      return res.status(400).json({ message: "Hai bạn không phải là bạn bè" });
    }

    (currentUser as any).friends = (currentUser as any).friends.filter((id: any) => id.toString() !== friendId.toString());
    targetUser.friends = targetUser.friends.filter((id: any) => id.toString() !== currentUser?._id.toString());

    await currentUser?.save();
    await targetUser.save();

    res.json({ message: "Đã xóa khỏi danh sách bạn bè" });
  } catch (error: any) {
    console.error("Lỗi xóa bạn bè:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Xem Hồ sơ công khai
const getPublicProfile = async (req: any, res: Response) => {
  try {
    const targetUserId = req.params.id;
    const currentUserId = (req as any).user._id.toString();

    const targetUser = await User.findById(targetUserId).select('name avatar level exp achievements friendCode friends friendRequests sentRequests createdAt');
    if (!targetUser) return res.status(404).json({ message: "Không tìm thấy người dùng" });

    let relationship = 'none';
    if (targetUserId === currentUserId) {
      relationship = 'self';
    } else if (targetUser.friends.some((id: any) => id.toString() === currentUserId)) {
      relationship = 'friend';
    } else if (targetUser.friendRequests.some((id: any) => id.toString() === currentUserId)) {
      relationship = 'sent'; // Current user đã gửi request
    } else if (targetUser.sentRequests.some((id: any) => id.toString() === currentUserId)) {
      relationship = 'received'; // Target user đang gửi request cho mình
    }

    res.json({
      user: {
        _id: targetUser._id,
        name: targetUser.name,
        avatar: targetUser.avatar,
        level: targetUser.level,
        exp: targetUser.exp,
        achievements: targetUser.achievements,
        friendCode: targetUser.friendCode,
        createdAt: targetUser.createdAt
      },
      relationship
    });
  } catch (error: any) {
    console.error("Lỗi xem profile:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

export default {
  getAllUsers,
  toggleAdminStatus,
  updateUserProfile,
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  getPublicProfile
};
