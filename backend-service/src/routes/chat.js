import express from 'express';

const router = express.Router();

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

const getFallbackReply = (message) => {
  const lower = message.toLowerCase();

  if (lower.includes('pothole') || lower.includes('road')) {
    return 'A pothole report should include a photo, exact location, and a quick description of road damage. You can report it from the Citizen Report page and it will be triaged to the dispatch board.';
  }

  if (lower.includes('garbage') || lower.includes('waste') || lower.includes('litter')) {
    return 'Garbage or waste issues can be reported with a photo and the spot location. The system will score the risk, group nearby reports, and route it to the relevant team.';
  }

  if (lower.includes('streetlight') || lower.includes('light')) {
    return 'If a streetlight is damaged or out, report the exact intersection and the lighting issue. The system flags safety risk and helps dispatch a maintenance crew faster.';
  }

  if (lower.includes('thank') || lower.includes('hello') || lower.includes('hi')) {
    return 'Hi! I can help with civic issue reporting, dispatch workflow, and service status for CivicPulse AI. Ask me anything about new reports, priorities, or the command center.';
  }

  return 'I can help with CivicPulse AI reporting, triage, issue types, or dispatch workflow. If you want to report a city issue, tell me what happened and where it is.';
};

router.post('/', async (req, res) => {
  const message = String(req.body?.message || '').trim();

  if (!message) {
    return res.status(400).json({ message: 'Please enter a message for the AI assistant.' });
  }

  if (!geminiApiKey) {
    return res.json({
      reply: getFallbackReply(message),
      fallback: true,
    });
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: message }],
            },
          ],
          systemInstruction: {
            role: 'system',
            parts: [{
              text: 'You are CivicPulse AI, a civic reporting assistant for a city issue management app. Help residents report issues, explain the workflow, and give short, practical guidance. Keep answers concise, helpful, and in plain English.',
            }],
          },
        }),
      }
    );

    const payload = await response.json();

    if (!response.ok) {
      const errorMessage = payload?.error?.message || 'Google AI request failed.';
      throw new Error(errorMessage);
    }

    const reply = payload?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || '')
      .join('')
      .trim();

    return res.json({
      reply: reply || getFallbackReply(message),
      fallback: false,
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message || 'The AI assistant is unavailable right now.',
      reply: getFallbackReply(message),
      fallback: true,
    });
  }
});

export default router;
