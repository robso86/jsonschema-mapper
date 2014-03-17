var EventEmitter = require('events').EventEmitter,
    util = require('util'),
    _ = require('underscore'),
    url = require('url'),
    URI = require('URIjs'),
    Path = require('path');

var errors = {
  'notimplemented': function(method, cls){
    Error.call(this); //super constructor
    Error.captureStackTrace(this, this.constructor); //super helper method to include stack trace in error object

    this.name = 'Method not implemented';
    this.message =  method + ' - must be implemented when extending ' + cls;
  },
  'import_problem': function(problem){
    Error.call(this); //super constructor
    Error.captureStackTrace(this, this.constructor); //super helper method to include stack trace in error object

    this.name = 'Import Error';
    this.message = problem;
  },
  'tbi': function(func){
    Error.call(this); //super constructor
    Error.captureStackTrace(this, this.constructor); //super helper method to include stack trace in error object

    this.name = 'Function not defined (yet)';
    this.message = 'The function ' + func + ' has not been written yet please provide your own';
  }
};

Object.keys(errors).forEach(function(fnName){
  util.inherits(errors[fnName], Error);
});

var readyStates = {
  'unitialised': 0,
  'initialised': 1,
  'running': 2,
  'complete': 3
};

/**
 * Very simple log function that outputs to console
 *
 * @param {string} message Message to push to console
 * @param {string} level The type of message
 */
function basicLogger (message, level){
  if(!level || !console[level]){
    level = 'log';
  }

  console[level](message);
}

/**
 * BaseImporter psuedo class to be extended
 *
 */
function BaseImporter () {
  //some intialising stuff
  //expects extending class to call
  //newClass.super_.call(this);
  this._schema = null;
  this._export = null;
  this._types = {};
  this._model = {
    properties:{},
    definitions:{},
    ids:{}
  };
  this.error = null;

  var baseImporter = this; //alias to keep scope of this

  //setup listeners
  this.on('readyStateChanged', function (readyState) {
    //state changed
    if(readyStates.complete === readyState){
      //state says loading has finished
      if(baseImporter.error){
        //the load failed
        baseImporter.emit('failed', baseImporter.error);
      } else {
        //the load succeeded
        baseImporter.emit('success', null, baseImporter.getModel());
      }

      console.log('Import complete');

      //finally send general complete notification
      baseImporter.emit('complete', baseImporter.error, baseImporter.getModel());
    }
  });
}

util.inherits(BaseImporter, EventEmitter);

BaseImporter.prototype.keywords = ['title', 'description', 'default', 'multipleOf', 'maximum', 'exclusiveMaximum',
                                   'minimum', 'exclusiveMinimum', 'maxLength', 'minLength', 'pattern', 'items',
                                   'enum', 'type', 'required'];

/**
 * Abstract function to be overwritten
 *
 * @param {object} schema, Description
 * @param {function} callback Description
 */
BaseImporter.prototype.importSchema = function (schema, callback) {
  throw new errors.notimplemented('importSchema', 'BaseImporter');
};

/**
 * Abstract function to be overwritten
 */
BaseImporter.prototype.exportORM = function () {
  throw new errors.notimplemented('exportORM', 'BaseImporter');
};

/**
 * A function that will retrieve (and parse) a schema
 *
 * @param {string} uri URI to the schema to be loaded
 * @param {function} callback A callback function that will called with the requested schema
 */
BaseImporter.prototype.getExternalSchema = function (uri, callback) {
  throw new errors.tbi('getExternalSchema');
};

/**
 * Internal function to kick off import of schema
 */
BaseImporter.prototype.doImport = function () {
  var baseImporter = this;

  baseImporter.setReadyState(readyStates.running);

  baseImporter.indexIDs(this._schema, null, null, '', function(){
    process.nextTick(function () {
      baseImporter.emit('indexing:complete');
    });
  });

  baseImporter.on('indexing:complete', function () {

    baseImporter._export = {};

    //handle schema references
    if(baseImporter._schema.$ref){
      baseImporter.resolveRef.call(baseImporter,baseImporter._schema.$ref, function (ref){
        if(!ref){
          baseImporter.log('failed to resolve :: ' + baseImporter._schema.$ref);
          console.log(baseImporter._definitions);
        }else{
          //deal with a reference
          //@todo is this the best way to achieve this?
          baseImporter._model.properties = _.extend(baseImporter._model.properties, ref);
        }
        doImportContinue();
      });
    }else{
      doImportContinue();
    }

    //@todo get rid of this hacky hacky solution
    function doImportContinue () {
      if(baseImporter._schema.definitions){
        //deal with definitions
        Object.keys(baseImporter._schema.definitions).forEach(function(stDef){
          //@todo make pointer to the _model
          baseImporter.doImportDefinition.call(baseImporter, stDef, baseImporter._schema.definitions[stDef], baseImporter._model.definitions);
        });
      }

      if(baseImporter._schema.properties){
        Object.keys(baseImporter._schema.properties).forEach(function(stProp){
          baseImporter.doImportProperty.call(baseImporter, stProp, baseImporter._schema.properties[stProp], baseImporter._model.properties);
        });
      }

      baseImporter.setReadyState(readyStates.complete);
    }

  });

  baseImporter.on('indexing:failed', function (err) {
    baseImporter.error = err;
    baseImporter.setReadyState(readyStates.complete);
  });
};

