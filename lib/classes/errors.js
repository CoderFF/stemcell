var util = require('util');

util.inherits(AuthError, Error);

var NotFoundError = function(message) {
  Error.captureStackTrace(this, this.constructor);
  this.message = message;
};

util.inherits(NotFoundError, Error);

var SQLError = function(message, query) {
  Error.captureStackTrace(this, this.constructor);
  this.message = message + '\nQuery:\n' + query;
  console.error(this.message);
};

util.inherits(SQLError, Error);

module.exports = {
  "NotFoundError": NotFoundError,
  "SQLError": SQLError,
};
