#!/usr/bin/env bun

/**
 * Test to verify usage tracking works for Responses API
 */

const PLEXUS_URL = process.env.PLEXUS_URL || 'http://localhost:4000';
const API_KEY = process.env.PLEXUS_API_KEY || 'sk-SuperSecretValue';

async function testNonStreaming() {
  console.log('🧪 Testing non-streaming responses API usage tracking...\n');
  
  const response = await fetch(`${PLEXUS_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      input: 'Say exactly: "Hello from Plexus"',
      stream: false
    })
  });

  const data = await response.json();
  
  console.log('Response ID:', data.id);
  console.log('Status:', data.status);
  console.log('\n📊 Usage Data:');
  console.log(JSON.stringify(data.usage, null, 2));
  
  if (data.usage && data.usage.input_tokens > 0 && data.usage.output_tokens > 0) {
    console.log('\n✅ Usage data is present in response');
  } else {
    console.log('\n❌ Usage data is missing or zero');
  }
}

async function testStreaming() {
  console.log('\n🧪 Testing streaming responses API usage tracking...\n');
  
  const response = await fetch(`${PLEXUS_URL}/v1/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      input: 'Say exactly: "Hello from Plexus"',
      stream: true
    })
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let finalEvent: any = null;

  if (!reader) {
    console.log('❌ No reader available');
    return;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        
        try {
          const event = JSON.parse(data);
          if (event.type === 'response.completed' && event.response?.usage) {
            finalEvent = event;
          }
        } catch (e) {
          // Ignore
        }
      }
    }
  }

  if (finalEvent) {
    console.log('📊 Usage Data from final event:');
    console.log(JSON.stringify(finalEvent.response.usage, null, 2));
    
    if (finalEvent.response.usage.input_tokens > 0 && finalEvent.response.usage.output_tokens > 0) {
      console.log('\n✅ Usage data is present in streaming response');
    } else {
      console.log('\n❌ Usage data is missing or zero in streaming');
    }
  } else {
    console.log('❌ No completed event with usage found');
  }
}

async function main() {
  console.log('🚀 Testing Plexus Responses API Usage Tracking');
  console.log(`URL: ${PLEXUS_URL}\n`);
  
  await testNonStreaming();
  await testStreaming();
}

main().catch(console.error);
