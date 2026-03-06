# Gamestore - E-commerce Platform

Một nền tảng thương mại điện tử chuyên về game với đầy đủ tính năng hiện đại bao gồm AI chatbot, thanh toán Stripe, và quản lý người dùng thông minh.

## 🎯 Tính năng chính

### 🤖 AI Chatbot thông minh

- **GameBot AI** với khả năng xử lý ngôn ngữ tự nhiên
- Nhận diện ý định và trích xuất thực thể
- Phân tích cảm xúc và đề xuất game cá nhân hóa
- Hỗ trợ đa ngôn ngữ (Tiếng Việt & Tiếng Anh)
- Voice input/output với Speech Recognition

### 🛍️ Quản lý sản phẩm

- Thêm, sửa, xóa game
- Tìm kiếm và lọc theo thể loại
- Đánh giá và review sản phẩm
- Hệ thống giảm giá và khuyến mãi

### 💳 Thanh toán trực tuyến

- Tích hợp Stripe Payment Gateway
- Hỗ trợ thanh toán an toàn
- Quản lý đơn hàng tự động

### 👤 Quản lý người dùng

- Đăng ký/Đăng nhập với JWT
- Profile người dùng cá nhân
- Lịch sử mua hàng
- Wishlist và favorites

### 📱 Responsive Design

- UI/UX hiện đại với React + TailwindCSS
- Mobile-friendly
- Real-time notifications với Socket.io

## 📁 Cấu trúc dự án

```
Gamestore/
├── my-ecommerce-api/          # Backend API Server
│   ├── server.js              # Main server file
│   ├── models/                # MongoDB models
│   ├── routes/                # API routes
│   └── package.json
├── my-ecommerce-app/          # Frontend React App
│   ├── src/
│   │   ├── components/        # React components
│   │   ├── pages/            # Page components
│   │   ├── hooks/            # Custom hooks
│   │   └── utils/            # Utility functions
│   ├── public/               # Static assets
│   └── package.json
├── .env                      # Environment variables
├── package.json              # Root package.json
└── README.md                 # This file
```

## 🚀 Hướng dẫn cài đặt và chạy

### Yêu cầu hệ thống

- **Node.js**: phiên bản 18.0 hoặc cao hơn
- **npm**: phiên bản 8.0 hoặc cao hơn
- **MongoDB**: Atlas cloud account

### 1. Clone repository

```bash
git clone <repository-url>
cd Gamestore
```

### 2. Cài đặt dependencies

#### Backend dependencies:

```bash
cd my-ecommerce-api
npm install
```

#### Frontend dependencies:

```bash
cd ../my-ecommerce-app
npm install
```

#### Hoặc cài đặt tất cả từ root:

```bash
npm install
cd my-ecommerce-app && npm install
```

### 3. Cấu hình Environment Variables

Tạo file `.env` trong thư mục root với nội dung:

```env
# MongoDB Configuration
MONGO_URI=mongodb+srv://<username>:<password>@<cluster-url>/gameDatabase?retryWrites=true&w=majority&appName=MongoDB

# Server Configuration
PORT=4000

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_...

# Google Gemini AI
GEMINI_API_KEY=AIzaSy...

# Frontend URL
FRONTEND_URL=http://localhost:5173

# JWT Secret
JWT_SECRET=your-secret-key-here
```

**⚠️ Lưu ý quan trọng:**

