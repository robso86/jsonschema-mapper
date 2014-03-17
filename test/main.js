// test/main.js
var should = require('should');
var mapper = require('../lib/main');

describe('jsonschema-mapper', function() {
    describe('provide a base class', function() {
      it('returns a function to be inherited from', function () {
        should.exist(mapper.BaseImporter);
        mapper.BaseImporter.should.be.a.Function;
      });
      it('throws an error when abstract methods aren\'t implemented', function () {
        var BaseImporter = new mapper.BaseImporter();
        BaseImporter.importSchema.should.throw();
        BaseImporter.exportORM.should.throw();
        BaseImporter.getExternalSchema.should.throw();
      });
      it('allows readystate changes that trigger notification event', function (done) {
        var BaseImporter = new mapper.BaseImporter();
        var newState = 2;
        var listener = function (state) {
          if(state === newState){
            return done();
          }
          done( new Error('Change state event did not report the correct value'));
        }

        BaseImporter.setReadyState.should.be.a.Function;
        BaseImporter.getReadyState.should.be.a.Function;

        BaseImporter.on('readyStateChanged', listener);
        BaseImporter.setReadyState(newState);
      });
      it('get model returns an object with properties,definitions,ids keys', function () {
        var BaseImporter = new mapper.BaseImporter();
        BaseImporter.getModel.should.be.a.Function;
        var mdl = BaseImporter.getModel();

        mdl.should.be.an.Object;
        mdl.should.have.property('properties');
        mdl.should.have.property('definitions');
        mdl.should.have.property('ids');
      });
    });
});

describe('jsonschema-manager', function () {
  describe('provide a base class', function () {
    it('returns a function to be inherited from', function () {
      should.exist(mapper.BaseImporter);
      mapper.BaseManager.should.be.a.Function;
    });

  });
});