import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

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
    // folder: 'gamestore_avatars',
    // allowedFormats: ['jpeg', 'png', 'jpg', 'webp'],
    // @ts-ignore - TODO: Fix TS error
    transformation: [{ width: 500, height: 500, crop: 'limit' }] // Resize nếu cần
  }
});

const upload = multer({ storage: storage });

export { cloudinary, upload };
