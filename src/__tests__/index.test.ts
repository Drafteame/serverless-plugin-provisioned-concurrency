import * as os from 'os';
import ProvisionedConcurrency from '../index';
import MaximumConcurrencyError from '../execptions/MaximumConcurrencyError';
import NoVersionFoundError from '../execptions/NoVersionFoundError';

// Mock dependencies
jest.mock('os');
jest.mock('p-limit', () => {
  return jest.fn(() => {
    return (fn: Function) => fn();
  });
});

describe('ProvisionedConcurrency', () => {
  // Mock Serverless instance
  const mockServerless = {
    getProvider: jest.fn().mockReturnValue({
      request: jest.fn(),
    }),
    service: {
      service: 'test-service',
      functions: {},
      provider: {
        stage: 'test',
      },
    },
    cli: {
      log: jest.fn(),
    },
  };

  // Mock options
  const mockOptions = {};

  // Mock utils (for Serverless v4)
  const mockUtils = {
    log: {
      info: jest.fn(),
      error: jest.fn(),
    },
    progress: {
      create: jest.fn().mockReturnValue({
        remove: jest.fn(),
      }),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock os.cpus to return a fixed number of CPUs
    (os.cpus as jest.Mock).mockReturnValue(Array(4).fill({}));

    // Reset the functions configuration
    mockServerless.service.functions = {};
  });

  describe('constructor', () => {
    it('should initialize with Serverless v3', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any);

      expect(plugin).toBeDefined();
      expect(mockServerless.getProvider).toHaveBeenCalledWith('aws');
      expect(plugin.hooks).toHaveProperty('after:aws:deploy:deploy:updateStack');
      expect(plugin.hooks).toHaveProperty('after:deploy:function:deploy');
    });

    it('should initialize with Serverless v4', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      expect(plugin).toBeDefined();
      expect(mockServerless.getProvider).toHaveBeenCalledWith('aws');
      expect(plugin.hooks).toHaveProperty('after:aws:deploy:deploy:updateStack');
      expect(plugin.hooks).toHaveProperty('after:deploy:function:deploy');
    });
  });

  describe('setProvisionedConcurrency', () => {
    it('should do nothing when no functions are configured', async () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      await plugin.setProvisionedConcurrency();

      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: No functions configured for provisioned concurrency'
      );
      expect(mockUtils.progress.create).not.toHaveBeenCalled();
    });

    it('should delete existing provisioned concurrency before setting new one', async () => {
      // Configure functions with provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
      };

      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request for listVersionsByFunction, listProvisionedConcurrencyConfigs, and getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
          });
        }
        if (method === 'listProvisionedConcurrencyConfigs') {
          return Promise.resolve({
            ProvisionedConcurrencyConfigs: [
              {
                FunctionArn: `arn:aws:lambda:us-east-1:123456789012:function:${params.FunctionName}:1`,
                RequestedProvisionedConcurrentExecutions: 5,
                AvailableProvisionedConcurrentExecutions: 5,
                AllocatedProvisionedConcurrentExecutions: 5,
                Status: 'READY',
                StatusReason: null,
                LastModified: '2025-07-09T21:19:25+0000',
              },
              {
                FunctionArn: `arn:aws:lambda:us-east-1:123456789012:function:${params.FunctionName}:2`,
                RequestedProvisionedConcurrentExecutions: 5,
                AvailableProvisionedConcurrentExecutions: 5,
                AllocatedProvisionedConcurrentExecutions: 5,
                Status: 'READY',
                StatusReason: null,
                LastModified: '2025-07-09T21:19:25+0000',
              },
            ],
          });
        }
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({
            Status: 'READY',
            RequestedProvisionedConcurrentExecutions: 10,
            AvailableProvisionedConcurrentExecutions: 10,
            AllocatedProvisionedConcurrentExecutions: 10,
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      await plugin.setProvisionedConcurrency();

      // Should call provider.request for listVersionsByFunction, listProvisionedConcurrencyConfigs,
      // deleteProvisionedConcurrencyConfig (twice), and putProvisionedConcurrencyConfig
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'listVersionsByFunction', expect.any(Object));
      expect(mockProvider.request).toHaveBeenCalledWith(
        'Lambda',
        'listProvisionedConcurrencyConfigs',
        expect.any(Object)
      );
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'deleteProvisionedConcurrencyConfig', {
        FunctionName: 'test-service-test-func1',
        Qualifier: '1',
      });
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'deleteProvisionedConcurrencyConfig', {
        FunctionName: 'test-service-test-func1',
        Qualifier: '2',
      });
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'putProvisionedConcurrencyConfig', {
        FunctionName: 'test-service-test-func1',
        Qualifier: '3',
        ProvisionedConcurrentExecutions: 10,
      });

      // Should log about finding and deleting existing provisioned concurrency
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleting provisioned concurrency for test-service-test-func1:1')
      );
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Deleting provisioned concurrency for test-service-test-func1:2')
      );
    });

    it('should process functions with provisioned concurrency', async () => {
      // Configure functions with provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
        func2: {
          concurrency: {
            provisioned: 5,
            version: '2',
          },
        },
        func3: {}, // No concurrency config
      };

      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request for listVersionsByFunction, listProvisionedConcurrencyConfigs, and getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
          });
        }
        if (method === 'listProvisionedConcurrencyConfigs') {
          return Promise.resolve({
            ProvisionedConcurrencyConfigs: [],
          });
        }
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({
            Status: 'READY',
            RequestedProvisionedConcurrentExecutions: 10,
            AvailableProvisionedConcurrentExecutions: 10,
            AllocatedProvisionedConcurrentExecutions: 10,
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      await plugin.setProvisionedConcurrency();

      // Should create a progress indicator with the initial message
      expect(mockUtils.progress.create).toHaveBeenCalledWith({
        message: expect.stringMatching(/Setting provisioned concurrency \(0\/\d+\) \(0s\)/),
      });

      // Should log CPU count
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Using concurrency limit of 4 (based on available CPUs)'
      );

      // Should call provider.request for each function
      expect(mockProvider.request).toHaveBeenCalledTimes(7); // 2 listVersionsByFunction + 2 listProvisionedConcurrencyConfigs + 1 putProvisionedConcurrency + 2 getProvisionedConcurrencyConfig

      // Should log completion
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Provisioned concurrency configuration completed'
      );
    });

    it('should handle errors during processing', async () => {
      // Configure a function with provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
      };

      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request to throw an error for listVersionsByFunction
      // but allow other requests to succeed
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.reject(new Error('API error'));
        }
        // Return a default successful response for other methods
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // Wrap in try/catch to handle the expected error
      try {
        await plugin.setProvisionedConcurrency();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // Expected error, do nothing
      }

      // Should log the error
      expect(mockUtils.log.error).toHaveBeenCalledWith(
        'Provisioned Concurrency: Error setting provisioned concurrency: API error'
      );

      // Should remove the progress indicator even on error
      expect(mockUtils.progress.create().remove).toHaveBeenCalled();
    });
  });

  describe('setProvisionedConcurrencyForFunction', () => {
    it('should do nothing when function name is not provided', async () => {
      const plugin = new ProvisionedConcurrency(
        mockServerless as any,
        {} as any, // Empty options
        mockUtils as any
      );

      await plugin.setProvisionedConcurrencyForFunction();

      expect(mockUtils.log.error).toHaveBeenCalledWith('Provisioned Concurrency: Function name not provided');
      expect(mockUtils.progress.create).not.toHaveBeenCalled();
    });

    it('should do nothing when function does not have provisioned concurrency', async () => {
      // Configure functions without provisioned concurrency
      mockServerless.service.functions = {
        func1: {},
      };

      const plugin = new ProvisionedConcurrency(
        mockServerless as any,
        { function: 'func1' } as any, // Function name in options
        mockUtils as any
      );

      await plugin.setProvisionedConcurrencyForFunction();

      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Function func1 does not have provisioned concurrency configured'
      );
      expect(mockUtils.progress.create).not.toHaveBeenCalled();
    });

    it('should process function with provisioned concurrency', async () => {
      // Configure function with provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
            version: '2',
          },
        },
      };

      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request to return successful responses
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({ Status: 'READY' });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(
        mockServerless as any,
        { function: 'func1' } as any, // Function name in options
        mockUtils as any
      );

      await plugin.setProvisionedConcurrencyForFunction();

      // Should create a progress indicator with the initial message
      expect(mockUtils.progress.create).toHaveBeenCalledWith({
        message: expect.stringMatching(/Setting provisioned concurrency for function func1 \(0\/1\) \(0s\)/),
      });

      // Should call provider.request for the function
      expect(mockProvider.request).toHaveBeenCalledWith(
        'Lambda',
        'putProvisionedConcurrencyConfig',
        expect.objectContaining({
          FunctionName: 'test-service-test-func1',
          Qualifier: '2',
          ProvisionedConcurrentExecutions: 10,
        })
      );

      // Should log the action
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Setting provisioned concurrency for test-service-test-func1:2 to 10'
      );
    });

    it('should handle errors during processing', async () => {
      // Configure function with provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
      };

      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request to throw an error for specific methods
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'putProvisionedConcurrencyConfig') {
          return Promise.reject(new Error('API error'));
        }
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({ Status: 'READY' });
        }
        return Promise.resolve({
          Versions: [{ Version: '$LATEST' }, { Version: '1' }],
        });
      });

      const plugin = new ProvisionedConcurrency(
        mockServerless as any,
        { function: 'func1' } as any, // Function name in options
        mockUtils as any
      );

      // Wrap in try/catch to handle the expected error
      try {
        await plugin.setProvisionedConcurrencyForFunction();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // Expected error, do nothing
      }

      // Should log the error
      expect(mockUtils.log.error).toHaveBeenCalledWith(
        'Provisioned Concurrency: Error setting provisioned concurrency for function func1: API error'
      );

      // Should remove the progress indicator even on error
      expect(mockUtils.progress.create().remove).toHaveBeenCalled();
    });
  });

  describe('_getLatestVersion', () => {
    it('should return the latest version number', async () => {
      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request for listVersionsByFunction
      mockProvider.request.mockResolvedValue({
        Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const version = await plugin._getLatestVersion('test-function');

      expect(version).toBe('3');
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'listVersionsByFunction', {
        FunctionName: 'test-function',
        MaxItems: 50,
      });
    });

    it('should throw NoVersionFoundError when no versions are found', async () => {
      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request to return no versions
      mockProvider.request.mockResolvedValue({
        Versions: [],
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      await expect(plugin._getLatestVersion('test-function')).rejects.toThrow(NoVersionFoundError);
      // @ts-ignore - Accessing private method for testing
      await expect(plugin._getLatestVersion('test-function')).rejects.toThrow(
        'No versions found for function test-function'
      );
    });

    it('should throw NoVersionFoundError when only $LATEST version exists', async () => {
      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request to return only $LATEST
      mockProvider.request.mockResolvedValue({
        Versions: [{ Version: '$LATEST' }],
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      await expect(plugin._getLatestVersion('test-function')).rejects.toThrow(NoVersionFoundError);
      // @ts-ignore - Accessing private method for testing
      await expect(plugin._getLatestVersion('test-function')).rejects.toThrow(
        'No numbered versions found for function test-function'
      );
    });

    it('should handle API errors', async () => {
      const mockProvider = mockServerless.getProvider();

      // Mock the provider.request to throw an error
      mockProvider.request.mockRejectedValue(new Error('API error'));

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      await expect(plugin._getLatestVersion('test-function')).rejects.toThrow('API error');
    });
  });

  describe('_normalizeConfig', () => {
    it('should normalize config with defaults using concurrency object', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const normalized = plugin._normalizeConfig({
        concurrency: {
          provisioned: 10,
        },
      });

      expect(normalized).toEqual({
        provisioned: 10,
        reserved: null,
        version: null,
      });
    });

    it('should normalize config with version using concurrency object', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const normalized = plugin._normalizeConfig({
        concurrency: {
          provisioned: 10,
          version: '2',
        },
      });

      expect(normalized).toEqual({
        provisioned: 10,
        reserved: null,
        version: '2',
      });
    });

    it('should handle undefined config', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const normalized = plugin._normalizeConfig({} as any);

      expect(normalized).toEqual({
        provisioned: null,
        reserved: null,
        version: null,
      });
    });
  });

  describe('_getFunctionName', () => {
    it('should return the full function name', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const fullName = plugin._getFunctionName('myFunction');

      expect(fullName).toBe('test-service-test-myFunction');
    });
  });

  describe('validateConcurrency', () => {
    it('should do nothing when all functions pass validation', async () => {
      // Configure functions with valid provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
      };

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // Mock _validateAllFunctions to return empty array (no errors)
      // @ts-ignore - Accessing private method for testing
      plugin._validateAllFunctions = jest.fn().mockReturnValue([]);

      await expect(plugin.validateConcurrency()).resolves.not.toThrow();
      // @ts-ignore - Accessing private method for testing
      expect(plugin._validateAllFunctions).toHaveBeenCalled();
    });

    it('should throw MaximumConcurrencyError when validation fails', async () => {
      // Configure functions with invalid provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 100,
          },
          reservedConcurrency: 100,
        },
      };

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // Mock _validateAllFunctions to return error messages
      // @ts-ignore - Accessing private method for testing
      plugin._validateAllFunctions = jest
        .fn()
        .mockReturnValue([
          'Function test-service-test-func1 has provisioned concurrency (100) higher than 80% of reserved concurrency (100)',
        ]);

      await expect(plugin.validateConcurrency()).rejects.toThrow(MaximumConcurrencyError);
      await expect(plugin.validateConcurrency()).rejects.toThrow(/Validation failed for the following functions/);
      // @ts-ignore - Accessing private method for testing
      expect(plugin._validateAllFunctions).toHaveBeenCalled();
    });
  });

  describe('validateConcurrencyForFunction', () => {
    it('should do nothing when function passes validation', async () => {
      // Configure function with valid provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
      };

      const plugin = new ProvisionedConcurrency(
        mockServerless as any,
        { function: 'func1' } as any, // Function name in options
        mockUtils as any
      );
      // Mock _validateProvisionedConcurrency to return null (no error)
      // @ts-ignore - Accessing private method for testing
      plugin._validateProvisionedConcurrency = jest.fn().mockReturnValue(null);

      await expect(plugin.validateConcurrencyForFunction()).resolves.not.toThrow();
      // @ts-ignore - Accessing private method for testing
      expect(plugin._validateProvisionedConcurrency).toHaveBeenCalled();
    });

    it('should throw MaximumConcurrencyError when function validation fails', async () => {
      // Configure function with invalid provisioned concurrency
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 100,
          },
          reservedConcurrency: 100,
        },
      };

      const plugin = new ProvisionedConcurrency(
        mockServerless as any,
        { function: 'func1' } as any, // Function name in options
        mockUtils as any
      );
      // Mock _validateProvisionedConcurrency to return error message
      // @ts-ignore - Accessing private method for testing
      plugin._validateProvisionedConcurrency = jest
        .fn()
        .mockReturnValue(
          'Function test-service-test-func1 has provisioned concurrency (100) higher than 80% of reserved concurrency (100)'
        );

      await expect(plugin.validateConcurrencyForFunction()).rejects.toThrow(MaximumConcurrencyError);
      await expect(plugin.validateConcurrencyForFunction()).rejects.toThrow(/Validation failed for function func1/);
      // @ts-ignore - Accessing private method for testing
      expect(plugin._validateProvisionedConcurrency).toHaveBeenCalled();
    });
  });
});
