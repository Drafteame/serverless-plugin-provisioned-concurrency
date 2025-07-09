#!/bin/bash

# Script to check if the version in package.json matches the version bumped by commitizen
# If not, update package.json and commit the changes

set -e

# Get the version bumped by commitizen (without the 'v' prefix)
COMMITIZEN_VERSION=$(cz version --project)
echo "Commitizen version: $COMMITIZEN_VERSION"

# Get the version from package.json
PACKAGE_VERSION=$(grep -o '"version": "[^"]*"' package.json | cut -d'"' -f4)
echo "Package.json version: $PACKAGE_VERSION"

# Check if versions match
if [ "$COMMITIZEN_VERSION" != "$PACKAGE_VERSION" ]; then
    echo "Versions don't match. Updating package.json..."

    # Update package.json with the correct version
    # Using sed to replace the version line in package.json
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS uses BSD sed which requires an empty string after -i
        sed -i '' "s/\"version\": \"$PACKAGE_VERSION\"/\"version\": \"$COMMITIZEN_VERSION\"/" package.json
    else
        # Linux uses GNU sed
        sed -i "s/\"version\": \"$PACKAGE_VERSION\"/\"version\": \"$COMMITIZEN_VERSION\"/" package.json
    fi

    # Commit the changes
    git add package.json
    git commit -m "core: set new version $COMMITIZEN_VERSION"
    echo "Updated package.json and committed changes."
else
    echo "Versions match. No changes needed."
fi

exit 0
