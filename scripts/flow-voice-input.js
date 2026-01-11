#!/usr/bin/env node

/**
 * Wogi Flow - Voice Input
 *
 * Voice-to-transcript support with multiple provider options:
 * - Local: Whisper.cpp (no API key required)
 * - Cloud: OpenAI Whisper API
 * - Cloud: Groq (free tier available)
 *
 * Usage:
 *   flow voice-input                    # Record and transcribe
 *   flow voice-input --duration 30      # Record for 30 seconds
 *   flow voice-input --provider openai  # Use specific provider
 *   flow voice-input --to-story         # Create story from transcript
 *   flow voice-input setup              # Interactive setup
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execSync } = require('child_process');
const readline = require('readline');
const { getConfig, getProjectRoot, colors: c } = require('./flow-utils');

const PROJECT_ROOT = getProjectRoot();
const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.workflow');
const CONFIG_PATH = path.join(WORKFLOW_DIR, 'config.json');

// ============================================================
// Voice Provider Types
// ============================================================

const VOICE_PROVIDERS = {
  LOCAL: 'local',
  OPENAI: 'openai',
  GROQ: 'groq'
};

const PROVIDER_INFO = {
  local: {
    name: 'Local (Whisper.cpp)',
    description: 'Run transcription locally - no API key required',
    requiresKey: false,
    binaryName: 'whisper'
  },
  openai: {
    name: 'OpenAI Whisper',
    description: 'Cloud transcription via OpenAI API',
    requiresKey: true,
    endpoint: 'https://api.openai.com/v1/audio/transcriptions',
    model: 'whisper-1'
  },
  groq: {
    name: 'Groq',
    description: 'Fast cloud transcription - free tier available',
    requiresKey: true,
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    model: 'whisper-large-v3'
  }
};

// ============================================================
// Configuration
// ============================================================

/**
 * Get voice configuration from config.json
 */
function getVoiceConfig() {
  const config = getConfig();
  return config.voice || {
    enabled: false,
    provider: null,
    openaiApiKey: null,
    groqApiKey: null,
    localModelPath: null,
    defaultDuration: 30,
    sampleRate: 16000,
    channels: 1
  };
}

/**
 * Check if voice input is enabled
 */
function isVoiceEnabled() {
  const config = getVoiceConfig();
  return config.enabled === true && config.provider !== null;
}

/**
 * Get the active provider
 */
function getActiveProvider() {
  const config = getVoiceConfig();
  return config.provider;
}

// ============================================================
// Audio Recording
// ============================================================

/**
 * Check if recording dependencies are available
 */
function checkRecordingDependencies() {
  const issues = [];

  // Check for sox (required for most recorders)
  try {
    execSync('which sox', { stdio: 'pipe' });
  } catch {
    issues.push('sox not found - install with: brew install sox');
  }

  // Check for rec (part of sox)
  try {
    execSync('which rec', { stdio: 'pipe' });
  } catch {
    issues.push('rec not found - install with: brew install sox');
  }

  return issues;
}

/**
 * Record audio from microphone
 * Returns path to recorded WAV file
 */
async function recordAudio(durationSeconds = 30, options = {}) {
  const {
    sampleRate = 16000,
    channels = 1,
    showProgress = true
  } = options;

  const tempFile = path.join('/tmp', `wogi-voice-${Date.now()}.wav`);

  return new Promise((resolve, reject) => {
    if (showProgress) {
      console.log(`${c.cyan}Recording for ${durationSeconds} seconds...${c.reset}`);
      console.log(`${c.dim}Press Ctrl+C to stop early${c.reset}\n`);
    }

    // Use sox's rec command for cross-platform recording
    const rec = spawn('rec', [
      '-r', String(sampleRate),
      '-c', String(channels),
      '-b', '16',
      tempFile,
      'trim', '0', String(durationSeconds)
    ], {
      stdio: showProgress ? ['inherit', 'inherit', 'inherit'] : 'pipe'
    });

    rec.on('close', (code) => {
      if (code === 0 && fs.existsSync(tempFile)) {
        resolve(tempFile);
      } else {
        reject(new Error(`Recording failed with code ${code}`));
      }
    });

    rec.on('error', (err) => {
      reject(new Error(`Recording error: ${err.message}`));
    });
  });
}

