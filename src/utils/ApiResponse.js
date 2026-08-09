const ApiResponse = {
  success(res, data = null, message = 'Success', statusCode = 200) {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
    });
  },

  created(res, data = null, message = 'Created') {
    return this.success(res, data, message, 201);
  },

  error(res, message = 'Error', statusCode = 500, code = 'ERROR', details = null) {
    return res.status(statusCode).json({
      success: false,
      message,
      code,
      ...(details ? { details } : {}),
    });
  },
};

module.exports = ApiResponse;
