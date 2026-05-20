const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (err) {
    const errorMessages = err.errors.map(e => e.message).join(', ');
    return res.status(400).json({ message: errorMessages });
  }
};

module.exports = validate;
