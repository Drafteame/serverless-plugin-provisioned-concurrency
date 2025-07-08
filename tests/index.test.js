import { expect } from 'chai';
import sinon from 'sinon';
import SlsPlugin from '../index.js';

describe('SlsPlugin', function () {
  let serverless;
  let options;
  let plugin;
  let logSpy;

  beforeEach(function () {
    serverless = { cli: { log: function () {} } };
    options = { someOption: 'someValue' };
    plugin = new SlsPlugin(serverless, options);
    logSpy = sinon.spy(serverless.cli, 'log');
  });

  afterEach(function () {
    logSpy.restore();
  });

  describe('constructor', function () {
    it('should set serverless and options', function () {
      expect(plugin.serverless).to.equal(serverless);
      expect(plugin.options).to.equal(options);
    });

    it('should set default options if none provided', function () {
      const pluginWithDefaultOptions = new SlsPlugin(serverless);
      expect(pluginWithDefaultOptions.options).to.deep.equal({});
    });

    it('should set hooks', function () {
      expect(plugin.hooks).to.have.property('initialize');
    });
  });

  describe('initialize', function () {
    it('should log initialization and options', function () {
      plugin.initialize();
      expect(logSpy.calledWith('Initializing plugin')).to.be.true;
      expect(logSpy.calledWith('Options:', options)).to.be.true;
    });
  });
});
