const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Cấu hình Cloudinary (Lấy từ biến môi trường)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Cấu hình storage cho multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'gamestore_avatars',
    allowedFormats: ['jpeg', 'png', 'jpg', 'webp'],
    transformation: [{ width: 500, height: 500, crop: 'limit' }] // Resize nếu cần
  }
});

const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };
