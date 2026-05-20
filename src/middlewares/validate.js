const { ZodError } = require('zod');

const validate = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof ZodError) {
      const errorMessages = err.issues.map(e => e.message).join(', ');
      return res.status(400).json({ message: errorMessages });
    }
    return res.status(400).json({ message: "Dữ liệu không hợp lệ" });
  }
};

module.exports = validate;
