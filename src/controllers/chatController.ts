import { Request, Response, NextFunction } from 'express';
import {  GoogleGenerativeAI  } from "@google/generative-ai";
import Game from "../models/Game";
import User from "../models/User";
import Order from "../models/Order";
import Message from "../models/Message";
import jwt from "jsonwebtoken";
import {  decrypt  } from "../utils/encryption";

// Initialize Google AI
const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const genAI = new GoogleGenerativeAI(geminiKey);
const chatModelGlobal = genAI.getGenerativeModel({ 
  model: "gemini-3.1-flash-lite",
  generationConfig: {
    responseMimeType: "application/json",
  }
});

const handleChat = async (req: Request, res: Response) => {
  try {
    const { message, history } = req.body;
    
    // 1. Lấy thông tin user (tùy chọn) để cá nhân hóa
    let userContext = "Khách vãng lai";
    let ownedGamesList = "";
    
    const token = req.headers.authorization?.split(" ")[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, (process.env.JWT_SECRET as string));
        const user = await User.findById((decoded as any).userId);
        if (user) {
          userContext = `Tên: ${user.name || 'Người dùng'}, Email: ${user.email}`;
          
          // Lấy danh sách game đã mua để tư vấn chuẩn hơn
          const userOrders = await Order.find({ user: user._id, status: 'completed' });
          const ownedSet = new Set();
          userOrders.forEach(order => {
            order.items.forEach((item: any) => ownedSet.add(item.name));
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
    const gamesKnowledge = topGames.map((g: any) => 
      `- ${g.name}: [Thể loại: ${g.genre.join(", ")}], [Giá: $${g.price}], [Đánh giá: ${g.rating}/5], Mô tả: ${g.description.substring(0, 100)}...`
    ).join("\n");

    // 3. Nâng cấp System Prompt: Cho phép trả lời tự do + Yêu cầu JSON nghiêm ngặt từ model level
    const systemPrompt = `Bạn là GameBot 🤖 - Chuyên gia tư vấn game của Gam34Pers.
Bạn được tự do trò chuyện về MỌI CHỦ ĐỀ với người dùng (như một người bạn), tuy nhiên hãy luôn giữ phong cách vui vẻ và khéo léo liên hệ đến Game hoặc gợi ý game trong cửa hàng nếu phù hợp.

THÔNG TIN NGƯỜI DÙNG HIỆN TẠI:
- Trạng thái: ${userContext}
- ${ownedGamesList}

KIẾN THỨC VỀ CÁC GAME TRONG CỬA HÀNG (Dùng để tư vấn):
${gamesKnowledge}

QUY TẮC PHẢN HỒI (BẮT BUỘC TRẢ VỀ JSON DO CONFIGURATION ĐÃ KHÓA JSON):
Bạn PHẢI trả về ĐÚNG MỘT JSON Object chứa 2 trường:
1. "response": Lời phản hồi tự nhiên, vui vẻ, thoải mái của bạn (dùng Markdown để in đậm, gạch đầu dòng, emoji). Dù hỏi bất cứ chuyện gì trên đời, hãy thoải mái nói chuyện!
2. "query": Nếu người dùng đang tìm kiếm hoặc bạn chủ động muốn gợi ý game từ cửa hàng, hãy điền từ khóa vào đây (Ví dụ: { "genre": "Hành động" } hoặc { "name": "Zelda" } hoặc { "platform": "PC" }). Nếu chỉ đang trò chuyện bình thường mà không cần hiển thị thẻ game bên dưới, hãy để null hoặc object rỗng {}.

Ví dụ Output JSON hợp lệ:
{
  "response": "Trời mưa lạnh thế này thì ở nhà trùm chăn chơi **Stardew Valley** trồng trọt là tuyệt nhất đó bạn ơi! 🌧️🌾 Mình gợi ý game này cho bạn nhé!",
  "query": { "genre": "Mô phỏng" }
}`;

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ text: "AI service not configured" });
    }

    let formattedHistory = (history || [])
      .filter((m: any) => m.id !== 1)
      .map((m: any) => ({ role: m.from === "user" ? "user" : "model", parts: [{ text: m.text }] }));

    const firstUserIdx = formattedHistory.findIndex((msg: any) => msg.role === 'user');
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
      systemInstruction: { role: "system", parts: [{ text: systemPrompt }] },
    });

    const result = await chat.sendMessage(message);
    const aiResponseText = result.response.text();

    let aiJson;
    try {
      aiJson = JSON.parse(aiResponseText);
    } catch (e) {
      return res.json({
        text: "Xin lỗi, não bộ AI vừa bị rối nhẹ, bạn nói lại xíu nha!",
        results: [],
      });
    }

    let gameResults: any[] = [];
    if (aiJson.query && (aiJson.query.genre || aiJson.query.platform || aiJson.query.name)) {
      const dbQuery: any = {};
      if (aiJson.query.genre) (dbQuery as any).genre = { $regex: new RegExp(aiJson.query.genre, "i") };
      if (aiJson.query.platform) (dbQuery as any).platform = { $regex: new RegExp(aiJson.query.platform, "i") };
      if (aiJson.query.name) (dbQuery as any).$text = { $search: aiJson.query.name };
      
      gameResults = await Game.find(dbQuery).limit(5);
    }

    res.json({
      text: aiJson.response || "Mời bạn tham khảo các tựa game này nhé!",
      results: gameResults,
    });
  } catch (error: any) {
    console.error('❌ Chatbot Error:', error.message);
    res.status(500).json({ text: "Hệ thống AI đang bận chút, bạn thử lại sau nhen! 🤖" });
  }
};

// Lấy lịch sử chat với một người bạn (50 tin nhắn gần nhất)
const getChatHistory = async (req: Request, res: Response) => {
  try {
    const myId = (req as any).user._id;
    const { friendId } = req.params;

    // Kiểm tra có phải bạn bè không
    const me = await User.findById(myId);
    // @ts-ignore - TODO: Fix TS error
    if (!me?.friends.includes(friendId)) {
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

    // Giải mã và đảo lại thứ tự: cũ nhất ở trên, mới nhất ở dưới
    const decryptedMessages = messages.reverse().map((m: any) => ({ ...m, content: String(m.content) }));

    res.json({ messages: decryptedMessages });
  } catch (error: any) {
    console.error('Lỗi lấy lịch sử chat:', error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
};

// Lấy danh sách cuộc hội thoại (bạn bè đã nhắn tin + số chưa đọc)
const getConversations = async (req: Request, res: Response) => {
  try {
    const myId = (req as any).user._id;

    const me = await User.findById(myId).populate('friends', 'name avatar email friendCode');
    if (!me) return res.status(404).json({ message: 'Không tìm thấy user' });

    // Với mỗi người bạn, lấy tin nhắn cuối và số chưa đọc
    const conversations = await Promise.all(
      me?.friends.map(async (friend) => {
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
          lastMessage: lastMessage ? { ...lastMessage, content: String(lastMessage.content) } : null,
          unreadCount,
        };
      })
    );

    // Sắp xếp: Ai nhắn gần nhất lên đầu
    conversations.sort((a: any, b: any) => {
      const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
      const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    res.json({ conversations });
  } catch (error: any) {
    console.error('Lỗi lấy danh sách hội thoại:', error);
    res.status(500).json({ message: 'Lỗi máy chủ' });
  }
};

export default {
  handleChat,
  getChatHistory,
  getConversations,
};
