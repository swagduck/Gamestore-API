// == Stripe Checkout Route ==
app.post("/api/create-checkout-session", verifyToken, async (req, res) => {
  try {
    const { cartItems } = req.body;

    // Check for already-owned games before checkout
    const userId = req.user?._id;
    if (userId) {
      const completedOrders = await Order.find({ user: userId, status: 'completed' });
      const ownedGameIds = new Set();
      completedOrders.forEach(order => {
        order.items.forEach(item => {
          if (item.game) ownedGameIds.add(item.game.toString());
        });
      });

      const alreadyOwned = cartItems.filter(item => ownedGameIds.has(item._id));
      if (alreadyOwned.length > 0) {
        return res.status(400).json({
          message: `Bạn đã sở hữu: ${alreadyOwned.map(g => g.name).join(', ')}. Vui lòng xóa khỏi giỏ hàng.`,
          ownedGames: alreadyOwned.map(g => g._id)
        });
      }
    }

    const line_items = cartItems.map((item) => {
      // Calculate discounted price
      let finalPrice = item.price;
      
      // Check if discount is active
      if (item.discountType && item.discountType !== 'none') {
        const now = new Date();
        const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
        const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
        
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        
        if (isDiscountActive) {
          if (item.discountType === 'percentage') {
            finalPrice = item.price * (1 - item.discountValue / 100);
          } else if (item.discountType === 'fixed') {
            finalPrice = Math.max(0, item.price - item.discountValue);
          }
        }
      }

      // Basic validation for image URL
      let imageUrl = item.image;
      if (typeof imageUrl !== "string" || !imageUrl.startsWith("http")) {
        // If it starts with / it's a relative path, prepend frontend URL
        if (typeof imageUrl === "string" && imageUrl.startsWith("/")) {
          imageUrl = `${process.env.FRONTEND_URL}${imageUrl}`;
        } else {
          console.warn(`Invalid image URL for ${item.name}: ${imageUrl}. Using placeholder.`);
          imageUrl = "https://via.placeholder.com/200x200?text=" + encodeURIComponent(item.name);
        }
      }

      return {
        price_data: {
          currency: "usd",
          product_data: {
            name: item.name,
            images: [imageUrl], // Must be an array of absolute URLs
            metadata: {
              platform: Array.isArray(item.platform)
                ? item.platform.join(", ")
                : item.platform,
              id: item._id,
              originalPrice: item.price,
              discountedPrice: finalPrice,
              discountType: item.discountType || 'none',
              discountValue: item.discountValue || 0,
            },
          },
          unit_amount: Math.round(finalPrice * 100), // Use discounted price in cents
        },
        quantity: item.quantity,
      };
    });
    // Clean FRONTEND_URL by removing trailing slash if it exists
    const frontendBase = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: line_items,
      mode: "payment",
      success_url: `${frontendBase}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendBase}/cancel`,
      metadata: {
        userId: req.user?._id?.toString() || 'guest' // Include user ID in metadata
      },
      client_reference_id: req.user?._id?.toString() || 'guest' // Alternative way to track user
    });
    res.json({ url: session.url }); // Return the checkout session URL
  } catch (error) {
    console.error("Lỗi khi tạo phiên Stripe:", error);
    res.status(500).json({ message: "Không thể tạo phiên thanh toán" });
  }
});

