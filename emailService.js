const nodemailer = require('nodemailer');

// --- Transporter Setup ---
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASSWORD, // Gmail App Password (16 chars)
  },
});

// --- Helper: Format currency ---
const formatPrice = (price) => {
  if (price === 0) return '<span style="color:#43A047;font-weight:700;">MIỄN PHÍ</span>';
  return `$${Number(price).toFixed(2)}`;
};

// --- HTML Email Template ---
const buildOrderEmailHTML = (order, userEmail) => {
  const itemRows = order.items.map(item => `
    <tr>
      <td style="padding:12px 16px;border-bottom:1px solid #2a2a3e;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width:56px;height:56px;border-radius:8px;object-fit:cover;flex-shrink:0;" />` : ''}
          <div>
            <div style="color:#e2e8f0;font-weight:600;font-size:14px;">${item.name}</div>
            ${item.discountType && item.discountType !== 'none' ? `<div style="color:#94a3b8;font-size:12px;text-decoration:line-through;">$${Number(item.price).toFixed(2)}</div>` : ''}
          </div>
        </div>
      </td>
      <td style="padding:12px 16px;border-bottom:1px solid #2a2a3e;text-align:right;color:#a78bfa;font-weight:700;font-size:15px;white-space:nowrap;">
        ${formatPrice(item.finalPrice || item.price)}
      </td>
    </tr>
  `).join('');

  const orderDate = new Date(order.createdAt).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const frontendUrl = process.env.FRONTEND_URL || 'https://my-ecommerce-app-red.vercel.app';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Xác nhận đơn hàng</title>
</head>
<body style="margin:0;padding:0;background:#0f0f1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1a1a2e;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.5);">

          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#646cff,#a855f7);padding:36px 40px;text-align:center;">
              <div style="font-size:28px;font-weight:800;color:white;letter-spacing:2px;">🎮 Gam34Pers</div>
              <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:6px;">Cảm ơn bạn đã tin tưởng mua tại cửa hàng!</div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="padding:32px 40px;">

              <!-- Greeting -->
              <p style="color:#e2e8f0;font-size:16px;margin:0 0 8px;">Xin chào <strong>${userEmail.split('@')[0]}</strong> 👋</p>
              <p style="color:#94a3b8;font-size:14px;margin:0 0 28px;line-height:1.6;">
                Đơn hàng của bạn đã được xác nhận thành công. Dưới đây là chi tiết đơn hàng của bạn:
              </p>

              <!-- Order Info Box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;border-radius:10px;margin-bottom:24px;">
                <tr>
                  <td style="padding:16px 20px;border-bottom:1px solid #2a2a3e;">
                    <span style="color:#94a3b8;font-size:13px;">Mã đơn hàng</span>
                    <div style="color:#a78bfa;font-weight:700;font-size:15px;margin-top:4px;">${order.orderNumber}</div>
                  </td>
                  <td style="padding:16px 20px;border-bottom:1px solid #2a2a3e;text-align:right;">
                    <span style="color:#94a3b8;font-size:13px;">Ngày mua</span>
                    <div style="color:#e2e8f0;font-weight:600;font-size:14px;margin-top:4px;">${orderDate}</div>
                  </td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:16px 20px;">
                    <span style="color:#94a3b8;font-size:13px;">Trạng thái</span>
                    <div style="margin-top:6px;">
                      <span style="background:#166534;color:#86efac;font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;">✅ Thanh toán thành công</span>
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Items Table -->
              <p style="color:#e2e8f0;font-weight:700;font-size:15px;margin:0 0 12px;">📋 Game đã mua</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;border-radius:10px;overflow:hidden;margin-bottom:24px;">
                ${itemRows}
                <!-- Total -->
                <tr>
                  <td style="padding:16px 20px;text-align:right;" colspan="2">
                    <span style="color:#94a3b8;font-size:14px;">Tổng cộng: </span>
                    <span style="color:#a78bfa;font-weight:800;font-size:20px;margin-left:8px;">$${Number(order.totalAmount).toFixed(2)}</span>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <div style="text-align:center;margin:28px 0 12px;">
                <a href="${frontendUrl}/orders"
                   style="display:inline-block;background:linear-gradient(135deg,#646cff,#a855f7);color:white;text-decoration:none;font-weight:700;font-size:15px;padding:14px 36px;border-radius:30px;box-shadow:0 4px 20px rgba(100,108,255,0.4);">
                  Xem lịch sử đơn hàng →
                </a>
              </div>

              <p style="color:#64748b;font-size:12px;text-align:center;margin-top:20px;line-height:1.6;">
                Nếu bạn có thắc mắc, hãy liên hệ với chúng tôi.<br/>
                Email này được gửi tự động, vui lòng không trả lời.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#0f0f1a;padding:20px 40px;text-align:center;border-top:1px solid #2a2a3e;">
              <p style="color:#475569;font-size:12px;margin:0;">© 2025 Gam34Pers · Hệ Thống Thông Tin · Van Lang University</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// --- Main Export Function ---
const sendOrderConfirmation = async (userEmail, order) => {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_APP_PASSWORD) {
    console.warn('⚠️ Email credentials not configured. Skipping confirmation email.');
    return;
  }

  try {
    const info = await transporter.sendMail({
      from: `"Gam34Pers 🎮" <${process.env.EMAIL_USER}>`,
      to: userEmail,
      subject: `✅ Xác nhận đơn hàng ${order.orderNumber} - Gam34Pers`,
      html: buildOrderEmailHTML(order, userEmail),
    });
    console.log(`📧 Order confirmation email sent to ${userEmail}: ${info.messageId}`);
  } catch (error) {
    // Non-blocking: email failure should never crash the order creation
    console.error(`❌ Failed to send email to ${userEmail}:`, error.message);
  }
};

module.exports = { sendOrderConfirmation };
