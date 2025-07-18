import ProvisionedConcurrency from '../index';

describe('Function processing methods', () => {
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
      custom: {},
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

    // Reset the functions configuration
    mockServerless.service.functions = {};
  });

  describe('_getConfiguredFunctions', () => {
    it('should return empty array when no functions are configured', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const functions = plugin._getConfiguredFunctions();

      expect(functions).toEqual([]);
    });

    it('should return only functions with provisioned concurrency using concurrency.provisioned format', () => {
      // Configure functions with and without provisioned concurrency
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
        func4: {
          concurrency: {}, // Empty concurrency config
        },
      };

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const functions = plugin._getConfiguredFunctions();

      expect(functions).toHaveLength(2);
      expect(functions[0].name).toBe('func1');
      expect(functions[1].name).toBe('func2');

      expect(functions[0].config).toEqual({
        provisioned: 10,
        reserved: null,
        version: null,
      });

      expect(functions[1].config).toEqual({
        provisioned: 5,
        reserved: null,
        version: '2',
      });
    });

    it('should return functions with provisioned concurrency', () => {
      // Configure functions with concurrency.provisioned
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

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      const functions = plugin._getConfiguredFunctions();

      expect(functions).toHaveLength(2);
      expect(functions[0].name).toBe('func1');
      expect(functions[1].name).toBe('func2');

      expect(functions[0].config).toEqual({
        provisioned: 10,
        reserved: null,
        version: null,
      });

      expect(functions[1].config).toEqual({
        provisioned: 5,
        reserved: null,
        version: '2',
      });
    });
  });

  describe('_processFunction', () => {
    beforeEach(() => {
      // Reset the mock implementation for provider.request
      mockServerless.getProvider().request.mockReset();
    });

    it('should process function with specific version', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function without reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          // No reservedConcurrency property
        },
      };

      // Mock the provider.request for getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
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

      // Mock the _delay method to return immediately
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 10,
          reserved: null,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should log the action
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Setting provisioned concurrency for test-service-test-myFunction:2 to 10'
      );

      // Should call provider.request with correct parameters
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'putProvisionedConcurrencyConfig', {
        FunctionName: 'test-service-test-myFunction',
        Qualifier: '2',
        ProvisionedConcurrentExecutions: 10,
      });
    });

    it('should get latest version when no version specified', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function without reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          // No reservedConcurrency property
        },
      };

      // Mock the provider.request for listVersionsByFunction and getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
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

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 10,
          reserved: null,
          version: null, // No version specified
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should call provider.request to get versions
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'listVersionsByFunction', {
        FunctionName: 'test-service-test-myFunction',
        MaxItems: 50,
      });

      // Should log the action with the latest version
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Setting provisioned concurrency for test-service-test-myFunction:3 to 10'
      );

      // Should call provider.request with correct parameters
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'putProvisionedConcurrencyConfig', {
        FunctionName: 'test-service-test-myFunction',
        Qualifier: '3',
        ProvisionedConcurrentExecutions: 10,
      });
    });

    it('should get latest version when "latest" is specified', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function without reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          // No reservedConcurrency property
        },
      };

      // Mock the provider.request for listVersionsByFunction and getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
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

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 10,
          reserved: null,
          version: 'latest', // "latest" specified
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should call provider.request to get versions
      expect(mockProvider.request).toHaveBeenCalledWith('Lambda', 'listVersionsByFunction', {
        FunctionName: 'test-service-test-myFunction',
        MaxItems: 50,
      });

      // Should log the action with the latest version
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Setting provisioned concurrency for test-service-test-myFunction:3 to 10'
      );
    });

    it('should handle errors during processing', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function without reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          // No reservedConcurrency property
        },
      };

      // Mock the provider.request to throw an error
      mockProvider.request.mockRejectedValue(new Error('API error'));

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      // Mock the _logError method
      // @ts-ignore - Accessing private method for testing
      const originalLogError = plugin._logError;
      // @ts-ignore - Accessing private method for testing
      plugin._logError = jest.fn();

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 10,
          reserved: null,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await expect(plugin._processFunction(functionConfig)).rejects.toThrow('API error');

      // Restore the original _logError method
      // @ts-ignore - Accessing private method for testing
      plugin._logError = originalLogError;
    });

    it('should not show warning when function has no reserved concurrency configured', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function without reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          // No reservedConcurrency property
        },
      };

      // Mock the provider.request for getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
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

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 10,
          reserved: null,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should not log any warning about reserved concurrency
      expect(mockUtils.log.info).not.toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Function test-service-test-myFunction has provisioned concurrency')
      );
    });

    it('should not show warning when provisioned concurrency is within 80% of reserved concurrency', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function with reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          reservedConcurrency: 100, // 80% of this is 80
        },
      };

      // Mock the provider.request for getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({
            Status: 'READY',
            RequestedProvisionedConcurrentExecutions: 80,
            AvailableProvisionedConcurrentExecutions: 80,
            AllocatedProvisionedConcurrentExecutions: 80,
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 80, // Exactly 80% of reserved concurrency
          reserved: 100,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should not log any warning about reserved concurrency
      expect(mockUtils.log.info).not.toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Function test-service-test-myFunction has provisioned concurrency')
      );
    });

    it('should show warning when provisioned concurrency exceeds 80% of reserved concurrency', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function with reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          reservedConcurrency: 100, // 80% of this is 80
        },
      };

      // Mock the provider.request for getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({
            Status: 'READY',
            RequestedProvisionedConcurrentExecutions: 81,
            AvailableProvisionedConcurrentExecutions: 81,
            AllocatedProvisionedConcurrentExecutions: 81,
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 81, // Exceeds 80% of reserved concurrency
          reserved: 100,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should log a warning about reserved concurrency
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Setting provisioned concurrency for test-service-test-myFunction:2 to 81'
      );
    });

    it('should use custom maxPercent when configured in custom.provisionedConcurrency.maxPercent', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function with reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          reservedConcurrency: 100, // 90% of this is 90
        },
      };

      // Configure custom.provisionedConcurrency.maxPercent
      mockServerless.service.custom = {
        provisionedConcurrency: {
          maxPercent: 90, // 90% instead of default 80%
        },
      };

      // Mock the provider.request for getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({
            Status: 'READY',
            RequestedProvisionedConcurrentExecutions: 91,
            AvailableProvisionedConcurrentExecutions: 91,
            AllocatedProvisionedConcurrentExecutions: 91,
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 91, // Exceeds 90% of reserved concurrency
          reserved: 100,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should log a warning about reserved concurrency with custom percentage
      expect(mockUtils.log.info).toHaveBeenCalledWith(
        'Provisioned Concurrency: Setting provisioned concurrency for test-service-test-myFunction:2 to 91'
      );
    });

    it('should not show warning when provisioned concurrency is within custom maxPercent', async () => {
      const mockProvider = mockServerless.getProvider();

      // Configure a function with reserved concurrency
      mockServerless.service.functions = {
        myFunction: {
          reservedConcurrency: 100, // 90% of this is 90
        },
      };

      // Configure custom.provisionedConcurrency.maxPercent
      mockServerless.service.custom = {
        provisionedConcurrency: {
          maxPercent: 90, // 90% instead of default 80%
        },
      };

      // Mock the provider.request for getProvisionedConcurrencyConfig
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'getProvisionedConcurrencyConfig') {
          return Promise.resolve({
            Status: 'READY',
            RequestedProvisionedConcurrentExecutions: 90,
            AvailableProvisionedConcurrentExecutions: 90,
            AllocatedProvisionedConcurrentExecutions: 90,
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);
      // @ts-ignore - Accessing private method for testing
      plugin._delay = jest.fn().mockResolvedValue(undefined);

      const functionConfig = {
        name: 'myFunction',
        config: {
          provisioned: 90, // Exactly 90% of reserved concurrency
          reserved: 100,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await plugin._processFunction(functionConfig);

      // Should not log any warning about reserved concurrency
      expect(mockUtils.log.info).not.toHaveBeenCalledWith(
        expect.stringContaining('WARNING: Function test-service-test-myFunction has provisioned concurrency')
      );
    });
  });
});
