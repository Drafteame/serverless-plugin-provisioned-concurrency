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

    it('should return only functions with provisioned concurrency', () => {
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
        concurrency: 10,
        version: null,
      });

      expect(functions[1].config).toEqual({
        concurrency: 5,
        version: '2',
      });
    });
  });

  describe('_processFunction', () => {
    it('should process function with specific version', async () => {
      const mockProvider = mockServerless.getProvider();

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      const functionConfig = {
        name: 'myFunction',
        config: {
          concurrency: 10,
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

      // Mock the provider.request for listVersionsByFunction
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      const functionConfig = {
        name: 'myFunction',
        config: {
          concurrency: 10,
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

      // Mock the provider.request for listVersionsByFunction
      mockProvider.request.mockImplementation((_service: string, method: string, _params: any) => {
        if (method === 'listVersionsByFunction') {
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }, { Version: '3' }],
          });
        }
        return Promise.resolve({});
      });

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      const functionConfig = {
        name: 'myFunction',
        config: {
          concurrency: 10,
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

      // Mock the provider.request to throw an error
      mockProvider.request.mockRejectedValue(new Error('API error'));

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      const functionConfig = {
        name: 'myFunction',
        config: {
          concurrency: 10,
          version: '2',
        },
      };

      // @ts-ignore - Accessing private method for testing
      await expect(plugin._processFunction(functionConfig)).rejects.toThrow('API error');

      // Should log the error
      expect(mockUtils.log.error).toHaveBeenCalledWith(
        'Provisioned Concurrency: Error processing function myFunction: API error'
      );
    });
  });
});
