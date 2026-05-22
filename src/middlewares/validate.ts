import { Request, Response, NextFunction } from 'express';
import {  ZodError  } from 'zod';

const validate = (schema: any) => (req: Request, res: Response, next: NextFunction) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err: any) {
    if (err instanceof ZodError) {
      const errorMessages = err.issues.map(e => e.message).join(', ');
      return res.status(400).json({ message: errorMessages });
    }
    return res.status(400).json({ message: "Dữ liệu không hợp lệ" });
  }
};

export default validate;
