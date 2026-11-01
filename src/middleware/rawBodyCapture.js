'use strict';

const AppError = require('../utils/AppError');

/** Read the HTTP entity into a Buffer without JSON parsing or decompression. */
function rawBodyCapture(limit) {
  return (req, res, next) => {
    const chunks = [];
    let size = 0;
    let failed = false;
    req.on('data', (chunk) => {
      if (failed) return;
      size += chunk.length;
      if (size > limit) {
        failed = true;
        req.pause();
        next(new AppError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${limit} bytes.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (failed) return;
      req.body = Buffer.concat(chunks, size);
      next();
    });
    req.on('error', (error) => { if (!failed) next(error); });
    req.on('aborted', () => { if (!failed) next(new AppError(400, 'INCOMPLETE_REQUEST', 'Request body was interrupted.')); });
  };
}

module.exports = rawBodyCapture;