/**
 * Returns the internal model of the schema
 *
 * @return {object}
 */
BaseImporter.prototype.getModel = function () {
  return this._model;
};

/**
 * Returns true if ready state is 'complete' and there are no errors
 *
 * @return boolean
 */
BaseImporter.prototype.isLoaded = function () {
  return this.getReadyState === readyStates.complete && false === this.error;
};

/**
 * Returns the current readyState
 *
 * @return int
 */
BaseImporter.prototype.getReadyState = function () {
  return this.readyState;
};

/**
 * Set the current readyState
 *
 * @param {string|int} newState Description
 * @return int
 */
BaseImporter.prototype.setReadyState = function (newState) {
  var currentState = this.readyState;

  if('number' === typeof newState){
    //assumes an integer would be direct from readyStates
    this.readyState = newState;
  }else if('string' === typeof newState){
    //only set if the string is a known state
    this.readyState = readyStates[newState] || this.readyState;
  }

  if(currentState !== this.readyState){
    //readyState has changed notify listeners
    this.emit('readyStateChanged', this.readyState);
  }

  return this.readyState;
};

/**
 * Load a schema from a json resource
 *
 * @param {string|buffer} schemaJSON Description
 */
BaseImporter.prototype.loadSchemaFromJSON = function (schemaJSON) {
  try{
    schema = JSON.parse(schemaJSON);
    if(schema){
      this._schema = schema;
      this.setReadyState(readyStates.initialised);
      this.doImport();
    }
  } catch (e) {
    this.error = e;
    this.setReadyState(readyStates.complete);
  }
};

/**
 * Function to walk the imported schema for ids
 * for use in reference resolutions
 *
 * @param {object} schemaIn The schema or part there of to be indexed
 * @param {string} scope Current scope to be used
 * @param {string} index Alternative id usually from the key of the property/definition
 * @param {function} callback Function to call when all actions complete
 */
BaseImporter.prototype.indexIDs = function (schemaIn, scope, index, path, callback) {
  var baseimporter = this;

  var currentScope = scope || false;
  var keys = Object.keys(schemaIn);
  var newScope = false;
  path = path || '';
  index = index || '';

  var listenFor = []; //array for use in recursion

  /**
   * Factory function for generating next tick
   * Always returns a function, though passed an undefined nextSchema the
   * returned function will be empty
   *
   * @param {object} nextSchema Object to index
   * @param {string} nextScope Scope to resolve against
   * @param {string} nextIndex Index of the property/definiton passed as nextSchema
   *
   * @return {function} a function to be passed to process.nextTick()
   */
  var factoryNext = function(nextSchema, nextScope, nextIndex, nextPath, nextCBack){
    var nSchema = nextSchema || false;
    var nScope = nextScope;
    var nIndex = nextIndex;
    var nPath = nextPath;
    var nCBack = nextCBack || function(){};

    if(false === nSchema){
      return function(){};
    }else{
      return function(){
        baseimporter.indexIDs.call(baseimporter, nSchema, nScope, nIndex, nPath, nCBack);
      };
    }
  };

  var myCallback = function ( name ) {
    if(-1 !== listenFor.indexOf(name)){
      listenFor.splice(listenFor.indexOf(name), 1);
    }
    if(0 === listenFor.length){
      //all child processes have reported in
      process.nextTick(function () {
        callback(index);
      });
    }
  };

  if(keys && keys.length){
    if(schemaIn.id){
      if(!currentScope){
        //no parent scope set to this id
        newScope = schemaIn.id;
      }else{
        var iduri = new URI(schemaIn.id);
        if(true === iduri.is('relative')){
          newScope = iduri.relativeTo(currentScope);
        }else if(true === iduri.is('absolute')){
          newScope = schemaIn.id;
        }
      }
    }else if('string' === typeof index){
      if(!currentScope){
        newScope = index;
      }else{
        var iduri = new URI(index);

        newScope = iduri.absoluteTo(currentScope).toString();
      }
    }

    if(false !== newScope){
      //store index
      baseimporter._model.ids[schemaIn.id||index] = {absolute:newScope};
      baseimporter._model.ids[schemaIn.id||index].path = Path.join(path, index);
      //continue loop down through
      //properties
      if(schemaIn.properties){
        //run the properties
        Object.keys(schemaIn.properties).forEach(function(prop){
          //recurrance - defer to nextTick
          listenFor.push(prop);
          process.nextTick(factoryNext(schemaIn.properties[prop], newScope, prop, Path.join(baseimporter._model.ids[schemaIn.id||index].path, 'properties'), myCallback));
        });
      }
      //definitions
      if(schemaIn.definitions){
        //run the properties
        Object.keys(schemaIn.definitions).forEach(function(def){
          //recurrance - defer to nextTick
          listenFor.push(def);
          process.nextTick(factoryNext(schemaIn.definitions[def], newScope, def, Path.join(baseimporter._model.ids[schemaIn.id||index].path,'definitions'), myCallback));
        });
      }
    }

    if(0 === listenFor.length){
      //not waiting for anything - fire the callback
      callback(index);
    }

  }
};

