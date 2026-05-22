import { Request, Response, NextFunction } from 'express';
import mongoose from "mongoose";
import Analytics from "../models/Analytics";
import Game from "../models/Game";
import Order from "../models/Order";
import {  GoogleGenerativeAI  } from "@google/generative-ai";

const geminiKey = (process.env.GEMINI_API_KEY || "").trim();
const genAI = new GoogleGenerativeAI(geminiKey);
const chatModelGlobal = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite-preview" });

const getAnalyticsData = async (req: Request, res: Response) => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ message: "Database temporarily unavailable. Please try again later." });
    }

    let analytics = await Analytics.findOne();
    if (!analytics) {
      analytics = new Analytics();
      await analytics.save();
    }

    const totalSales = analytics.orders.reduce((sum, order) => sum + (order.total || 0), 0);
    const totalOrders = analytics.orders.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    const gamesWithViews = await Game.find({ viewCount: { $gt: 0 } })
      .select('_id name viewCount').sort({ viewCount: -1 }).limit(20);

    const topGamesByViews = gamesWithViews.map(game => ({
      gameId: game?._id, gameName: game?.name, views: game?.viewCount
    }));

    const analyticsGameViews = analytics.gameViews || {};
    Object.entries(analyticsGameViews).forEach(([gameId, views]) => {
      if (typeof views === 'number' && views > 0) {
        const existing = topGamesByViews.find((item: any) => item.gameId === gameId);
        if (!existing) {
          Game.findById(gameId).select('name').then(game => {
            if (game) {
              // @ts-ignore - TODO: Fix TS error
              topGamesByViews.push({ gameId, gameName: game?.name, views });
            }
          }).catch(err => console.log('Error finding game:', err));
        }
      }
    });
    
    topGamesByViews.sort((a: any, b: any) => b.views - a.views);

    const totalViews = await Game.aggregate([{ $group: { _id: null, totalViews: { $sum: '$viewCount' } } }]);
    const totalViewCount = totalViews[0]?.totalViews || 0;

    const gameSales: any = {};
    analytics.orders.forEach((order) => {
      order.items?.forEach((item: any) => {
        gameSales[item.gameId as string] = (gameSales[item.gameId as string] || 0) + item.quantity;
      });
    });

    const topGamesBySales = Object.entries(gameSales as any)
      .map(([gameId, quantity]) => {
        const game = analytics.games.find((g) => g._id === gameId);
        return { gameId, gameName: game?.name || `Game ${gameId}`, quantity };
      })
      .sort((a: any, b: any) => b.quantity - a.quantity).slice(0, 5);

    res.json({
      totalSales, totalOrders, averageOrderValue,
      topGamesByViews: topGamesByViews.slice(0, 10),
      topGamesBySales, totalViews: totalViewCount,
      gameViews: analytics.gameViews, orders: analytics.orders,
      games: analytics.games, lastUpdated: new Date().toISOString()
    });
  } catch (error: any) {
    if (error.name === 'MongooseServerSelectionError' || error.message.includes('buffering timed out')) {
      return res.status(503).json({ message: "Database temporarily unavailable. Please try again later." });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi lấy dữ liệu thống kê." });
  }
};

const trackGameView = async (req: Request, res: Response) => {
  try {
    const { gameId, gameName } = req.body;
    if (!gameId) return res.status(400).json({ message: "Game ID là bắt buộc." });

    let analytics = await Analytics.findOne() || new Analytics();
    analytics.gameViews = analytics.gameViews || {};
    analytics.gameViews[gameId] = (analytics.gameViews[gameId] || 0) + 1;

    if (gameName) {
      const existingGame = analytics.games.find((g) => g._id === gameId);
      if (!existingGame) analytics.games.push({ _id: gameId, name: gameName });
    }

    analytics.lastUpdated = new Date();
    await analytics.save();
    res.json({ message: "Lượt xem đã được ghi nhận." });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận lượt xem." });
  }
};

