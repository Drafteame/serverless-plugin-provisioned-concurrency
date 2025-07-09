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

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // Trigger a method that uses progress
      await plugin.setProvisionedConcurrency();

      // Should use the provided progress utility
      expect(mockUtils.progress.create).toHaveBeenCalledWith({
        message: 'Setting provisioned concurrency...',
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

      // Mock the provider to throw an error
      const mockProvider = {
        request: jest.fn().mockRejectedValue(new Error('Test error')),
      };
      mockServerless.getProvider.mockReturnValue(mockProvider);

      const plugin = new ProvisionedConcurrency(mockServerless as any, mockOptions as any, mockUtils as any);

      // Trigger a method that uses progress and will encounter an error
      await plugin.setProvisionedConcurrency();

      // Should remove the progress indicator even on error
      expect(mockRemove).toHaveBeenCalled();
    });
  });
});
