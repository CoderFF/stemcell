/*jslint esversion: 6*/
/*jslint node: true*/
'use strict';

/*

 ===  How to use models ===

const ad = new Ad({campaign_id: '1038', banner: 'file.jpg'});

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

const util          = require('util');
const escape        = require('pg-format');
const validator     = require('validator');
const SQLError      = require('../classes/errors.js').SQLError;
const NotFoundError = require('../classes/errors.js').NotFoundError;

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

// Makes nice inheritance. Use instead of util.inherherits
AbstractModel.boost = function(Class) {
  util.inherits(Class, AbstractModel);
  Object.keys(AbstractModel).forEach(function(i) {
    Class[i] = AbstractModel[i];
  });
};

// === Static methods ===

AbstractModel.hasMany = function(name, Model, foreignKey) {
  this._hasMany.push({name: name, Model: Model, foreignKey: foreignKey});
}; 

AbstractModel.hasOne = function(name, Model, foreignKey) {
  this._hasOne.push({name: name, Model: Model, foreignKey: foreignKey});
}; 

AbstractModel._initHasMany = function() {
  const self = this;
  this._hasMany.forEach(function(def) {
    const name = def.name;
    const Model = def.Model;
    const foreignKey = def.foreignKey;

    self.prototype[name] = function(options, callback) {
      if ('undefined' == typeof self.id || !self.id) {
        return callback(new Error('This model has no ' + name + ' because is is not saved yet(no ID).'));
      }
      const conditions = {};
      conditions[foreignKey] = self.id;
      Model.findBy(conditions, options, callback);
    };
    self.prototype[name + 'Async'] = function(options) {
      const that = this;
      return new Promise(function(resolve, reject) {
        that[name](options, function(error, models) {
          if (error) {
            return reject(error);
          }
          resolve(models);
        });
      });
    };
  });
};

AbstractModel._initHasOne = function() {
  const self = this;
  this._hasOne.forEach((def) => {
    const name = def.name;
    const Model = def.Model;
    const foreignKey = def.foreignKey;

    self.prototype[name] = function(options, callback) {
      if ('undefined' == typeof self.id || !self.id) {
        return callback(new Error('This model has no ' + name + ' because is is not saved yet(no ID).'));
      }
      const conditions = {};
      conditions[foreignKey] = self.id;
      Model.findBy(conditions, options, function(error, models) {
        if (error) {
          return callback(error);
        }
        if (!models.length) {
          return callback(new NotFoundError());
        }
        callback(null, models[1]);
      });
    };
    self.prototype[name + 'Async'] = function(options) {
      const that = this;
      return new Promise(function(resolve, reject) {
        that[name](options, function(error, models) {
          if (error) {
            return reject(error);
          }
          resolve(models);
        });
      });
    };
  });
};

AbstractModel.allAsync = function(options, callback) {
  return this.findByAsync(null, options);
};

AbstractModel.all = function(options, callback) {
  this.findBy(null, options, callback);
};

AbstractModel.findByAsync = function(conditions, options, row_only) {
  const self = this;
  return new Promise((resolve, reject) => {
    self.findBy(conditions, options, function(error, models) {
      if (error) {
        return reject(error);
      }
      resolve(models);
    }, row_only);
  });
};

AbstractModel.findBy = function(conditions, options, callback, row_only) {
  row_only = row_only || false;
  const self = this;
  options = options || {};

  let query = escape("SELECT * FROM %I " + this._parseConditions(conditions, options), this.prototype.table);

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
    const models = [];
    result.rows.forEach(function(row) {
      models.push(new self(row));
    });
    return callback(null, models);
  });
};

AbstractModel.deleteByAsync = function(conditions, options) {
  const self = this;
  return new Promise((resolve, reject) => {
    self.deleteBy(conditions, options, function(error) {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  });
};

AbstractModel.deleteBy = function(conditions, options, callback) {
  const self = this;
  options = options || {};

  const query = escape("DELETE FROM %I " + this._parseConditions(conditions, options), this.prototype.table);

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
    const condArr = [];
    
    Object.keys(conditions).forEach(function(i) {
      if (Array.isArray(conditions[i])) {
        conditions[i] = conditions[i].map(escape.literal);
        condArr.push(escape("%I", i) + ' IN(' + conditions[i].join(',') + ')');
        return;
      }
      condArr.push(escape("%I = %L", i, conditions[i]));
    });
    return 'WHERE ' + condArr.join(' ' + options.logical + ' ');
  }

  throw new Error("Could not parse conditions");
};

AbstractModel.loadAsync = function(id) {
  const self = this;
  return new Promise(function(resolve, reject) {
    self.load(id, function(error, model) {
      if (error) {
        return reject(error);
      }
      resolve(model);
    });    
  });
};

AbstractModel.load = function(id, callback) {
  const self = this;

  const query = escape("SELECT * FROM %I WHERE id = %L", this.prototype.table, id);
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
  const self = this;
  if ('undefined' == typeof(this.fields)) {
    return;
  }

  this.fields.forEach(function(field) {
    if ('undefined' == typeof source[field])
      return;

    self[field] = source[field];
  });

  return this;
};

AbstractModel.prototype.saveAsync = function(callback) {
  const self = this;
  return new Promise(function(resolve, reject) {
    self.save(function(error) {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  });
};

AbstractModel.prototype.save = function(callback) {
  callback = callback || function() {};

  if (-1 == this.fields.indexOf('id') || 'undefined' == typeof this.id || !this.id) {
    return this.insert(callback);
  }

  this.update(callback);
};


AbstractModel.prototype.insertAsync = function(callback) {
  const self = this;
  return new Promise(function(resolve, reject) {
    self.insert(function(error) {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  });
};

AbstractModel.prototype.insert = function(callback) {
  const self = this;
  
  const fields = [];
  const values = [];

  this.fields.forEach(function(field) {
    if ('undefined' == typeof self[field]) {
      return;
    }
    fields.push(escape('%I', field));
    values.push(escape("%L", self[field]));
  });

  const query = escape("INSERT INTO %I ", this.table) + '(' + fields.join(',') + ') VALUES (' + values.join(',') + ') RETURNING *';

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

AbstractModel.prototype.updateAsync = function(callback) {
  const self = this;
  return new Promise(function(resolve, reject) {
    self.update(function(error) {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  });
};

AbstractModel.prototype.update = function(callback) {
  const self = this;
  const fields = [];
  callback = callback || function() {};

  this.fields.forEach(function(field) {
    if (field == 'id' || 'undefined' == typeof self[field]) {
      return;
    }
    fields.push(escape("%I = %L", field, self[field]));
  });
  const query = escape("UPDATE %I SET ", this.table) + fields.join(', ') + escape(" WHERE id = %L", this.id);
  this._app.db.query(query, function(error, result) {
    if (error) {
      return callback(new SQLError('SQL error while updating a model: ' + error, query));
    } 

    return callback(null, self);
  }); 
};

AbstractModel.prototype.deleteAsync = function(callback) {
  const self = this;
  return new Promise(function(resolve, reject) {
    self.delete(function(error) {
      if (error) {
        return reject(error);
      }
      resolve();
    });
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
  this.error(!validator.isIn(String(this[field]), ['true', 'false', 't', 'f']) ? 'The ' + field + ' field must be a valid boolean.' : null);
};

AbstractModel.prototype.checkInt = function(field) {
  this.error(!validator.isInt(String(this[field])) ? 'The ' + field + ' field must be a valid integer.' : null);
};

AbstractModel.prototype.checkFloat = function(field) {
  this.error(!validator.isFloat(String(this[field])) ? 'The ' + field + ' field must be a valid float (' + this[field] + ').' : null);
};

AbstractModel.prototype.checkNumeric = function(field) {
  this.error(!validator.isNumeric(String(this[field])) ? 'The ' + field + ' field must be a valid numeric.' : null);
};

AbstractModel.prototype.checkJSON = function(field) {
  let ok = validator.isJSON(this[field]);
  if (!ok) {
    try {
      JSON.parse(this[field]);
    } catch(e) {
      ok = false;
    }
  }
  this.error(!ok ? 'The ' + field + ' field must be a valid JSON: ' + this[field] : null);
};

AbstractModel.prototype.checkVarchar = function(field) {
  this.error(!validator.isLength(String(this[field]), {max: 255}) ? 'The ' + field + ' field must be as much as 255 characters length' : null);
};

AbstractModel.prototype.checkURL = function(field) {
  this.error(!validator.isURL(String(this[field]), {max: 255}) ? 'The ' + field + ' field must be a valid URL' : null);
};

AbstractModel.prototype.checkSet = function(field) {
  this.error(!String(this[field]).length ? 'The ' + field + ' field must be set' : null);
};

AbstractModel.prototype.checkTextID = function(field) {
  this.error(String(this[field]).match(/[^A-Za-z0-9-]/) ? 'The ' + field + ' field must contain only following set of characters: A-Z, a-z, 0-9, "-"' : null);
};

AbstractModel.prototype.checkTrimmed = function(field) {
  this.error(String(this[field]).match(/^[\r\n\t ]/) || this[field].match(/[\r\n\t ]$/) ? 'The ' + field + ' field contains leading or trailing spaces' : null);
};

module.exports = AbstractModel;
