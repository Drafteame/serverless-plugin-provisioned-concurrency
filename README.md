# Serverless Plugin Lambda Provisioned Concurrency

A serverless plugin that manages provisioned concurrency for AWS Lambda functions. This plugin allows you to set 
provisioned concurrency for specific Lambda versions during deployment and automatically clean it up during removal.

**Compatible with Serverless Framework v3 and v4**

## Features

- Set provisioned concurrency for specific Lambda versions
- Automatic cleanup during stack removal
- Support for multiple functions configuration
- Flexible version targeting (specific version or latest)
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
      version: '3'  # optional - uses latest if not specified
    events:
      - sqs:
          arn: arn:aws:sqs:us-east-1:123456789012:my-queue
  
  api:
    handler: src/api.handler
    concurrency:
      provisioned: 5  # uses latest version
    events:
      - http:
          path: /api
          method: get
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
      provisioned: 10  # Uses latest version
    events:
      - http:
          path: /api
          method: get
  
  processor:
    handler: src/processor.handler
    concurrency:
      provisioned: 5
      version: '3'  # Uses specific version 3
    events:
      - sqs:
          arn: arn:aws:sqs:us-east-1:123456789012:my-queue
```

## Configuration Options

### Function Configuration

Each function can include a `concurrency` section with the following options:

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `provisioned` | number | Yes | - | The number of provisioned concurrency units |
| `version` | string | No | latest | The Lambda version to configure (use specific version number or omit for latest) |

### Configuration Format

```yaml
functions:
  myFunction:
    handler: src/handler.js
    concurrency:
      provisioned: 10    # Required - number of concurrent executions
      version: '2'       # Optional - specific version (defaults to latest)
```

### Short Form Configuration

You can specify just the provisioned concurrency if you want to use the latest version:

```yaml
functions:
  myFunction:
    handler: src/handler.js
    concurrency:
      provisioned: 10  # Uses latest version
```

## How It Works

1. **During Deployment**: The plugin runs after the stack is updated and sets provisioned concurrency for the configured functions
2. **During Removal**: The plugin runs before stack removal and cleans up all provisioned concurrency configurations

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
3. Run linting: `npm run lint`
4. Format code: `npm run format`

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License - see LICENSE file for details