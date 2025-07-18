import * as os from 'os';
import plimit from 'p-limit';
// import chalk from 'chalk';
import NoVersionFoundError from './execptions/NoVersionFoundError';
import MaximumConcurrencyError from './execptions/MaximumConcurrencyError';
import {
  Serverless,
  ServerlessOptions,
  ServerlessProvider,
  ServerlessFunction,
  ServerlessUtils,
  Logger,
  Progress,
  LambdaVersion,
  FunctionWithConfig,
  NormalizedFunctionConfig,
} from './interfaces';

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
      'before:aws:deploy:deploy:updateStack': this.validateConcurrency.bind(this),
      'before:deploy:function:deploy': this.validateConcurrencyForFunction.bind(this),
      'after:aws:deploy:deploy:updateStack': this.setProvisionedConcurrency.bind(this),
      'after:deploy:function:deploy': this.setProvisionedConcurrencyForFunction.bind(this),
    };
  }

  async validateConcurrency(): Promise<void> {
    // Validate all functions before processing
    const validationErrors = this._validateAllFunctions();
    if (validationErrors.length > 0) {
      // Join all error messages with line breaks
      const errorMessage = validationErrors.join('\n\n');
      throw new MaximumConcurrencyError(
        `Validation failed for the following functions:\n\n${errorMessage}\n\nDeployment process stopped.`
      );
    }
  }

  async validateConcurrencyForFunction(): Promise<void> {
    const functionName = this.options.function;

    if (!functionName) {
      this._logError('Function name not provided');
      return;
    }

    const functions = this._getConfiguredFunctions();
    const func = functions.find((func) => func.name === functionName);

    if (!func) {
      return;
    }

    const error = this._validateProvisionedConcurrency(func);

    if (error) {
      throw new MaximumConcurrencyError(
        `Validation failed for function ${functionName}:\n\n${error}\n\nDeployment process stopped.`
      );
    }
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

    // Validate the function before processing
    const validationError = this._validateProvisionedConcurrency(functionConfig);
    if (validationError) {
      throw new MaximumConcurrencyError(
        `Validation failed for function ${functionName}:\n\n${validationError}\n\nDeployment process stopped.`
      );
    }

    // Create a shared state object for tracking progress
    const state = {
      progress: this.progress.create({
        message: `Setting provisioned concurrency for function ${functionName} (0/1) (0s)`,
      }),
      completedCount: 0,
      totalCount: 1,
      startTime: Date.now(),
      updateMessage: function () {
        const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        return `Setting provisioned concurrency for function ${functionName} (${this.completedCount}/${this.totalCount}) (${elapsedSeconds}s)`;
      },
    };

    // Start a timer to update the spinner message with elapsed time
    const updateInterval = setInterval(() => {
      if (state.progress) {
        state.progress.remove();
        state.progress = this.progress.create({
          message: state.updateMessage(),
        });
      } else {
        clearInterval(updateInterval);
      }
    }, 1000);

    try {
      await this._processFunction(functionConfig, state);
      this._logInfo(`Provisioned concurrency set for function ${functionName}`);
    } catch (error) {
      this._logError(`Error setting provisioned concurrency for function ${functionName}: ${(error as Error).message}`);
      // Re-throw the error to stop the deployment process
      throw error;
    } finally {
      clearInterval(updateInterval);
      if (state.progress) {
        state.progress.remove();
        // Create a fake spinner that satisfies the Spinner interface
        state.progress = {
          remove: () => {
            // No-op
          },
        };
      }
    }
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

    // Create a shared state object for tracking progress
    const state = {
      progress: this.progress.create({
        message: 'Setting provisioned concurrency (0/' + functions.length + ') (0s)',
      }),
      completedCount: 0,
      totalCount: functions.length,
      startTime: Date.now(),
      updateMessage: function () {
        const elapsedSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        return `Setting provisioned concurrency (${this.completedCount}/${this.totalCount}) (${elapsedSeconds}s)`;
      },
    };

    // Start a timer to update the spinner message with elapsed time
    const updateInterval = setInterval(() => {
      if (state.progress) {
        state.progress.remove();
        state.progress = this.progress.create({
          message: state.updateMessage(),
        });
      } else {
        clearInterval(updateInterval);
      }
    }, 1000);

    // Get the number of available CPUs for the concurrency limit
    const cpuCount = os.cpus().length;
    this._logInfo(`Using concurrency limit of ${cpuCount} (based on available CPUs)`);

    try {
      // Create a limit function with concurrency based on CPU count
      const limit = plimit(cpuCount);

      // Map each function to a limited promise
      const promises = functions.map((func) => limit(() => this._processFunction(func, state)));

      // Wait for all promises to complete
      await Promise.all(promises);
      this._logInfo('Provisioned concurrency configuration completed');
    } catch (error) {
      this._logError(`Error setting provisioned concurrency: ${(error as Error).message}`);
      // Re-throw the error to stop the deployment process
      throw error;
    } finally {
      clearInterval(updateInterval);
      if (state.progress) {
        state.progress.remove();
        // Create a fake spinner that satisfies the Spinner interface
        state.progress = {
          remove: () => {
            // No-op
          },
        };
      }
    }
  }

  /**
   * Validates a function's provisioned concurrency against its reserved concurrency
   * @param {FunctionWithConfig} func - Function configuration
   * @returns {string|null} - Error message if validation fails, null if validation passes
   * @private
   */
  private _validateProvisionedConcurrency(func: FunctionWithConfig): string | null {
    const { name, config } = func;
    const functionName = this._getFunctionName(name);

    // Check if the function has reserved concurrency configured
    // If it does, ensure provisioned concurrency is at most maxPercent of reserved concurrency
    const originalFunctionConfig = this.serverless.service.functions[name] as ServerlessFunction;
    const maxPercent = this._getProvisionedConcurrencyPercent();
    const percentDisplay = Math.round(maxPercent * 100);

    // Use the reserved concurrency from the config if available, otherwise from the original function config
    const reservedConcurrency =
      config.reserved !== null && config.reserved !== undefined
        ? config.reserved
        : originalFunctionConfig.reservedConcurrency;

    // Only check if reserved concurrency is configured
    if (reservedConcurrency !== null && reservedConcurrency !== undefined) {
      const maxProvisionedConcurrency = Math.floor(reservedConcurrency * maxPercent);
      // If provisioned concurrency exceeds maxPercent of reserved concurrency, return an error message
      if (config.provisioned > maxProvisionedConcurrency) {
        return (
          `Function ${functionName} has provisioned concurrency (${config.provisioned}) ` +
          `higher than ${percentDisplay}% of reserved concurrency (${reservedConcurrency}). ` +
          `Maximum recommended provisioned concurrency is ${maxProvisionedConcurrency}. ` +
          `Maximum available provisioned concurrency is ${reservedConcurrency - 1}.`
        );
      }
    }

    return null;
  }

  /**
   * Validates all functions configured for provisioned concurrency
   * @returns {string[]} - Array of error messages for functions that fail validation
   * @private
   */
  private _validateAllFunctions(): string[] {
    const functions = this._getConfiguredFunctions();
    const errors: string[] = [];

    for (const func of functions) {
      const error = this._validateProvisionedConcurrency(func);
      if (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  private async _processFunction(func: FunctionWithConfig, state?: any): Promise<void> {
    const { name, config } = func;
    const functionName = this._getFunctionName(name);

    let version = config.version;

    if (!version || version === 'latest') {
      version = await this._getLatestVersion(functionName);
    }

    await this._setProvisionedConcurrency(functionName, version, config.provisioned, state);

    // Update the completed count and refresh the progress message if a state is provided
    if (state) {
      state.completedCount += 1;
      if (state.progress) {
        state.progress.remove();
        state.progress = this.progress.create({
          message: state.updateMessage(),
        });
      }
    }
  }

  /**
   * Get maximum provisioned concurrency percent recommended to be configured
   * @returns {number}
   * @private
   */
  private _getProvisionedConcurrencyPercent(): number {
    const customConfig = this.serverless.service.custom?.provisionedConcurrency || {};
    return customConfig.maxPercent !== undefined ? customConfig.maxPercent / 100 : 0.8;
  }

  /**
   * Extracts version number from a Lambda function ARN
   * @param {string} arn - Lambda function ARN
   * @returns {string|null} - Version number or null if not found
   * @private
   */
  private _extractVersionFromArn(arn: string): string | null {
    if (!arn) return null;

    // ARN format: arn:aws:lambda:region:account-id:function:function-name:version
    const parts = arn.split(':');
    if (parts.length < 8) return null;

    return parts[7]; // Version is the 8th part (index 7)
  }

  /**
   * Process previously provisioned concurrency set on other function versions and delete them
   * @param {string} functionName - Name of the function to manage versions
   * @param {string} version - Current version to set concurrency
   * @private
   */
  private async _managePreviousConcurrency(functionName: string, version: string): Promise<void> {
    // Check if there are other versions with provisioned concurrency
    const versionsWithConcurrency = await this._getVersionsWithProvisionedConcurrency(functionName);

    // If other versions with provisioned concurrency exist, delete their concurrency
    if (versionsWithConcurrency.length == 0) {
      return;
    }

    for (const versionConfig of versionsWithConcurrency) {
      // Extract version from FunctionArn
      const versionFromArn = this._extractVersionFromArn(versionConfig.FunctionArn);

      // Skip if it's the same version we're trying to set or if a version couldn't be extracted
      if (versionFromArn === version || !versionFromArn) {
        continue;
      }

      await this._deleteProvisionedConcurrency(functionName, versionFromArn);
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
    const response = await this.provider.request('Lambda', 'listVersionsByFunction', {
      FunctionName: functionName,
      MaxItems: 50,
    });

    if (!response.Versions || response.Versions.length === 0) {
      throw new NoVersionFoundError(`No versions found for function ${functionName}`);
    }

    // Get the latest version (excluding $LATEST)
    const versions = (response.Versions as LambdaVersion[])
      .filter((v) => v.Version !== '$LATEST')
      .sort((a, b) => parseInt(b.Version) - parseInt(a.Version));

    if (versions.length === 0) {
      throw new NoVersionFoundError(
        `No numbered versions found for function ${functionName}. Only $LATEST version exists.`
      );
    }

    return versions[0].Version;
  }

  /**
   * Updates provisioned concurrency configuration
   * @param {string} functionName - Function name
   * @param {string} version - Function version
   * @param {number} concurrency - Provisioned concurrency value
   * @param {Object} state - Shared state object for tracking progress
   * @returns {Promise<void>}
   * @private
   */
  private async _setProvisionedConcurrency(
    functionName: string,
    version: string,
    concurrency: number,
    state?: any
  ): Promise<void> {
    this._logInfo(`Setting provisioned concurrency for ${functionName}:${version} to ${concurrency}`);

    try {
      await this.provider.request('Lambda', 'putProvisionedConcurrencyConfig', {
        FunctionName: functionName,
        Qualifier: version,
        ProvisionedConcurrentExecutions: concurrency,
      });

      // Wait for the configuration to be ready
      await this._waitForProvisionedConcurrencyReady(functionName, version, state);
    } catch (error) {
      if ((error as Error).message.includes('InvalidParameterValueException')) {
        this._logError(
          `Invalid provisioned concurrency configuration for ${functionName}:${version}. ` +
            `Check that the value (${concurrency}) is within AWS limits and doesn't exceed reserved concurrency.`
        );
      }
      throw error;
    }

    await this._managePreviousConcurrency(functionName, version);
  }

  private async _waitForProvisionedConcurrencyReady(functionName: string, version: string, state?: any): Promise<void> {
    const maxAttempts = 30; // 5-minute max wait
    const delayMs = 10000; // 10 seconds between checks

    // Create a local spinner if the state is not provided or doesn't have progress
    let localSpinner: any = null;
    // Update the shared spinner message to indicate waiting for this function
    if (state && state.progress) {
      state.progress.remove();
      state.progress = this.progress.create({
        message: `${state.updateMessage()} - Waiting for ${functionName}:${version}`,
      });
    } else {
      localSpinner = this.progress.create({
        message: `Waiting for provisioned concurrency for ${functionName}:${version} to become ready`,
      });
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const response = await this.provider.request('Lambda', 'getProvisionedConcurrencyConfig', {
          FunctionName: functionName,
          Qualifier: version,
        });

        if (response.Status === 'READY') {
          // Restore the original spinner message or remove local spinner
          if (state && state.progress) {
            state.progress.remove();
            state.progress = this.progress.create({
              message: state.updateMessage(),
            });
          } else if (localSpinner) {
            localSpinner.remove();
          }
          return;
        }

        // Update the spinner message with the current attempt
        if (state && state.progress) {
          state.progress.remove();
          state.progress = this.progress.create({
            message: `${state.updateMessage()} - Waiting for ${functionName}:${version} (${attempt + 1}/${maxAttempts})`,
          });
        } else if (localSpinner) {
          localSpinner.remove();
          localSpinner = this.progress.create({
            message: `Waiting for provisioned concurrency for ${functionName}:${version} to become ready (${attempt + 1}/${maxAttempts})`,
          });
        }

        await this._delay(delayMs);
      } catch (error) {
        // Restore the original spinner message or remove the local spinner in case of error
        if (state && state.progress) {
          state.progress.remove();
          state.progress = this.progress.create({
            message: state.updateMessage(),
          });
        } else if (localSpinner) {
          localSpinner.remove();
        }
        this._logError(`Error checking provisioned concurrency status: ${(error as Error).message}`);
        throw error;
      }
    }

    // Restore the original spinner message or remove the local spinner in case of timeout
    if (state && state.progress) {
      state.progress.remove();
      state.progress = this.progress.create({
        message: state.updateMessage(),
      });
    } else if (localSpinner) {
      localSpinner.remove();
    }
    throw new Error(`Provisioned concurrency for ${functionName}:${version} did not become ready within timeout`);
  }

  private async _delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Gets all versions with provisioned concurrency for a function
   * @param {string} functionName - Function name
   * @returns {Promise<Array>} - Array of version configurations with provisioned concurrency
   * @private
   */
  private async _getVersionsWithProvisionedConcurrency(functionName: string): Promise<any[]> {
    try {
      const response = await this.provider.request('Lambda', 'listProvisionedConcurrencyConfigs', {
        FunctionName: functionName,
        MaxItems: 50,
      });

      if (!response.ProvisionedConcurrencyConfigs || response.ProvisionedConcurrencyConfigs.length === 0) {
        return [];
      }

      return response.ProvisionedConcurrencyConfigs;
    } catch (error) {
      this._logError(
        `Error getting versions with provisioned concurrency for ${functionName}: ${(error as Error).message}`
      );
      return [];
    }
  }

  /**
   * Deletes provisioned concurrency configuration for a function version
   * @param {string} functionName - Function name
   * @param {string} version - Function version
   * @returns {Promise<void>}
   * @private
   */
  private async _deleteProvisionedConcurrency(functionName: string, version: string): Promise<void> {
    try {
      this._logInfo(`Deleting provisioned concurrency for ${functionName}:${version}`);
      await this.provider.request('Lambda', 'deleteProvisionedConcurrencyConfig', {
        FunctionName: functionName,
        Qualifier: version,
      });
    } catch (error) {
      this._logError(
        `Error deleting provisioned concurrency for ${functionName}:${version}: ${(error as Error).message}`
      );
      throw error;
    }
  }

  /**
   * Gets functions configured for provisioned concurrency from serverless config
   * @returns {Array<Object>}
   * @private
   */
  private _getConfiguredFunctions(): FunctionWithConfig[] {
    const functions = this.serverless.service.functions || {};

    return Object.entries(functions)
      .filter(
        ([_, functionConfig]) =>
          // Check for concurrency.provisioned configuration
          functionConfig.concurrency?.provisioned !== undefined
      )
      .map(([name, functionConfig]) => ({
        name,
        config: this._normalizeConfig(functionConfig),
      }));
  }

  /**
   * Normalizes function configuration from either format
   * @param {Object} functionConfig - Function configuration
   * @returns {Object}
   * @private
   */
  private _normalizeConfig(functionConfig: ServerlessFunction): NormalizedFunctionConfig {
    const version = functionConfig.concurrency?.version || null;
    const provisioned = functionConfig.concurrency?.provisioned || null;
    const reserved = functionConfig.reservedConcurrency || null;

    return <NormalizedFunctionConfig>{
      reserved: reserved,
      provisioned: provisioned,
      version: version,
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
   * Creates a legacy logger for Serverless v3 compatibility
   * @returns {Object}
   * @private
   */
  private _createLegacyLogger(): Logger {
    return {
      info: (message: string) => {
        if (this.serverless.cli?.log) {
          this.serverless.cli.log(message);
        } else {
          console.log(message); // eslint-disable-line no-console
        }
      },
      error: (message: string) => {
        if (this.serverless.cli?.log) {
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
}

export = ProvisionedConcurrency;
