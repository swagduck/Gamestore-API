const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

console.log('📬 [EmailService-Resend] Module loading...');
console.log('📬 [EmailService-Resend] API Key status:', process.env.RESEND_API_KEY ? 'CONFIGURED' : 'MISSING');

// --- Helper: Format currency ---
const formatPrice = (price) => {
  if (price === 0) return 'MIỄN PHÍ';
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
  <div style="background:#0f0f1a;padding:40px 20px;">
    <div style="max-width:600px;margin:0 auto;background:#1a1a2e;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.5);">

      <!-- HEADER -->
      <div style="background:linear-gradient(135deg,#646cff,#a855f7);padding:36px 40px;text-align:center;">
        <div style="font-size:28px;font-weight:800;color:white;letter-spacing:2px;">🎮 Gam34Pers</div>
        <div style="color:rgba(255,255,255,0.85);font-size:14px;margin-top:6px;">Cảm ơn bạn đã tin tưởng mua tại cửa hàng!</div>
      </div>

      <!-- BODY -->
      <div style="padding:32px 40px;">
        <p style="color:#e2e8f0;font-size:16px;margin:0 0 8px;">Xin chào 👋</p>
        <p style="color:#94a3b8;font-size:14px;margin:0 0 28px;line-height:1.6;">
          Đơn hàng của bạn đã được xác nhận thành công. Dưới đây là chi tiết đơn hàng của bạn:
        </p>

        <!-- Order Info Box -->
        <div style="background:#0f0f1a;border-radius:10px;margin-bottom:24px;padding:20px;">
          <div style="display:flex;justify-content:space-between;border-bottom:1px solid #2a2a3e;padding-bottom:10px;margin-bottom:10px;">
            <div>
              <span style="color:#94a3b8;font-size:13px;">Mã đơn hàng</span>
              <div style="color:#a78bfa;font-weight:700;font-size:15px;">${order.orderNumber}</div>
            </div>
            <div style="text-align:right;">
              <span style="color:#94a3b8;font-size:13px;">Ngày mua</span>
              <div style="color:#e2e8f0;font-weight:600;font-size:14px;">${orderDate}</div>
            </div>
          </div>
          <div>
            <span style="color:#94a3b8;font-size:13px;">Trạng thái: </span>
            <span style="color:#86efac;font-size:12px;font-weight:700;">✅ Thanh toán thành công</span>
          </div>
        </div>

        <!-- Items Table -->
        <p style="color:#e2e8f0;font-weight:700;font-size:15px;margin:0 0 12px;">📋 Game đã mua</p>
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f1a;border-radius:10px;overflow:hidden;margin-bottom:24px;">
          ${itemRows}
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
          Email này được gửi tự động thông qua Resend API.
        </p>
      </div>

      <!-- FOOTER -->
      <div style="background:#0f0f1a;padding:20px 40px;text-align:center;border-top:1px solid #2a2a3e;">
        <p style="color:#475569;font-size:12px;margin:0;">© 2025 Gam34Pers · Van Lang University</p>
      </div>

    </div>
  </div>
</body>
</html>`;
};

// --- Main Export Function ---
const sendOrderConfirmation = async (userEmail, order) => {
  if (!process.env.RESEND_API_KEY) {
    console.warn('⚠️ RESEND_API_KEY not configured. Skipping confirmation email.');
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'Gam34Pers <onboarding@resend.dev>', // Use default sender for unverified domains
      to: [userEmail],
      subject: `✅ Xác nhận đơn hàng ${order.orderNumber} - Gam34Pers`,
      html: buildOrderEmailHTML(order, userEmail),
    });

    if (error) {
      console.error(`❌ Resend API Error for ${userEmail}:`, error.message);
    } else {
      console.log(`📧 Resend Success for ${userEmail}: ID ${data.id}`);
    }
  } catch (error) {
    console.error(`❌ Unexpected error sending via Resend:`, error.message);
  }
};

module.exports = { sendOrderConfirmation };
