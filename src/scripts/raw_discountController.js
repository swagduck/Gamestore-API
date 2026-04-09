// == Discount Routes (Admin only) ==

// GET all discounts
app.get("/api/discounts", verifyAdmin, async (req, res) => {
  try {
    const discounts = await Discount.find().sort({ createdAt: -1 });
    res.json(discounts);
  } catch (error) {
    console.error("Lỗi khi lấy danh sách mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// GET discount by ID
app.get("/api/discounts/:id", verifyAdmin, async (req, res) => {
  try {
    const discount = await Discount.findById(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Không tìm thấy mã giảm giá." });
    }
    res.json(discount);
  } catch (error) {
    console.error("Lỗi khi lấy mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ." });
  }
});

// POST create new discount
app.post("/api/discounts", verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    } = req.body;

    // Validate required fields
    if (!name || !code || !type || !value || !startDate || !endDate) {
      return res.status(400).json({
        message: "Name, code, type, value, startDate, và endDate là bắt buộc."
      });
    }

    // Check if discount code already exists
    const existingDiscount = await Discount.findOne({ code: code.toUpperCase() });
    if (existingDiscount) {
      return res.status(400).json({ message: "Mã giảm giá đã tồn tại." });
    }

    // Create new discount
    const discount = new Discount({
      name,
      code: code.toUpperCase(),
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    });

    await discount.save();
    res.status(201).json({
      message: "Mã giảm giá đã được tạo thành công.",
      discount
    });
  } catch (error) {
    console.error("Lỗi khi tạo mã giảm giá:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi tạo mã giảm giá." });
  }
});

// PUT update discount
app.put("/api/discounts/:id", verifyAdmin, async (req, res) => {
  try {
    const {
      name,
      code,
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    } = req.body;

    const discount = await Discount.findById(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Không tìm thấy mã giảm giá." });
    }

    // Check if new code conflicts with existing discount (if code is being changed)
    if (code && code !== discount.code) {
      const existingDiscount = await Discount.findOne({ 
        code: code.toUpperCase(),
        _id: { $ne: req.params.id }
      });
      if (existingDiscount) {
        return res.status(400).json({ message: "Mã giảm giá đã tồn tại." });
      }
    }

    // Update discount fields
    const updateData = {
      name,
      code: code ? code.toUpperCase() : discount.code,
      description,
      type,
      value,
      startDate,
      endDate,
      minOrderValue,
      maxDiscountAmount,
      usageLimit,
      isActive
    };

    // Remove undefined fields
    Object.keys(updateData).forEach(key => 
      updateData[key] === undefined && delete updateData[key]
    );

    const updatedDiscount = await Discount.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    res.json({
      message: "Mã giảm giá đã được cập nhật thành công.",
      discount: updatedDiscount
    });
  } catch (error) {
    console.error("Lỗi khi cập nhật mã giảm giá:", error);
    if (error.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Lỗi máy chủ khi cập nhật mã giảm giá." });
  }
});

// DELETE discount
app.delete("/api/discounts/:id", verifyAdmin, async (req, res) => {
  try {
    const discount = await Discount.findById(req.params.id);
    if (!discount) {
      return res.status(404).json({ message: "Không tìm thấy mã giảm giá." });
    }

    await Discount.findByIdAndDelete(req.params.id);
    res.json({ message: "Mã giảm giá đã được xóa thành công." });
  } catch (error) {
    console.error("Lỗi khi xóa mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi xóa mã giảm giá." });
  }
});

// POST validate discount code (public endpoint for cart checkout)
app.post("/api/discounts/validate", async (req, res) => {
  try {
    const { code, orderValue } = req.body;

    if (!code) {
      return res.status(400).json({ message: "Mã giảm giá là bắt buộc." });
    }

    const discount = await Discount.findOne({ code: code.toUpperCase() });
    if (!discount) {
      return res.status(404).json({ message: "Mã giảm giá không tồn tại." });
    }

    // Check if discount can be used
    if (!discount.canBeUsed()) {
      return res.status(400).json({ 
        message: "Mã giảm giá không hợp lệ hoặc đã hết hạn." 
      });
    }

    // Check minimum order value
    if (discount.minOrderValue && orderValue < discount.minOrderValue) {
      return res.status(400).json({ 
        message: `Giá trị đơn hàng tối thiểu là $${discount.minOrderValue}.` 
      });
    }

    // Calculate discount amount
    let discountAmount = 0;
    if (discount.type === 'percentage') {
      discountAmount = orderValue * (discount.value / 100);
      // Apply max discount amount limit if set
      if (discount.maxDiscountAmount && discountAmount > discount.maxDiscountAmount) {
        discountAmount = discount.maxDiscountAmount;
      }
    } else {
      discountAmount = discount.value;
    }

    const finalAmount = Math.max(0, orderValue - discountAmount);

    res.json({
      valid: true,
      discount: {
        id: discount._id,
        name: discount.name,
        code: discount.code,
        type: discount.type,
        value: discount.value,
        discountAmount,
        finalAmount
      }
    });
  } catch (error) {
    console.error("Lỗi khi xác thực mã giảm giá:", error);
    res.status(500).json({ message: "Lỗi máy chủ khi xác thực mã giảm giá." });
  }
});