// == Order Creation from Frontend Success Page ==
app.post("/api/orders/create-from-session", verifyToken, async (req, res) => {
  try {
    const { sessionId, cartItems } = req.body;
    const userId = req.user._id;
    
    if (!sessionId || !cartItems || !Array.isArray(cartItems)) {
      return res.status(400).json({ message: "Session ID và cart items là bắt buộc" });
    }
    
    // Verify the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    if (!session || session.payment_status !== 'paid') {
      return res.status(400).json({ message: "Session không hợp lệ hoặc thanh toán chưa hoàn thành" });
    }
    
    // Check if order already exists for this session
    const existingOrder = await Order.findOne({ paymentId: sessionId });
    if (existingOrder) {
      // Even if order exists, try to send confirmation email if not sent yet
      try {
        const userDoc = await User.findById(userId).select('email');
        if (userDoc?.email) {
          sendOrderConfirmation(userDoc.email, existingOrder);
        }
      } catch (e) { console.error('Email retry failed'); }
      
      return res.json(existingOrder); // Return existing order
    }
    
    // Calculate total and prepare order items
    let totalAmount = 0;
    const orderItems = cartItems.map(item => {
      let finalPrice = item.price;
      
      // Validate item has required fields (allow price 0 for free games)
      if (!item._id || !item.name || item.price === undefined || !item.quantity) {
        throw new Error(`Item thiếu thông tin bắt buộc: ${JSON.stringify(item)}`);
      }
      
      // Apply discount if active
      if (item.discountType && item.discountType !== 'none') {
        const now = new Date();
        const start = item.discountStartDate ? new Date(item.discountStartDate) : null;
        const end = item.discountEndDate ? new Date(item.discountEndDate) : null;
        const isDiscountActive = (!start || now >= start) && (!end || now <= end);
        
        if (isDiscountActive) {
          if (item.discountType === 'percentage') {
            finalPrice = item.price * (1 - item.discountValue / 100);
          } else if (item.discountType === 'fixed') {
            finalPrice = Math.max(0, item.price - item.discountValue);
          }
        }
      }
      
      totalAmount += finalPrice * item.quantity;
      
      return {
        game: item._id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        image: item.image || '',
        discountType: item.discountType || 'none',
        discountValue: item.discountValue || 0,
        finalPrice: finalPrice
      };
    });
    
    // Create order
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
    
    // Try to populate game details, but handle errors gracefully
    try {
      await order.populate('items.game', 'name genre image rating');
    } catch (populateError) {
      console.warn('⚠️ Could not populate game details:', populateError.message);
      // Continue without population - the order is still saved
    }
    
    console.log(`✅ Order created from frontend: ${order._id} for user ${userId}`);
    
    // Update analytics
    await syncAnalytics(order);

    // Send confirmation email (non-blocking)
    try {
      const userDoc = await User.findById(userId).select('email');
      if (userDoc?.email) {
        sendOrderConfirmation(userDoc.email, order);
      }
    } catch (emailErr) {
      console.warn('Could not fetch user email for confirmation:', emailErr.message);
    }
    
    res.status(201).json(order);
  } catch (error) {
    console.error("Lỗi khi tạo đơn hàng từ session:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi tạo đơn hàng" });
  }
});

// == Stripe Webhook for Payment Completion ==
app.post("/api/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log(`Webhook signature verification failed.`, err.message);
    return res.status(400).send(`Webhook signature verification failed.`);
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      
      try {
        // Check if order already exists for this session
        const existingOrder = await Order.findOne({ paymentId: session.id });
        if (existingOrder && existingOrder.items.length > 0) {
          console.log(`⚠️ Order already exists and populated for session ${session.id}: ${existingOrder._id}`);
          break;
        }
        
        // Get user ID from multiple sources
        let userId = session.metadata?.userId || session.client_reference_id;
        
        // Only create or update order if we have a valid user ID (not 'guest')
        if (userId && userId !== 'guest') {
          // Fetch line items to get products
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            expand: ['data.price.product']
          });

          const orderItems = lineItems.data.map(item => {
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
            // Update the basic order created previously (if any)
            existingOrder.items = orderItems;
            existingOrder.totalAmount = session.amount_total / 100;
            await existingOrder.save();
            console.log(`✅ Order updated from webhook with ${orderItems.length} items: ${existingOrder._id}`);
          } else {
            // Create a new order if it doesn't exist
            const orderData = {
              user: userId,
              orderNumber: generateOrderNumber(),
              items: orderItems,
              totalAmount: session.amount_total / 100,
              paymentMethod: "stripe",
              paymentId: session.id,
              status: "completed"
            };
            
            const order = new Order(orderData);
            await order.save();
            console.log(`✅ Order created from webhook with ${orderItems.length} items for user ${userId}: ${order._id}`);

            // Send confirmation email from webhook
            try {
              const userDoc = await User.findById(userId).select('email');
              if (userDoc?.email) {
                sendOrderConfirmation(userDoc.email, order);
              }
            } catch (emailErr) {
              console.warn('Webhook email failed:', emailErr.message);
            }

            // Update analytics
            await syncAnalytics(order);
          }
        } else {
          console.log(`⚠️ No valid user ID found in session ${session.id}, skipping order creation`);
        }
      } catch (error) {
        console.error("Error processing checkout.session.completed webhook:", error);
      }
      break;

    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      const failedSession = event.data.object;
      console.log(`❌ Payment failed for session: ${failedSession.id}`);
      
      // Update order status to failed if it exists
      try {
        await Order.findOneAndUpdate(
          { paymentId: failedSession.id },
          { status: "failed", updatedAt: new Date() }
        );
      } catch (error) {
        console.error("Error updating failed order:", error);
      }
      break;

    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  // Return a 200 response to acknowledge receipt of the event
  res.send();
});