const addOrder = async (req: Request, res: Response) => {
  try {
    const orderData = req.body;
    if (!orderData.items || !Array.isArray(orderData.items)) {
      return res.status(400).json({ message: "Dữ liệu đơn hàng không hợp lệ." });
    }

    let analytics = await Analytics.findOne() || new Analytics();
    const newOrder = {
      _id: orderData.id || Date.now().toString(),
      ...orderData, date: new Date(), status: "completed"
    };

    analytics.orders.push(newOrder);
    orderData.items.forEach((item: any) => {
      if (item.name) {
        const existingGame = analytics.games.find((g) => g._id === item.gameId);
        if (!existingGame) analytics.games.push({ _id: item.gameId, name: item.name });
      }
    });

    analytics.lastUpdated = new Date();
    await analytics.save();
    res.json({ message: "Đơn hàng đã được ghi nhận." });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận đơn hàng." });
  }
};

const resetViews = async (req: Request, res: Response) => {
  try {
    let analytics = await Analytics.findOne() || new Analytics();
    analytics.gameViews = {};
    analytics.lastUpdated = new Date();
    await analytics.save();
    res.json({ message: "Lượt xem đã được reset." });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi reset lượt xem." });
  }
};

const syncAnalyticsData = async (req: Request, res: Response) => {
  try {
    const { gameViews, orders, games } = req.body;
    let analytics = await Analytics.findOne() || new Analytics();

    if (gameViews) {
      analytics.gameViews = analytics.gameViews || {};
      Object.keys(gameViews).forEach((gameId) => {
        analytics.gameViews[gameId] = (analytics.gameViews[gameId] || 0) + gameViews[gameId];
      });
    }

    if (orders && Array.isArray(orders)) analytics.orders.push(...orders);

    if (games && Array.isArray(games)) {
      games.forEach((game) => {
        const existingGame = analytics.games.find((g) => g._id === game?._id);
        if (!existingGame) analytics.games.push({ _id: game?._id, name: game?.name });
      });
    }

    analytics.lastUpdated = new Date();
    await analytics.save();
    res.json({ message: "Dữ liệu đã được đồng bộ." });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi đồng bộ dữ liệu." });
  }
};

