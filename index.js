/**
 * LambdaProvisionedConcurrency is a serverless plugin that manages provisioned concurrency
 * for Lambda functions. It can set/update provisioned concurrency during deployment and
 * clean it up during removal.
 */
const pLimit = require('p-limit');
const os = require('os');

class LambdaProvisionedConcurrency {
  constructor(serverless, options, utils) {
    this.serverless = serverless;
    this.options = options;

    // Handle different constructor signatures between v3 and v4
    if (utils && typeof utils === 'object') {
      // Serverless v4 - utils is an object with log and progress
      this.log = utils.log;
      this.progress = utils.progress;
    } else {
      // Serverless v3 - utils might be undefined or different structure
      this.log = this.#createLegacyLogger();
      this.progress = this.#createLegacyProgress();
    }

    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'after:aws:deploy:deploy:updateStack': this.setProvisionedConcurrency.bind(this),
    };
  }

  /**
   * Creates a legacy logger for Serverless v3 compatibility
   * @returns {Object}
   * @private
   */
  #createLegacyLogger() {
    return {
      info: (message) => {
        if (this.serverless.cli && this.serverless.cli.log) {
          this.serverless.cli.log(message);
        } else {
          console.log(message); // eslint-disable-line no-console
        }
      },
      error: (message) => {
        if (this.serverless.cli && this.serverless.cli.log) {
          this.serverless.cli.log(message, 'ERROR');
        } else {
          console.error(message); // eslint-disable-line no-console
        }
      },
    };
  }

  /**
   * Creates a legacy progress handler for Serverless v3 compatibility
   * @returns {Object}
   * @private
   */
  #createLegacyProgress() {
    return {
      // eslint-disable-next-line no-unused-vars
      create: (options) => ({
        remove: () => {
          // No-op for v3 compatibility
        },
      }),
    };
  }

  /**
   * Main entrypoint to set provisioned concurrency for configured functions
   * @returns {Promise<void>}
   */
  async setProvisionedConcurrency() {
    const functions = this.#getConfiguredFunctions();

    if (functions.length === 0) {
      this.#logInfo('No functions configured for provisioned concurrency');
      return;
    }

    const progress = this.progress.create({
      message: 'Setting provisioned concurrency...',
    });

    // Get the number of available CPUs for concurrency limit
    const cpuCount = os.cpus().length;
    this.#logInfo(`Using concurrency limit of ${cpuCount} (based on available CPUs)`);

    try {
      // Create a limit function with concurrency based on CPU count
      const limit = pLimit(cpuCount);

      // Map each function to a limited promise
      const promises = functions.map((func) => limit(() => this.#processFunction(func)));

      // Wait for all promises to complete
      await Promise.all(promises);
      this.#logInfo('Provisioned concurrency configuration completed');
    } catch (error) {
      this.#logError(`Error setting provisioned concurrency: ${error.message}`);
    } finally {
      progress.remove();
    }
  }

  /**
   * Processes a single function to set provisioned concurrency
   * @param {Object} func - Function configuration
   * @returns {Promise<void>}
   * @private
   */
  async #processFunction(func) {
    const { name, config } = func;
    const functionName = this.#getFunctionName(name);

    try {
      // Get the specific version or create a new one
      let version = config.version;

      if (!version || version === 'latest') {
        // If no version specified or 'latest', get the latest version number
        version = await this.#getLatestVersion(functionName);
      }

      this.#logInfo(`Setting provisioned concurrency for ${functionName}:${version} to ${config.concurrency}`);
      await this.#setProvisionedConcurrency(functionName, version, config.concurrency);
    } catch (error) {
      this.#logError(`Error processing function ${name}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets the latest version number for a function
   * @param {string} functionName - Function name
   * @returns {Promise<string>}
   * @throws {Error} If no versions are found or API call fails
   * @private
   */
  async #getLatestVersion(functionName) {
    try {
      const response = await this.provider.request('Lambda', 'listVersionsByFunction', {
        FunctionName: functionName,
        MaxItems: 50,
      });

      if (!response.Versions || response.Versions.length === 0) {
        throw new Error(`No versions found for function ${functionName}`);
      }

      // Get the latest version (excluding $LATEST)
      const versions = response.Versions.filter((v) => v.Version !== '$LATEST').sort(
        (a, b) => parseInt(b.Version) - parseInt(a.Version)
      );

      if (versions.length === 0) {
        throw new Error(`No numbered versions found for function ${functionName}. Only $LATEST version exists.`);
      }

      return versions[0].Version;
    } catch (error) {
      if (error.message.includes('No versions found') || error.message.includes('No numbered versions found')) {
        throw error; // Re-throw our custom errors
      }
      throw new Error(`Error getting latest version for ${functionName}: ${error.message}`);
    }
  }

  /**
   * Updates provisioned concurrency configuration
   * @param {string} functionName - Function name
   * @param {string} version - Function version
   * @param {number} concurrency - Provisioned concurrency value
   * @returns {Promise<void>}
   * @private
   */
  async #setProvisionedConcurrency(functionName, version, concurrency) {
    this.#logInfo('updating provisioned concurrency');
    await this.provider.request('Lambda', 'putProvisionedConcurrencyConfig', {
      FunctionName: functionName,
      Qualifier: version,
      ProvisionedConcurrentExecutions: concurrency,
    });
  }

  /**
   * Gets functions configured for provisioned concurrency from serverless config
   * @returns {Array<Object>}
   * @private
   */
  #getConfiguredFunctions() {
    const functions = this.serverless.service.functions || {};

    return Object.entries(functions)
      .filter(([_, functionConfig]) => functionConfig.concurrency?.provisioned) // eslint-disable-line no-unused-vars
      .map(([name, functionConfig]) => ({
        name,
        config: this.#normalizeConfig(functionConfig.concurrency),
      }));
  }

  /**
   * Normalizes function configuration
   * @param {Object} config - Function concurrency configuration
   * @returns {Object}
   * @private
   */
  #normalizeConfig(config) {
    return {
      concurrency: config.provisioned || 1,
      version: config.version || null,
    };
  }

  /**
   * Gets the full function name including service and stage
   * @param {string} functionName - Function name from serverless config
   * @returns {string}
   * @private
   */
  #getFunctionName(functionName) {
    const { service } = this.serverless.service;
    const { stage } = this.serverless.service.provider;

    return `${service}-${stage}-${functionName}`;
  }

  /**
   * Logs error message
   * @param {string} message - Message to log
   * @private
   */
  #logError(message) {
    this.log.error(`Lambda Provisioned Concurrency: ${message}`);
  }

  /**
   * Logs info message
   * @param {string} message - Message to log
   * @private
   */
  #logInfo(message) {
    this.log.info(`Lambda Provisioned Concurrency: ${message}`);
  }
}

module.exports = LambdaProvisionedConcurrency;