/**
 * Resolve a $ref in a schema
 *
 * @param {string} reference The reference to be reolved
 * @param {string} scope The resolution scope for the reference
 * @return {object|boolean} Returns false if the Ref cannot be resolved
 */
BaseImporter.prototype.resolveRef = function (reference, cback) {

  //types of reference
  // - Canonical (MUST)
  // - inline referencing (OPTIONAL)

  //types of reference
  // "#schema"
  // "#/definitions/schema"
  // "#/properties/schema"
  // "http://someplace.com/#properties/schema"
  // "http://someplace.com/#definitions/schema"

  var refURI = new URI(reference);
  var importer = this;

  if(refURI.is('absolute')){
    //Canonical
    importer.getExternalSchema(refURI.href(), function (err, schema) {
      if(err){
        return cback(false);
      }
      return cback(schema.findRef(refURI.fragment()));
    });
  }else if(refURI.is('relative')){
    //relative
    if(refURI.host()){
      importer.log('Problem resolving relative path with host');
    }else{
      //it's completely internal
      return cback(importer.findRef(refURI.fragment()));
    }
  }

  return false;
};

/**
 * Search by fragment
 *
 * @param {string} frag Fragment to search by
 */
BaseImporter.prototype.findRef = function (frag) {
  var searchId = Path.basename(frag);
  if(!searchId){
    searchId = Path.basename(Path.dirname(frag));
  }

  if(!searchId){
    throw new errors.import_problem('Cannot find searchid in ref from : ' + frag );
  }

  if(searchId == '.'){
    //root
    return this._model.properties;
  }

  if(this._model.ids[searchId]){

    //find from precalc'd path
    pth = this._model.ids[searchId].path.split('/');
    var pntr = this._model;

    pth.forEach(function(elname){
      if(pntr && pntr[elname]){
        pntr = pntr[elname];
      } else {
        pntr = false;
      }
    });

    return pntr;
  }else{
    this.log('findRef not fully implemented');
  }
};

/**
 * Function to import a definiton from an element
 *
 *
 * @param String stDef Description
 * @param Object src Description
 * @param Object parent Description
 */
BaseImporter.prototype.doImportDefinition = function ( stDef, src, parent){
  var baseImporter = this;

  //@todo more validation of input
  if('string' !== typeof stDef){
    throw new errors.import_problem('Property name type expected "String" but found "' + (typeof stDef) + '"');
  }

  if('object' !== typeof src){
    throw new errors.import_problem('Source element type expected "Object" but found "' + (typeof src) + '"');
  }

  if('object' !== typeof parent){
    throw new errors.import_problem('Parent element type expected "Object" but found "' + (typeof parent) + '"');
  }

  var def = parent[stDef] = {};

  baseImporter.keywords.forEach(function (stKey) {
    if('undefined' !== typeof src[stKey]){
      def[stKey] = src[stKey];
    }
  });

  if(src.properties){
    Object.keys(src.properties).forEach(function(stProp){
      baseImporter.doImportProperty.call(baseImporter, stProp, src.properties[stProp], def);
    });
  }

};

/**
 * @private
 * Function to import the properties from an element
 *
 * @param String stProp String of the property key
 * @param Object src The object from the schema
 * @param Object parent The target
 */
