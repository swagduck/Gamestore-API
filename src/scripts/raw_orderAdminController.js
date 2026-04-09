// == Order Routes ==

// GET user's order history (authenticated users only)
app.get("/api/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;
    
    // Build query
    const query = { user: userId };
    if (status && status !== 'all') {
      query.status = status;
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    const orders = await Order.find(query)
      .populate('items.game', 'name genre image rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Order.countDocuments(query);
    
    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error("Lỗi khi lấy lịch sử đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy lịch sử đơn hàng" });
  }
});

// GET user's purchased games for recommendations
app.get("/api/orders/purchased-games", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get all completed orders
    const orders = await Order.find({ 
      user: userId, 
      status: 'completed' 
    }).populate('items.game', 'name genre image rating platform');
    
    // Extract unique games
    const purchasedGames = [];
    const gameIds = new Set();
    
    orders.forEach(order => {
      order.items.forEach(item => {
        if (item.game && !gameIds.has(item.game._id.toString())) {
          gameIds.add(item.game._id.toString());
          purchasedGames.push({
            ...item.game.toObject(),
            purchasedAt: order.createdAt,
            price: item.finalPrice || item.price
          });
        }
      });
    });
    
    res.json(purchasedGames);
  } catch (error) {
    console.error("Lỗi khi lấy game đã mua:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy game đã mua" });
  }
});

// GET owned game IDs only (lightweight)
app.get("/api/orders/owned-game-ids", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const orders = await Order.find({ user: userId, status: 'completed' });
    
    const ownedIds = new Set();
    orders.forEach(order => {
      order.items.forEach(item => {
        if (item.game) ownedIds.add(item.game.toString());
      });
    });
    
    res.json([...ownedIds]);
  } catch (error) {
    console.error("Lỗi khi lấy owned game IDs:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// ==Admin: GET all orders (admin only) ==
app.get("/api/admin/orders", verifyAdmin, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ message: "Không có quyền truy cập" });

    const { page = 1, limit = 20, status } = req.query;
    const query = {};
    if (status && status !== 'all') query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .populate('user', 'email')
      .populate('items.game', 'name image price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      orders,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error("Lỗi admin orders:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});

// == Admin: AI Summary Insight ==
app.get("/api/admin/ai-summary", verifyAdmin, async (req, res) => {
  try {
    // 1. Thu thập dữ liệu thô
    const completedOrders = await Order.find({ status: 'completed' }).populate('items.game');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalOrders = completedOrders.length;
    
    // Thống kê game
    const gameSales = {};
    completedOrders.forEach(o => {
      o.items.forEach(item => {
        const name = item.name || 'Unknown';
        gameSales[name] = (gameSales[name] || 0) + (item.finalPrice || 1);
      });
    });
    
    // Lấy top 5 game doanh thu cao
    const topGames = Object.entries(gameSales)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, rev]) => `${name} ($${rev.toFixed(2)})`)
      .join(", ");

    const analyticsData = `
      - Tổng doanh thu: $${(totalRevenue || 0).toFixed(2)}
      - Tổng đơn hàng: ${totalOrders || 0}
      - Top game doanh thu: ${topGames || 'Chưa có dữ liệu'}
    `;

    const systemPrompt = `Bạn là Chuyên gia Phân tích Kinh doanh AI của Gam34Pers. 
NHIỆM VỤ: Dựa trên dữ liệu doanh thu, hãy viết một bản tóm tắt tình hình kinh doanh "CÓ TÂM" cho chủ shop.
YÊU CẦU ĐỊNH DẠNG: 
- Sử dụng xuống dòng (\n) giữa các phần để dễ đọc.
- Cấu trúc gồm 3 phần rõ rệt: Đánh giá (📊), Điểm sáng (🚀), và Lời khuyên (💡).
- Ngôn ngữ chuyên nghiệp, súc tích, dùng emoji phù hợp.
TRÌNH BÀY: Khoảng 4-5 dòng, mỗi phần một dòng riêng biệt.`;

    // 4. Gọi AI với logic phòng vệ (Retry/Error Handling)
    try {
      const fullPrompt = `${systemPrompt}\n\nDữ liệu thống kê hôm nay:\n${analyticsData}`;
      const result = await chatModelGlobal.generateContent(fullPrompt);
      const summary = result.response.text();
      res.json({ summary });
    } catch (aiError) {
      if (aiError.status === 503 || aiError.message?.includes("503")) {
        console.warn("⚠️ Gemini busy (503)");
        return res.status(503).json({ message: "🔮 AI Gemini hiện đang quá tải lượt gọi (Dưới 10 lượt/phút cho gói Free). Bạn hãy thử lại sau ít phút nhé! ⌛" });
      }
      throw aiError; 
    }
  } catch (error) {
    console.error("❌ Lỗi AI Summary:", error.message);
    res.status(500).json({ message: "AI đang bận phân tích số liệu, vui lòng quay lại sau! 📉" });
  }
});

