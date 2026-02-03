#!/usr/bin/env bun

const PLEXUS_URL = 'http://localhost:4000';
const API_KEY = 'sk-SuperSecretValue';

async function testStreamingChat() {
  console.log('🧪 Testing streaming chat completions...\n');
  
  const response = await fetch(`${PLEXUS_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-mini',
      messages: [{role: 'user', content: 'Say: hi'}],
      stream: true
    })
  });

  console.log('Response status:', response.status);
  console.log('Response headers:', Object.fromEntries(response.headers.entries()));

  if (!response.body) {
    console.log('❌ No response body');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let chunks = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const text = decoder.decode(value);
    console.log(`Chunk ${++chunks}:`, text.substring(0, 200));
    
    if (chunks > 5) {
      console.log('... truncated after 5 chunks');
      break;
    }
  }
  
  console.log(`\n✅ Received ${chunks} chunks`);
}

testStreamingChat().catch(console.error);
