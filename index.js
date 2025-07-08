export default class SlsPlugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options || {};

    this.hooks = {
      initialize: this.initialize.bind(this),
    };
  }

  initialize() {
    this.serverless.cli.log('Initializing plugin');
    this.serverless.cli.log('Options:', this.options);
  }
}