// ============================================================
// Transcription Providers
// ============================================================

/**
 * Transcribe with local Whisper.cpp
 */
async function transcribeLocal(audioPath, options = {}) {
  const config = getVoiceConfig();
  const modelPath = config.localModelPath || 'base.en';

  try {
    // Check if whisper is available
    execSync('which whisper', { stdio: 'pipe' });
  } catch {
    throw new Error(
      'Local Whisper not found. Install with:\n' +
      '  brew install openai-whisper\n' +
      'Or download whisper.cpp from: https://github.com/ggerganov/whisper.cpp'
    );
  }

  return new Promise((resolve, reject) => {
    const whisper = spawn('whisper', [
      audioPath,
      '--model', modelPath,
      '--output_format', 'txt',
      '--output_dir', '/tmp'
    ]);

    let stderr = '';
    whisper.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    whisper.on('close', (code) => {
      if (code === 0) {
        // Read the output file
        const outputPath = audioPath.replace('.wav', '.txt');
        if (fs.existsSync(outputPath)) {
          const text = fs.readFileSync(outputPath, 'utf-8').trim();
          fs.unlinkSync(outputPath); // Cleanup
          resolve({ text, provider: 'local', model: modelPath });
        } else {
          reject(new Error('Whisper output file not found'));
        }
      } else {
        reject(new Error(`Whisper failed: ${stderr}`));
      }
    });
  });
}

/**
 * Transcribe with OpenAI Whisper API
 */
async function transcribeOpenAI(audioPath, options = {}) {
  const config = getVoiceConfig();
  const apiKey = config.openaiApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'OpenAI API key not found. Set it in config.json:\n' +
      '  "voice": { "openaiApiKey": "sk-..." }\n' +
      'Or set OPENAI_API_KEY environment variable'
    );
  }

  const audioData = fs.readFileSync(audioPath);
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

  // Build multipart form data
  const formData = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n'),
    Buffer.from('Content-Type: audio/wav\r\n\r\n'),
    audioData,
    Buffer.from(`\r\n--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="model"\r\n\r\n'),
    Buffer.from('whisper-1'),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else {
            resolve({ text: json.text, provider: 'openai', model: 'whisper-1' });
          }
        } catch (err) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(formData);
    req.end();
  });
}

/**
 * Transcribe with Groq API
 */
async function transcribeGroq(audioPath, options = {}) {
  const config = getVoiceConfig();
  const apiKey = config.groqApiKey || process.env.GROQ_API_KEY;

  if (!apiKey) {
    throw new Error(
      'Groq API key not found. Set it in config.json:\n' +
      '  "voice": { "groqApiKey": "gsk_..." }\n' +
      'Or set GROQ_API_KEY environment variable\n\n' +
      'Get a free key at: https://console.groq.com'
    );
  }

  const audioData = fs.readFileSync(audioPath);
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);

  const formData = Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n'),
    Buffer.from('Content-Type: audio/wav\r\n\r\n'),
    audioData,
    Buffer.from(`\r\n--${boundary}\r\n`),
    Buffer.from('Content-Disposition: form-data; name="model"\r\n\r\n'),
    Buffer.from('whisper-large-v3'),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': formData.length
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            reject(new Error(json.error.message));
          } else {
            resolve({ text: json.text, provider: 'groq', model: 'whisper-large-v3' });
          }
        } catch (err) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(formData);
    req.end();
  });
}

/**
 * Main transcription function - routes to appropriate provider
 */
async function transcribe(audioPath, providerOverride = null) {
  const config = getVoiceConfig();
  const provider = providerOverride || config.provider || 'openai';

  switch (provider) {
    case 'local':
      return transcribeLocal(audioPath);
    case 'openai':
      return transcribeOpenAI(audioPath);
    case 'groq':
      return transcribeGroq(audioPath);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// ============================================================
// Interactive Setup
// ============================================================

/**
 * Interactive setup wizard for voice input
 */
async function runSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (q) => new Promise(resolve => rl.question(q, resolve));

  console.log(`\n${c.cyan}=== Wogi Flow Voice Input Setup ===${c.reset}\n`);

  // Check recording dependencies
  const issues = checkRecordingDependencies();
  if (issues.length > 0) {
    console.log(`${c.yellow}Recording dependencies missing:${c.reset}`);
    issues.forEach(i => console.log(`  - ${i}`));
    console.log('');
  }

  // Enable voice input
  const enable = await question(`Enable voice input? (y/n): `);
  if (enable.toLowerCase() !== 'y') {
    console.log(`${c.dim}Voice input disabled.${c.reset}`);
    rl.close();
    return;
  }

  // Choose provider
  console.log(`\n${c.cyan}Choose transcription provider:${c.reset}`);
  console.log('  1. Local (Whisper.cpp) - No API key, works offline');
  console.log('  2. OpenAI - Best accuracy, requires API key');
  console.log('  3. Groq - Fast, free tier available');

  const providerChoice = await question(`\nSelect provider (1-3): `);
  let provider, apiKey = null;

  switch (providerChoice) {
    case '1':
      provider = 'local';
      console.log(`\n${c.green}Local provider selected.${c.reset}`);
      console.log(`${c.dim}Ensure whisper is installed: brew install openai-whisper${c.reset}`);
      break;
    case '2':
      provider = 'openai';
      apiKey = await question(`\nEnter OpenAI API key (sk-...): `);
      if (!apiKey.startsWith('sk-')) {
        console.log(`${c.yellow}Warning: Key doesn't look like an OpenAI key${c.reset}`);
      }
      break;
    case '3':
      provider = 'groq';
      apiKey = await question(`\nEnter Groq API key (gsk_...): `);
      if (!apiKey.startsWith('gsk_')) {
        console.log(`${c.yellow}Warning: Key doesn't look like a Groq key${c.reset}`);
      }
      break;
    default:
      console.log(`${c.red}Invalid choice${c.reset}`);
      rl.close();
      return;
  }

  // Save configuration
  const config = getConfig();
  config.voice = {
    enabled: true,
    provider,
    openaiApiKey: provider === 'openai' ? apiKey : (config.voice?.openaiApiKey || null),
    groqApiKey: provider === 'groq' ? apiKey : (config.voice?.groqApiKey || null),
    localModelPath: config.voice?.localModelPath || 'base.en',
    defaultDuration: 30,
    sampleRate: 16000,
    channels: 1
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));

  console.log(`\n${c.green}Voice input configured!${c.reset}`);
  console.log(`Provider: ${PROVIDER_INFO[provider].name}`);
  console.log(`\nTest with: ${c.cyan}./scripts/flow voice-input${c.reset}`);

  rl.close();
}

