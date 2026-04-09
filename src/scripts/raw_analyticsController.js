// == Analytics Routes ==

// GET analytics data
app.get("/api/analytics", async (req, res) => {
  try {
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      return res.status(503).json({ 
        message: "Database temporarily unavailable. Please try again later." 
      });
    }

    let analytics = await Analytics.findOne();

    if (!analytics) {
      // Tạo analytics document mới nếu chưa có
      analytics = new Analytics();
      await analytics.save();
    }

    // Tính toán thống kê
    const totalSales = analytics.orders.reduce(
      (sum, order) => sum + (order.total || 0),
      0
    );
    const totalOrders = analytics.orders.length;
    const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    // Get all games with viewCount > 0
    const gamesWithViews = await Game.find({ viewCount: { $gt: 0 } })
      .select('_id name viewCount')
      .sort({ viewCount: -1 })
      .limit(20);

    // Top games theo lượt xem (from Game collection)
    const topGamesByViews = gamesWithViews.map(game => ({
      gameId: game._id,
      gameName: game.name,
      views: game.viewCount
    }));

    // Also include games with 0 views from analytics (for backward compatibility)
    const analyticsGameViews = analytics.gameViews || {};
    Object.entries(analyticsGameViews).forEach(([gameId, views]) => {
      if (typeof views === 'number' && views > 0) {
        // Check if already in topGamesByViews
        const existing = topGamesByViews.find(item => item.gameId === gameId);
        if (!existing) {
          // Try to get game name
          Game.findById(gameId).select('name').then(game => {
            if (game) {
              topGamesByViews.push({
                gameId,
                gameName: game.name,
                views
              });
            }
          }).catch(err => console.log('Error finding game:', err));
        }
      }
    });
    
    // Sort by views descending
    topGamesByViews.sort((a, b) => b.views - a.views);

    // Calculate total views from Game collection
    const totalViews = await Game.aggregate([
      { $group: { _id: null, totalViews: { $sum: '$viewCount' } } }
    ]);
    const totalViewCount = totalViews[0]?.totalViews || 0;

    // Top games theo doanh số
    const gameSales = {};
    analytics.orders.forEach((order) => {
      order.items?.forEach((item) => {
        gameSales[item.gameId] = (gameSales[item.gameId] || 0) + item.quantity;
      });
    });

    const topGamesBySales = Object.entries(gameSales)
      .map(([gameId, quantity]) => {
        const game = analytics.games.find((g) => g._id === gameId);
        return {
          gameId,
          gameName: game?.name || `Game ${gameId}`,
          quantity,
        };
      })
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    res.json({
      totalSales,
      totalOrders,
      averageOrderValue,
      topGamesByViews: topGamesByViews.slice(0, 10), // Top 10
      topGamesBySales,
      totalViews: totalViewCount,
      gameViews: analytics.gameViews, // Keep for backward compatibility
      orders: analytics.orders,
      games: analytics.games,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error("Lỗi khi lấy analytics data:", error);
    if (error.name === 'MongooseServerSelectionError' || error.message.includes('buffering timed out')) {
      return res.status(503).json({ 
        message: "Database temporarily unavailable. Please try again later." 
      });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi lấy dữ liệu thống kê." });
  }
});

// POST track game view
app.post("/api/analytics/track-view", async (req, res) => {
  try {
    const { gameId, gameName } = req.body;

    if (!gameId) {
      return res.status(400).json({ message: "Game ID là bắt buộc." });
    }

    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Tăng lượt xem
    analytics.gameViews = analytics.gameViews || {};
    analytics.gameViews[gameId] = (analytics.gameViews[gameId] || 0) + 1;

    // Cập nhật danh sách games nếu có tên mới
    if (gameName) {
      const existingGame = analytics.games.find((g) => g._id === gameId);
      if (!existingGame) {
        analytics.games.push({ _id: gameId, name: gameName });
      }
    }

    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Lượt xem đã được ghi nhận." });
  } catch (error) {
    console.error("Lỗi khi track game view:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận lượt xem." });
  }
});

// POST add order to analytics
app.post("/api/analytics/add-order", async (req, res) => {
  try {
    const orderData = req.body;

    if (!orderData.items || !Array.isArray(orderData.items)) {
      return res
        .status(400)
        .json({ message: "Dữ liệu đơn hàng không hợp lệ." });
    }

    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Thêm đơn hàng mới
    const newOrder = {
      _id: orderData.id || Date.now().toString(), // Use frontend ID or fallback to timestamp
      ...orderData,
      date: new Date(),
      status: "completed",
    };

    analytics.orders.push(newOrder);

    // Cập nhật danh sách games từ đơn hàng
    orderData.items.forEach((item) => {
      if (item.name) {
        const existingGame = analytics.games.find((g) => g._id === item.gameId);
        if (!existingGame) {
          analytics.games.push({ _id: item.gameId, name: item.name });
        }
      }
    });

    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Đơn hàng đã được ghi nhận." });
  } catch (error) {
    console.error("Lỗi khi thêm đơn hàng:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi ghi nhận đơn hàng." });
  }
});

// PUT reset game views (Admin only)
app.put("/api/analytics/reset-views", verifyAdmin, async (req, res) => {
  try {
    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Reset lượt xem nhưng giữ lại đơn hàng và danh sách games
    analytics.gameViews = {};
    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Lượt xem đã được reset." });
  } catch (error) {
    console.error("Lỗi khi reset lượt xem:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi reset lượt xem." });
  }
});

// POST sync analytics data (merge local data with server)
app.post("/api/analytics/sync", async (req, res) => {
  try {
    const gameViews = req.body.gameViews;
    const orders = req.body.orders;
    const games = req.body.games;

    let analytics = await Analytics.findOne();

    if (!analytics) {
      analytics = new Analytics();
    }

    // Merge game views
    if (gameViews) {
      analytics.gameViews = analytics.gameViews || {};
      Object.keys(gameViews).forEach((gameId) => {
        analytics.gameViews[gameId] =
          (analytics.gameViews[gameId] || 0) + gameViews[gameId];
      });
    }

    // Merge orders
    if (orders && Array.isArray(orders)) {
      analytics.orders.push(...orders);
    }

    // Merge games
    if (games && Array.isArray(games)) {
      games.forEach((game) => {
        const existingGame = analytics.games.find((g) => g._id === game._id);
        if (!existingGame) {
          analytics.games.push({ _id: game._id, name: game.name });
        }
      });
    }

    analytics.lastUpdated = new Date();
    await analytics.save();

    res.json({ message: "Dữ liệu đã được đồng bộ." });
  } catch (error) {
    console.error("Lỗi khi sync analytics:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi đồng bộ dữ liệu." });
  }
});

