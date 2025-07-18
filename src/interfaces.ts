/**
 * Interface for Serverless instance
 */
export interface Serverless {
  getProvider(_name: string): ServerlessProvider;
  service: {
    service: string;
    functions: Record<string, ServerlessFunction>;
    provider: {
      stage: string;
    };
    custom?: Record<string, any>;
  };
  cli?: {
    log(_message: string, _entity?: string): void;
  };
}

/**
 * Interface for Serverless provider
 */
export interface ServerlessProvider {
  request(_service: string, _method: string, _params: Record<string, any>): Promise<any>;
}

/**
 * Interface for Serverless function configuration
 */
export interface ServerlessFunction {
  concurrency?: {
    provisioned?: number;
    version?: string;
  };
  reservedConcurrency?: number;
}

/**
 * Interface for Serverless options
 */
export interface ServerlessOptions {
  function?: string;
  [key: string]: any;
}

/**
 * Interface for Serverless utils (v4)
 */
export interface ServerlessUtils {
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
export interface NormalizedFunctionConfig {
  provisioned: number;
  reserved?: number;
  version?: string;
}

/**
 * Interface for function with configuration
 */
export interface FunctionWithConfig {
  name: string;
  config: NormalizedFunctionConfig;
}

/**
 * Interface for a Lambda version
 */
export interface LambdaVersion {
  Version: string;
  [key: string]: any;
}

/**
 * Interface for serverless logger
 */
export interface Logger {
  info(_message: string): void;
  error(_message: string): void;
}

/**
 * Interface for serverless progress spinner instance
 */
export interface Spinner {
  remove(): void;
}

/**
 * Interface for serverless progress manager
 */
export interface Progress {
  create(_options: { message: string }): Spinner;
}

export interface State {}