// ============================================================
// Main CLI Handler
// ============================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // Parse options
  const options = {
    duration: 30,
    provider: null,
    toStory: false,
    output: null
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--duration':
      case '-d':
        options.duration = parseInt(args[++i]) || 30;
        break;
      case '--provider':
      case '-p':
        options.provider = args[++i];
        break;
      case '--to-story':
        options.toStory = true;
        break;
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
    }
  }

  // Handle commands
  switch (command) {
    case 'setup':
      await runSetup();
      break;

    case 'status':
      showStatus();
      break;

    case 'test':
      await testVoiceInput();
      break;

    case undefined:
    case 'record':
      await recordAndTranscribe(options);
      break;

    default:
      showHelp();
  }
}

/**
 * Show voice input status
 */
function showStatus() {
  const config = getVoiceConfig();

  console.log(`\n${c.cyan}Voice Input Status${c.reset}\n`);
  console.log(`Enabled: ${config.enabled ? c.green + 'Yes' : c.red + 'No'}${c.reset}`);

  if (config.enabled) {
    const providerInfo = PROVIDER_INFO[config.provider] || {};
    console.log(`Provider: ${providerInfo.name || config.provider}`);
    console.log(`Default duration: ${config.defaultDuration}s`);

    if (config.provider === 'openai') {
      console.log(`API Key: ${config.openaiApiKey ? c.green + 'Configured' : c.red + 'Missing'}${c.reset}`);
    } else if (config.provider === 'groq') {
      console.log(`API Key: ${config.groqApiKey ? c.green + 'Configured' : c.red + 'Missing'}${c.reset}`);
    }
  }

  // Check dependencies
  const issues = checkRecordingDependencies();
  if (issues.length > 0) {
    console.log(`\n${c.yellow}Missing dependencies:${c.reset}`);
    issues.forEach(i => console.log(`  - ${i}`));
  } else {
    console.log(`\n${c.green}Recording dependencies OK${c.reset}`);
  }
}

