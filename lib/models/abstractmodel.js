/*

 ===  How to use models ===

var ad = new Ad({campaign_id: '1038', banner: 'file.jpg'});

ad.save(function(error, ad) { //insert
  // here we have ad.id already
});

...
// '100500' is an ID

Ad.load('100500', function(error, ad) {
  ad.ctr = 5;
  ad.save(funtion(error, ad) { // update
    ad.delete(function(error) {
      // here we still have model data
    });
  });
});

*/

var util          = require('util');
var escape        = require('pg-format');
var validator     = require('validator');
var SQLError      = require('../classes/errors.js').SQLError;
var NotFoundError = require('../classes/errors.js').NotFoundError;

function AbstractModel (initializer) {
  if ('object' == typeof initializer) {
    this.set(initializer);
  }
  this._errors = [];
}

AbstractModel._hasMany = [];
AbstractModel._hasOne = [];

AbstractModel.init = function(app) {
  this.prototype._app = app;
  if (this._hasMany.length) {
    this._initHasMany();
  }
  if (this._hasOne.length) {
    this._initHasOne();
  }
};

AbstractModel.prototype.table = "Please set your model's prototype.table to use database functionality";
AbstractModel.prototype._errors = [];

AbstractModel.boost = function(Class) {
  util.inherits(Class, AbstractModel);
  for (var i in AbstractModel) {
    Class[i] = AbstractModel[i];
  }
};

// === Static methods ===

AbstractModel.hasMany = function(name, Model, foreignKey) {
  this._hasMany.push({name: name, Model: Model, foreignKey: foreignKey});
}; 

AbstractModel._initHasMany = function() {
  var self = this;
  this._hasMany.forEach(function(def) {
    var name = def.name;
    var model = def.Model;
    var foreignKey = def.foreignKey;

    self.prototype[name] = function(options, callback) {
      if ('undefined' == typeof self.id || !self.id) {
        return callback(new Error('This model has no ' + name + ' because is is not saved yet(no ID).'));
      }
      var conditions = {};
      conditions[foreignKey] = self.id;
      Model.findBy(conditions, options, callback);
    };
  });
};

AbstractModel._initHasOne = function() {
};

AbstractModel.all = function(options, callback) {
  this.findBy(null, options, callback);
};

AbstractModel.findBy = function(conditions, options, callback, row_only) {
  row_only = row_only || false;
  var self = this;
  options = options || {};

  var query = escape("SELECT * FROM %I " + this._parseConditions(conditions, options), this.prototype.table);

  options.order = options.order || null;
  if (options.order) {
    query += escape(' ORDER BY %I', options.order);
  }
  options.orderby = options.orderby || null;
  if (options.orderby) {
    query += escape(' ORDER BY %s', options.orderby);
  }
  options.limit = options.limit || null;
  if (options.limit) {
    query += ' LIMIT ' + options.limit;
  }

  this.prototype._app.db.query(query, function(error, result) {
    if (error) {
      return callback(new SQLError("Error while performing 'findBy' operation: " + error, query));
    }
    if ('undefined' == typeof result.rows || !result.rows.length) {
      return callback(null, []);
    }
    if (row_only) {
      return callback(null, result.rows);
    }
    var models = [];
    result.rows.forEach(function(row) {
      models.push(new self(row));
    });
    return callback(null, models);
  });
};

AbstractModel.deleteBy = function(conditions, options, callback) {
  var self = this;
  options = options || {};

  var query = escape("DELETE FROM %I " + this._parseConditions(conditions, options), this.prototype.table);

  this.prototype._app.db.query(query, function(error) {
    if (error) {
      return callback(new SQLError("Error while performing 'findBy' operation: " + error, query));
    }
    return callback(null);
  });
};

AbstractModel._parseConditions = function(conditions, options) {
  options = options || {};
  options.logical = options.logical || 'AND';

  if (!conditions) {
    return '';
  }

  if ('string' == typeof conditions) {
    return 'WHERE ' + conditions;
  }

  if (Array.isArray(conditions)) {
    return 'WHERE ' + conditions.join(' ' + options.logical + ' ');
  }
  
  if ('object' == typeof conditions) {
    var condArr = [];
    
    Object.keys(conditions).forEach(function(key) {
      var cond = conditions[key];
      if (Array.isArray(cond)) {
        conditions[i] = conditions[i].map(escape.literal);
        condArr.push(escape("%I", i) + ' IN(' + cond.join(',') + ')');
        return;
      }
      condArr.push(escape("%I = %L", i, cond));
    });
    return 'WHERE ' + condArr.join(' ' + options.logical + ' ');
  }

  throw new Error("Could not parse conditions");
};

