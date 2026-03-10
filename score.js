// ============================================================
//  Netlify Serverless Function: score.js
//
//  This function is the secure middleman between the game
//  and OpenAI. The API key never leaves this server-side
//  function. The browser never sees it.
//
//  The API key is stored in Netlify's environment variables
//  (set in the Netlify dashboard - never in any file).
// ============================================================

exports.handler = async function(event) {

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  // Read the API key from Netlify environment variables
  var apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'API key not configured on server' })
    };
  }

  // Parse the request from the game
  var body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid request body' })
    };
  }

  var scenario = body.scenario || '';
  var prompt   = body.prompt   || '';
  var isPing   = body.ping     || false;

  // Health check ping - just confirms the function + key are working
  if (isPing) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, mode: 'live' })
    };
  }

  if (!scenario || !prompt) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing scenario or prompt' })
    };
  }

  // Build the system instruction for GPT-4o
  var systemInstruction = [
    'You are an expert prompt engineering coach specialising in the CO-STAR framework.',
    'Analyse the user\'s prompt for the given challenge scenario.',
    'Return ONLY valid JSON - no markdown, no code fences, no explanation.',
    'Return exactly this structure:',
    '{',
    '  "scores": {',
    '    "C": { "score": <0-10>, "tip": "<Short actionable tip under 20 words>" },',
    '    "O": { "score": <0-10>, "tip": "<tip>" },',
    '    "S": { "score": <0-10>, "tip": "<tip>" },',
    '    "T": { "score": <0-10>, "tip": "<tip>" },',
    '    "A": { "score": <0-10>, "tip": "<tip>" },',
    '    "R": { "score": <0-10>, "tip": "<tip>" }',
    '  },',
    '  "total": <sum of all six scores, max 60>,',
    '  "feedback": "<2 sentences: one strength, one key improvement. Friendly. Max 45 words.>",',
    '  "improved": "<A complete expert-level rewrite using all CO-STAR elements. Natural flowing prompt.>"',
    '}',
    'Scoring guide: 0-2 missing or vague, 3-5 partial, 6-8 good, 9-10 excellent.'
  ].join('\n');

  // Call OpenAI
  try {
    var https = require('https');

    var requestBody = JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1000,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user',   content: 'Challenge scenario: "' + scenario + '"\n\nUser\'s prompt: "' + prompt + '"' }
      ]
    });

    var openAIResponse = await new Promise(function(resolve, reject) {
      var options = {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey,
          'Content-Length': Buffer.byteLength(requestBody)
        }
      };

      var req = https.request(options, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() { resolve({ status: res.statusCode, body: data }); });
      });

      req.on('error', reject);
      req.write(requestBody);
      req.end();
    });

    if (openAIResponse.status !== 200) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: 'OpenAI API error: ' + openAIResponse.status })
      };
    }

    var openAIData = JSON.parse(openAIResponse.body);
    var text = openAIData.choices[0].message.content.replace(/```json|```/g, '').trim();
    var result = JSON.parse(text);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error: ' + err.message })
    };
  }
};
