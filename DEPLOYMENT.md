# Render Deployment Instructions

## 🚀 Required Environment Variables

Add these exact environment variables in your Render Dashboard:

### Database Configuration
```
MONGO_URI=mongodb+srv://hoanguy:22289604@mongodb.p9ncspb.mongodb.net/gameDatabase?retryWrites=true&w=majority&appName=MongoDB
```

### Server Configuration
```
PORT=4000
```

### API Keys
```
STRIPE_SECRET_KEY=sk_test_51SKGkvDjiDv73fOhAIaQr4V6M7V90cwJK9RmLK5BLCmLO80eBHNRSePWeZwJ8nAAj44EEQbzlg0PNzyeM6CnhCPe00rKCLehzd
GEMINI_API_KEY=AIzaSyDsWLkYzanSvHQG3pHNVhYXaejzc8xJbO8
JWT_SECRET=ChuoiBiMatSieuDaiVaPhucTapCuaBan_123!@
```

### Frontend Configuration
```
FRONTEND_URL=https://your-frontend-url.vercel.app
```

## 📋 Deployment Steps

1. **Push code to GitHub** (already done)
2. **Add environment variables** in Render Dashboard
3. **Trigger Manual Deploy** → "Deploy Latest Commit"
4. **Wait for deployment** to complete
5. **Test API endpoints**:
   - `https://gamestore-api-whwx.onrender.com/api/test`
   - `https://gamestore-api-whwx.onrender.com/api/games`
   - `https://gamestore-api-whwx.onrender.com/api/status`

## 🔧 Database Seeding

If database is empty, run the seeding script:
```bash
node seed-database.js
```

## 🐛 Troubleshooting

### API Returns Empty Array
- Check environment variables in Render Dashboard
- Verify MONGO_URI is correct
- Check deployment logs for connection errors

### 503 Service Unavailable
- Database connection failed
- Check MongoDB Atlas cluster status
- Verify network access

### CORS Issues
- Update FRONTEND_URL environment variable
- Check CORS origins in server.js

## 📊 API Endpoints

- `GET /api/test` - Health check (no database required)
- `GET /api/status` - Database status check
- `GET /api/games` - Get all games
- `GET /api/analytics` - Get analytics data
- `POST /api/chat` - AI chatbot endpoint