AbstractModel.load = function(id, callback) {
  var self = this;

  var query = escape("SELECT * FROM %I WHERE id = %L", this.prototype.table, id);
  this.prototype._app.db.query(query, function(error, result) {
    if (error) {
      return callback(new SQLError("Error while loading a model: " + error, query));
    } 
    if ('undefined' == typeof result.rows || !result.rows.length) {
      return callback(new NotFoundError("Model #" + id + " not found."));
    }
    return callback(null, new self(result.rows[0])); 
  });
};

// === Normal methods ===

AbstractModel.prototype.set = function(source) {
  var self = this;
  if ('undefined' == typeof(this.fields)) {
    return;
  }

  this.fields.forEach(function(field) {
    if ('undefined' == typeof source[field])
      return;

    var value = source[field];
//    if (null !== value) {
//      value = value.toString();
//    }

    self[field] = value;
  });

  return this;
};

AbstractModel.prototype.save = function(callback) {
  if (-1 == this.fields.indexOf('id') || 'undefined' == typeof this.id) {
    return this.insert(callback);
  }

  this.update(callback);
};

AbstractModel.prototype.insert = function(callback) {
  var self = this;
  
  var fields = [];
  var values = [];

  this.fields.forEach(function(field) {
    if ('undefined' == typeof self[field]) {
      return;
    }
    fields.push(escape('%I', field));
    values.push(escape("%L", self[field]));
  });

  var query = escape("INSERT INTO %I ", this.table) + '(' + fields.join(',') + ') VALUES (' + values.join(',') + ') RETURNING *';

  this._app.db.query(query, function(error, result) {
    if (error) {
      return callback(new SQLError('SQL error while saving model: ' + error, query));
    }

    if ('undefined' != typeof result.rows && result.rows.length) {
      self.set(result.rows[0]);
    }

    return callback(null, self);
  });
};

AbstractModel.prototype.update = function(callback) {
  var self = this;
  var fields = [];
  callback = callback || function() {};

  this.fields.forEach(function(field) {
    if (field == 'id' || 'undefined' == typeof self[field]) {
      return;
    }
    fields.push(escape("%I = %L", field, self[field]));
  });
  var query = escape("UPDATE %I SET ", this.table) + fields.join(', ') + escape(" WHERE id = %L", this.id);
  this._app.db.query(query, function(error, result) {
    if (error) {
      return callback(new SQLError('SQL error while updating a model: ' + error, query));
    } 

    return callback(null, self);
  }); 
};

AbstractModel.prototype.delete = function(callback) {
  if ('undefined' == typeof this.id || !this.id) {
    console.dir(this);
    return callback(new Error('This model cannot be deleted because it is not saved (no ID)'));
  }
  this.constructor.deleteBy({id: this.id}, null, callback); 
};

AbstractModel.prototype.error = function(err) {
  if (!err) {
    return;
  }
  this._errors.push(err);
};

AbstractModel.prototype.checkBool = function(field) {
  this.error(!validator.isIn(this[field], ['true', 'false', 't', 'f']) ? 'The ' + field + ' field must be a valid boolean.' : null);
};

AbstractModel.prototype.checkInt = function(field) {
  this.error(!validator.isInt(this[field]) ? 'The ' + field + ' field must be a valid integer.' : null);
};

AbstractModel.prototype.checkFloat = function(field) {
  this.error(!validator.isFloat(this[field]) ? 'The ' + field + ' field must be a valid float (' + this[field] + ').' : null);
};

AbstractModel.prototype.checkNumeric = function(field) {
  this.error(!validator.isNumeric(this[field]) ? 'The ' + field + ' field must be a valid numeric.' : null);
};

AbstractModel.prototype.checkJSON = function(field) {
  var ok = validator.isJSON(this[field]);
  if (!ok) {
    try {
      var trash = JSON.parse(this[field]);
    } catch(e) {
      ok = false;
    }
  }
  this.error(!ok ? 'The ' + field + ' field must be a valid JSON: ' + this[field] : null);
};

AbstractModel.prototype.checkVarchar = function(field) {
  this.error(!validator.isLength(this[field], {max: 255}) ? 'The ' + field + ' field must be as much as 255 characters length' : null);
};

AbstractModel.prototype.checkURL = function(field) {
  this.error(!validator.isURL(this[field], {max: 255}) ? 'The ' + field + ' field must be a valid URL' : null);
};

AbstractModel.prototype.checkSet = function(field) {
  this.error(!this[field].length ? 'The ' + field + ' field must be set' : null);
};

AbstractModel.prototype.checkTextID = function(field) {
  this.error(this[field].match(/[^A-Za-z0-9-]/) ? 'The ' + field + ' field must contain only following set of characters: A-Z, a-z, 0-9, "-"' : null);
};

AbstractModel.prototype.checkTrimmed = function(field) {
  this.error(this[field].match(/^[\r\n\t ]/) || this[field].match(/[\r\n\t ]$/) ? 'The ' + field + ' field contains leading or trailing spaces' : null);
};

module.exports = AbstractModel;
