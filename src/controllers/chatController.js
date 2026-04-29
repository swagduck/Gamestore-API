const { GoogleGenerativeAI } = require("@google/generative-ai");
const Game = require("../models/Game.js");
const User = require("../models/User.js");
const Order = require("../models/Order.js");
const Message = require("../models/Message.js");
const jwt = require("jsonwebtoken");

// Initialize Google AI
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const genAI = new GoogleGenerativeAI(geminiKey);
const chatModelGlobal = genAI.getGenerativeModel({ 
  model: "gemini-2.0-flash",
  tools: [{ googleSearch: {} }]
});

const handleChat = async (req, res) => {
  try {
    const { message, history } = req.body;
    
    // 1. Lấy thông tin user (tùy chọn) để cá nhân hóa
    let userContext = "Khách vãng lai";
    let ownedGamesList = "";
    
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId);
        if (user) {
          userContext = `Tên: ${user.name || 'Người dùng'}, Email: ${user.email}`;
          
          // Lấy danh sách game đã mua để tư vấn chuẩn hơn
          const userOrders = await Order.find({ user: user._id, status: 'completed' });
          const ownedSet = new Set();
          userOrders.forEach(order => {
            order.items.forEach(item => ownedSet.add(item.name));
          });
          if (ownedSet.size > 0) {
            ownedGamesList = `Người dùng này đã sở hữu: ${Array.from(ownedSet).join(", ")}. Đừng gợi ý lại những game này trừ khi họ hỏi.`;
          }
        }
      } catch (e) {
        // Token lỗi thì thôi
      }
    }

    // 2. Lấy "Kiến thức nền" (Top 15 game) để AI biết tư vấn sâu
    const topGames = await Game.find({}).sort({ rating: -1, viewCount: -1 }).limit(15);
    const gamesKnowledge = topGames.map(g => 
      `- ${g.name}: [Thể loại: ${g.genre.join(", ")}], [Giá: $${g.price}], [Đánh giá: ${g.rating}/5], Mô tả: ${g.description.substring(0, 100)}...`
    ).join("\n");

    // 3. Nâng cấp System Prompt
    const systemPrompt = `Bạn là GameBot 🤖 - Chuyên gia tư vấn game cao cấp của Gam34Pers.
NHIỆM VỤ: Phân tích nhu cầu, so sánh game và đưa ra lời khuyên "CÓ GU" cho khách hàng. Đừng chỉ là một thanh tìm kiếm!

THÔNG TIN NGƯỜI DÙNG HIỆN TẠI:
- Trạng thái: ${userContext}
- ${ownedGamesList}

KIẾN THỨC VỀ CÁC GAME TRONG CỬA HÀNG (Dùng để tư vấn & so sánh):
${gamesKnowledge}

QUYỀN HẠN ĐẶC BIỆT (INTERNET ACCESS):
- Nếu người dùng hỏi các chi tiết sâu (cốt truyện, gameplay cơ bản, nhà phát triển) hoặc hỏi về một TỰA GAME KHÔNG CÓ trong danh sách cửa hàng, BẠN BẮT BUỘC SỬ DỤNG GOOGLE SEARCH để lấy thông tin thực tế trên mạng và review cực kỳ chi tiết cho họ.

QUY TẮC PHẢN HỒI (CHỈ TRẢ VỀ CHUẨN JSON):
\`\`\`json
{
  "response": "Trình bày câu trả lời SIÊU ĐẸP bằng Markdown! Dùng: \n- **Tiêu đề** (ví dụ: ### 🎮 Góc Tư Vấn)\n- **In đậm** tên game (**Elden Ring**)\n- **Gạch đầu dòng (-)** liệt kê cốt truyện/ưu điểm\n- **Nhiều Emoji** 🔥✨⚔️.\nChia đoạn ngắn gọn, dễ nhìn.",
  "query": { "genre": "thể loại", "platform": "PC", "name": "tên game" }
}
\`\`\`
LUÔN TRẢ VỀ JSON HỢP LỆ! TUYỆT ĐỐI KHÔNG xuất kết quả tìm kiếm Google ra ngoài khối JSON. Mọi thông tin (kể cả kết quả từ mạng) phải được nhét gọn đẹp vào bên trong biến "response". Không comment ngoài JSON.`;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ text: "AI service not configured" });
    }

    let formattedHistory = (history || [])
      .filter(m => m.id !== 1)
      .map(m => ({ role: m.from === "user" ? "user" : "model", parts: [{ text: m.text }] }));

    const firstUserIdx = formattedHistory.findIndex(msg => msg.role === 'user');
    if (firstUserIdx !== -1) {
      formattedHistory = formattedHistory.slice(firstUserIdx);
    } else {
      formattedHistory = [];
    }

    formattedHistory = formattedHistory.slice(-10);
    while (formattedHistory.length > 0 && formattedHistory[0].role !== 'user') {
      formattedHistory.shift();
    }

    const chat = chatModelGlobal.startChat({
      history: formattedHistory,
      systemInstruction: { parts: [{ text: systemPrompt }] },
    });

    const result = await chat.sendMessage(message);
    const aiResponseText = result.response.text();

    let aiJson;
    try {
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
         aiJson = JSON.parse(jsonMatch[0]);
      } else {
         throw new Error("No JSON");
      }
    } catch (e) {
      return res.json({
        text: aiResponseText.replace(/```json|```/g, "").trim() || "Chào bạn! Mình có thể giúp gì được cho bạn?",
        results: [],
      });
    }

    let gameResults = [];
    if (aiJson.query && (aiJson.query.genre || aiJson.query.platform || aiJson.query.name)) {
      const dbQuery = {};
      if (aiJson.query.genre) dbQuery.genre = { $regex: new RegExp(aiJson.query.genre, "i") };
      if (aiJson.query.platform) dbQuery.platform = { $regex: new RegExp(aiJson.query.platform, "i") };
      if (aiJson.query.name) dbQuery.name = { $regex: new RegExp(aiJson.query.name, "i") };
      
      gameResults = await Game.find(dbQuery).limit(5);
    }

    res.json({
      text: aiJson.response || "Mời bạn tham khảo các tựa game này nhé!",
      results: gameResults,
    });
  } catch (error) {
    console.error('❌ Chatbot Error:', error.message);
    res.status(500).json({ text: "Hệ thống AI đang bận chút, bạn thử lại sau nhen! 🤖" });
  }
};

