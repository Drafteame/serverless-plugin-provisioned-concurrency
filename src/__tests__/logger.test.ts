import ProvisionedConcurrency from '../index';

describe('Logger methods', () => {
  // Mock Serverless instance with CLI
  const mockServerlessWithCli = {
    getProvider: jest.fn().mockReturnValue({}),
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

  // Mock Serverless instance without CLI (fallback to console)
  const mockServerlessWithoutCli = {
    getProvider: jest.fn().mockReturnValue({}),
    service: {
      service: 'test-service',
      functions: {},
      provider: {
        stage: 'test',
      },
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

  // Spy on console methods
  const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('Serverless v3 logging', () => {
    it('should log info message using CLI when available', () => {
      const plugin = new ProvisionedConcurrency(mockServerlessWithCli as any, mockOptions as any);

      // @ts-ignore - Accessing private method for testing
      plugin._logInfo('Test info message');

      expect(mockServerlessWithCli.cli.log).toHaveBeenCalledWith('Provisioned Concurrency: Test info message');
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log error message using CLI when available', () => {
      const plugin = new ProvisionedConcurrency(mockServerlessWithCli as any, mockOptions as any);

      // @ts-ignore - Accessing private method for testing
      plugin._logError('Test error message');

      expect(mockServerlessWithCli.cli.log).toHaveBeenCalledWith(
        'Provisioned Concurrency: Test error message',
        'ERROR'
      );
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('should log info message using console when CLI not available', () => {
      const plugin = new ProvisionedConcurrency(mockServerlessWithoutCli as any, mockOptions as any);

      // @ts-ignore - Accessing private method for testing
      plugin._logInfo('Test info message');

      expect(consoleLogSpy).toHaveBeenCalledWith('Provisioned Concurrency: Test info message');
    });

    it('should log error message using console when CLI not available', () => {
      const plugin = new ProvisionedConcurrency(mockServerlessWithoutCli as any, mockOptions as any);

      // @ts-ignore - Accessing private method for testing
      plugin._logError('Test error message');

      expect(consoleErrorSpy).toHaveBeenCalledWith('Provisioned Concurrency: Test error message');
    });
  });

  describe('Serverless v4 logging', () => {
    it('should log info message using utils.log', () => {
      const plugin = new ProvisionedConcurrency(mockServerlessWithCli as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      plugin._logInfo('Test info message');

      expect(mockUtils.log.info).toHaveBeenCalledWith('Provisioned Concurrency: Test info message');
      expect(mockServerlessWithCli.cli.log).not.toHaveBeenCalled();
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it('should log error message using utils.log', () => {
      const plugin = new ProvisionedConcurrency(mockServerlessWithCli as any, mockOptions as any, mockUtils as any);

      // @ts-ignore - Accessing private method for testing
      plugin._logError('Test error message');

      expect(mockUtils.log.error).toHaveBeenCalledWith('Provisioned Concurrency: Test error message');
      expect(mockServerlessWithCli.cli.log).not.toHaveBeenCalled();
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
  });
});