/**
 * Test voice input with a short recording
 */
async function testVoiceInput() {
  const config = getVoiceConfig();

  if (!config.enabled) {
    console.log(`${c.yellow}Voice input not enabled. Run: ./scripts/flow voice-input setup${c.reset}`);
    return;
  }

  console.log(`${c.cyan}Testing voice input...${c.reset}`);
  console.log(`Provider: ${PROVIDER_INFO[config.provider]?.name || config.provider}\n`);

  try {
    console.log('Recording 5 seconds of audio...\n');
    const audioPath = await recordAudio(5);

    console.log(`\n${c.cyan}Transcribing...${c.reset}`);
    const result = await transcribe(audioPath);

    console.log(`\n${c.green}Success!${c.reset}`);
    console.log(`Transcript: "${result.text}"`);
    console.log(`Provider: ${result.provider}, Model: ${result.model}`);

    // Cleanup
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }
  } catch (error) {
    console.error(`${c.red}Test failed: ${error.message}${c.reset}`);
  }
}

/**
 * Main record and transcribe flow
 */
async function recordAndTranscribe(options) {
  const config = getVoiceConfig();

  if (!config.enabled) {
    console.log(`${c.yellow}Voice input not enabled.${c.reset}`);
    console.log(`Run: ${c.cyan}./scripts/flow voice-input setup${c.reset}`);
    return;
  }

  try {
    // Record
    const duration = options.duration || config.defaultDuration || 30;
    const audioPath = await recordAudio(duration);

    // Transcribe
    console.log(`\n${c.cyan}Transcribing...${c.reset}`);
    const result = await transcribe(audioPath, options.provider);

    console.log(`\n${c.green}Transcript:${c.reset}`);
    console.log(result.text);

    // Output to file if requested
    if (options.output) {
      fs.writeFileSync(options.output, result.text);
      console.log(`\n${c.dim}Saved to: ${options.output}${c.reset}`);
    }

    // Create story if requested
    if (options.toStory) {
      console.log(`\n${c.cyan}Creating story from transcript...${c.reset}`);
      // This would integrate with flow-story.js
      console.log(`${c.dim}[Integration with story creation would go here]${c.reset}`);
    }

    // Cleanup
    if (fs.existsSync(audioPath)) {
      fs.unlinkSync(audioPath);
    }

    // Return result for programmatic use
    return result;
  } catch (error) {
    console.error(`${c.red}Error: ${error.message}${c.reset}`);
    process.exit(1);
  }
}

/**
 * Show help
 */
function showHelp() {
  console.log(`
${c.cyan}Wogi Flow - Voice Input${c.reset}

${c.bold}Usage:${c.reset}
  flow voice-input [command] [options]

${c.bold}Commands:${c.reset}
  setup              Interactive setup wizard
  status             Show voice input configuration
  test               Test with a 5-second recording
  record             Record and transcribe (default)

${c.bold}Options:${c.reset}
  --duration, -d     Recording duration in seconds (default: 30)
  --provider, -p     Override provider (local, openai, groq)
  --to-story         Create a story from the transcript
  --output, -o       Save transcript to file

${c.bold}Examples:${c.reset}
  flow voice-input setup              # Configure voice input
  flow voice-input                    # Record and transcribe
  flow voice-input -d 60              # Record for 60 seconds
  flow voice-input -p groq            # Use Groq provider
  flow voice-input --to-story         # Create story from voice

${c.bold}Providers:${c.reset}
  local   - Whisper.cpp (no API key, works offline)
  openai  - OpenAI Whisper API (best accuracy)
  groq    - Groq API (fast, free tier available)
`);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  getVoiceConfig,
  isVoiceEnabled,
  getActiveProvider,
  recordAudio,
  transcribe,
  transcribeLocal,
  transcribeOpenAI,
  transcribeGroq,
  checkRecordingDependencies,
  VOICE_PROVIDERS,
  PROVIDER_INFO
};

// ============================================================
// Run CLI
// ============================================================

if (require.main === module) {
  main().catch(err => {
    console.error(`${c.red}Error: ${err.message}${c.reset}`);
    process.exit(1);
  });
}
