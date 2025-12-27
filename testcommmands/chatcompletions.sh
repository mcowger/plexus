#!/bin/bash

# Change to the directory containing this script
cd "$(dirname "$0")"

# Check if model name is provided
if [ -z "$1" ]; then
    echo "Usage: $0 <model-name>"
    echo "Example: $0 gpt-5-mini"
    exit 1
fi

MODEL_NAME="$1"

# Check if the JSON body file exists
if [ ! -f "testwithtool.json" ]; then
    echo "Error: testwithtool.json not found in testcommmands directory"
    exit 1
fi

# Create a temporary file with the model name replaced
TEMP_FILE=$(mktemp)
trap "rm -f $TEMP_FILE" EXIT

# Replace MODELNAME with the actual model name
sed "s/MODELNAME/$MODEL_NAME/g" testwithtool.json > "$TEMP_FILE"

curl --silent -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d @"$TEMP_FILE" | jq .