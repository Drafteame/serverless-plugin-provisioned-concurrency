# Serverless Plugin Lambda Provisioned Concurrency

A serverless plugin that manages provisioned concurrency for AWS Lambda functions. This plugin allows you to set
provisioned concurrency for specific Lambda versions during deployment and automatically clean it up during removal.

**Compatible with Serverless Framework v3 and v4**

## Features

- Set provisioned concurrency for specific Lambda versions
- Support for both full deployments and single function deployments
- Automatic cleanup during stack removal
- Support for multiple functions configuration
- Flexible version targeting (specific version or latest)
- Automatic management of provisioned concurrency across versions (only one version per function can have provisioned concurrency)
- Error handling and logging

## Compatibility

This plugin is compatible with:

- **Serverless Framework v3.x**
- **Serverless Framework v4.x**

The plugin automatically detects the Serverless version and adapts its logging and progress reporting accordingly.

## Installation

```bash
npm install serverless-plugin-provisioned-concurrency --save-dev
```

## Usage

### 1. Add the plugin to your serverless.yml

```yaml
plugins:
  - serverless-plugin-provisioned-concurrency
```

### 2. Configure provisioned concurrency

Add the `concurrency` configuration directly to your function definitions in `serverless.yml`:

```yaml
functions:
  processor:
    handler: src/processor.handler
    concurrency:
      provisioned: 10
      version: '3' # optional - uses latest if not specified
    events:
      - sqs:
          arn: arn:aws:sqs:us-east-1:123456789012:my-queue

  api:
    handler: src/api.handler
    concurrency:
      provisioned: 5 # uses latest version
    events:
      - http:
          path: /api
          method: get
```

### 3. Deployment options

The plugin supports both full deployments and single function deployments:

#### Full deployment

When you run a full deployment with `serverless deploy`, provisioned concurrency will be set for all configured functions after the stack is updated.

```bash
serverless deploy
```

#### Single function deployment

When you deploy a single function with `serverless deploy function`, provisioned concurrency will be set for that function if it's configured:

```bash
serverless deploy function -f functionName
```

### Complete Example

```yaml
service: my-service

provider:
  name: aws
  runtime: nodejs18.x
  stage: dev
  region: us-east-1

plugins:
  - serverless-plugin-provisioned-concurrency

functions:
  api:
    handler: src/api.handler
    concurrency:
      provisioned: 10 # Uses latest version
    events:
      - http:
          path: /api
          method: get

  processor:
    handler: src/processor.handler
    concurrency:
      provisioned: 5
      version: '3' # Uses specific version 3
    events:
      - sqs:
          arn: arn:aws:sqs:us-east-1:123456789012:my-queue
```

## Configuration Options

### Function Configuration

Each function can include a `concurrency` section with the following options:

| Option        | Type   | Required | Default | Description                                                                      |
| ------------- | ------ | -------- | ------- | -------------------------------------------------------------------------------- |
| `provisioned` | number | Yes      | -       | The number of provisioned concurrency units                                      |
| `version`     | string | No       | latest  | The Lambda version to configure (use specific version number or omit for latest) |

### Global Configuration

You can configure global settings for the plugin under the `custom.provisionedConcurrency` section:

| Option       | Type   | Required | Default | Description                                                                                    |
| ------------ | ------ | -------- | ------- | ---------------------------------------------------------------------------------------------- |
| `maxPercent` | number | No       | 80      | Maximum percentage of reserved concurrency allowed to be configured as provisioned concurrency |

### Configuration Format

```yaml
# Global plugin configuration
custom:
  provisionedConcurrency:
    maxPercent: 90 # Optional - maximum percentage of reserved concurrency (defaults to 80)

# Function configuration
functions:
  myFunction:
    handler: src/handler.js
    reservedConcurrency: 100 # Optional - reserved concurrency for the function
    concurrency:
      provisioned: 10 # Required - number of concurrent executions
      version: '2' # Optional - specific version (defaults to latest)
```

### Short Form Configuration

You can specify just the provisioned concurrency if you want to use the latest version:

```yaml
functions:
  myFunction:
    handler: src/handler.js
    concurrency:
      provisioned: 10 # Uses latest version
```

## How It Works

1. **During Deployment**: The plugin runs after the stack is updated and sets provisioned concurrency for the configured functions
2. **During Removal**: The plugin runs before stack removal and cleans up all provisioned concurrency configurations
3. **Version Management**: The plugin ensures only one version of a function has provisioned concurrency:
   - When setting provisioned concurrency for a version, the plugin first checks if other versions already have provisioned concurrency
   - If other versions with provisioned concurrency are found, the plugin automatically removes their provisioned concurrency before setting it for the new version
   - This prevents having multiple versions with provisioned concurrency, which can lead to unexpected costs

## Plugin Lifecycle

- **Hook**: `after:aws:deploy:deploy:updateStack` - Sets provisioned concurrency

## Version Handling

- If no version is specified or `version: "latest"` is used, the plugin will automatically determine the latest version number
- Specific versions can be targeted by providing the version number as a string
- The plugin will not use the `$LATEST` pseudo-version as provisioned concurrency cannot be set on it

## Error Handling

The plugin includes comprehensive error handling:

- Logs detailed error messages for debugging
- Continues processing other functions if one fails
- Gracefully handles missing functions or versions
- Provides clear status messages during execution

## AWS Permissions

Make sure your AWS credentials have the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "lambda:GetProvisionedConcurrencyConfig",
        "lambda:PutProvisionedConcurrencyConfig",
        "lambda:DeleteProvisionedConcurrencyConfig",
        "lambda:ListProvisionedConcurrencyConfigs",
        "lambda:ListVersionsByFunction"
      ],
      "Resource": "*"
    }
  ]
}
```

## Development

### Prerequisites

- Node.js >= 14.0.0
- npm or yarn

### Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Build the project: `npm run build`
4. Run linting: `npm run lint`
5. Format code: `npm run format`

### TypeScript

This plugin is written in TypeScript for improved type safety and developer experience. The TypeScript source code is compiled to JavaScript during the build process.

- Source code: `src/index.ts`
- Compiled output: `dist/index.js`
- Type definitions: `dist/index.d.ts`

To make changes to the plugin:

1. Edit the TypeScript source files
2. Run `npm run build` to compile
3. Test your changes

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details