// Lấy lịch sử chat với một người bạn (50 tin nhắn gần nhất)
const getChatHistory = async (req, res) => {
  try {
    const myId = req.user._id;
    const { friendId } = req.params;

    // Kiểm tra có phải bạn bè không
    const me = await User.findById(myId);
    if (!me.friends.includes(friendId)) {
      return res.status(403).json({ message: 'Chỉ có thể chat với bạn bè' });
    }

    const messages = await Message.find({
      $or: [
        { sender: myId, receiver: friendId },
        { sender: friendId, receiver: myId },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    // Đánh dấu đã đọc các tin nhắn từ friendId
    await Message.updateMany(
      { sender: friendId, receiver: myId, read: false },
      { $set: { read: true } }
    );

    res.json({ messages: messages.reverse() });
  } catch (error) {
    console.error('Lỗi lấy lịch sử chat:', error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
};

// Lấy danh sách cuộc hội thoại (bạn bè đã nhắn tin + số chưa đọc)
const getConversations = async (req, res) => {
  try {
    const myId = req.user._id;

    const me = await User.findById(myId).populate('friends', 'name avatar email friendCode');
    if (!me) return res.status(404).json({ message: 'Không tìm thấy user' });

    // Với mỗi người bạn, lấy tin nhắn cuối và số chưa đọc
    const conversations = await Promise.all(
      me.friends.map(async (friend) => {
        const lastMessage = await Message.findOne({
          $or: [
            { sender: myId, receiver: friend._id },
            { sender: friend._id, receiver: myId },
          ],
        })
          .sort({ createdAt: -1 })
          .lean();

        const unreadCount = await Message.countDocuments({
          sender: friend._id,
          receiver: myId,
          read: false,
        });

        return {
          friend,
          lastMessage,
          unreadCount,
        };
      })
    );

    // Sắp xếp: Ai nhắn gần nhất lên đầu
    conversations.sort((a, b) => {
      const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt) : 0;
      const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt) : 0;
      return bTime - aTime;
    });

    res.json({ conversations });
  } catch (error) {
    console.error('Lỗi lấy danh sách hội thoại:', error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
};

module.exports = {
  handleChat,
  getChatHistory,
  getConversations,
};
