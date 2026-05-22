import { Request, Response, NextFunction } from 'express';
import Order from "../models/Order";
import User from "../models/User";
import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
import { sendOrderConfirmation } from "../utils/emailService";
import { addExpAndCheckBadges } from "../utils/leveling";
import Game from "../models/Game";
import Analytics from "../models/Analytics";

const generateOrderNumber = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `GAMPERS-${date}-${random}`;
};

const syncAnalytics = async (order: any) => {
  try {
    const items = order.items || [];
    await Analytics.findOneAndUpdate(
      {},
      {
        $push: {
          orders: {
            _id: order._id.toString(),
            userId: order.user?.toString(),
            items: items.map((item: any) => ({
              gameId: item.game?.toString() || item.gameId,
              name: item.name,
              price: item.price,
              quantity: item.quantity,
              finalPrice: item.finalPrice || item.price,
              platform: Array.isArray(item.platform) ? item.platform : [item.platform].filter(Boolean),
              genre: Array.isArray(item.genre) ? item.genre : [item.genre].filter(Boolean)
            })),
            total: order.totalAmount,
            itemCount: items.length,
            date: order.createdAt || new Date(),
            status: (order as any).status || 'completed'
          }
        },
        $set: { lastUpdated: new Date() }
      },
      { upsert: true }
    );
    
    for (const item of items) {
      const gId = item.game?.toString() || item.gameId;
      if (gId && item.name) {
        const analytics = await Analytics.findOne({});
        const gameExists = analytics?.games?.some((g: any) => g._id === gId);
        if (!gameExists) {
          await Analytics.findOneAndUpdate({}, { $push: { games: { _id: gId, name: item.name } } });
        }
      }
    }
  } catch (error: any) {
    console.error('⚠️ Could not sync analytics:', error.message);
  }
};

