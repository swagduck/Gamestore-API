const { GoogleGenerativeAI } = require("@google/generative-ai");
const Game = require("../models/Game.js");
const User = require("../models/User.js");
const Order = require("../models/Order.js");
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

module.exports = {
  handleChat
};
