import { Request, Response, NextFunction } from 'express';
import jwt from "jsonwebtoken";
import User from "../models/User";

const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ message: "Không có token, không được phép truy cập" });
    }

    const decoded = jwt.verify(token, (process.env.JWT_SECRET as string)) as any;
    (req as any).user = { 
      _id: (decoded as any).userId,
      isAdmin: (decoded as any).isAdmin // Ensure isAdmin is available
    };
    next();
  } catch (error: any) {
    res.status(401).json({ message: "Token không hợp lệ" });
  }
};

const verifyAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ message: 'Không có token, không được phép truy cập' });
    }

    const decoded = jwt.verify(token, (process.env.JWT_SECRET as string)) as any;
    const user = await User.findById((decoded as any).userId);

    if (!user || !user.isAdmin) {
      return res.status(403).json({ message: 'Yêu cầu quyền admin' });
    }

    (req as any).user = user;
    next();
  } catch (error: any) {
    res.status(401).json({ message: 'Token không hợp lệ' });
  }
};

/**

 * verifyTokenSoft: Middleware xác thực mềm.
 * Không reject nếu thiếu/sai token — chỉ gắn (req as any).user nếu token hợp lệ.
 * Dùng cho các route public nhưng cần phân biệt user đã đăng nhập hay chưa.
 */
const verifyTokenSoft = (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
    if (token) {
      const decoded = jwt.verify(token, (process.env.JWT_SECRET as string)) as any;
      (req as any).user = {
        _id: (decoded as any).userId,
        isAdmin: (decoded as any).isAdmin,
      };
    }
  } catch {
    // Token không hợp lệ → bỏ qua, không attach (req as any).user
  }
  next();
};



export { verifyToken, verifyAdmin, verifyTokenSoft };