- File `.env` hiện tại chứa API keys thật của bạn
- **KHÔNG** nên gửi file `.env` cho giảng viên hoặc commit lên GitHub
- Đã có sẵn file `.env.example` trong project để làm template
- File `.gitignore` đã được cấu hình để loại bỏ `.env` và các file nhạy cảm
- Giảng viên sẽ cần tự cung cấp API keys của họ:
  - **MongoDB Atlas**: Tạo free cluster tại [mongodb.com/atlas](https://mongodb.com/atlas)
  - **Stripe**: Tạo test account tại [stripe.com](https://stripe.com)
  - **Google Gemini AI**: Lấy API key từ [Google AI Studio](https://makersuite.google.com/app/apikey)

**Các bước giảng viên cần làm:**

1. Copy file `.env.example` → `.env`
2. Điền API keys thật vào file `.env`
3. Chạy ứng dụng như hướng dẫn ở bước 4

### 4. Chạy ứng dụng (local)

#### Cách 1: Chạy từng phần riêng biệt

**Backend Server:**

```bash
cd my-ecommerce-api
npm start
# hoặc
npm run dev
```

Server sẽ chạy tại: `http://localhost:4000`

**Frontend App:**

```bash
cd my-ecommerce-app
npm run dev
```

App sẽ chạy tại: `http://localhost:5173`

#### Cách 2: Chạy đồng thời (mở 2 terminal)

**Terminal 1 - Backend:**

```bash
cd my-ecommerce-api
npm start
```

**Terminal 2 - Frontend:**

```bash
cd my-ecommerce-app
npm run dev
```

### 5. Deploy lên Production (Optional)

#### Deploy Backend lên Render

1. Push code lên GitHub repository
2. Đăng nhập [Render Dashboard](https://render.com)
3. Create New → Web Service
4. Connect GitHub repository
5. Cấu hình:
   - **Build Command**: `cd my-ecommerce-api && npm install`
   - **Start Command**: `cd my-ecommerce-api && npm start`
   - **Instance Type**: Free (hoặc paid cho production)
6. Add Environment Variables trong Render Dashboard:
   ```
   MONGO_URI=mongodb+srv://...
   PORT=4000
   STRIPE_SECRET_KEY=sk_test_...
   GEMINI_API_KEY=AIzaSy...
   FRONTEND_URL=https://your-frontend.vercel.app
   JWT_SECRET=your-secret-key
   ```
7. Deploy và lấy URL của backend (ví dụ: `https://your-api.onrender.com`)

#### Deploy Frontend lên Vercel

1. Đăng nhập [Vercel Dashboard](https://vercel.com)
2. New Project → Import GitHub repository
3. Cấu hình:
   - **Root Directory**: `my-ecommerce-app`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. Add Environment Variables:
   ```
   VITE_API_URL=https://your-api.onrender.com
   VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
   ```
5. Deploy và lấy URL của frontend

#### Cập nhật CORS và URLs

Sau khi deploy, cần cập nhật:

1. Trong `my-ecommerce-api/server.js`:

   ```javascript
   const cors = require("cors");
   app.use(
     cors({
       origin: ["https://your-frontend.vercel.app", "http://localhost:5173"],
       credentials: true,
     })
   );
   ```

2. Trong file `.env` của backend:

   ```
   FRONTEND_URL=https://your-frontend.vercel.app
   ```

3. Trong frontend (`my-ecommerce-app/src/utils/api.js` hoặc tương tự):
   ```javascript
   const API_BASE_URL =
     import.meta.env.VITE_API_URL || "https://your-api.onrender.com";
   ```

## 🔗 API Endpoints chính

### Authentication

- `POST /api/auth/register` - Đăng ký người dùng
- `POST /api/auth/login` - Đăng nhập
- `POST /api/auth/logout` - Đăng xuất

### Games

- `GET /api/games` - Lấy danh sách game
- `GET /api/games/:id` - Chi tiết game
- `POST /api/games` - Thêm game mới
- `PUT /api/games/:id` - Cập nhật game
- `DELETE /api/games/:id` - Xóa game

### Orders

- `POST /api/orders` - Tạo đơn hàng
- `GET /api/orders/user/:userId` - Lịch sử đơn hàng

### Payments

- `POST /api/create-checkout-session` - Tạo session thanh toán Stripe

### AI Chatbot

- `POST /api/chatbot/message` - Nhắn tin với GameBot AI

## 🎮 Demo Features

### AI Chatbot Commands

- "Tìm game RPG hay" - Tìm kiếm theo thể loại
- "Game dưới 500k" - Tìm theo giá
- "So sánh GTA và Cyberpunk" - So sánh game
- "Gợi ý game cho tôi" - Đề xuất cá nhân hóa

### Payment Flow

1. Thêm game vào giỏ hàng
2. Checkout với Stripe
3. Nhận email xác nhận
4. Download game sau khi thanh toán

## 🛠️ Công nghệ sử dụng

### Backend

- **Node.js** + **Express.js** - Server framework
- **MongoDB** + **Mongoose** - Database
- **JWT** - Authentication
- **Stripe** - Payment processing
- **Socket.io** - Real-time communication
- **Google Gemini AI** - AI chatbot
- **bcryptjs** - Password hashing

### Frontend

- **React 19** - UI framework
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **React Router** - Navigation
- **React Icons** - Icons
- **React Toastify** - Notifications
- **Stripe JS** - Payment frontend

## 🐛 Troubleshooting

### Common Issues

1. **MongoDB Connection Error**

   - Kiểm tra lại MONGO_URI trong file .env
   - Đảm bảo MongoDB Atlas đang hoạt động

2. **Port Conflict**

   - Thay đổi PORT trong .env nếu 4000 hoặc 5173 đang được sử dụng

3. **Stripe Payment Error**

   - Kiểm tra STRIPE_SECRET_KEY
   - Đảm bảo frontend URL được cấu hình đúng trong Stripe Dashboard

4. **AI Chatbot Not Working**

   - Kiểm tra GEMINI_API_KEY
   - Đảm bảo API key còn hiệu lực

5. **CORS Issues (Production)**

   - Kiểm tra lại origin trong CORS configuration
   - Đảm bảo frontend URL được thêm vào danh sách allowed origins

6. **Render Deployment Issues**

   - Check build logs trong Render Dashboard
   - Đảm bảo tất cả dependencies được cài đặt đúng

7. **Vercel Build Errors**
   - Kiểm tra lại environment variables
   - Đảm bảo API URL được cấu hình đúng

### Logs & Debugging

- **Backend logs**: Terminal chạy server hoặc Render Dashboard logs
- **Frontend logs**: Browser Console hoặc Vercel logs
- **Database logs**: MongoDB Atlas Dashboard

## 📞 Liên hệ

- **Student**: [Your Name]
- **Project**: Gamestore E-commerce Platform
- **Course**: [Course Name]
- **Instructor**: [Instructor Name]

## 📄 License

© 2024 [Your Name]. All rights reserved.

---

## 📝 Checklist cho Giảng viên

Trước khi chấm điểm, hãy kiểm tra:

### ✅ Yêu cầu bắt buộc

- [ ] Node.js 18+ đã được cài đặt
- [ ] MongoDB Atlas account đã được tạo
- [ ] Stripe test account đã được tạo
- [ ] Google Gemini AI API key đã có
- [ ] File `.env` đã được cấu hình từ `.env.example`

### ✅ Kiểm tra chức năng

- [ ] Backend chạy thành công trên port 4000
- [ ] Frontend chạy thành công trên port 5173
- [ ] Database kết nối và có dữ liệu game
- [ ] Đăng ký/Đăng nhập người dùng hoạt động
- [ ] AI Chatbot trả lời được câu hỏi
- [ ] Thanh toán Stripe test hoạt động
- [ ] Responsive design trên mobile

### ✅ Files quan trọng cần xem

- `my-ecommerce-api/server.js` - Main backend logic
- `my-ecommerce-app/src/` - Frontend components
- `my-ecommerce-api/models/` - Database schemas
- `.env.example` - Environment template

---

**Note**: Đây là dự án học tập nhằm mục đích minh họa các kỹ năng lập trình web full-stack. Vui lòng không sử dụng thông tin thanh toán thật cho mục đích khác.