BaseImporter.prototype.doImportProperty = function ( stProp, src, parent){

  //@todo more validation of input
  if('string' !== typeof stProp){
    throw new errors.import_problem('Property name type expected "String" but found "' + (typeof stProp) + '"');
  }

  if('object' !== typeof src){
    throw new errors.import_problem('Source element type expected "Object" but found "' + (typeof src) + '"');
  }

  if('object' !== typeof parent){
    throw new errors.import_problem('Parent element type expected "Object" but found "' + (typeof parent) + '"');
  }

  //setup the export object
  var exprop = parent[stProp] = {};

  //check the property type
  if(src.type){
    exprop.type = src.type;
    //@todo move this to post process
    /*//check if this type can be mapped
    if(this._types[src.type]){
      exprop.type = this._types[src.type];
    }*/
  }

  var importer = this;
  //handle schema references
  if(src.$ref){
    importer.resolveRef.call(this,src.$ref, function (ref){
      if(!ref){
        importer.log('failed to resolve :: ' + src.$ref);
        console.log(importer._definitions);
      }else{
        //deal with a reference
        //@todo is this the best way to achieve this?
        exprop = parent[stProp] = _.extend(exprop,ref);
      }
      doImportPropContinue();

    });
  }else{
    doImportPropContinue();
  }

  function doImportPropContinue () {
    importer.keywords.forEach(function (stKey) {
      if('undefined' !== typeof src[stKey]){
        exprop[stKey] = src[stKey];
      }
    });

    //handle sub properties
    if(src.properties){
      Object.keys(src.properties).forEach(function(stSubProp){
        importer.doImportProperty.call(importer, stSubProp, src.properties[stSubProp], exprop);
      });
    }
  }
};

BaseImporter.prototype.log = basicLogger;

//import manager store references
//each one is an instance of BaseImporter
//
var importManagerCache = {};
var baseImportManagerDefaults = {
  importClass: BaseImporter,
  logger: false
};

function BaseImportManager (opts) {
  opts = opts || {};
  this.options = _.extend(baseImportManagerDefaults, opts);

  if(this.options.logger){
    this.log = this.options.logger;
  }
}

util.inherits(BaseImportManager, EventEmitter);


/**
 * Stub function for loading a file, to be provided by the implementor
 *
 * @param {string} uri Description
 * @param {function} callback Callback function to provided contents of the file at
 */
BaseImportManager.prototype.readFile = function (uri, callback) {
  callback(new errors.notimplemented('readFile', 'BaseImportManager'), null);
};


/**
 * Fetch a schema from the specified uri
 *
 * @param {string} uri URI to the schema
 * @param {function} callback The callback that will be called with schema as 2nd param
 */
BaseImportManager.prototype.fetchSchema = function (uri, callback) {

  if(!uri){
    return false;
  }

  if(importManagerCache[uri]){
    if(importManagerCache[uri].isLoaded()){
      callback(null, importManagerCache[uri]);
      return true;
    }else if(importManagerCache[uri].getReadyState() < readyStates.complete){
      //listen for the end event fired after success or failure to load
      importManagerCache[uri].once('complete', function(err, model){
          callback(err, importManagerCache[uri]);
      });
      return true;
    }else{
      //it's not loaded successfully
      //and it's not mid-load
      //it must have failed
      callback(importManagerCache[uri].error, null);
      return true;
    }
  }

  //it wasn't in the cache needs loaded
  var importManager = this;

  importManager.readFile(uri, function (err, contents) {
    if( importManagerCache[uri] ){
      //another request for this uri has already taken place while the file was read
      return importManager.fetchSchema(uri, callback);
    }

    importManagerCache[uri] = new importManager.options.importClass();
    //swap out the getExternal schema function for the managers fetchSchema
    importManagerCache[uri].getExternalSchema = importManager.fetchSchema.bind(importManager); //@todo check this doesn't need bind

    //there was an error fetching the file, attach this to the new instance
    if(err){
      importManagerCache[uri].error = err;
      importManagerCache[uri].setReadyState(readyStates.complete);
      return callback(err, null);
    }

    importManagerCache[uri].once('complete', function(err, model){
        callback(err, importManagerCache[uri]);
    });

    importManagerCache[uri].loadSchemaFromJSON(contents);
  });

  return true;
};

BaseImportManager.prototype.getImporter = function (uri) {
  //@todo will overwrite existing instance, should it?
  //@todo also serious duplication of code from fetchSchema
  importManagerCache[uri] = new this.options.importClass();
  importManagerCache[uri].getExternalSchema = this.fetchSchema.bind(this); //@todo check this doesn't need bind

  return importManagerCache[uri];
};

//provide a copy of the ready states but not the reference used internally
BaseImportManager.prototype.readyStates = _.clone(readyStates);

BaseImportManager.prototype.log = basicLogger;

module.exports = {
  "BaseImporter":BaseImporter,
  "BaseImportManager": BaseImportManager,
  "errors": errors
};