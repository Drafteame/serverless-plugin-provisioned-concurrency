import ProvisionedConcurrency from '../index';

describe('Progress methods', () => {
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
  });

  describe('Legacy progress handling (v3)', () => {
    it('should create a no-op progress object', () => {
      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any);

      // @ts-ignore - Accessing private method for testing
      const progress = plugin._createLegacyProgress();

      // Create a progress indicator
      const spinner = progress.create({ message: 'Test progress' });

      // Should have a remove method that doesn't throw
      expect(() => spinner.remove()).not.toThrow();
    });
  });

  describe('Modern progress handling (v4)', () => {
    it('should use the provided progress utility', async () => {
      // Configure a function with provisioned concurrency to trigger progress
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
            version: '2',
          },
        },
      };

      // Mock the provider to return successful responses
      const mockProvider = {
        request: jest.fn().mockImplementation((_service: string, method: string, _params: any) => {
          if (method === 'getProvisionedConcurrencyConfig') {
            return Promise.resolve({ Status: 'READY' });
          }
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }],
            ProvisionedConcurrencyConfigs: [],
          });
        }),
      };
      mockServerless.getProvider.mockReturnValue(mockProvider);

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // Trigger a method that uses progress
      await plugin.setProvisionedConcurrency();

      // Should use the provided progress utility
      expect(mockUtils.progress.create).toHaveBeenCalledWith({
        message: expect.stringMatching(/Setting provisioned concurrency \(\d+\/\d+\) \(\d+s\)/),
      });
    });

    it('should remove the progress indicator when done', async () => {
      const mockRemove = jest.fn();
      mockUtils.progress.create.mockReturnValue({
        remove: mockRemove,
      });

      // Configure a function with provisioned concurrency to trigger progress
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
            version: '2',
          },
        },
      };

      // Mock the provider to return successful responses
      const mockProvider = {
        request: jest.fn().mockImplementation((_service: string, method: string, _params: any) => {
          if (method === 'getProvisionedConcurrencyConfig') {
            return Promise.resolve({ Status: 'READY' });
          }
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }, { Version: '2' }],
            ProvisionedConcurrencyConfigs: [],
          });
        }),
      };
      mockServerless.getProvider.mockReturnValue(mockProvider);

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // Trigger a method that uses progress
      await plugin.setProvisionedConcurrency();

      // Should remove the progress indicator
      expect(mockRemove).toHaveBeenCalled();
    });

    it('should remove the progress indicator even on error', async () => {
      const mockRemove = jest.fn();
      mockUtils.progress.create.mockReturnValue({
        remove: mockRemove,
      });

      // Configure a function with provisioned concurrency to trigger processing
      mockServerless.service.functions = {
        func1: {
          concurrency: {
            provisioned: 10,
          },
        },
      };

      // Mock the provider to throw an error for specific methods
      const mockProvider = {
        request: jest.fn().mockImplementation((_service: string, method: string, _params: any) => {
          if (method === 'putProvisionedConcurrencyConfig') {
            return Promise.reject(new Error('Test error'));
          }
          // Return successful responses for other methods to avoid unrelated errors
          if (method === 'getProvisionedConcurrencyConfig') {
            return Promise.resolve({ Status: 'READY' });
          }
          return Promise.resolve({
            Versions: [{ Version: '$LATEST' }, { Version: '1' }],
            ProvisionedConcurrencyConfigs: [],
          });
        }),
      };
      mockServerless.getProvider.mockReturnValue(mockProvider);

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // Trigger a method that uses progress and will encounter an error
      // Wrap in try/catch to handle the expected error
      try {
        await plugin.setProvisionedConcurrency();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // Expected error, do nothing
      }

      // Should remove the progress indicator even on error
      expect(mockRemove).toHaveBeenCalled();
    });
  });
});
