import * as os from 'os';
import plimit from 'p-limit';

/**
 * Interface for Serverless instance
 */
interface Serverless {
  getProvider(_name: string): ServerlessProvider;
  service: {
    service: string;
    functions: Record<string, ServerlessFunction>;
    provider: {
      stage: string;
    };
  };
  cli?: {
    log(_message: string, _entity?: string): void;
  };
}

/**
 * Interface for Serverless provider
 */
interface ServerlessProvider {
  request(_service: string, _method: string, _params: Record<string, any>): Promise<any>;
}

/**
 * Interface for Serverless function configuration
 */
interface ServerlessFunction {
  concurrency?: {
    provisioned?: number;
    version?: string;
  };
}

/**
 * Interface for Serverless options
 */
interface ServerlessOptions {
  function?: string;
  [key: string]: any;
}

/**
 * Interface for Serverless utils (v4)
 */
interface ServerlessUtils {
  log: {
    info(_message: string): void;
    error(_message: string): void;
  };
  progress: {
    create(_options: { message: string }): { remove(): void };
  };
}

/**
 * Interface for normalized function configuration
 */
interface NormalizedFunctionConfig {
  concurrency: number;
  version: string | null;
}

/**
 * Interface for function with configuration
 */
interface FunctionWithConfig {
  name: string;
  config: NormalizedFunctionConfig;
}

/**
 * Interface for a Lambda version
 */
interface LambdaVersion {
  Version: string;
  [key: string]: any;
}

/**
 * Interface for serverless logger
 */
interface Logger {
  info(_message: string): void;
  error(_message: string): void;
}

/**
 * Interface for serverless progress spinner instance
 */
interface Spinner {
  remove(): void;
}

/**
 * Interface for serverless progress manager
 */
interface Progress {
  create(_options: { message: string }): Spinner;
}

/**
 * LambdaProvisionedConcurrency is a serverless plugin that manages provisioned concurrency
 * for Lambda functions. It can set/update provisioned concurrency during deployment and
 * clean it up during removal.
 */
class ProvisionedConcurrency {
  private serverless: Serverless;
  private options: ServerlessOptions;
  private log: Logger;
  private progress: Progress;
  private provider: ServerlessProvider;
  public readonly hooks: Record<string, () => Promise<void>>;

  constructor(serverless: Serverless, options: ServerlessOptions, utils?: ServerlessUtils) {
    this.serverless = serverless;
    this.options = options;

    // Handle different constructor signatures between v3 and v4
    if (utils && typeof utils === 'object') {
      // Serverless v4 - utils is an object with log and progress
      this.log = utils.log;
      this.progress = utils.progress;
    } else {
      // Serverless v3 - utils might be undefined or different structure
      this.log = this._createLegacyLogger();
      this.progress = this._createLegacyProgress();
    }

    this.provider = this.serverless.getProvider('aws');

    this.hooks = {
      'after:aws:deploy:deploy:updateStack': this.setProvisionedConcurrency.bind(this),
      'after:deploy:function:deploy': this.setProvisionedConcurrencyForFunction.bind(this),
    };
  }

