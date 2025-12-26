#!/bin/bash

# Check if model parameter is provided
if [ $# -eq 0 ]; then
    echo "Error: Model name is required as a parameter"
    echo "Usage: $0 <model-name>"
    echo "Example: $0 gpt-5-mini"
    exit 1
fi

MODEL_NAME="$1"

curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"model\": \"$MODEL_NAME\",
    \"max_tokens\": 1024,
    \"messages\": [
      {
        \"role\": \"user\",
        \"content\": \"Hello, how are you?\"
      }
    ]
  }"