const getAiSummary = async (req: Request, res: Response) => {
  try {
    const completedOrders = await Order.find({ status: 'completed' }).populate('items.game');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalOrders = completedOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    
    const gameSales: any = {};
    const gameSalesCount = {};
    completedOrders.forEach(o => {
      o.items.forEach((item: any) => {
        const name = item.name || 'Unknown';
        gameSales[name as string] = (gameSales[name as string] || 0) + (item.finalPrice || 1);
        // @ts-ignore - TODO: Fix TS error
        gameSalesCount[name as string] = (gameSalesCount[name as string] || 0) + (item.quantity || 1);
      });
    });
    
    const topGamesRev = Object.entries(gameSales as any)
      .sort((a: any, b: any) => b[1] - a[1]).slice(0, 3)
      // @ts-ignore - TODO: Fix TS error
      .map(([name, rev]) => `${name} ($${rev.toFixed(2)})`).join(", ");

    const gamesData = await Game.find({}).select('name viewCount price');
    const topViewedGames = gamesData
      .sort((a: any, b: any) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 3)
      .map((g: any) => `${g.name} (${g.viewCount} views)`).join(", ");
      
    const slowMoving = gamesData
      // @ts-ignore - TODO: Fix TS error
      .filter((g: any) => (g.viewCount || 0) > 5 && !gameSalesCount[g.name])
      .sort((a: any, b: any) => (b.viewCount || 0) - (a.viewCount || 0)).slice(0, 3)
      .map((g: any) => g.name).join(", ");

    const analyticsData = `
      - Tổng doanh thu: $${(totalRevenue || 0).toFixed(2)}
      - Số đơn hàng: ${totalOrders || 0}
      - Giá trị trung bình/đơn (AOV): $${avgOrderValue.toFixed(2)}
      - Top bán chạy (Doanh thu): ${topGamesRev || 'Chưa có'}
      - Top xem nhiều nhất: ${topViewedGames || 'Chưa có'}
      - Game báo động hụt doanh thu (Được xem > 5 lần nhưng 0 ai mua): ${slowMoving || 'Tỷ lệ chuyển đổi hoàn hảo'}
    `;

    const systemPrompt = `Bạn là Chuyên gia Phân tích Dữ liệu Kinh doanh xuất sắc của Gam34Pers. 
NHIỆM VỤ: Phân tích sâu dữ liệu tôi cung cấp và lập báo cáo đa chiều.
YÊU CẦU ĐỊNH DẠNG:
- Trả lời bằng Markdown (dùng bôi đậm **text**, có xuống dòng).
- Cấu trúc gồm đúng 4 phần bắt buộc: 
  📊 **Tổng quan**: Đánh giá hiệu suất chung (Doanh thu, Đơn hàng, AOV).
  🔥 **Sản phẩm Xu hướng**: Nhận định Top bán chạy và Top xem nhiều.
  ⚠️ **Kẽ hở chuyển đổi**: Bắt buộc chỉ đích danh các "Game báo động hụt doanh thu" (high views, zero sales). Định dạng in đậm tên game?. Dự đoán nguyên nhân (vd: giá cao so mặt bằng chung?).
  💡 **Chiến lược gợi ý**: Đề xuất tỷ lệ % giảm giá hợp lý cho các Game hụt doanh thu ở trên để kích cầu, hoặc chiến dịch combo chéo.
Viết mạch lạc, sắc sảo như một chuyên gia C-level thương mại điện tử thực thụ. (Khoảng 8-12 dòng).`;

    try {
      const fullPrompt = `${systemPrompt}\n\nDữ liệu thống kê hôm nay:\n${analyticsData}`;
      const result = await chatModelGlobal.generateContent(fullPrompt);
      res.json({ summary: result.response.text() });
    } catch (aiError: any) {
      if (aiError.status === 503 || aiError.message?.includes("503")) {
        return res.status(503).json({ message: "🔮 AI Gemini hiện đang quá tải lượt gọi. Bạn hãy thử lại sau ít phút nhé! ⌛" });
      }
      throw aiError; 
    }
  } catch (error: any) {
    res.status(500).json({ message: "AI đang bận phân tích số liệu, vui lòng quay lại sau! 📉" });
  }
};

const getAdminStats = async (req: Request, res: Response) => {
  try {
    const completedOrders = await Order.find({ status: 'completed' }).populate('items.game', 'name image price genre');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalOrders = completedOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    const gameSalesMap = {};
    completedOrders.forEach(order => {
      order.items.forEach((item: any) => {
        const gameId = item.game?._id?.toString() || item.game?.toString();
        const gameName = item.game?.name || item.name || 'Unknown';
        const gameImage = item.game?.image || item.image || '';
        const price = item.finalPrice || item.price || 0;
        if (gameId) {
          // @ts-ignore - TODO: Fix TS error
          if (!gameSalesMap[gameId]) {
            // @ts-ignore - TODO: Fix TS error
            gameSalesMap[gameId] = { _id: gameId, name: gameName, image: gameImage, sold: 0, revenue: 0 };
          }
          // @ts-ignore - TODO: Fix TS error
          gameSalesMap[gameId].sold += 1;
          // @ts-ignore - TODO: Fix TS error
          gameSalesMap[gameId].revenue += price;
        }
      });
    });
    const topSelling = Object.values(gameSalesMap).sort((a: any, b: any) => b.sold - a.sold).slice(0, 10);
    res.json({ totalRevenue, totalOrders, avgOrderValue, topSelling });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

export default {
  getAnalyticsData, trackGameView, addOrder, resetViews, syncAnalyticsData,
  getAiSummary, getAdminStats
};