  /**
   * Creates a legacy logger for Serverless v3 compatibility
   * @returns {Object}
   * @private
   */
  private _createLegacyLogger(): Logger {
    return {
      info: (message: string) => {
        if (this.serverless.cli && this.serverless.cli.log) {
          this.serverless.cli.log(message);
        } else {
          console.log(message); // eslint-disable-line no-console
        }
      },
      error: (message: string) => {
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
  private _createLegacyProgress(): Progress {
    return {
      create: (_options: { message: string }) => ({
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
  async setProvisionedConcurrency(): Promise<void> {
    const functions = this._getConfiguredFunctions();

    if (functions.length === 0) {
      this._logInfo('No functions configured for provisioned concurrency');
      return;
    }

    const progress = this.progress.create({
      message: 'Setting provisioned concurrency...',
    });

    // Get the number of available CPUs for the concurrency limit
    const cpuCount = os.cpus().length;
    this._logInfo(`Using concurrency limit of ${cpuCount} (based on available CPUs)`);

    try {
      // Create a limit function with concurrency based on CPU count
      const limit = plimit(cpuCount);

      // Map each function to a limited promise
      const promises = functions.map((func) => limit(() => this._processFunction(func)));

      // Wait for all promises to complete
      await Promise.all(promises);
      this._logInfo('Provisioned concurrency configuration completed');
    } catch (error) {
      this._logError(`Error setting provisioned concurrency: ${(error as Error).message}`);
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
  private async _processFunction(func: FunctionWithConfig): Promise<void> {
    const { name, config } = func;
    const functionName = this._getFunctionName(name);

    try {
      // Get the specific version or create a new one
      let version = config.version;

      if (!version || version === 'latest') {
        // If no version specified or 'latest', get the latest version number
        version = await this._getLatestVersion(functionName);
      }

      this._logInfo(`Setting provisioned concurrency for ${functionName}:${version} to ${config.concurrency}`);
      await this._setProvisionedConcurrency(functionName, version, config.concurrency);
    } catch (error) {
      this._logError(`Error processing function ${name}: ${(error as Error).message}`);
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
  private async _getLatestVersion(functionName: string): Promise<string> {
    try {
      const response = await this.provider.request('Lambda', 'listVersionsByFunction', {
        FunctionName: functionName,
        MaxItems: 50,
      });

      if (!response.Versions || response.Versions.length === 0) {
        throw new Error(`No versions found for function ${functionName}`);
      }

      // Get the latest version (excluding $LATEST)
      const versions = (response.Versions as LambdaVersion[])
        .filter((v) => v.Version !== '$LATEST')
        .sort((a, b) => parseInt(b.Version) - parseInt(a.Version));

      if (versions.length === 0) {
        throw new Error(`No numbered versions found for function ${functionName}. Only $LATEST version exists.`);
      }

      return versions[0].Version;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('No versions found') || error.message.includes('No numbered versions found'))
      ) {
        throw error; // Re-throw our custom errors
      }
      throw new Error(`Error getting latest version for ${functionName}: ${(error as Error).message}`);
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
  private async _setProvisionedConcurrency(functionName: string, version: string, concurrency: number): Promise<void> {
    this._logInfo('updating provisioned concurrency');
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
  private _getConfiguredFunctions(): FunctionWithConfig[] {
    const functions = this.serverless.service.functions || {};

    return Object.entries(functions)
      .filter(([_, functionConfig]) => functionConfig.concurrency?.provisioned)
      .map(([name, functionConfig]) => ({
        name,
        config: this._normalizeConfig(functionConfig.concurrency),
      }));
  }

  /**
   * Normalizes function configuration
   * @param {Object} config - Function concurrency configuration
   * @returns {Object}
   * @private
   */
  private _normalizeConfig(config: ServerlessFunction['concurrency']): NormalizedFunctionConfig {
    return {
      concurrency: config?.provisioned || 1,
      version: config?.version || null,
    };
  }

  /**
   * Gets the full function name including service and stage
   * @param {string} functionName - Function name from serverless config
   * @returns {string}
   * @private
   */
  private _getFunctionName(functionName: string): string {
    const { service } = this.serverless.service;
    const { stage } = this.serverless.service.provider;

    return `${service}-${stage}-${functionName}`;
  }

  /**
   * Logs error message
   * @param {string} message - Message to log
   * @private
   */
  private _logError(message: string): void {
    this.log.error(`Provisioned Concurrency: ${message}`);
  }

  /**
   * Logs info message
   * @param {string} message - Message to log
   * @private
   */
  private _logInfo(message: string): void {
    this.log.info(`Provisioned Concurrency: ${message}`);
  }

  /**
   * Sets provisioned concurrency for a single function after it's deployed
   * using the 'serverless deploy function' command
   * @returns {Promise<void>}
   */
  async setProvisionedConcurrencyForFunction(): Promise<void> {
    // Get the function name from the options
    const functionName = this.options.function;

    if (!functionName) {
      this._logError('Function name not provided');
      return;
    }

    this._logInfo(`Checking provisioned concurrency for function: ${functionName}`);

    // Get all functions with provisioned concurrency configured
    const allConfiguredFunctions = this._getConfiguredFunctions();

    // Find the specific function we're deploying
    const functionConfig = allConfiguredFunctions.find((func) => func.name === functionName);

    if (!functionConfig) {
      this._logInfo(`Function ${functionName} does not have provisioned concurrency configured`);
      return;
    }

    const progress = this.progress.create({
      message: `Setting provisioned concurrency for function ${functionName}...`,
    });

    try {
      await this._processFunction(functionConfig);
      this._logInfo(`Provisioned concurrency set for function ${functionName}`);
    } catch (error) {
      this._logError(`Error setting provisioned concurrency for function ${functionName}: ${(error as Error).message}`);
    } finally {
      progress.remove();
    }
  }
}

export = ProvisionedConcurrency;