// == Admin: Revenue stats ==
app.get("/api/admin/stats", verifyAdmin, async (req, res) => {
  try {
    if (!req.user.isAdmin) return res.status(403).json({ message: "Không có quyền truy cập" });

    const completedOrders = await Order.find({ status: 'completed' })
      .populate('items.game', 'name image price genre');

    const totalRevenue = completedOrders.reduce((sum, o) => sum + (o.totalAmount || 0), 0);
    const totalOrders = completedOrders.length;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Top selling games
    const gameSalesMap = {};
    completedOrders.forEach(order => {
      order.items.forEach(item => {
        const gameId = item.game?._id?.toString() || item.game?.toString();
        const gameName = item.game?.name || item.name || 'Unknown';
        const gameImage = item.game?.image || item.image || '';
        const price = item.finalPrice || item.price || 0;
        if (gameId) {
          if (!gameSalesMap[gameId]) {
            gameSalesMap[gameId] = { _id: gameId, name: gameName, image: gameImage, sold: 0, revenue: 0 };
          }
          gameSalesMap[gameId].sold += 1;
          gameSalesMap[gameId].revenue += price;
        }
      });
    });
    const topSelling = Object.values(gameSalesMap)
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 10);

    res.json({ totalRevenue, totalOrders, avgOrderValue, topSelling });
  } catch (error) {
    console.error("Lỗi admin stats:", error);
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
});


// GET single order details
app.get("/api/orders/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const orderId = req.params.id;
    
    const order = await Order.findOne({ _id: orderId, user: userId })
      .populate('items.game', 'name genre image rating description platform');
    
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }
    
    res.json(order);
  } catch (error) {
    console.error("Lỗi khi lấy chi tiết đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi lấy chi tiết đơn hàng" });
  }
});

// POST create new order (used by payment success)
app.post("/api/orders", verifyToken, async (req, res) => {
  try {
    const userId = req.user._id;
    const { items, totalAmount, paymentMethod, paymentId, status = 'pending' } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Giỏ hàng trống" });
    }
    
    // Validate items
    for (const item of items) {
      if (!item.game || !item.name || !item.price || !item.quantity) {
        return res.status(400).json({ message: "Thông tin sản phẩm không hợp lệ" });
      }
    }
    
    const order = new Order({
      user: userId,
      orderNumber: generateOrderNumber(),
      items,
      totalAmount,
      paymentMethod,
      paymentId: paymentId || `manual_${Date.now()}`,
      status
    });
    
    await order.save();
    
    // Populate game details for response
    await order.populate('items.game', 'name genre image rating');
    
    // Update analytics
    await syncAnalytics(order);
    
    res.status(201).json(order);
  } catch (error) {
    console.error("Lỗi khi tạo đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi tạo đơn hàng" });
  }
});

// PUT update order status (for payment completion/failure)
app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    const orderId = req.params.id;
    
    if (!['pending', 'completed', 'failed', 'refunded'].includes(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ" });
    }
    
    const order = await Order.findByIdAndUpdate(
      orderId,
      { status, updatedAt: new Date() },
      { new: true }
    ).populate('items.game', 'name genre image rating');
    
    if (!order) {
      return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    }
    
    res.json(order);
  } catch (error) {
    console.error("Lỗi khi cập nhật trạng thái đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật trạng thái đơn hàng" });
  }
});

