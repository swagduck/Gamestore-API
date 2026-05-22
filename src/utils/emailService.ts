import {  Resend  } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

console.log('📬 [EmailService-Resend] Module loading...');
console.log('📬 [EmailService-Resend] API Key status:', process.env.RESEND_API_KEY ? 'CONFIGURED' : 'MISSING');

// --- Helper: Format currency ---
// @ts-ignore - TODO: Fix TS error
const formatPrice = (price) => {
  if (price === 0) return 'MIỄN PHÍ';
  return `$${Number(price).toFixed(2)}`;
};

// --- HTML Email Template ---
// @ts-ignore - TODO: Fix TS error
const buildOrderEmailHTML = (order, userEmail) => {
  const itemRows = order.items.map((item: any) => `
    <tr>
      <td style="padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td width="64" valign="top">
              ${item.image ? `<img src="${item.image}" alt="${item.name}" style="width: 64px; height: 64px; border-radius: 12px; object-fit: cover; display: block;" />` : `<div style="width: 64px; height: 64px; border-radius: 12px; background: #2a2a3e;"></div>`}
            </td>
            <td valign="top" style="padding-left: 16px;">
              <div style="color: #ffffff; font-weight: 600; font-size: 15px; margin-bottom: 4px;">${item.name}</div>
              ${item.discountType && item.discountType !== 'none' ? `<div style="color: #94a3b8; font-size: 13px; text-decoration: line-through;">$${Number(item.price).toFixed(2)}</div>` : ''}
              <div style="color: #a78bfa; font-weight: 700; font-size: 15px; margin-top: 4px;">${formatPrice(item.finalPrice || item.price)}</div>
            </td>
            <td valign="top" align="right" style="color: #94a3b8; font-size: 14px; font-weight: 500;">
              x${item.quantity || 1}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  `).join('');

  const orderDate = new Date(order.createdAt).toLocaleDateString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const frontendBase = (process.env.FRONTEND_URL || 'https://my-ecommerce-app-red.vercel.app').replace(/\/$/, "");

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Xác nhận đơn hàng</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0d0d14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #0d0d14; padding: 40px 20px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table width="100%" max-width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; background-color: #151522; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%); padding: 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase;">🎮 Gam34Pers</h1>
              <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 15px;">Biên lai điện tử của bạn</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 30px;">
              <p style="margin: 0 0 10px 0; color: #ffffff; font-size: 18px; font-weight: 600;">Xin chào 👋</p>
              <p style="margin: 0 0 30px 0; color: #94a3b8; font-size: 15px; line-height: 1.6;">
                Cảm ơn bạn đã mua sắm tại Gam34Pers. Giao dịch của bạn đã được xử lý thành công. Dưới đây là chi tiết đơn hàng:
              </p>

              <!-- Order Info Box (Safe Table Layout) -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 30px;">
                <tr>
                  <td style="padding: 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td width="50%" valign="top">
                          <p style="margin: 0 0 4px 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Mã đơn hàng</p>
                          <p style="margin: 0; color: #e2e8f0; font-size: 15px; font-weight: 600;">${order.orderNumber}</p>
                        </td>
                        <td width="50%" valign="top" align="right">
                          <p style="margin: 0 0 4px 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Ngày giao dịch</p>
                          <p style="margin: 0; color: #e2e8f0; font-size: 15px; font-weight: 600;">${orderDate}</p>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding-top: 16px;">
                          <div style="border-top: 1px solid rgba(255,255,255,0.05); margin-bottom: 16px;"></div>
                        </td>
                      </tr>
                      <tr>
                        <td colspan="2" valign="top">
                          <p style="margin: 0 0 4px 0; color: #64748b; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Trạng thái thanh toán</p>
                          <p style="margin: 0; color: #34d399; font-size: 14px; font-weight: 700;">✅ Đã thanh toán thành công qua Stripe</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Items -->
              <h2 style="margin: 0 0 15px 0; color: #ffffff; font-size: 16px; font-weight: 700; border-bottom: 2px solid #a855f7; padding-bottom: 8px; display: inline-block;">Sản phẩm đã mua</h2>
              
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 20px;">
                ${itemRows}
              </table>

              <!-- Total -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: rgba(168, 85, 247, 0.1); border-radius: 12px; padding: 20px; margin-bottom: 35px;">
                <tr>
                  <td align="right">
                    <span style="color: #94a3b8; font-size: 15px; margin-right: 12px;">Tổng thanh toán:</span>
                    <span style="color: #c084fc; font-size: 24px; font-weight: 800;">$${Number(order.totalAmount).toFixed(2)}</span>
                  </td>
                </tr>
              </table>

              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center">
                    <a href="${frontendBase}/orders" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #9333ea 100%); color: #ffffff; text-decoration: none; font-size: 15px; font-weight: 700; padding: 16px 40px; border-radius: 30px; text-transform: uppercase; letter-spacing: 1px;">
                      Vào thư viện của bạn
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin: 35px 0 0 0; color: #64748b; font-size: 13px; text-align: center; line-height: 1.6;">
                Cần hỗ trợ? Hãy trả lời trực tiếp email này.<br/>
                Email tự động từ hệ thống Gam34Pers.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #0a0a0f; padding: 24px; text-align: center;">
              <p style="margin: 0; color: #475569; font-size: 12px;">
                © 2026 Gam34Pers · Van Lang University<br/>
                Made with ❤️ for Gamers
              </p>
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
const sendOrderConfirmation = async (userEmail: any, order: any) => {
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
  } catch (error: any) {
    console.error(`❌ Unexpected error sending via Resend:`, error.message);
  }
};

export { sendOrderConfirmation };
