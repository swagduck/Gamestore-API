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
        createdAt: user.createdAt,
        friendCode: user.friendCode
      }
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật hồ sơ:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật hồ sơ" });
  }
};

// --- QUẢN LÝ BẠN BÈ ---

// Lấy danh sách bạn bè và lời mời
const getFriends = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'name email avatar friendCode')
      .populate('friendRequests', 'name email avatar friendCode')
      .populate('sentRequests', 'name email avatar friendCode');
    
    if (!user) return res.status(404).json({ message: "Không tìm thấy người dùng" });

    res.json({
      friends: user.friends,
      friendRequests: user.friendRequests,
      sentRequests: user.sentRequests
    });
  } catch (error) {
    console.error("Lỗi lấy danh sách bạn bè:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Gửi lời mời kết bạn bằng friendCode
const sendFriendRequest = async (req, res) => {
  try {
    const { friendCode } = req.body;
    if (!friendCode) return res.status(400).json({ message: "Vui lòng nhập mã kết bạn" });

    const currentUser = await User.findById(req.user._id);
    if (currentUser.friendCode === friendCode) {
      return res.status(400).json({ message: "Bạn không thể tự kết bạn với chính mình" });
    }

    const targetUser = await User.findOne({ friendCode });
    if (!targetUser) return res.status(404).json({ message: "Không tìm thấy người dùng với mã này" });

    // Kiểm tra xem đã là bạn bè chưa
    if (currentUser.friends.includes(targetUser._id)) {
      return res.status(400).json({ message: "Hai bạn đã là bạn bè" });
    }

    // Kiểm tra xem đã gửi lời mời chưa
    if (currentUser.sentRequests.includes(targetUser._id)) {
      return res.status(400).json({ message: "Bạn đã gửi lời mời kết bạn cho người này rồi" });
    }

    // Kiểm tra xem người kia có đang gửi lời mời cho mình không
    if (currentUser.friendRequests.includes(targetUser._id)) {
      return res.status(400).json({ message: "Người này đã gửi lời mời cho bạn, vui lòng kiểm tra danh sách lời mời" });
    }

    // Cập nhật Database
    currentUser.sentRequests.push(targetUser._id);
    targetUser.friendRequests.push(currentUser._id);

    await currentUser.save();
    await targetUser.save();

    res.json({ message: "Đã gửi lời mời kết bạn thành công", targetUser: { id: targetUser._id, name: targetUser.name } });
  } catch (error) {
    console.error("Lỗi gửi lời mời kết bạn:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Chấp nhận lời mời kết bạn
const acceptFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.body; // ObjectId của người đã gửi lời mời
    const currentUser = await User.findById(req.user._id);
    const requestingUser = await User.findById(requestId);

    if (!requestingUser) return res.status(404).json({ message: "Người dùng không tồn tại" });

    if (!currentUser.friendRequests.includes(requestId)) {
      return res.status(400).json({ message: "Không tìm thấy lời mời kết bạn này" });
    }

    // Chuyển từ friendRequests/sentRequests sang friends
    currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== requestId.toString());
    currentUser.friends.push(requestId);

    requestingUser.sentRequests = requestingUser.sentRequests.filter(id => id.toString() !== currentUser._id.toString());
    requestingUser.friends.push(currentUser._id);

    await currentUser.save();
    await requestingUser.save();

    res.json({ message: "Đã chấp nhận lời mời kết bạn" });
  } catch (error) {
    console.error("Lỗi chấp nhận lời mời:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Từ chối hoặc Hủy lời mời kết bạn
const rejectFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.body;
    const currentUser = await User.findById(req.user._id);
    const targetUser = await User.findById(requestId);

    if (!targetUser) return res.status(404).json({ message: "Người dùng không tồn tại" });

    // Hủy lời mời mình nhận được
    if (currentUser.friendRequests.includes(requestId)) {
      currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== requestId.toString());
      targetUser.sentRequests = targetUser.sentRequests.filter(id => id.toString() !== currentUser._id.toString());
    } 
    // Hoặc hủy lời mời mình đã gửi đi
    else if (currentUser.sentRequests.includes(requestId)) {
      currentUser.sentRequests = currentUser.sentRequests.filter(id => id.toString() !== requestId.toString());
      targetUser.friendRequests = targetUser.friendRequests.filter(id => id.toString() !== currentUser._id.toString());
    } else {
      return res.status(400).json({ message: "Không tìm thấy lời mời này" });
    }

    await currentUser.save();
    await targetUser.save();

    res.json({ message: "Đã hủy lời mời kết bạn" });
  } catch (error) {
    console.error("Lỗi hủy lời mời:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

// Xóa bạn bè
const removeFriend = async (req, res) => {
  try {
    const { friendId } = req.body;
    const currentUser = await User.findById(req.user._id);
    const targetUser = await User.findById(friendId);

    if (!targetUser) return res.status(404).json({ message: "Người dùng không tồn tại" });

    if (!currentUser.friends.includes(friendId)) {
      return res.status(400).json({ message: "Hai bạn không phải là bạn bè" });
    }

    currentUser.friends = currentUser.friends.filter(id => id.toString() !== friendId.toString());
    targetUser.friends = targetUser.friends.filter(id => id.toString() !== currentUser._id.toString());

    await currentUser.save();
    await targetUser.save();

    res.json({ message: "Đã xóa khỏi danh sách bạn bè" });
  } catch (error) {
    console.error("Lỗi xóa bạn bè:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

module.exports = {
  getAllUsers,
  toggleAdminStatus,
  updateUserProfile,
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend
};
