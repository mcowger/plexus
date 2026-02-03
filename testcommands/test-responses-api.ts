#!/usr/bin/env bun

/**
 * Test script for the Responses API implementation
 * 
 * Usage:
 *   bun testcommands/test-responses-api.ts
 */

const PLEXUS_URL = process.env.PLEXUS_URL || 'http://localhost:4000';
const API_KEY = process.env.PLEXUS_API_KEY || 'sk-SuperSecretValue';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  response?: any;
}

const results: TestResult[] = [];

async function testSimpleTextRequest() {
  console.log('\n🧪 Test 1: Simple text request');
  
  try {
    const response = await fetch(`${PLEXUS_URL}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: 'Say "Hello from Plexus Responses API" in exactly those words.'
      })
    });

    const data = await response.json();
    
    if (response.ok && data.object === 'response' && data.status === 'completed') {
      console.log('✅ PASSED - Response structure is correct');
      console.log('Response ID:', data.id);
      console.log('Output items:', data.output?.length);
      results.push({ name: 'Simple text request', passed: true, response: data });
      return data;
    } else {
      console.log('❌ FAILED - Invalid response');
      console.log(JSON.stringify(data, null, 2));
      results.push({ name: 'Simple text request', passed: false, error: 'Invalid response structure' });
      return null;
    }
  } catch (error: any) {
    console.log('❌ FAILED -', error.message);
    results.push({ name: 'Simple text request', passed: false, error: error.message });
    return null;
  }
}

async function testStreamingRequest() {
  console.log('\n🧪 Test 2: Streaming request');
  
  try {
    const response = await fetch(`${PLEXUS_URL}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: 'Count from 1 to 5.',
        stream: true
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.log('❌ FAILED - HTTP', response.status);
      console.log(JSON.stringify(errorData, null, 2));
      results.push({ name: 'Streaming request', passed: false, error: `HTTP ${response.status}` });
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let eventCount = 0;
    let hasCreatedEvent = false;
    let hasCompletedEvent = false;

    if (!reader) {
      throw new Error('No response body reader available');
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
            eventCount++;
            
            if (event.type === 'response.created') hasCreatedEvent = true;
            if (event.type === 'response.completed') hasCompletedEvent = true;
            
            if (eventCount <= 5) {
              console.log(`Event ${eventCount}:`, event.type);
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }
    }

    if (hasCreatedEvent && hasCompletedEvent && eventCount > 0) {
      console.log(`✅ PASSED - Received ${eventCount} streaming events`);
      results.push({ name: 'Streaming request', passed: true });
    } else {
      console.log('❌ FAILED - Missing expected events');
      console.log(`Created: ${hasCreatedEvent}, Completed: ${hasCompletedEvent}, Events: ${eventCount}`);
      results.push({ name: 'Streaming request', passed: false, error: 'Missing expected events' });
    }
  } catch (error: any) {
    console.log('❌ FAILED -', error.message);
    results.push({ name: 'Streaming request', passed: false, error: error.message });
  }
}

async function testArrayInputFormat() {
  console.log('\n🧪 Test 3: Array input format with structured items');
  
  try {
    const response = await fetch(`${PLEXUS_URL}/v1/responses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'What is 2+2?'
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();
    
    if (response.ok && data.object === 'response' && data.output) {
      console.log('✅ PASSED - Array input format works');
      results.push({ name: 'Array input format', passed: true, response: data });
    } else {
      console.log('❌ FAILED - Invalid response');
      console.log(JSON.stringify(data, null, 2));
      results.push({ name: 'Array input format', passed: false, error: 'Invalid response' });
    }
  } catch (error: any) {
    console.log('❌ FAILED -', error.message);
    results.push({ name: 'Array input format', passed: false, error: error.message });
  }
}

async function testResponseRetrieval(responseId: string) {
  console.log('\n🧪 Test 4: Response retrieval');
  
  try {
    const response = await fetch(`${PLEXUS_URL}/v1/responses/${responseId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    const data = await response.json();
    
    if (response.ok && data.id === responseId) {
      console.log('✅ PASSED - Response retrieval works');
      results.push({ name: 'Response retrieval', passed: true });
    } else {
      console.log('❌ FAILED - Could not retrieve response');
      console.log(JSON.stringify(data, null, 2));
      results.push({ name: 'Response retrieval', passed: false, error: 'Could not retrieve' });
    }
  } catch (error: any) {
    console.log('❌ FAILED -', error.message);
    results.push({ name: 'Response retrieval', passed: false, error: error.message });
  }
}

async function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  
  results.forEach(result => {
    const icon = result.passed ? '✅' : '❌';
    console.log(`${icon} ${result.name}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });
  
  console.log('\n' + '='.repeat(60));
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
  console.log('='.repeat(60) + '\n');
  
  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log(`⚠️  ${failed} test(s) failed`);
  }
}

async function main() {
  console.log('🚀 Testing Plexus Responses API Implementation');
  console.log(`URL: ${PLEXUS_URL}`);
  console.log(`API Key: ${API_KEY.substring(0, 8)}...`);
  
  const firstResponse = await testSimpleTextRequest();
  await testStreamingRequest();
  await testArrayInputFormat();
  
  // Test response retrieval if we got a response ID from the first test
  if (firstResponse?.id) {
    await testResponseRetrieval(firstResponse.id);
  }
  
  await printSummary();
}

main().catch(console.error);