const createTestPayment = async (req: Request, res: Response) => {
  try {
    const { cartItems } = req.body;
    const userId = (req as any).user._id;

    // Lấy thông tin game từ DB để chống thao túng giá
    const gameIds = cartItems.map((item: any) => item._id);
    const gamesInDb = await Game.find({ _id: { $in: gameIds } });
    
    const processedItems = cartItems.map((item: any) => {
      const dbGame = gamesInDb.find((g: any) => g._id.toString() === item._id);
      if (!dbGame) throw new Error(`Không tìm thấy game: ${item.name}`);

      let finalPrice = dbGame.price;
      if (dbGame.discountType && dbGame.discountType !== 'none') {
        const now = new Date();
        const start = dbGame.discountStartDate ? new Date(dbGame.discountStartDate) : null;
        const end = dbGame.discountEndDate ? new Date(dbGame.discountEndDate) : null;
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        if (isDiscountActive) {
          if (dbGame.discountType === 'percentage') {
            finalPrice = dbGame.price * (1 - (dbGame.discountValue || 0) / 100);
          } else if (dbGame.discountType === 'fixed') {
            finalPrice = Math.max(0, dbGame.price - (dbGame.discountValue || 0));
          }
        }
      }
      return {
        name: dbGame.name,
        originalPrice: dbGame.price,
        discountedPrice: finalPrice,
        quantity: item.quantity
      };
    });
    
    const total = processedItems.reduce((sum: any, item: any) => sum + item.discountedPrice * item.quantity, 0);
    const testSessionId = `test_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const orderItems = cartItems.map((item: any) => {
        const dbGame = gamesInDb.find((g: any) => g._id.toString() === item._id);
        if (!dbGame) throw new Error(`Không tìm thấy game: ${item.name}`);

        let finalPrice = dbGame.price;
        if (dbGame.discountType && dbGame.discountType !== 'none') {
          const now = new Date();
          const start = dbGame.discountStartDate ? new Date(dbGame.discountStartDate) : null;
          const end = dbGame.discountEndDate ? new Date(dbGame.discountEndDate) : null;
          const isDiscountActive = (!start || now >= start) && (!end || now <= end);
          if (isDiscountActive) {
            if (dbGame.discountType === 'percentage') {
              finalPrice = dbGame.price * (1 - (dbGame.discountValue || 0) / 100);
            } else if (dbGame.discountType === 'fixed') {
              finalPrice = Math.max(0, dbGame.price - (dbGame.discountValue || 0));
            }
          }
        }
        return {
          game: item._id,
          name: dbGame.name,
          price: dbGame.price,
          quantity: item.quantity,
          image: dbGame.image,
          discountType: dbGame.discountType || 'none',
          discountValue: dbGame.discountValue || 0,
          finalPrice: finalPrice
        };
      });
      
      const order = new Order({
        user: userId,
        orderNumber: generateOrderNumber(),
        items: orderItems,
        totalAmount: total,
        paymentMethod: 'test',
        paymentId: testSessionId,
        status: 'completed'
      });
      await order.save();

      try {
        const userDoc = await User.findById(userId).select('email');
        if (userDoc?.email as string) {
          // sendOrderConfirmation(userDoc.email, order);
        }
      } catch (emailErr) {}

      try {
        // import leveling
        const allOrders = await Order.find({ user: userId, status: 'completed' });
        let totalGamesBought = 0;
        allOrders.forEach(o => totalGamesBought += o.items.length);
        await addExpAndCheckBadges(userId, 50 * order.items.length, { gamesBought: totalGamesBought });
      } catch (e) {
        console.error("Leveling error:", e);
      }
    } catch (orderError) {}
    
    res.json({
      success: true,
      items: processedItems,
      totalAmount: total,
      sessionId: testSessionId,
      message: "Test payment successful"
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const createCheckoutSession = async (req: Request, res: Response) => {
  try {
    const { cartItems } = req.body;
    const userId = req.user?._id;
    if (userId) {
      const completedOrders = await Order.find({ user: userId, status: 'completed' });
      const ownedGameIds = new Set();
      completedOrders.forEach(order => {
        order.items.forEach((item: any) => {
          if (item.game) ownedGameIds.add(item.game?.toString());
        });
      });

      const alreadyOwned = cartItems.filter((item: any) => ownedGameIds.has(item._id));
      if (alreadyOwned.length > 0) {
        return res.status(400).json({
          message: `Bạn đã sở hữu: ${alreadyOwned.map((g: any) => g.name).join(', ')}. Vui lòng xóa khỏi giỏ hàng.`,
          ownedGames: alreadyOwned.map((g: any) => g._id)
        });
      }
    }

    // Fetch games from DB
    const gameIds = cartItems.map((item: any) => item._id);
    const gamesInDb = await Game.find({ _id: { $in: gameIds } });

    const line_items = cartItems.map((item: any) => {
      const dbGame = gamesInDb.find((g: any) => g._id.toString() === item._id);
      if (!dbGame) throw new Error(`Không tìm thấy game: ${item.name}`);

      let finalPrice = dbGame.price;
      if (dbGame.discountType && dbGame.discountType !== 'none') {
        const now = new Date();
        const start = dbGame.discountStartDate ? new Date(dbGame.discountStartDate) : null;
        const end = dbGame.discountEndDate ? new Date(dbGame.discountEndDate) : null;
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        if (isDiscountActive) {
          if (dbGame.discountType === 'percentage') {
            finalPrice = dbGame.price * (1 - (dbGame.discountValue || 0) / 100);
          } else if (dbGame.discountType === 'fixed') {
            finalPrice = Math.max(0, dbGame.price - (dbGame.discountValue || 0));
          }
        }
      }

      let imageUrl = dbGame.image;
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
        if (typeof imageUrl === "string" && imageUrl.startsWith("/")) {
          imageUrl = `${process.env.FRONTEND_URL}${imageUrl}`;
        } else {
          imageUrl = "https://via.placeholder.com/200x200?text=" + encodeURIComponent(dbGame.name);
        }
      }

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: dbGame.name,
            images: [imageUrl],
            metadata: {
              platform: Array.isArray(dbGame.platform) ? dbGame.platform.join(", ") : dbGame.platform,
              id: dbGame._id.toString(),
              originalPrice: dbGame.price.toString(),
              discountedPrice: finalPrice.toString(),
              discountType: dbGame.discountType || 'none',
              discountValue: (dbGame.discountValue || 0).toString(),
            },
          },
          unit_amount: Math.round(finalPrice * 100),
        },
        quantity: item.quantity,
      };
    });

    const frontendBase = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
    const session = await (stripe as any).checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: `${frontendBase}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}/cancel`,
      metadata: { userId: req.user?._id?.toString() || 'guest' },
      client_reference_id: req.user?._id?.toString() || 'guest'
    });
    res.json({ url: session.url });
  } catch (error: any) {
    res.status(500).json({ message: "Không thể tạo phiên thanh toán" });
  }
};

const createOrderFromSession = async (req: Request, res: Response) => {
  try {
    const { sessionId, cartItems } = req.body;
    const userId = (req as any).user._id;
    if (!sessionId || !cartItems || !Array.isArray(cartItems)) {
      return res.status(400).json({ message: "Session ID và cart items là bắt buộc" });
    }
    
    const session = await (stripe as any).checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ message: "Session không hợp lệ hoặc thanh toán chưa hoàn thành" });
    }
    
    const existingOrder = await Order.findOne({ paymentId: sessionId });
    if (existingOrder) {
      try {
        const userDoc = await User.findById(userId).select('email');
        if (userDoc?.email as string) sendOrderConfirmation(userDoc.email, existingOrder).catch(err => console.error('Email error:', err));
      } catch (e) {}
      return res.json(existingOrder);
    }
    
    const gameIds = cartItems.map((item: any) => item._id);
    const gamesInDb = await Game.find({ _id: { $in: gameIds } });

    let totalAmount = 0;
    const orderItems = cartItems.map((item: any) => {
      const dbGame = gamesInDb.find((g: any) => g._id.toString() === item._id);
      if (!dbGame) throw new Error(`Không tìm thấy game: ${item.name}`);

      let finalPrice = dbGame.price;
      if (dbGame.discountType && dbGame.discountType !== 'none') {
        const now = new Date();
        const start = dbGame.discountStartDate ? new Date(dbGame.discountStartDate) : null;
        const end = dbGame.discountEndDate ? new Date(dbGame.discountEndDate) : null;
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        if (isDiscountActive) {
          if (dbGame.discountType === 'percentage') {
            finalPrice = dbGame.price * (1 - (dbGame.discountValue || 0) / 100);
          } else if (dbGame.discountType === 'fixed') {
            finalPrice = Math.max(0, dbGame.price - (dbGame.discountValue || 0));
          }
        }
      }
      totalAmount += finalPrice * item.quantity;
      return {
        game: item._id,
        name: dbGame.name,
        price: dbGame.price,
        quantity: item.quantity,
        image: dbGame.image || '',
        discountType: dbGame.discountType || 'none',
        discountValue: dbGame.discountValue || 0,
        finalPrice: finalPrice
      };
    });
    
    const order = new Order({
      user: userId,
      orderNumber: generateOrderNumber(),
      items: orderItems,
      totalAmount,
      paymentMethod: 'stripe',
      paymentId: sessionId,
      status: 'completed'
    });
    await order.save();
    
    try { await order.populate('items.game', 'name genre image rating'); } catch (e) {}
    await syncAnalytics(order);

    try {
      const userDoc = await User.findById(userId).select('email');
      if (userDoc?.email as string) sendOrderConfirmation(userDoc.email, order).catch(err => console.error('Email error:', err));
    } catch (e) {}

    try {
      // import leveling
      const allOrders = await Order.find({ user: userId, status: 'completed' });
      let totalGamesBought = 0;
      allOrders.forEach(o => totalGamesBought += o.items.length);
      await addExpAndCheckBadges(userId, 50 * order.items.length, { gamesBought: totalGamesBought });
    } catch (e) {
      console.error("Leveling error:", e);
    }
    
    res.status(201).json(order);
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi tạo đơn hàng" });
  }
};

const handleStripeWebhook = async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    // @ts-ignore - TODO: Fix TS error
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err: any) {
    return res.status(400).send(`Webhook signature verification failed.`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      try {
        const existingOrder = await Order.findOne({ paymentId: session.id });
        if (existingOrder && existingOrder.items.length > 0) break;
        
        let userId = session.metadata?.userId || session.client_reference_id;
        if (userId && userId !== 'guest') {
          const lineItems = await (stripe as any).checkout.sessions.listLineItems(session.id, { expand: ['data.price.product'] });
          const orderItems = lineItems.data.map((item: any) => {
            const product = item.price.product;
            const metadata = product.metadata || {};
            return {
              game: metadata.id,
              name: item.description,
              price: parseFloat(metadata.originalPrice) || (item.amount_total / 100 / item.quantity),
              quantity: item.quantity,
              image: product.images?.[0] || 'https://via.placeholder.com/200x200?text=Game',
              discountType: metadata.discountType || 'none',
              discountValue: parseFloat(metadata.discountValue) || 0,
              finalPrice: item.amount_total / 100 / item.quantity
            };
          });

          if (existingOrder) {
            existingOrder.items = orderItems;
            existingOrder.totalAmount = (session as any)?.amount_total / 100;
            await existingOrder.save();
          } else {
            const orderData = {
              user: userId,
              orderNumber: generateOrderNumber(),
              items: orderItems,
              totalAmount: (session as any)?.amount_total / 100,
              paymentMethod: "stripe",
              paymentId: session.id,
              status: "completed"
            };
            const order = new Order(orderData);
            await order.save();
            try {
              const userDoc = await User.findById(userId).select('email');
              if (userDoc?.email as string) sendOrderConfirmation(userDoc.email, order).catch(err => console.error('Email error:', err));
            } catch (e) {}
            await syncAnalytics(order);

            try {
              // import leveling
              const allOrders = await Order.find({ user: userId, status: 'completed' });
              let totalGamesBought = 0;
              allOrders.forEach(o => totalGamesBought += o.items.length);
              await addExpAndCheckBadges(userId, 50 * order.items.length, { gamesBought: totalGamesBought });
            } catch (e) {
              console.error("Leveling error:", e);
            }
          }
        }
      } catch (error: any) {}
      break;
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      const failedSession = event.data.object;
      try {
        await Order.findOneAndUpdate({ paymentId: failedSession.id }, { status: "failed", updatedAt: new Date() });
      } catch (error: any) {}
      break;
  }
  res.send();
};

const getUserOrders = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;
    const { page = 1, limit = 10, status } = req.query;
    const query: any = { user: userId };
    if (status && status !== 'all') query.status = status;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const orders = await Order.find(query)
      .populate('items.game', 'name genre image rating')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit as string));
    const total = await Order.countDocuments(query);
    res.json({
      orders,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi lấy lịch sử đơn hàng" });
  }
};

const getPurchasedGames = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({ user: (req as any).user._id, status: 'completed' }).populate('items.game', 'name genre image rating platform');
    const purchasedGames: any[] = [];
    const gameIds = new Set();
    orders.forEach(order => {
      order.items.forEach((item: any) => {
        if (item.game && !gameIds.has(item.game?._id.toString())) {
          gameIds.add(item.game?._id.toString());
          purchasedGames.push({ ...item.game?.toObject(), purchasedAt: order.createdAt, price: item.finalPrice || item.price });
        }
      });
    });
    res.json(purchasedGames);
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi lấy game đã mua" });
  }
};

const getOwnedGameIds = async (req: Request, res: Response) => {
  try {
    const orders = await Order.find({ user: (req as any).user._id, status: 'completed' });
    const ownedIds = new Set();
    orders.forEach(order => {
      order.items.forEach((item: any) => { if (item.game) ownedIds.add(item.game?.toString()); });
    });
    res.json([...ownedIds]);
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const getAllOrdersAdmin = async (req: Request, res: Response) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const query: any = {};
    if (status && status !== 'all') query.status = status;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const total = await Order.countDocuments(query);
    const orders = await Order.find(query)
      .populate('user', 'email')
      .populate('items.game', 'name image price')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit as string));
    res.json({
      orders,
      pagination: { page: parseInt(page as string), limit: parseInt(limit as string), total, pages: Math.ceil(total / parseInt(limit as string)) }
    });
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ" });
  }
};

const getOrderById = async (req: Request, res: Response) => {
  try {
    const order = await Order.findOne({ _id: req.params.id, user: (req as any).user._id })
      .populate('items.game', 'name genre image rating description platform');
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    res.json(order);
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi lấy chi tiết đơn hàng" });
  }
};

const createOrder = async (req: Request, res: Response) => {
  try {
    const { items, totalAmount, paymentMethod, paymentId, status = 'pending' } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Giỏ hàng trống" });
    }

    // Only allow manual completed orders from admins, otherwise force pending
    let finalStatus = status;
    const user = (req as any).user;
    if (status === 'completed' && !user.isAdmin) {
      finalStatus = 'pending';
    }

    const order = new Order({
      user: user._id,
      orderNumber: generateOrderNumber(),
      items,
      totalAmount,
      paymentMethod,
      paymentId: paymentId || `manual_${Date.now()}`,
      status: finalStatus
    });
    await order.save();
    try { await order.populate('items.game', 'name genre image rating'); } catch(e){}
    await syncAnalytics(order);
    res.status(201).json(order);
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi tạo đơn hàng" });
  }
};

const updateOrderStatus = async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!['pending', 'completed', 'failed', 'refunded'].includes(status)) {
      return res.status(400).json({ message: "Trạng thái không hợp lệ" });
    }
    const order = await Order.findByIdAndUpdate(req.params.id, { status, updatedAt: new Date() }, { new: true })
      .populate('items.game', 'name genre image rating');
    if (!order) return res.status(404).json({ message: "Không tìm thấy đơn hàng" });
    res.json(order);
  } catch (error: any) {
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật" });
  }
};

export default {
  createTestPayment,
  createCheckoutSession,
  createOrderFromSession,
  handleStripeWebhook,
  getUserOrders,
  getPurchasedGames,
  getOwnedGameIds,
  getAllOrdersAdmin,
  getOrderById,
  createOrder,
  updateOrderStatus
};
